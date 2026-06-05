-- 013_analytics_and_bi.sql
-- Business-intelligence foundation: first-party analytics events, a credit
-- ledger, marketing-spend tracking, AI cost/telemetry columns, generation
-- typing, acquisition (UTM) columns, last-active tracking, and read-side views.
--
-- ALL ADDITIVE + IDEMPOTENT. No existing table/column/function is dropped or
-- behaviourally changed. The credit-ledger trigger is AFTER-UPDATE and only
-- inserts a log row, so it cannot break the credit hot path.
--
-- Design notes:
--   * First-party analytics (no third-party SDK): /api/track inserts into
--     analytics_events with the service-role key, so RLS stays closed (no
--     public policies) and the data never leaves this Supabase project.
--   * credit_ledger captures EVERY balance change via a trigger, regardless of
--     which RPC caused it — so we never had to touch the 6 credit functions.
--     `reason` is best-effort (set via the `app.credit_reason` GUC if a caller
--     opts in); category is otherwise derivable from the delta sign/size.

-- ──────────────────────────────────────────────────────────────────
-- 1. analytics_events — first-party funnel / product analytics
-- ──────────────────────────────────────────────────────────────────
create table if not exists analytics_events (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  anon_id     text,                         -- stable client id (localStorage), pre-auth
  user_id     uuid,                         -- set once known (no FK: ingestion must never block)
  session_id  text,
  event       text not null,                -- e.g. 'landing_viewed', 'signup_completed'
  props       jsonb not null default '{}'::jsonb,
  path        text,
  referrer    text,
  utm_source  text,
  utm_medium  text,
  utm_campaign text
);
create index if not exists analytics_events_event_time_idx on analytics_events (event, created_at desc);
create index if not exists analytics_events_user_time_idx  on analytics_events (user_id, created_at desc);
create index if not exists analytics_events_time_idx       on analytics_events (created_at desc);
-- RLS: anon + authenticated may INSERT only (first-party tracking from the
-- browser via supabase-js — no Vercel function needed, stays under the Hobby
-- 12-function cap). No SELECT/UPDATE/DELETE policies → reads are service-role
-- only (admin). Logged-in users may only attribute events to themselves.
alter table analytics_events enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='analytics_events' and policyname='analytics_events_insert') then
    create policy analytics_events_insert on analytics_events
      for insert to anon, authenticated
      with check (user_id is null or user_id = auth.uid());
  end if;
end $$;

-- ──────────────────────────────────────────────────────────────────
-- 2. credit_ledger — journal of every toolkit_credits change
-- ──────────────────────────────────────────────────────────────────
create table if not exists credit_ledger (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references profiles(id) on delete cascade,
  delta         integer not null,           -- +grant / -consume / etc.
  balance_after integer not null,
  reason        text,                        -- best-effort: 'purchase'|'consume'|'refund'|'admin'|'reversal'
  created_at    timestamptz not null default now()
);
create index if not exists credit_ledger_user_time_idx on credit_ledger (user_id, created_at desc);
create index if not exists credit_ledger_time_idx       on credit_ledger (created_at desc);
alter table credit_ledger enable row level security;

