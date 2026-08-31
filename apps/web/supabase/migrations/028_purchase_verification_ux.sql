-- ════════════════════════════════════════════════════════════════════════
-- Migration 028 — in-modal purchase verification + typo diagnosis
-- ════════════════════════════════════════════════════════════════════════
-- Problem this solves. PurchaseModal closed the instant /api/purchase
-- returned anything other than 'completed', showed a success toast, and left
-- a navbar spinner as the only affordance. A customer who mistyped their
-- bKash TrxID got the same "credits will land soon" message as a customer
-- whose payment was already matched — and then watched the spinner turn for
-- up to 24h (the expiry sweep) with no diagnosis and no way out.
--
-- Fixing that needs the server to answer a question it previously could not:
-- "this purchase is still pending — is that because we haven't seen the SMS
-- yet, or because the TrxID is wrong?" Those look identical at submit time.
-- Three objects here make the distinction answerable:
--
--   (1) watcher_heartbeats     — liveness of the operator's SMS-watcher phone.
--                                Without it, "we haven't seen your SMS" is
--                                ambiguous between "your ID is wrong" and
--                                "our phone is offline", and guessing wrong
--                                accuses a paying customer. Optional by
--                                design: with no heartbeat rows the diagnosis
--                                degrades to soft wording rather than lying.
--   (2) diagnose_pending_purchase — user-callable. Looks for an unclaimed
--                                verified payment that resembles what the
--                                customer typed, or that came from the number
--                                they gave us, and returns a verdict.
--   (3) void_pending_purchase  — lets a customer retire their own mistyped
--                                pending row so a corrected resubmit doesn't
--                                burn another slot in the 5-per-24h cap.
--
-- PRIVACY / FRAUD NOTE (deliberate, do not "improve" this):
-- diagnose_pending_purchase never returns the payment_reference of an
-- unclaimed payment. purchases.sender_msisdn is supplied by the customer at
-- submit time and is NOT verified, so an msisdn match is not proof of
-- ownership — revealing a reference on that basis would let someone who knows
-- a victim's bKash number submit a junk TrxID, read back the victim's real
-- TrxID, and claim their payment. The genuine customer is holding the SMS and
-- does not need us to read the ID back to them; they need to know that their
-- typed ID doesn't match and that their money is visible to us. So we return
-- the amount, a masked sender, and two booleans — never the reference.
--
-- Idempotent: create table if not exists / create or replace function.
-- Mirror of these objects lives in supabase/schema.sql.
-- Depends on: pg_trgm (already installed — see schema.sql, admin Users tab).
-- ════════════════════════════════════════════════════════════════════════

-- ── (1) watcher_heartbeats ────────────────────────────────────────────────
-- One row per operator device. The Flutter watcher pings
-- POST /api/confirm-purchase { kind: 'heartbeat', ... } on its existing HMAC
-- credentials; see docs/contracts/webhook-confirm-purchase.md.
create table if not exists watcher_heartbeats (
  device_id    text primary key,
  last_seen_at timestamp with time zone not null default timezone('utc', now()),
  app_version  text,
  queue_depth  integer,                    -- rows the watcher still owes us
  ping_count   bigint not null default 1
);
alter table watcher_heartbeats enable row level security;
-- No user/anon policies — service-role and SECURITY DEFINER functions only.
-- Customers never read this table directly; diagnose_pending_purchase reads
-- it on their behalf and returns only a derived boolean + timestamp.

