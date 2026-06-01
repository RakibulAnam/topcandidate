-- 009 — Admin panel surface area.
--
-- Implements the work in
-- `topcandidate-audit-2026-05-08/PROMPT-admin-panel.md`.
-- Idempotent: safe to re-run.
--
-- What this migration adds:
--   1. `admin_audit_log` — append-only log of every operator write action.
--      Layered alongside `purchase_state_changes` from migration 007:
--      - purchase_state_changes tracks purchase row transitions only,
--        and is also written by Flutter + customer paths.
--      - admin_audit_log tracks operator actions on ANY target (user,
--        purchase, dispute, orphan SMS, system) with before/after snapshots.
--   2. `profile_notes` — operator-private free-text notes on customer profiles.
--   3. `profiles.flagged_at` — known-fraud flag (set/cleared by operator).
--   4. `unmatched_inbound_sms.reviewed_at` — operator marks a parser failure
--      reviewed without matching it (the matched-to-purchase column means
--      "matched", reviewed_at means "I've seen it, don't show me again").
--   5. `record_admin_action` RPC — single SECURITY DEFINER helper called by
--      every admin endpoint after its underlying write succeeds. The choice
--      of one shared RPC (vs per-action RPCs) is explicit: every endpoint
--      pays the same audit cost, and there's one place to evolve the
--      audit schema. The action's write and the audit row are NOT in the
--      same transaction — see "Audit-after-write" note below.
--   6. Operator credit RPCs: `admin_grant_credits`, `admin_deduct_credits`.
--      Deduct allows the balance to go negative (the paid endpoint already
--      gates on > 0, so negative balance is a holding state, not a bug).
--   7. Operator purchase RPCs: `admin_expire_purchase`, `admin_reopen_purchase`,
--      `admin_grant_override` (for underpaid rows).
--   8. `profiles_email_trgm_idx` — pg_trgm GIN index for fast substring
--      search on email in the Users tab. The 006 migration already enabled
--      pg_trgm for the dashboard search; we reuse it.
--
-- Audit-after-write
-- =================
-- Each admin endpoint performs:
--   1. The underlying SECURITY DEFINER RPC (e.g. operator_confirm_purchase).
--      This is atomic on the target row.
--   2. A call to record_admin_action() to log the operator action.
-- These are two separate transactions. If step 2 fails after step 1
-- succeeds, the action ran but the audit row is missing. We accept this
-- trade-off because:
--   - record_admin_action is a plain INSERT, far more reliable than the
--     domain RPC.
--   - The alternative (wrap each operator RPC in a do-and-audit pair) would
--     fan out and make every action RPC larger; the audit schema then
--     becomes part of every action's contract.
--   - Operator workflows can spot missing audit rows by cross-referencing
--     purchase_state_changes (which IS in the action's transaction).
-- This trade-off is documented in the audit-log tab UI ("if a write
-- succeeded but no audit row appeared, check purchase_state_changes").

-- ── 1. admin_audit_log ──────────────────────────────────────────────────
create table if not exists public.admin_audit_log (
  id            uuid default uuid_generate_v4() primary key,
  actor         text not null default 'operator', -- single operator today; column reserved for future
  action        text not null,                    -- 'confirm_purchase' | 'refund_purchase' | 'grant_credits' | …
  target_kind   text not null,                    -- 'user' | 'purchase' | 'dispute' | 'orphan_sms' | 'parser_failure' | 'system'
  target_id     uuid,
  before_state  jsonb,
  after_state   jsonb,
  reason        text,
  created_at    timestamp with time zone default timezone('utc'::text, now())
);

alter table public.admin_audit_log enable row level security;
-- service_role only; no user-facing policies.

create index if not exists admin_audit_log_target_idx
  on public.admin_audit_log(target_kind, target_id, created_at desc);

create index if not exists admin_audit_log_action_idx
  on public.admin_audit_log(action, created_at desc);

create index if not exists admin_audit_log_created_idx
  on public.admin_audit_log(created_at desc);

-- ── 2. profile_notes ─────────────────────────────────────────────────────
create table if not exists public.profile_notes (
  id          uuid default uuid_generate_v4() primary key,
  user_id     uuid references public.profiles(id) on delete cascade not null,
  note        text not null,
  created_at  timestamp with time zone default timezone('utc'::text, now())
);

alter table public.profile_notes enable row level security;
-- service_role only.

create index if not exists profile_notes_user_idx
  on public.profile_notes(user_id, created_at desc);

-- ── 3. profiles.flagged_at ───────────────────────────────────────────────
alter table public.profiles
  add column if not exists flagged_at timestamp with time zone;

create index if not exists profiles_flagged_idx
  on public.profiles(flagged_at)
  where flagged_at is not null;

-- ── 4. unmatched_inbound_sms.reviewed_at ─────────────────────────────────
alter table public.unmatched_inbound_sms
  add column if not exists reviewed_at timestamp with time zone;

-- ── 5. record_admin_action RPC ───────────────────────────────────────────
create or replace function public.record_admin_action(
  p_action       text,
  p_target_kind  text,
  p_target_id    uuid,
  p_before       jsonb,
  p_after        jsonb,
  p_reason       text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if p_action is null or p_target_kind is null then
    raise exception 'action_and_target_kind_required';
  end if;

  insert into public.admin_audit_log
    (action, target_kind, target_id, before_state, after_state, reason)
    values
    (p_action, p_target_kind, p_target_id, p_before, p_after, p_reason)
    returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.record_admin_action(text, text, uuid, jsonb, jsonb, text) from public;
revoke execute on function public.record_admin_action(text, text, uuid, jsonb, jsonb, text) from anon;
revoke execute on function public.record_admin_action(text, text, uuid, jsonb, jsonb, text) from authenticated;

-- ── 6. admin_grant_credits / admin_deduct_credits ────────────────────────
--
-- Distinct from the consume/refund credit RPCs (migration 008) because
-- those are tied to the toolkit-credit hot path (consume on /api/optimize,
-- refund on optimizer failure). These are operator-driven adjustments
-- with arbitrary amounts and audit context. Negative balance allowed on
-- deduct — paid endpoints already gate on > 0.
create or replace function public.admin_grant_credits(
  p_user_id uuid,
  p_amount  integer
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_new_balance integer;
begin
  if p_user_id is null then raise exception 'user_id_required'; end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'amount_must_be_positive';
  end if;

  update public.profiles
    set toolkit_credits = toolkit_credits + p_amount
    where id = p_user_id
    returning toolkit_credits into v_new_balance;

  if v_new_balance is null then
    raise exception 'user_not_found';
  end if;

  return v_new_balance;
end;
$$;

revoke execute on function public.admin_grant_credits(uuid, integer) from public;
revoke execute on function public.admin_grant_credits(uuid, integer) from anon;
revoke execute on function public.admin_grant_credits(uuid, integer) from authenticated;

create or replace function public.admin_deduct_credits(
  p_user_id uuid,
  p_amount  integer
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_new_balance integer;
begin
  if p_user_id is null then raise exception 'user_id_required'; end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'amount_must_be_positive';
  end if;

  -- No "where toolkit_credits >= p_amount" guard — operator may deduct
  -- below zero on purpose (e.g. clawback after a chargeback). Paid
  -- endpoints already refuse to spend a non-positive balance.
  update public.profiles
    set toolkit_credits = toolkit_credits - p_amount
    where id = p_user_id
    returning toolkit_credits into v_new_balance;

  if v_new_balance is null then
    raise exception 'user_not_found';
  end if;

  return v_new_balance;
end;
$$;

revoke execute on function public.admin_deduct_credits(uuid, integer) from public;
revoke execute on function public.admin_deduct_credits(uuid, integer) from anon;
revoke execute on function public.admin_deduct_credits(uuid, integer) from authenticated;

-- ── 7. admin_expire_purchase / admin_reopen_purchase / admin_grant_override ─
--
-- admin_expire_purchase — operator forces a pending row to expired without
-- waiting for the 24h cron. Useful when the customer says "ignore that one,
-- I'll resubmit". Logs to purchase_state_changes.
create or replace function public.admin_expire_purchase(
  p_purchase_id uuid,
  p_reason      text
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text;
begin
  if p_purchase_id is null then raise exception 'purchase_id_required'; end if;

  select status into v_status
  from public.purchases
  where id = p_purchase_id
  for update;

  if not found then
    raise exception 'purchase_not_found';
  end if;
  if v_status not in ('pending', 'underpaid', 'msisdn_mismatch_review') then
    raise exception 'not_expirable' using hint = format('Cannot expire row in status %s.', v_status);
  end if;

  update public.purchases set status = 'expired' where id = p_purchase_id;
  insert into public.purchase_state_changes (purchase_id, from_status, to_status, actor, reason)
    values (p_purchase_id, v_status, 'expired', 'operator', p_reason);

  return 'expired';
end;
$$;

revoke execute on function public.admin_expire_purchase(uuid, text) from public;
revoke execute on function public.admin_expire_purchase(uuid, text) from anon;
revoke execute on function public.admin_expire_purchase(uuid, text) from authenticated;

-- admin_reopen_purchase — flip an expired / failed row back to pending so
-- the operator can confirm it manually. Resets created_at so the cron
-- doesn't immediately re-expire it.
create or replace function public.admin_reopen_purchase(
  p_purchase_id uuid,
  p_reason      text
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text;
begin
  if p_purchase_id is null then raise exception 'purchase_id_required'; end if;

  select status into v_status
  from public.purchases
  where id = p_purchase_id
  for update;

  if not found then
    raise exception 'purchase_not_found';
  end if;
  if v_status not in ('expired', 'failed') then
    raise exception 'not_reopenable' using hint = format('Cannot reopen row in status %s.', v_status);
  end if;

  update public.purchases
    set status = 'pending',
        created_at = timezone('utc'::text, now())
    where id = p_purchase_id;
  insert into public.purchase_state_changes (purchase_id, from_status, to_status, actor, reason)
    values (p_purchase_id, v_status, 'pending', 'operator', p_reason);

  return 'pending';
end;
$$;

revoke execute on function public.admin_reopen_purchase(uuid, text) from public;
revoke execute on function public.admin_reopen_purchase(uuid, text) from anon;
revoke execute on function public.admin_reopen_purchase(uuid, text) from authenticated;

-- admin_grant_override — for underpaid rows specifically; flips to
-- completed and grants the original credit pack despite the underpayment.
-- Operator's call: "small underpayment, granted as goodwill".
create or replace function public.admin_grant_override(
  p_purchase_id uuid,
  p_reason      text
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
  if p_purchase_id is null then raise exception 'purchase_id_required'; end if;

  select * into v_purchase from public.purchases
  where id = p_purchase_id
  for update;

  if not found then
    raise exception 'purchase_not_found';
  end if;
  if v_purchase.status not in ('underpaid', 'msisdn_mismatch_review', 'expired') then
    raise exception 'not_grantable' using hint = format('Cannot grant override on status %s.', v_purchase.status);
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
            coalesce(p_reason, 'operator override'));

  return query select v_purchase.user_id, v_balance, v_purchase.credits_granted;
end;
$$;

revoke execute on function public.admin_grant_override(uuid, text) from public;
revoke execute on function public.admin_grant_override(uuid, text) from anon;
revoke execute on function public.admin_grant_override(uuid, text) from authenticated;

-- ── 8. profiles_email_trgm_idx ───────────────────────────────────────────
--
-- Migration 006 enabled pg_trgm for generated_resumes search. Reuse the
-- extension for the admin Users tab substring search on email.
create extension if not exists pg_trgm;

create index if not exists profiles_email_trgm_idx
  on public.profiles using gin (email gin_trgm_ops);
