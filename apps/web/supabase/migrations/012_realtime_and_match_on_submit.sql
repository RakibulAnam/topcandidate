-- ════════════════════════════════════════════════════════════════════════
-- Migration 012 — near-real-time credit assignment
-- ════════════════════════════════════════════════════════════════════════
-- Goal: collapse "user submits TrxID → credits granted" from minutes to
-- seconds. Two structural changes plus a Realtime hookup:
--
-- (1) inbound_payments — server-side memory of an HMAC-verified bKash SMS that
--     reached the watcher BEFORE the customer submitted their TrxID. Today the
--     server forgets that SMS (it just 404s) and the watcher only retries every
--     few minutes, so the common "pay first, paste TrxID seconds later" flow
--     waits for the next retry. With this table the confirm-purchase webhook
--     records the verified SMS on a 404, and initiate_purchase matches it the
--     instant the user submits.
--
-- (2) initiate_purchase v3 (match-on-submit) — after inserting the pending row
--     it checks inbound_payments and settles (complete / underpaid /
--     mismatch) synchronously, in the SAME locked, idempotent path the webhook
--     uses. Pay-first purchases now grant credits inside the submit request.
--
-- (3) purchases is added to the supabase_realtime publication (+ replica
--     identity full) so the web client can subscribe to its own purchase row
--     and reflect the grant in <1s instead of polling.
--
-- Idempotent: re-running is safe (IF NOT EXISTS / CREATE OR REPLACE / guarded
-- publication add). Mirror of these objects lives in supabase/schema.sql.
-- ════════════════════════════════════════════════════════════════════════

