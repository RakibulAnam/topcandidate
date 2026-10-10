-- 032_welcome_credit_master_unlock.sql
--
-- Pricing-flow change (branch feat/purchase-nudges, 2026-10-11).
--
-- BEFORE: new users got 0 credits and a FREE general ("master") resume on
-- profile completion. Users took the free resume and used it everywhere —
-- it substitutes for the paid product instead of sampling it.
--
-- AFTER:
--   1. Every account gets ONE free credit (= one complete tailored
--      application) once its profile is complete. Granted once, ever, via
--      claim_welcome_credit(); `profiles.welcome_credit_at` is the guard.
--   2. The master resume is unlocked by the FIRST completed purchase. A
--      trigger on `purchases` stamps `profiles.master_resume_unlocked_at`, so
--      every completion path (match-on-submit, watcher webhook, admin
--      grant-override, top-ups) unlocks it without touching those RPCs.
--      Buying again changes nothing — the stamp is set once. A later refund
--      does not re-lock it.
--   3. Users who already HAVE a master resume keep it (no rows are touched);
--      generating or regenerating one is what requires the unlock, enforced in
--      api/optimize-general.ts.
--
-- Backfill (runs once, idempotent via the guard columns):
--   * accounts with a completed purchase → unlocked at their first completion,
--     and marked as having had their welcome credit (no extra credit).
--   * accounts with NO completed purchase and a complete profile → +1 credit
--     now (ledger reason 'welcome_credit').
--   * accounts with no purchase and an incomplete profile → nothing; they claim
--     on completion like a new user.
--
-- Idempotent: safe to re-run.

alter table public.profiles
  add column if not exists welcome_credit_at timestamptz,
  add column if not exists master_resume_unlocked_at timestamptz;

comment on column public.profiles.welcome_credit_at is
  'When the one-time free welcome credit was granted (or waived for accounts that had already paid). Null = not yet claimed.';
comment on column public.profiles.master_resume_unlocked_at is
  'First completed purchase. Generating/regenerating the master (general) resume requires this to be set.';

-- ---------------------------------------------------------------------------
-- Unlock on first completed purchase.
-- ---------------------------------------------------------------------------
create or replace function public.unlock_master_resume_on_purchase()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'completed'
     and (tg_op = 'INSERT' or old.status is distinct from 'completed') then
    update public.profiles
      set master_resume_unlocked_at = now()
      where id = new.user_id
        and master_resume_unlocked_at is null;
  end if;
  return new;
end;
$$;
revoke execute on function public.unlock_master_resume_on_purchase() from public, anon, authenticated;

drop trigger if exists trg_unlock_master_resume on public.purchases;
create trigger trg_unlock_master_resume
  after insert or update of status on public.purchases
  for each row execute function public.unlock_master_resume_on_purchase();

-- ---------------------------------------------------------------------------
-- Claim the one-time welcome credit. User-callable; acts on auth.uid() only.
-- Returns the new balance when a credit was granted, NULL when nothing was
-- granted (already claimed, or profile not complete yet).
-- ---------------------------------------------------------------------------
create or replace function public.claim_welcome_credit()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_balance integer;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  perform set_config('app.credit_reason', 'welcome_credit', true);

  update public.profiles
    set toolkit_credits = toolkit_credits + 1,
        welcome_credit_at = now()
    where id = v_uid
      and welcome_credit_at is null
      and coalesce(onboarding_complete, false)
    returning toolkit_credits into v_balance;

  return v_balance;
end;
$$;
revoke execute on function public.claim_welcome_credit() from public, anon;
grant execute on function public.claim_welcome_credit() to authenticated;

-- ---------------------------------------------------------------------------
-- Backfill.
-- ---------------------------------------------------------------------------
-- Payers: unlock at first completion; waive the welcome credit.
update public.profiles p
  set master_resume_unlocked_at = coalesce(p.master_resume_unlocked_at, fp.first_paid_at),
      welcome_credit_at = coalesce(p.welcome_credit_at, now())
  from (
    select user_id, min(created_at) as first_paid_at
    from public.purchases
    where status = 'completed'
    group by user_id
  ) fp
  where fp.user_id = p.id
    and (p.master_resume_unlocked_at is null or p.welcome_credit_at is null);

-- Non-payers with a complete profile: grant the welcome credit now.
do $$
begin
  perform set_config('app.credit_reason', 'welcome_credit', true);
  update public.profiles p
    set toolkit_credits = p.toolkit_credits + 1,
        welcome_credit_at = now()
    where p.welcome_credit_at is null
      and coalesce(p.onboarding_complete, false)
      and not exists (
        select 1 from public.purchases pu
        where pu.user_id = p.id and pu.status = 'completed'
      );
end $$;