create or replace function log_credit_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.toolkit_credits is distinct from old.toolkit_credits then
    insert into credit_ledger (user_id, delta, balance_after, reason)
    values (
      new.id,
      new.toolkit_credits - old.toolkit_credits,
      new.toolkit_credits,
      nullif(current_setting('app.credit_reason', true), '')
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_log_credit_change on profiles;
create trigger trg_log_credit_change
  after update of toolkit_credits on profiles
  for each row execute function log_credit_change();

-- ──────────────────────────────────────────────────────────────────
-- 3. marketing_spend — operator-entered ad spend for CAC / ROAS
-- ──────────────────────────────────────────────────────────────────
create table if not exists marketing_spend (
  id          uuid primary key default gen_random_uuid(),
  spend_date  date not null,
  channel     text not null,                -- 'facebook' | 'google' | 'influencer' | ...
  campaign    text,
  amount_taka integer not null default 0,
  clicks      integer,
  impressions integer,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists marketing_spend_date_idx on marketing_spend (spend_date desc);
alter table marketing_spend enable row level security;

-- ──────────────────────────────────────────────────────────────────
-- 4. profiles — acquisition + activity columns
-- ──────────────────────────────────────────────────────────────────
alter table profiles add column if not exists utm_source      text;
alter table profiles add column if not exists utm_medium      text;
alter table profiles add column if not exists utm_campaign    text;
alter table profiles add column if not exists signup_referrer text;
alter table profiles add column if not exists last_active_at  timestamptz;

-- ──────────────────────────────────────────────────────────────────
-- 5. ai_call_log — cost + telemetry columns; widen kind for the free path
-- ──────────────────────────────────────────────────────────────────
alter table ai_call_log add column if not exists provider          text;
alter table ai_call_log add column if not exists model             text;
alter table ai_call_log add column if not exists prompt_tokens     integer;
alter table ai_call_log add column if not exists completion_tokens integer;
alter table ai_call_log add column if not exists cost_usd          numeric(12,6);
alter table ai_call_log add column if not exists status            text;   -- 'success' | 'error'
alter table ai_call_log add column if not exists latency_ms        integer;

-- Widen the kind CHECK to distinguish the free general-resume path.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'ai_call_log_kind_check' and conrelid = 'public.ai_call_log'::regclass
  ) then
    alter table ai_call_log drop constraint ai_call_log_kind_check;
  end if;
  alter table ai_call_log add constraint ai_call_log_kind_check
    check (kind in ('optimize', 'optimize_general', 'toolkit_item', 'extract_resume'));
end $$;

-- ──────────────────────────────────────────────────────────────────
-- 6. generated_resumes — free vs paid typing
-- ──────────────────────────────────────────────────────────────────
alter table generated_resumes add column if not exists generation_type text;
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'generated_resumes_generation_type_check'
      and conrelid = 'public.generated_resumes'::regclass
  ) then
    alter table generated_resumes add constraint generated_resumes_generation_type_check
      check (generation_type is null or generation_type in ('free_general', 'paid_tailored'));
  end if;
end $$;
-- Best-effort backfill: the free path saves a "General Resume" title.
update generated_resumes
  set generation_type = case when title ilike '%general%' then 'free_general' else 'paid_tailored' end
  where generation_type is null;

-- ──────────────────────────────────────────────────────────────────
-- 7. Read-side views (always-fresh; cheap at current volume)
-- ──────────────────────────────────────────────────────────────────
-- Daily revenue (completed purchases only).
create or replace view v_daily_revenue as
  select date(created_at)                       as day,
         count(*)                               as orders,
         coalesce(sum(amount_taka), 0)          as revenue_taka,
         coalesce(sum(credits_granted), 0)      as credits_sold
  from purchases
  where status = 'completed'
  group by 1;

-- Daily signups.
create or replace view v_daily_signups as
  select date(created_at) as day, count(*) as signups
  from profiles
  group by 1;

-- Daily AI cost / volume.
create or replace view v_daily_ai_usage as
  select date(created_at)                                          as day,
         count(*)                                                  as calls,
         count(*) filter (where status = 'error')                  as errors,
         coalesce(sum(cost_usd), 0)                                as cost_usd,
         coalesce(sum(prompt_tokens + completion_tokens), 0)       as total_tokens
  from ai_call_log
  group by 1;

-- Credit liability snapshot: outstanding (unspent) credits across all users.
create or replace view v_credit_liability as
  select coalesce(sum(toolkit_credits) filter (where toolkit_credits > 0), 0) as outstanding_credits,
         count(*) filter (where toolkit_credits < 0)                          as negative_balance_users
  from profiles;

-- ──────────────────────────────────────────────────────────────────
-- 8. admin_auth_emails — service-role lookup of the TRUE login email
-- ──────────────────────────────────────────────────────────────────
-- profiles.email is app-managed and can drift from the real auth login email
-- (e.g. two profiles ended up showing the same email while having different
-- logins). The admin Users/User-detail surfaces use this to show the source
-- of truth. SECURITY DEFINER so it can read auth.users; execute revoked from
-- anon/authenticated (only the service role — i.e. admin endpoints — calls it).
create or replace function public.admin_auth_emails(p_ids uuid[])
returns table(id uuid, email text)
language sql security definer set search_path = public as $$
  select u.id, u.email::text from auth.users u where u.id = any(p_ids);
$$;
revoke all on function public.admin_auth_emails(uuid[]) from public, anon, authenticated;

comment on table analytics_events is 'First-party product/funnel analytics. Inserted by the browser via supabase-js (insert-only RLS). RLS closed for reads.';
comment on table credit_ledger    is 'Append-only journal of toolkit_credits changes (trigger-fed). reason is best-effort.';
comment on table marketing_spend  is 'Operator-entered ad spend for CAC/ROAS.';
