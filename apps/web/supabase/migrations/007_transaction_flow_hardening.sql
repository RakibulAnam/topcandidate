-- 007 — Harden the bKash purchase flow against every observable edge case.
--
-- Implements the work in
-- `topcandidate-audit-2026-05-08/PROMPT-transaction-flow-edge-cases.md`.
-- Idempotent: safe to re-run.
--
-- What this migration adds:
--   1. Expanded `purchases.status` enum: + expired, underpaid, msisdn_mismatch_review
--   2. `purchases.observed_amount_taka` — what the SMS actually said vs what the row expected
--   3. `purchase_topups` — multi-SMS aggregation when a customer pays in pieces (case #14)
--   4. `purchase_overpayments` — surplus audit for refund/tip decisions (case #4)
--   5. `unmatched_inbound_sms` — orphan SMS the Flutter app couldn't match (cases #2, #5)
--   6. `purchase_disputes` — customer-filed disputes (case #10)
--   7. `purchase_state_changes` — append-only state-transition audit (all manual paths)
--   8. confirm_purchase v2 — amount comparison + topup aggregation + state-change logging
--   9. operator_confirm_purchase RPC — bypass amount/msisdn checks, audit the override
--  10. operator_refund_purchase RPC — flip completed → refunded, decrement credits
--  11. record_overpayment RPC — log surplus when an over-payment lands
--  12. apply_purchase_topup RPC — add a top-up SMS, re-evaluate underpaid → completed/underpaid
--  13. record_orphan_sms RPC — Flutter dumps unmatched SMS into reviewable queue
--  14. record_purchase_reversal RPC — bKash reversal SMS path (case #7)
--  15. record_purchase_dispute RPC — customer-callable dispute insert (case #10)
--  16. expire_stale_pending_purchases — cron-callable, 24h TTL on pending rows (case #1)

-- ── 1. Status enum expansion ─────────────────────────────────────────────
alter table public.purchases
  drop constraint if exists purchases_status_check;

alter table public.purchases
  add constraint purchases_status_check check (status in (
    'pending',
    'completed',
    'failed',
    'expired',
    'underpaid',
    'msisdn_mismatch_review',
    'refunded'
  ));

-- ── 2. Track the actual amount we observed via SMS ───────────────────────
alter table public.purchases
  add column if not exists observed_amount_taka integer;

-- ── 3. Top-ups (multi-SMS aggregation; case #14) ─────────────────────────
create table if not exists public.purchase_topups (
  id                uuid default uuid_generate_v4() primary key,
  purchase_id       uuid references public.purchases(id) on delete cascade not null,
  payment_reference text not null,
  sender_msisdn     text,
  amount_taka       integer not null,
  created_at        timestamp with time zone default timezone('utc'::text, now()),
  unique(payment_reference)
);

alter table public.purchase_topups enable row level security;
-- service_role only; no user-facing policies.

create index if not exists purchase_topups_purchase_idx
  on public.purchase_topups(purchase_id);

-- ── 4. Overpayments (surplus audit; case #4) ─────────────────────────────
create table if not exists public.purchase_overpayments (
  id           uuid default uuid_generate_v4() primary key,
  purchase_id  uuid references public.purchases(id) on delete cascade not null,
  surplus_taka integer not null,
  resolution   text not null default 'pending'
    check (resolution in ('pending','refunded','kept_as_credit')),
  created_at   timestamp with time zone default timezone('utc'::text, now())
);

alter table public.purchase_overpayments enable row level security;

create index if not exists purchase_overpayments_purchase_idx
  on public.purchase_overpayments(purchase_id);

-- ── 5. Orphan inbound SMS (cases #2, #5) ─────────────────────────────────
-- Populated by the Flutter watcher when it can't find a matching pending row
-- after its 24h retry window, OR when the customer's typed TrxID doesn't
-- match the SMS-actual TrxID.
create table if not exists public.unmatched_inbound_sms (
  id                     uuid default uuid_generate_v4() primary key,
  payment_reference      text not null,
  sender_msisdn          text,
  amount_taka            integer not null,
  raw_body               text,
  sms_timestamp          timestamp with time zone not null,
  matched_to_purchase_id uuid references public.purchases(id),
  created_at             timestamp with time zone default timezone('utc'::text, now()),
  unique(payment_reference)
);

alter table public.unmatched_inbound_sms enable row level security;

create index if not exists unmatched_inbound_sms_unmatched_idx
  on public.unmatched_inbound_sms(created_at desc)
  where matched_to_purchase_id is null;

-- ── 6. Customer-filed disputes (case #10) ────────────────────────────────
create table if not exists public.purchase_disputes (
  id                uuid default uuid_generate_v4() primary key,
  user_id           uuid references public.profiles(id) not null,
  payment_reference text not null,
  notes             text,
  status            text not null default 'open'
    check (status in ('open','resolved','rejected')),
  operator_note     text,
  created_at        timestamp with time zone default timezone('utc'::text, now()),
  resolved_at       timestamp with time zone
);

alter table public.purchase_disputes enable row level security;

-- Customers can read + insert their own dispute rows. Resolution is
-- operator-only (no UPDATE policy for users).
drop policy if exists "Users can view own disputes" on public.purchase_disputes;
create policy "Users can view own disputes" on public.purchase_disputes
  for select using (auth.uid() = user_id);

drop policy if exists "Users can insert own disputes" on public.purchase_disputes;
create policy "Users can insert own disputes" on public.purchase_disputes
  for insert with check (auth.uid() = user_id);

create index if not exists purchase_disputes_user_idx
  on public.purchase_disputes(user_id, created_at desc);

create index if not exists purchase_disputes_open_idx
  on public.purchase_disputes(created_at desc)
  where status = 'open';

-- ── 7. State-transition audit (all manual paths; cases #11/#12) ──────────
create table if not exists public.purchase_state_changes (
  id          uuid default uuid_generate_v4() primary key,
  purchase_id uuid references public.purchases(id) on delete cascade not null,
  from_status text,
  to_status   text not null,
  actor       text not null,     -- 'system' | 'operator' | 'flutter' | 'customer'
  reason      text,
  created_at  timestamp with time zone default timezone('utc'::text, now())
);

alter table public.purchase_state_changes enable row level security;

create index if not exists purchase_state_changes_purchase_idx
  on public.purchase_state_changes(purchase_id, created_at desc);

-- ── 8. confirm_purchase v2 ───────────────────────────────────────────────
--
-- New signature: adds `p_observed_amount_taka`. The webhook now passes the
-- amount the Flutter app extracted from the SMS. Logic:
--
--   - msisdn mismatch  → 'msisdn_mismatch' exception (operator decides)
--   - observed < expected → flip status to 'underpaid', do NOT grant credits.
--     Record observed_amount_taka. Caller maps this to 409 underpaid.
--   - observed >= expected → grant credits as before. If observed > expected,
--     log surplus to purchase_overpayments (case #4).
--
-- Top-up support: this RPC handles the FIRST inbound SMS for a TrxID. If
-- additional SMS land that reference the same purchase but with their own
-- (different) TrxIDs, the operator links them via apply_purchase_topup.
-- That re-evaluates the sum against amount_taka and flips underpaid →
-- completed when the threshold is met.
--
-- All transitions write to purchase_state_changes for the audit log.

drop function if exists public.confirm_purchase(text, text);

create or replace function public.confirm_purchase(
  p_transaction_id         text,
  p_observed_sender_msisdn text default null,
  p_observed_amount_taka   integer default null
)
returns table (user_id uuid, new_balance integer, credits_granted integer, status_out text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_purchase    public.purchases%rowtype;
  v_balance     integer;
  v_surplus     integer;
begin
  -- Lock the row that's still in a non-terminal state we can advance from.
  -- 'pending' is the normal entry point; 'underpaid' lets a fresh SMS for
  -- the same TrxID resolve a previously-stuck row (rare but possible if
  -- the customer somehow re-uses the same TrxID for the topup, e.g. via
  -- an unusual bKash flow). 'msisdn_mismatch_review' is operator-only.
  select * into v_purchase
  from public.purchases
  where payment_reference = p_transaction_id
    and status in ('pending', 'underpaid')
  for update;

  if not found then
    raise exception 'no_pending_purchase'
      using hint = 'No pending purchase matches the given transaction ID.';
  end if;

  -- msisdn check
  if v_purchase.sender_msisdn is not null
     and p_observed_sender_msisdn is not null
     and v_purchase.sender_msisdn <> p_observed_sender_msisdn
  then
    update public.purchases
      set status = 'msisdn_mismatch_review',
          observed_amount_taka = coalesce(p_observed_amount_taka, observed_amount_taka)
      where id = v_purchase.id;
    insert into public.purchase_state_changes (purchase_id, from_status, to_status, actor, reason)
      values (v_purchase.id, v_purchase.status, 'msisdn_mismatch_review', 'flutter',
              format('claimed=%s observed=%s', v_purchase.sender_msisdn, p_observed_sender_msisdn));
    raise exception 'msisdn_mismatch'
      using hint = format(
        'Pending purchase claims sender %s but observed SMS came from %s.',
        v_purchase.sender_msisdn, p_observed_sender_msisdn
      );
  end if;

  -- Amount check
  if p_observed_amount_taka is not null
     and p_observed_amount_taka < v_purchase.amount_taka
  then
    update public.purchases
      set status = 'underpaid',
          observed_amount_taka = p_observed_amount_taka
      where id = v_purchase.id;
    insert into public.purchase_state_changes (purchase_id, from_status, to_status, actor, reason)
      values (v_purchase.id, v_purchase.status, 'underpaid', 'flutter',
              format('observed=%s expected=%s', p_observed_amount_taka, v_purchase.amount_taka));
    raise exception 'underpaid'
      using hint = format(
        'Observed amount %s is less than required %s.',
        p_observed_amount_taka, v_purchase.amount_taka
      );
  end if;

  -- Happy path: grant credits, flip to completed.
  update public.purchases
    set status = 'completed',
        observed_amount_taka = coalesce(p_observed_amount_taka, observed_amount_taka)
    where id = v_purchase.id;

  update public.profiles
    set toolkit_credits = toolkit_credits + v_purchase.credits_granted
    where id = v_purchase.user_id
    returning toolkit_credits into v_balance;

  insert into public.purchase_state_changes (purchase_id, from_status, to_status, actor, reason)
    values (v_purchase.id, v_purchase.status, 'completed', 'flutter',
            case when p_observed_amount_taka is null then null
                 else format('observed=%s', p_observed_amount_taka) end);

  -- Overpayment surplus (case #4)
  if p_observed_amount_taka is not null
     and p_observed_amount_taka > v_purchase.amount_taka
  then
    v_surplus := p_observed_amount_taka - v_purchase.amount_taka;
    insert into public.purchase_overpayments (purchase_id, surplus_taka)
      values (v_purchase.id, v_surplus);
  end if;

  return query select v_purchase.user_id, v_balance, v_purchase.credits_granted, 'completed'::text;
end;
$$;

revoke execute on function public.confirm_purchase(text, text, integer) from public;
revoke execute on function public.confirm_purchase(text, text, integer) from anon;
revoke execute on function public.confirm_purchase(text, text, integer) from authenticated;

-- ── 9. operator_confirm_purchase ─────────────────────────────────────────
-- Case #11. Bypasses amount + msisdn checks when explicitly authorised by
-- the operator. Service-role only. The caller is responsible for the
-- security justification — every call lands in purchase_state_changes.
create or replace function public.operator_confirm_purchase(
  p_transaction_id        text,
  p_override_msisdn_check boolean default false,
  p_override_amount_check boolean default false,
  p_reason                text default null
)
returns table (user_id uuid, new_balance integer, credits_granted integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_purchase public.purchases%rowtype;
  v_balance  integer;
begin
  select * into v_purchase
  from public.purchases
  where payment_reference = p_transaction_id
    and status in ('pending', 'underpaid', 'msisdn_mismatch_review', 'expired')
  for update;

  if not found then
    raise exception 'no_pending_purchase'
      using hint = 'No row matches that transaction ID (or it is already completed).';
  end if;

  update public.purchases
    set status = 'completed'
    where id = v_purchase.id;

  update public.profiles
    set toolkit_credits = toolkit_credits + v_purchase.credits_granted
    where id = v_purchase.user_id
    returning toolkit_credits into v_balance;

  insert into public.purchase_state_changes (purchase_id, from_status, to_status, actor, reason)
    values (v_purchase.id, v_purchase.status, 'completed', 'operator',
            coalesce(p_reason, '')
              || case when p_override_msisdn_check then ' [msisdn_override]' else '' end
              || case when p_override_amount_check then ' [amount_override]' else '' end);

  return query select v_purchase.user_id, v_balance, v_purchase.credits_granted;
end;
$$;

revoke execute on function public.operator_confirm_purchase(text, boolean, boolean, text) from public;
revoke execute on function public.operator_confirm_purchase(text, boolean, boolean, text) from anon;
revoke execute on function public.operator_confirm_purchase(text, boolean, boolean, text) from authenticated;

-- ── 10. operator_refund_purchase ─────────────────────────────────────────
-- Case #12. Flip a completed row to refunded and decrement credits. May
-- leave the balance negative (case #8) — the paid-endpoint gate refuses
-- service until balance > 0, which is the correct UX.
create or replace function public.operator_refund_purchase(
  p_transaction_id text,
  p_reason         text default null
)
returns table (user_id uuid, new_balance integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_purchase public.purchases%rowtype;
  v_balance  integer;
begin
  select * into v_purchase
  from public.purchases
  where payment_reference = p_transaction_id
    and status = 'completed'
  for update;

  if not found then
    raise exception 'not_refundable'
      using hint = 'Only completed purchases can be refunded.';
  end if;

  update public.purchases
    set status = 'refunded'
    where id = v_purchase.id;

  update public.profiles
    set toolkit_credits = toolkit_credits - v_purchase.credits_granted
    where id = v_purchase.user_id
    returning toolkit_credits into v_balance;

  insert into public.purchase_state_changes (purchase_id, from_status, to_status, actor, reason)
    values (v_purchase.id, 'completed', 'refunded', 'operator', p_reason);

  return query select v_purchase.user_id, v_balance;
end;
$$;

revoke execute on function public.operator_refund_purchase(text, text) from public;
revoke execute on function public.operator_refund_purchase(text, text) from anon;
revoke execute on function public.operator_refund_purchase(text, text) from authenticated;

-- ── 11. apply_purchase_topup ─────────────────────────────────────────────
-- Case #14: customer sent the missing amount with a new TrxID after an
-- underpayment. Service-role only. Adds a topup row, re-evaluates the sum
-- against amount_taka, and flips underpaid → completed when reached.
create or replace function public.apply_purchase_topup(
  p_purchase_id     uuid,
  p_payment_ref     text,
  p_sender_msisdn   text,
  p_amount_taka     integer,
  p_actor           text default 'operator',
  p_reason          text default null
)
returns table (status_out text, observed_total integer, new_balance integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_purchase public.purchases%rowtype;
  v_total    integer;
  v_balance  integer;
  v_surplus  integer;
begin
  select * into v_purchase
  from public.purchases
  where id = p_purchase_id
  for update;

  if not found then
    raise exception 'purchase_not_found';
  end if;
  if v_purchase.status not in ('pending', 'underpaid') then
    raise exception 'purchase_not_topup_eligible'
      using hint = format('Status is %s; only pending/underpaid accept top-ups.', v_purchase.status);
  end if;

  insert into public.purchase_topups (purchase_id, payment_reference, sender_msisdn, amount_taka)
    values (p_purchase_id, p_payment_ref, p_sender_msisdn, p_amount_taka);

  select coalesce(v_purchase.observed_amount_taka, 0)
       + coalesce((select sum(amount_taka) from public.purchase_topups where purchase_id = p_purchase_id), 0)
    into v_total;

  if v_total >= v_purchase.amount_taka then
    update public.purchases
      set status = 'completed',
          observed_amount_taka = v_total
      where id = p_purchase_id;

    update public.profiles
      set toolkit_credits = toolkit_credits + v_purchase.credits_granted
      where id = v_purchase.user_id
      returning toolkit_credits into v_balance;

    insert into public.purchase_state_changes (purchase_id, from_status, to_status, actor, reason)
      values (p_purchase_id, v_purchase.status, 'completed', p_actor,
              format('topup ref=%s amount=%s new_total=%s', p_payment_ref, p_amount_taka, v_total)
              || coalesce(' ' || p_reason, ''));

    if v_total > v_purchase.amount_taka then
      v_surplus := v_total - v_purchase.amount_taka;
      insert into public.purchase_overpayments (purchase_id, surplus_taka)
        values (p_purchase_id, v_surplus);
    end if;

    return query select 'completed'::text, v_total, v_balance;
  else
    -- Still short. Flip to 'underpaid' (a no-op if already underpaid) so the
    -- customer's status pill shows the "send Tk N more" action card and
    -- operator queries for stuck rows surface this one.
    update public.purchases
      set status = 'underpaid',
          observed_amount_taka = v_total
      where id = p_purchase_id;

    insert into public.purchase_state_changes (purchase_id, from_status, to_status, actor, reason)
      values (p_purchase_id, v_purchase.status, 'underpaid', p_actor,
              format('topup ref=%s amount=%s still_short=%s',
                     p_payment_ref, p_amount_taka, v_purchase.amount_taka - v_total)
              || coalesce(' ' || p_reason, ''));

    return query select 'underpaid'::text, v_total, null::integer;
  end if;
end;
$$;

revoke execute on function public.apply_purchase_topup(uuid, text, text, integer, text, text) from public;
revoke execute on function public.apply_purchase_topup(uuid, text, text, integer, text, text) from anon;
revoke execute on function public.apply_purchase_topup(uuid, text, text, integer, text, text) from authenticated;

-- ── 12. record_orphan_sms (case #2, #5) ──────────────────────────────────
create or replace function public.record_orphan_sms(
  p_payment_reference text,
  p_sender_msisdn     text,
  p_amount_taka       integer,
  p_raw_body          text,
  p_sms_timestamp     timestamp with time zone
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  insert into public.unmatched_inbound_sms
    (payment_reference, sender_msisdn, amount_taka, raw_body, sms_timestamp)
  values (p_payment_reference, p_sender_msisdn, p_amount_taka, p_raw_body, p_sms_timestamp)
  on conflict (payment_reference) do update
    set sender_msisdn = excluded.sender_msisdn,
        amount_taka   = excluded.amount_taka,
        raw_body      = excluded.raw_body,
        sms_timestamp = excluded.sms_timestamp
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.record_orphan_sms(text, text, integer, text, timestamp with time zone) from public;
revoke execute on function public.record_orphan_sms(text, text, integer, text, timestamp with time zone) from anon;
revoke execute on function public.record_orphan_sms(text, text, integer, text, timestamp with time zone) from authenticated;

-- ── 13. record_purchase_reversal (case #7) ───────────────────────────────
-- Flutter classifies a bKash reversal SMS, posts to /api/reverse-purchase.
-- We flip the corresponding completed row to refunded and decrement credits.
create or replace function public.record_purchase_reversal(
  p_transaction_id text,
  p_reason         text default null
)
returns table (user_id uuid, new_balance integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_purchase public.purchases%rowtype;
  v_balance  integer;
begin
  select * into v_purchase
  from public.purchases
  where payment_reference = p_transaction_id
    and status = 'completed'
  for update;

  if not found then
    raise exception 'no_completed_purchase'
      using hint = 'Reversal SMS arrived but no matching completed row found.';
  end if;

  update public.purchases
    set status = 'refunded'
    where id = v_purchase.id;

  update public.profiles
    set toolkit_credits = toolkit_credits - v_purchase.credits_granted
    where id = v_purchase.user_id
    returning toolkit_credits into v_balance;

  insert into public.purchase_state_changes (purchase_id, from_status, to_status, actor, reason)
    values (v_purchase.id, 'completed', 'refunded', 'flutter',
            coalesce(p_reason, 'bKash reversal SMS observed'));

  return query select v_purchase.user_id, v_balance;
end;
$$;

revoke execute on function public.record_purchase_reversal(text, text) from public;
revoke execute on function public.record_purchase_reversal(text, text) from anon;
revoke execute on function public.record_purchase_reversal(text, text) from authenticated;

-- ── 14. record_purchase_dispute (case #10) ───────────────────────────────
-- User-callable. Inserts a dispute row scoped to the caller's user id.
create or replace function public.record_purchase_dispute(
  p_transaction_id text,
  p_notes          text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if length(coalesce(p_transaction_id, '')) < 6 then
    raise exception 'invalid_transaction_id';
  end if;

  insert into public.purchase_disputes (user_id, payment_reference, notes)
    values (auth.uid(), p_transaction_id, p_notes)
    returning id into v_id;
  return v_id;
end;
$$;

-- This one IS user-callable (it's the entry point for case #10).
grant execute on function public.record_purchase_dispute(text, text) to authenticated;

-- ── 15. resolve_purchase_dispute (operator only) ─────────────────────────
create or replace function public.resolve_purchase_dispute(
  p_dispute_id    uuid,
  p_resolution    text,
  p_operator_note text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_resolution not in ('resolved', 'rejected') then
    raise exception 'invalid_resolution';
  end if;
  update public.purchase_disputes
    set status = p_resolution,
        operator_note = p_operator_note,
        resolved_at = now()
    where id = p_dispute_id;
end;
$$;

revoke execute on function public.resolve_purchase_dispute(uuid, text, text) from public;
revoke execute on function public.resolve_purchase_dispute(uuid, text, text) from anon;
revoke execute on function public.resolve_purchase_dispute(uuid, text, text) from authenticated;

-- ── 16. expire_stale_pending_purchases (case #1) ─────────────────────────
-- Called by /api/cron/expire-pending (CRON_SECRET-gated) every ~15 min, or
-- by pg_cron if the operator has the extension enabled.
create or replace function public.expire_stale_pending_purchases()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_affected integer;
begin
  with expired as (
    update public.purchases
      set status = 'expired'
      where status = 'pending'
        and created_at < now() - interval '24 hours'
      returning id
  ),
  audited as (
    insert into public.purchase_state_changes (purchase_id, from_status, to_status, actor, reason)
      select id, 'pending', 'expired', 'system', 'TTL exceeded (24h)' from expired
      returning 1
  )
  select count(*) into v_affected from expired;
  return v_affected;
end;
$$;

revoke execute on function public.expire_stale_pending_purchases() from public;
revoke execute on function public.expire_stale_pending_purchases() from anon;
revoke execute on function public.expire_stale_pending_purchases() from authenticated;
-- service_role only.

-- ── 17. Index on purchases.status for admin "find pending older than N" ──
create index if not exists purchases_status_created_idx
  on public.purchases(status, created_at desc);