create or replace function record_watcher_heartbeat(
  p_device_id   text,
  p_app_version text default null,
  p_queue_depth integer default null
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if length(coalesce(p_device_id, '')) < 1 then
    raise exception 'invalid_device_id';
  end if;
  insert into public.watcher_heartbeats (device_id, app_version, queue_depth)
  values (p_device_id, p_app_version, p_queue_depth)
  on conflict (device_id) do update
    set last_seen_at = timezone('utc', now()),
        app_version  = coalesce(excluded.app_version, watcher_heartbeats.app_version),
        queue_depth  = excluded.queue_depth,
        ping_count   = watcher_heartbeats.ping_count + 1;
end; $$;
revoke execute on function record_watcher_heartbeat(text, text, integer)
  from public, anon, authenticated;

-- ── (2) diagnose_pending_purchase ─────────────────────────────────────────
-- Why is MY purchase still pending? Ownership is enforced via auth.uid(), so
-- this is safe to expose to a user JWT. Probing is naturally rate-limited:
-- it requires an owned purchase row, and initiate_purchase caps a user at 5
-- pending rows per 24h.
--
-- verdict is one of:
--   'completed' | 'underpaid' | 'msisdn_mismatch_review'
--   | 'expired' | 'refunded' | 'failed'   — already settled, render that
--   'likely_typo'   — an unclaimed verified payment resembles what they typed,
--                     or came from the number they gave us
--   'awaiting_sms'  — too early to conclude anything (or no heartbeat data)
--   'watcher_stale' — our phone hasn't checked in; our problem, not theirs
--   'nothing_found' — watcher is live, grace period passed, nothing matches
create or replace function diagnose_pending_purchase(p_transaction_id text)
returns table (
  verdict            text,
  purchase_status    text,
  amount_taka        integer,
  observed_amount    integer,
  age_seconds        integer,
  near_amount_taka   integer,
  near_msisdn_masked text,
  near_similar       boolean,
  near_msisdn_match  boolean,
  watcher_last_seen  timestamp with time zone,
  watcher_live       boolean,
  attempts_24h       integer
)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  -- Grace period before we will give a firm "nothing arrived" answer. bKash
  -- delivers to payer and payee independently and Android dispatch adds a
  -- little on top, so a very fresh purchase proves nothing either way.
  --
  -- INVARIANT: this MUST stay below PurchaseModal's VERIFY_WINDOW_MS (20s).
  -- The modal asks for a verdict the moment its window closes; if the grace
  -- period outlasts that, every answer is 'awaiting_sms' and the
  -- 'nothing_found' / 'watcher_stale' verdicts — and with them the entire
  -- heartbeat mechanism — become unreachable. It was 90s and did exactly that.
  --
  -- Being early here costs little: the 'nothing_found' copy is "we haven't
  -- received this payment yet, if you've already sent it give it another
  -- minute", which stays true for a merely-slow payment. The gentleness lives
  -- in the wording, not in the threshold.
  c_grace_seconds  constant integer := 15;
  -- A watcher that pings every 60s (see the mobile dispatcher) is stale at 5m.
  c_stale_interval constant interval := interval '5 minutes';
  -- pg_trgm similarity floor for "this looks like a typo of that". 0.45 keeps
  -- a 1-2 character slip on a 10-char bKash TrxID and rejects unrelated IDs.
  c_sim_floor      constant real := 0.45;

  v_purchase   public.purchases%rowtype;
  v_age        integer;
  v_attempts   integer;
  v_last_seen  timestamp with time zone;
  v_live       boolean;
  v_near_amt   integer;
  v_near_msisdn text;
  v_near_sim   boolean := false;
  v_near_match boolean := false;
  v_verdict    text;
begin
  if length(coalesce(p_transaction_id, '')) < 6 then
    raise exception 'invalid_transaction_id';
  end if;

  select * into v_purchase
  from public.purchases
  where payment_reference = p_transaction_id and user_id = auth.uid();

  if not found then
    -- Deliberately the same error whether the row is absent or someone
    -- else's — don't confirm the existence of another user's TrxID.
    raise exception 'purchase_not_found';
  end if;

  v_age := greatest(0, floor(extract(epoch from (now() - v_purchase.created_at)))::integer);

  -- How many times has this customer submitted in the last 24h? Voided
  -- (mistyped) rows land in 'failed', so they count as attempts here even
  -- though they no longer count against the pending cap.
  select count(*) into v_attempts
  from public.purchases
  where user_id = auth.uid()
    and created_at > now() - interval '24 hours'
    and status in ('pending', 'failed', 'expired');

  select max(last_seen_at) into v_last_seen from public.watcher_heartbeats;
  -- NULL (not false) when we have no heartbeat data at all, so the caller can
  -- tell "phone is down" from "we never wired up heartbeats".
  v_live := case when v_last_seen is null then null
                 else v_last_seen > now() - c_stale_interval end;

  if v_purchase.status <> 'pending' then
    return query select
      v_purchase.status, v_purchase.status, v_purchase.amount_taka,
      v_purchase.observed_amount_taka, v_age,
      null::integer, null::text, false, false,
      v_last_seen, v_live, v_attempts;
    return;
  end if;

  -- ── Typo evidence ──────────────────────────────────────────────────────
  -- Look through every HMAC-verified payment nobody has claimed, from both
  -- stores: inbound_payments (fresh, auto-consumed on match) and
  -- unmatched_inbound_sms (the operator's reconciliation queue). Rank an
  -- msisdn match above a fuzzy reference match, then by similarity.
  -- Every column below is aliased away from the RETURNS TABLE output names
  -- (amount_taka, near_amount_taka, ...). A bare `amount_taka` here would
  -- collide with the OUT parameter of the same name and Postgres would raise
  -- "column reference is ambiguous" at runtime.
  with candidates as (
    select ip.payment_reference as cand_ref,
           ip.sender_msisdn     as cand_msisdn,
           ip.amount_taka       as cand_amount
    from public.inbound_payments ip
    where ip.consumed_at is null
      and ip.received_at > now() - interval '24 hours'
    union all
    select us.payment_reference as cand_ref,
           us.sender_msisdn     as cand_msisdn,
           us.amount_taka       as cand_amount
    from public.unmatched_inbound_sms us
    where us.matched_to_purchase_id is null
      and us.reviewed_at is null
      and us.created_at > now() - interval '24 hours'
  ),
  scored as (
    select
      c.cand_amount,
      c.cand_msisdn,
      (v_purchase.sender_msisdn is not null
        and c.cand_msisdn is not null
        and c.cand_msisdn = v_purchase.sender_msisdn) as cand_msisdn_match,
      similarity(c.cand_ref, p_transaction_id) as cand_sim
    from candidates c
  )
  select s.cand_amount, s.cand_msisdn,
         s.cand_sim >= c_sim_floor, s.cand_msisdn_match
    into v_near_amt, v_near_msisdn, v_near_sim, v_near_match
  from scored s
  where s.cand_msisdn_match or s.cand_sim >= c_sim_floor
  order by s.cand_msisdn_match desc, s.cand_sim desc
  limit 1;

  if v_near_amt is not null then
    v_verdict := 'likely_typo';
  elsif v_age < c_grace_seconds then
    v_verdict := 'awaiting_sms';
  elsif v_live is null then
    -- No heartbeat wired up yet: we cannot honestly claim the watcher is
    -- healthy, so stay soft rather than blaming the customer.
    v_verdict := 'awaiting_sms';
  elsif v_live then
    v_verdict := 'nothing_found';
  else
    v_verdict := 'watcher_stale';
  end if;

  return query select
    v_verdict, v_purchase.status, v_purchase.amount_taka,
    v_purchase.observed_amount_taka, v_age,
    v_near_amt,
    -- Masked, never the raw number: 01712345678 -> 01712•••78
    case when v_near_msisdn is null or length(v_near_msisdn) < 7 then null
         else left(v_near_msisdn, 5) || '•••' || right(v_near_msisdn, 2) end,
    coalesce(v_near_sim, false), coalesce(v_near_match, false),
    v_last_seen, v_live, v_attempts;
end; $$;
-- Ownership comes from auth.uid(), never a parameter, so this is safe to expose
-- to a signed-in user. Drop the DEFAULT PUBLIC execute grant that CREATE
-- FUNCTION leaves behind and grant the two roles explicitly: without this,
-- `anon` inherits EXECUTE via PUBLIC and the function is reachable over
-- /rest/v1/rpc without a JWT. It fails closed there (auth.uid() is null, so no
-- row matches) but it is still needless unauthenticated surface, and every
-- other user-callable definer function here is locked down the same way
-- (see migration 025). Supabase's linter flags the PUBLIC grant as
-- `anon_security_definer_function_executable`.
revoke execute on function diagnose_pending_purchase(text) from public;
grant  execute on function diagnose_pending_purchase(text) to authenticated, service_role;

-- ── (3) void_pending_purchase ─────────────────────────────────────────────
-- "Edit & resubmit" after a mistyped TrxID. Retires the customer's own
-- pending row to 'failed' so the corrected submit doesn't consume another of
-- their 5 pending slots. The payment_reference stays taken (unique index) —
-- intentional: it preserves the audit trail, and the corrected ID differs.
create or replace function void_pending_purchase(p_transaction_id text)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  update public.purchases
    set status = 'failed'
    where payment_reference = p_transaction_id
      and user_id = auth.uid()
      and status = 'pending'
    returning id into v_id;

  if v_id is null then
    -- Absent, someone else's, or already settled. Same error either way so we
    -- don't confirm another user's TrxID exists.
    raise exception 'no_voidable_purchase';
  end if;

  insert into public.purchase_state_changes
    (purchase_id, from_status, to_status, actor, reason)
  values (v_id, 'pending', 'failed', 'user-corrected',
          'Customer voided a mistyped TrxID before resubmitting');
end; $$;
-- Same lockdown as diagnose_pending_purchase: no PUBLIC grant, so `anon`
-- cannot reach it over the REST RPC endpoint.
revoke execute on function void_pending_purchase(text) from public;
grant  execute on function void_pending_purchase(text) to authenticated, service_role;

-- ── Prune heartbeats from the existing expiry sweep ───────────────────────
-- Reuses the periodic job (pg_cron or the admin "run expiry" button) rather
-- than adding a schedule. Drops devices that stopped reporting a month ago.
create or replace function expire_stale_pending_purchases() returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_affected integer;
begin
  with expired as (
    update purchases set status = 'expired'
      where status = 'pending' and created_at < now() - interval '24 hours'
      returning id
  ),
  audited as (
    insert into purchase_state_changes (purchase_id, from_status, to_status, actor, reason)
      select id, 'pending', 'expired', 'system', 'TTL exceeded (24h)' from expired
      returning 1
  )
  select count(*) into v_affected from expired;

  delete from inbound_payments
    where consumed_at is not null
       or received_at < now() - interval '48 hours';

  delete from watcher_heartbeats
    where last_seen_at < now() - interval '30 days';

  return v_affected;
end; $$;
revoke execute on function expire_stale_pending_purchases() from public, anon, authenticated;