-- ── (1) inbound_payments ──────────────────────────────────────────────────
-- Short-lived store of verified-but-unmatched bKash SMS. Distinct from
-- unmatched_inbound_sms (the operator's 24h reconciliation queue): this one is
-- consumed automatically when the customer submits, usually within seconds, and
-- never surfaces in the admin Orphans tab.
create table if not exists inbound_payments (
  payment_reference    text primary key,          -- bKash TrxID (uppercased)
  sender_msisdn        text,
  amount_taka          integer not null,
  raw_body             text,
  sms_timestamp        timestamp with time zone,
  received_at          timestamp with time zone default timezone('utc', now()) not null,
  consumed_at          timestamp with time zone,   -- set when matched to a purchase
  consumed_purchase_id uuid references purchases(id)
);
alter table inbound_payments enable row level security;
-- No user/anon policies — only SECURITY DEFINER functions and the service-role
-- key touch this table. Customers never read it directly.
create index if not exists inbound_payments_unconsumed_idx
  on inbound_payments(received_at) where consumed_at is null;

-- ── record_inbound_payment ─────────────────────────────────────────────────
-- Called by the /api/confirm-purchase webhook (service-role) on a genuine 404
-- (no pending and no completed row). Stores the verified SMS so a later
-- initiate_purchase can match it. Idempotent on the TrxID.
create or replace function record_inbound_payment(
  p_payment_reference text,
  p_sender_msisdn     text,
  p_amount_taka       integer,
  p_raw_body          text default null,
  p_sms_timestamp     timestamp with time zone default null
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if length(coalesce(p_payment_reference, '')) < 6 then
    raise exception 'invalid_transaction_id';
  end if;
  if p_amount_taka is null or p_amount_taka <= 0 then
    raise exception 'invalid_amount';
  end if;
  insert into inbound_payments
    (payment_reference, sender_msisdn, amount_taka, raw_body, sms_timestamp)
  values
    (p_payment_reference, p_sender_msisdn, p_amount_taka,
     p_raw_body, coalesce(p_sms_timestamp, timezone('utc', now())))
  on conflict (payment_reference) do nothing;
end; $$;
revoke execute on function record_inbound_payment(text, text, integer, text, timestamp with time zone)
  from public, anon, authenticated;

-- ── (2) initiate_purchase v3 — match-on-submit ─────────────────────────────
-- Return type changes from `uuid` to a table, so the old signature must be
-- dropped before recreating.
drop function if exists initiate_purchase(text, text, text);
create or replace function initiate_purchase(
  p_package_id     text,
  p_transaction_id text,
  p_sender_msisdn  text default null
) returns table (
  purchase_id     uuid,
  status_out      text,
  credits_granted integer,
  new_balance     integer
)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_credits       integer;
  v_amount_taka   integer;
  v_purchase_id   uuid;
  v_pending_count integer;
  v_inbound       public.inbound_payments%rowtype;
  v_status        text := 'pending';
  v_balance       integer := null;
  v_surplus       integer;
begin
  -- Package mapping is hardcoded server-side so users can't fake credits/amount.
  case p_package_id
    when 'five-pack' then v_credits := 5; v_amount_taka := 200;
    else
      raise exception 'unknown_package_id'
        using hint = 'Valid packages: five-pack.';
  end case;

  if length(coalesce(p_transaction_id, '')) < 6 then
    raise exception 'invalid_transaction_id'
      using hint = 'bKash transaction ID is required and must be at least 6 characters.';
  end if;

  if exists (select 1 from public.purchases where payment_reference = p_transaction_id) then
    raise exception 'duplicate_transaction_id'
      using hint = 'This bKash transaction ID has already been submitted.';
  end if;

  -- Anti-spam: cap pending purchases per user in the rolling 24h window.
  select count(*) into v_pending_count
  from public.purchases
  where user_id = auth.uid()
    and status = 'pending'
    and created_at > now() - interval '24 hours';
  if v_pending_count >= 5 then
    raise exception 'too_many_pending'
      using hint = 'Too many pending purchases. Wait for confirmation or contact support.';
  end if;

  insert into public.purchases (
    user_id, credits_granted, amount_taka, payment_reference, sender_msisdn, status
  ) values (
    auth.uid(), v_credits, v_amount_taka, p_transaction_id, p_sender_msisdn, 'pending'
  )
  returning id into v_purchase_id;

  -- ── Match-on-submit ──────────────────────────────────────────────────────
  -- Did the watcher already deliver a verified SMS for this TrxID (it arrived
  -- before the user submitted)? If so, settle now instead of waiting for the
  -- watcher's next retry. Same checks as confirm_purchase; lock the inbound row.
  select * into v_inbound
  from public.inbound_payments
  where payment_reference = p_transaction_id and consumed_at is null
  for update;

  if found then
    if p_sender_msisdn is not null
       and v_inbound.sender_msisdn is not null
       and p_sender_msisdn <> v_inbound.sender_msisdn then
      -- Claimed sender (submit) != observed sender (SMS).
      update public.purchases
        set status = 'msisdn_mismatch_review',
            observed_amount_taka = v_inbound.amount_taka
        where id = v_purchase_id;
      insert into public.purchase_state_changes (purchase_id, from_status, to_status, actor, reason)
        values (v_purchase_id, 'pending', 'msisdn_mismatch_review', 'system-match',
                format('claimed=%s observed=%s', p_sender_msisdn, v_inbound.sender_msisdn));
      v_status := 'msisdn_mismatch_review';

    elsif v_inbound.amount_taka < v_amount_taka then
      update public.purchases
        set status = 'underpaid',
            observed_amount_taka = v_inbound.amount_taka
        where id = v_purchase_id;
      insert into public.purchase_state_changes (purchase_id, from_status, to_status, actor, reason)
        values (v_purchase_id, 'pending', 'underpaid', 'system-match',
                format('observed=%s expected=%s', v_inbound.amount_taka, v_amount_taka));
      v_status := 'underpaid';

    else
      update public.purchases
        set status = 'completed',
            observed_amount_taka = v_inbound.amount_taka
        where id = v_purchase_id;
      update public.profiles
        set toolkit_credits = toolkit_credits + v_credits
        where id = auth.uid()
        returning toolkit_credits into v_balance;
      insert into public.purchase_state_changes (purchase_id, from_status, to_status, actor, reason)
        values (v_purchase_id, 'pending', 'completed', 'system-match',
                format('matched inbound SMS observed=%s', v_inbound.amount_taka));
      if v_inbound.amount_taka > v_amount_taka then
        v_surplus := v_inbound.amount_taka - v_amount_taka;
        insert into public.purchase_overpayments (purchase_id, surplus_taka)
          values (v_purchase_id, v_surplus);
      end if;
      v_status := 'completed';
    end if;

    update public.inbound_payments
      set consumed_at = timezone('utc', now()), consumed_purchase_id = v_purchase_id
      where payment_reference = p_transaction_id;
  end if;

  return query select v_purchase_id, v_status, v_credits, v_balance;
end; $$;
-- Stays user-callable (uses auth.uid()); default PUBLIC EXECUTE is preserved as
-- in v1/v2. anon callers can't insert (auth.uid() is null vs NOT NULL user_id).

-- ── Prune inbound_payments from the existing expiry sweep ──────────────────
-- Reuses the periodic job (pg_cron or admin "run expiry" button). Deletes
-- consumed rows and anything older than 48h so the table stays small.
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

  return v_affected;
end; $$;
revoke execute on function expire_stale_pending_purchases() from public, anon, authenticated;

-- ── (3) Realtime on purchases ──────────────────────────────────────────────
-- Adds the table to the supabase_realtime publication so the web client can
-- subscribe to status changes (replaces polling). RLS still gates delivery —
-- a user only receives changes to rows they can SELECT (their own).
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'purchases'
  ) then
    alter publication supabase_realtime add table public.purchases;
  end if;
end $$;

-- replica identity full so the realtime change payload carries the full row
-- (needed for the payment_reference filter and to read status/amount fields).
alter table purchases replica identity full;
