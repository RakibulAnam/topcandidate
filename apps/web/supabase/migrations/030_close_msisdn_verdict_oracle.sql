-- ════════════════════════════════════════════════════════════════════════
-- Migration 030 — close the msisdn oracle for real, and fix 029's grants
-- ════════════════════════════════════════════════════════════════════════
-- 029 removed the amount and masked sender from the RESPONSE and declared the
-- oracle closed. It wasn't. The leak simply moved from the payload into the
-- verdict, because the msisdn match still decided the verdict:
--
--   where (v_purchase.sender_msisdn = c.cand_msisdn) or similarity(...) >= floor
--
-- So: create a purchase with a junk TrxID and a VICTIM'S bKash number as
-- sender_msisdn, wait past the grace window, read the verdict.
--   'likely_typo'   -> that number has an unclaimed payment
--   anything else   -> it does not
-- One bit, but it is the same bit 029's own header calls "the oracle", and
-- /api/purchase-ops/void-txn (added in 028) frees the pending slot afterwards,
-- so the 5-pending-per-24h cap does not bound the probing.
--
-- Fix: decide the verdict on TrxID similarity ALONE. That requires the prober
-- to already hold a near-correct reference — which is the system's actual proof
-- of ownership — so it is not an oracle over other people's phone numbers.
--
-- Cost: a customer whose typo is too mangled for trigram similarity now gets
-- 'nothing_found' instead of 'likely_typo'. Both tell them to re-check the ID
-- against their SMS; only the emphasis differs. That is a fair price.
--
-- ALSO: 029 recreated the function with DROP + CREATE, and Supabase's
-- ALTER DEFAULT PRIVILEGES re-granted EXECUTE to anon EXPLICITLY. `revoke ...
-- from public` does not remove an explicit role grant, so the function became
-- anon-callable over /rest/v1/rpc again. Revoke from BOTH here, for both
-- user-callable functions, so the migration history alone reproduces prod.
-- ════════════════════════════════════════════════════════════════════════

create or replace function diagnose_pending_purchase(p_transaction_id text)
returns table (
  verdict           text,
  purchase_status   text,
  amount_taka       integer,
  observed_amount   integer,
  age_seconds       integer,
  watcher_last_seen timestamp with time zone,
  watcher_live      boolean,
  attempts_24h      integer
)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  -- Must stay below PurchaseModal's VERIFY_WINDOW_MS (20s), or the modal always
  -- asks inside the grace window and the firm verdicts become unreachable.
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

  -- Reference similarity ONLY. The customer-supplied sender_msisdn is
  -- deliberately NOT consulted: it is unverified, and letting it decide the
  -- verdict turns this function into a lookup for "does this phone number have
  -- an unclaimed payment?". See the header.
  select exists (
    with candidates as (
      select ip.payment_reference as cand_ref
      from public.inbound_payments ip
      where ip.consumed_at is null
        and ip.received_at > now() - interval '24 hours'
      union all
      select us.payment_reference as cand_ref
      from public.unmatched_inbound_sms us
      where us.matched_to_purchase_id is null
        and us.reviewed_at is null
        and us.created_at > now() - interval '24 hours'
    )
    select 1 from candidates c
    where similarity(c.cand_ref, p_transaction_id) >= c_sim_floor
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

-- Revoke from public AND anon: a DROP+CREATE re-grants anon explicitly via
-- Supabase's default privileges, which a public-only revoke leaves in place.
revoke execute on function diagnose_pending_purchase(text) from public, anon;
grant  execute on function diagnose_pending_purchase(text) to authenticated, service_role;

revoke execute on function void_pending_purchase(text) from public, anon;
grant  execute on function void_pending_purchase(text) to authenticated, service_role;
