-- ════════════════════════════════════════════════════════════════════════
-- Migration 029 — stop describing OTHER people's payments
-- ════════════════════════════════════════════════════════════════════════
-- Corrects a privacy hole in 028's diagnose_pending_purchase.
--
-- 028 already refused to return the payment_reference of an unclaimed
-- payment, for the right reason: purchases.sender_msisdn is typed by the
-- customer at submit time and is never verified, so it proves nothing about
-- ownership. But it then used that same unverified value to decide whether to
-- reveal the payment's amount and a masked sender. That is the same mistake
-- one level down, and it opens two leaks:
--
--   1. msisdn oracle. Submit a junk TrxID claiming a victim's bKash number as
--      your own. If the victim has an unclaimed payment, near_msisdn_match
--      comes back true and the UI says "we can see a ৳200 payment from
--      01712•••78" — confirming that number paid, and how much.
--
--   2. Similarity oracle. The near-miss search matches on pg_trgm similarity,
--      which is NOT ownership. An honest customer's typo can land next to a
--      stranger's genuine unclaimed payment, and we would disclose its amount
--      to the wrong person.
--
-- In this system the ONLY evidence of ownership is possession of the correct
-- TrxID — that is the whole security model. Nothing available at diagnosis
-- time proves the near-miss belongs to the person asking, so the function now
-- describes it to nobody: no reference, no amount, no sender, and not even the
-- booleans, since `near_msisdn_match = true` IS the oracle in (1).
--
-- The near-miss search itself is kept — it still decides between the
-- 'likely_typo' and 'nothing_found' verdicts, which is what changes the advice
-- the customer gets. The verdict alone carries that, and the reassurance moves
-- into copy that makes no claim about anyone's payment.
--
-- Idempotent (create or replace). Mirrored in supabase/schema.sql.
-- ════════════════════════════════════════════════════════════════════════

drop function if exists diagnose_pending_purchase(text);

create or replace function diagnose_pending_purchase(p_transaction_id text)
returns table (
  verdict           text,
  purchase_status   text,
  amount_taka       integer,   -- the CALLER'S own pack price, not anyone else's
  observed_amount   integer,   -- the CALLER'S own settled row
  age_seconds       integer,
  watcher_last_seen timestamp with time zone,
  watcher_live      boolean,
  attempts_24h      integer
)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  -- Must stay below PurchaseModal's VERIFY_WINDOW_MS (20s) or the firm
  -- verdicts are unreachable — see migration 028's fix.
  c_grace_seconds  constant integer := 15;
  c_stale_interval constant interval := interval '5 minutes';
  c_sim_floor      constant real := 0.45;

  v_purchase   public.purchases%rowtype;
  v_age        integer;
  v_attempts   integer;
  v_last_seen  timestamp with time zone;
  v_live       boolean;
  v_near_found boolean := false;
  v_verdict    text;
begin
  if length(coalesce(p_transaction_id, '')) < 6 then
    raise exception 'invalid_transaction_id';
  end if;

  select * into v_purchase
  from public.purchases
  where payment_reference = p_transaction_id and user_id = auth.uid();

  if not found then
    raise exception 'purchase_not_found';
  end if;

  v_age := greatest(0, floor(extract(epoch from (now() - v_purchase.created_at)))::integer);

  select count(*) into v_attempts
  from public.purchases
  where user_id = auth.uid()
    and created_at > now() - interval '24 hours'
    and status in ('pending', 'failed', 'expired');

  select max(last_seen_at) into v_last_seen from public.watcher_heartbeats;
  v_live := case when v_last_seen is null then null
                 else v_last_seen > now() - c_stale_interval end;

  if v_purchase.status <> 'pending' then
    return query select
      v_purchase.status, v_purchase.status, v_purchase.amount_taka,
      v_purchase.observed_amount_taka, v_age,
      v_last_seen, v_live, v_attempts;
    return;
  end if;

  -- Is there an unclaimed verified payment that resembles what they typed, or
  -- that came from the number they gave us? The ANSWER stays inside this
  -- function: it only chooses the verdict. Nothing about that payment is
  -- returned, because nothing here proves it is theirs.
  select exists (
    with candidates as (
      select ip.payment_reference as cand_ref, ip.sender_msisdn as cand_msisdn
      from public.inbound_payments ip
      where ip.consumed_at is null
        and ip.received_at > now() - interval '24 hours'
      union all
      select us.payment_reference as cand_ref, us.sender_msisdn as cand_msisdn
      from public.unmatched_inbound_sms us
      where us.matched_to_purchase_id is null
        and us.reviewed_at is null
        and us.created_at > now() - interval '24 hours'
    )
    select 1 from candidates c
    where (v_purchase.sender_msisdn is not null
           and c.cand_msisdn is not null
           and c.cand_msisdn = v_purchase.sender_msisdn)
       or similarity(c.cand_ref, p_transaction_id) >= c_sim_floor
  ) into v_near_found;

  if v_near_found then
    v_verdict := 'likely_typo';
  elsif v_age < c_grace_seconds then
    v_verdict := 'awaiting_sms';
  elsif v_live is null then
    v_verdict := 'awaiting_sms';
  elsif v_live then
    v_verdict := 'nothing_found';
  else
    v_verdict := 'watcher_stale';
  end if;

  return query select
    v_verdict, v_purchase.status, v_purchase.amount_taka,
    v_purchase.observed_amount_taka, v_age,
    v_last_seen, v_live, v_attempts;
end; $$;

-- Revoke from BOTH public and anon. This function is created with DROP +
-- CREATE above, and Supabase ships ALTER DEFAULT PRIVILEGES that grant EXECUTE
-- on NEW functions to anon/authenticated/service_role — as an EXPLICIT role
-- grant, which `revoke ... from public` does NOT remove. Revoking only from
-- public left it callable over /rest/v1/rpc with no JWT.
revoke execute on function diagnose_pending_purchase(text) from public, anon;
grant  execute on function diagnose_pending_purchase(text) to authenticated, service_role;
