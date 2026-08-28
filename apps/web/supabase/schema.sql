-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- PROFILES
create table profiles (
  id uuid references auth.users not null primary key,
  user_type text check (user_type in ('student', 'professional')),
  onboarding_complete boolean default false,
  full_name text,
  email text,
  phone text,
  location text,
  linkedin text,
  github text,
  website text,
  toolkit_credits integer not null default 0,  -- paid tailored-resume generations remaining
  updated_at timestamp with time zone,
  created_at timestamp with time zone default timezone('utc'::text, now())
);

alter table profiles enable row level security;

create policy "Users can view own profile" on profiles
  for select using (auth.uid() = id);

create policy "Users can update own profile" on profiles
  for update using (auth.uid() = id);

create policy "Users can insert own profile" on profiles
  for insert with check (auth.uid() = id);

-- Column-level lockdown — RLS only restricts ROWS; without these GRANTS a
-- user with the row-level UPDATE policy above could directly write to
-- `toolkit_credits` from any signed-in browser console (verified during the
-- 2026-05-08 audit). Restrict updates to user-editable columns; the credits
-- balance is mutated only via the SECURITY DEFINER functions further down.
revoke update on profiles from authenticated;
revoke update on profiles from anon;

grant update (
  full_name,
  email,
  phone,
  location,
  linkedin,
  github,
  website,
  user_type,
  onboarding_complete,
  updated_at
) on profiles to authenticated;

-- EXPERIENCES
create table experiences (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references profiles(id) not null,
  company text,
  role text,
  start_date text,
  end_date text,
  is_current boolean default false,
  description text,
  -- "Polished profile" (migration 015): AI-normalized rendering of the raw
  -- description — { bullets, skills, gaps } — computed once on save and
  -- reused by every generation. Raw `description` stays the source of truth.
  normalized jsonb,
  normalized_source_hash text,
  -- Guided Mode (migration 018): structured questionnaire answers; `description`
  -- above is assembled from these in guided mode. See migration for semantics.
  input_mode text default 'guided',
  guided jsonb,
  guided_version int,
  created_at timestamp with time zone default timezone('utc'::text, now())
);

alter table experiences enable row level security;

create policy "Users can view own experiences" on experiences
  for select using (auth.uid() = user_id);

create policy "Users can insert own experiences" on experiences
  for insert with check (auth.uid() = user_id);

create policy "Users can update own experiences" on experiences
  for update using (auth.uid() = user_id);

create policy "Users can delete own experiences" on experiences
  for delete using (auth.uid() = user_id);

-- EDUCATIONS
create table educations (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references profiles(id) not null,
  school text,
  degree text,
  field text,
  start_date text,
  end_date text,
  gpa text,
  created_at timestamp with time zone default timezone('utc'::text, now())
);

alter table educations enable row level security;

create policy "Users can view own educations" on educations
  for select using (auth.uid() = user_id);

create policy "Users can insert own educations" on educations
  for insert with check (auth.uid() = user_id);

create policy "Users can update own educations" on educations
  for update using (auth.uid() = user_id);

create policy "Users can delete own educations" on educations
  for delete using (auth.uid() = user_id);

-- PROJECTS
create table projects (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references profiles(id) not null,
  name text,
  description text,
  technologies text[],
  link text,
  -- "Polished profile" (migration 016) — see experiences.normalized.
  normalized jsonb,
  normalized_source_hash text,
  -- Guided Mode (migration 018) — see experiences.
  input_mode text default 'guided',
  guided jsonb,
  guided_version int,
  created_at timestamp with time zone default timezone('utc'::text, now())
);

alter table projects enable row level security;

create policy "Users can view own projects" on projects
  for select using (auth.uid() = user_id);

create policy "Users can insert own projects" on projects
  for insert with check (auth.uid() = user_id);

create policy "Users can update own projects" on projects
  for update using (auth.uid() = user_id);

create policy "Users can delete own projects" on projects
  for delete using (auth.uid() = user_id);

-- SKILLS
create table skills (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references profiles(id) not null,
  name text,
  created_at timestamp with time zone default timezone('utc'::text, now())
);

alter table skills enable row level security;

create policy "Users can view own skills" on skills
  for select using (auth.uid() = user_id);

create policy "Users can insert own skills" on skills
  for insert with check (auth.uid() = user_id);

create policy "Users can delete own skills" on skills
  for delete using (auth.uid() = user_id);

-- EXTRACURRICULARS
create table extracurriculars (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references profiles(id) not null,
  title text,
  organization text,
  start_date text,
  end_date text,
  description text,
  -- "Polished profile" (migration 016) — see experiences.normalized.
  normalized jsonb,
  normalized_source_hash text,
  -- Guided Mode (migration 018) — see experiences.
  input_mode text default 'guided',
  guided jsonb,
  guided_version int,
  created_at timestamp with time zone default timezone('utc'::text, now())
);

alter table extracurriculars enable row level security;

create policy "Users can view own extracurriculars" on extracurriculars
  for select using (auth.uid() = user_id);

create policy "Users can insert own extracurriculars" on extracurriculars
  for insert with check (auth.uid() = user_id);

create policy "Users can update own extracurriculars" on extracurriculars
  for update using (auth.uid() = user_id);

create policy "Users can delete own extracurriculars" on extracurriculars
  for delete using (auth.uid() = user_id);

-- AWARDS
create table awards (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references profiles(id) not null,
  title text,
  issuer text,
  date text,
  description text,
  -- "Polished profile" + Guided Mode (migration 018): awards gained AI polish
  -- and the questionnaire alongside experiences/projects/extracurriculars.
  normalized jsonb,
  normalized_source_hash text,
  input_mode text default 'guided',
  guided jsonb,
  guided_version int,
  created_at timestamp with time zone default timezone('utc'::text, now())
);

alter table awards enable row level security;

create policy "Users can view own awards" on awards
  for select using (auth.uid() = user_id);

create policy "Users can insert own awards" on awards
  for insert with check (auth.uid() = user_id);

create policy "Users can update own awards" on awards
  for update using (auth.uid() = user_id);

create policy "Users can delete own awards" on awards
  for delete using (auth.uid() = user_id);

-- CERTIFICATIONS
create table certifications (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references profiles(id) not null,
  name text,
  issuer text,
  date text,
  link text,
  created_at timestamp with time zone default timezone('utc'::text, now())
);

alter table certifications enable row level security;

create policy "Users can view own certifications" on certifications
  for select using (auth.uid() = user_id);

create policy "Users can insert own certifications" on certifications
  for insert with check (auth.uid() = user_id);

create policy "Users can update own certifications" on certifications
  for update using (auth.uid() = user_id);

create policy "Users can delete own certifications" on certifications
  for delete using (auth.uid() = user_id);

-- AFFILIATIONS
create table affiliations (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references profiles(id) not null,
  organization text,
  role text,
  start_date text,
  end_date text,
  created_at timestamp with time zone default timezone('utc'::text, now())
);

alter table affiliations enable row level security;

create policy "Users can view own affiliations" on affiliations
  for select using (auth.uid() = user_id);

create policy "Users can insert own affiliations" on affiliations
  for insert with check (auth.uid() = user_id);

create policy "Users can update own affiliations" on affiliations
  for update using (auth.uid() = user_id);

create policy "Users can delete own affiliations" on affiliations
  for delete using (auth.uid() = user_id);

-- PUBLICATIONS
create table publications (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references profiles(id) not null,
  title text,
  publisher text,
  date text,
  link text,
  created_at timestamp with time zone default timezone('utc'::text, now())
);

alter table publications enable row level security;

create policy "Users can view own publications" on publications
  for select using (auth.uid() = user_id);

create policy "Users can insert own publications" on publications
  for insert with check (auth.uid() = user_id);

create policy "Users can update own publications" on publications
  for update using (auth.uid() = user_id);

create policy "Users can delete own publications" on publications
  for delete using (auth.uid() = user_id);

-- LANGUAGES (Bengali / English / Hindi etc., with proficiency level)
create table languages (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references profiles(id) not null,
  name text,
  proficiency text check (proficiency in ('Native', 'Fluent', 'Professional', 'Conversational', 'Basic')),
  created_at timestamp with time zone default timezone('utc'::text, now())
);

alter table languages enable row level security;

create policy "Users can view own languages" on languages
  for select using (auth.uid() = user_id);

create policy "Users can insert own languages" on languages
  for insert with check (auth.uid() = user_id);

create policy "Users can update own languages" on languages
  for update using (auth.uid() = user_id);

create policy "Users can delete own languages" on languages
  for delete using (auth.uid() = user_id);

-- REFERENCES (named referees with phone/email — common in BD CVs)
-- Table name `references_list` because `references` is a Postgres reserved keyword.
create table references_list (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references profiles(id) not null,
  name text,
  position text,
  organization text,
  email text,
  phone text,
  relationship text,
  created_at timestamp with time zone default timezone('utc'::text, now())
);

alter table references_list enable row level security;

create policy "Users can view own references" on references_list
  for select using (auth.uid() = user_id);

create policy "Users can insert own references" on references_list
  for insert with check (auth.uid() = user_id);

create policy "Users can update own references" on references_list
  for update using (auth.uid() = user_id);

create policy "Users can delete own references" on references_list
  for delete using (auth.uid() = user_id);

-- AI CALL LOG (per-user rate limiting / audit trail for /api/* endpoints)
create table ai_call_log (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references profiles(id) not null,
  kind text not null check (kind in ('optimize', 'toolkit_item', 'extract_resume')),
  created_at timestamp with time zone default timezone('utc'::text, now())
);

create index ai_call_log_user_created_idx on ai_call_log(user_id, created_at desc);

alter table ai_call_log enable row level security;

-- SECURITY (migrations 021 + 022). The analytics views are OPERATOR-only: they are
-- owned by postgres with security_invoker, and public roles have no SELECT — every
-- consumer is an /admin handler on SUPABASE_SERVICE_ROLE_KEY, which bypasses both.
-- Without this they were readable by anyone holding the (public) anon key.
revoke all on v_daily_revenue, v_daily_signups, v_daily_ai_usage,
              v_credit_liability, v_ai_failures_daily, v_ai_model_health
  from anon, authenticated;
alter view v_daily_revenue     set (security_invoker = true);
alter view v_daily_signups     set (security_invoker = true);
alter view v_daily_ai_usage    set (security_invoker = true);
alter view v_credit_liability  set (security_invoker = true);
alter view v_ai_failures_daily set (security_invoker = true);
alter view v_ai_model_health   set (security_invoker = true);
alter default privileges in schema public revoke select on tables from anon;

-- profiles is NOT a public/social profile — it holds full_name, email, phone,
-- location, links and toolkit_credits. The Supabase boilerplate policy
-- ("Public profiles are viewable by everyone.", USING (true)) leaked the whole
-- user base; own-row only.
drop policy if exists "Public profiles are viewable by everyone." on profiles;
create policy "Users can view own profile" on profiles
  for select using (auth.uid() = id);

create policy "Users can view own ai_call_log" on ai_call_log
  for select using (auth.uid() = user_id);

create policy "Users can insert own ai_call_log" on ai_call_log
  for insert with check (auth.uid() = user_id);

-- APPLICATIONS (for tracking job applications)
create table applications (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references profiles(id) not null,
  job_title text,
  company text,
  job_description text,
  status text default 'draft',
  optimized_summary text,
  optimized_skills text[],
  optimized_experience jsonb,
  cover_letter text,
  updated_at timestamp with time zone,
  created_at timestamp with time zone default timezone('utc'::text, now())
);

alter table applications enable row level security;

create policy "Users can view own applications" on applications
  for select using (auth.uid() = user_id);

create policy "Users can insert own applications" on applications
  for insert with check (auth.uid() = user_id);

create policy "Users can update own applications" on applications
  for update using (auth.uid() = user_id);

create policy "Users can delete own applications" on applications
  for delete using (auth.uid() = user_id);

-- GENERATED RESUMES (Final snapshots)
-- `data`    — the resume payload (ResumeData minus toolkit)
-- `toolkit` — AI-generated sibling artifacts (outreach email, LinkedIn note,
--             interview questions). Kept in its own column so the resume
--             itself stays clean and the toolkit is independently queryable.
create table generated_resumes (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references profiles(id) not null,
  title text,
  data jsonb,
  toolkit jsonb,
  -- Stored generated column extracted from data->targetJob->company.
  -- Added in migration 006. Enables efficient server-side search without
  -- scanning the full JSONB payload.
  company text generated always as ((data -> 'targetJob' ->> 'company')) stored,
  updated_at timestamp with time zone,
  created_at timestamp with time zone default timezone('utc'::text, now())
);

alter table generated_resumes enable row level security;

create policy "Users can view own generated resumes" on generated_resumes
  for select using (auth.uid() = user_id);

create policy "Users can insert own generated resumes" on generated_resumes
  for insert with check (auth.uid() = user_id);

create policy "Users can update own generated resumes" on generated_resumes
  for update using (auth.uid() = user_id);

create policy "Users can delete own generated resumes" on generated_resumes
  for delete using (auth.uid() = user_id);

-- TRIGGER to auto-create profile on auth.signup
-- (Optional but recommended for smoother DX)
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name');
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- PURCHASES (monetization audit trail — one row per purchase event)
-- Status starts at 'pending' when the user submits a bKash transaction ID
-- and flips to 'completed' when the Flutter SMS-watcher webhook confirms
-- the payment. `sender_msisdn` is the bKash phone number of the user who
-- sent the payment (extracted by the Flutter app from the SMS); used to
-- prevent users from claiming someone else's transaction.
create table purchases (
  id                uuid    default uuid_generate_v4() primary key,
  user_id           uuid    references profiles(id) not null,
  credits_granted   integer not null,
  amount_taka       integer not null,
  payment_reference text,                       -- bKash transaction ID
  sender_msisdn     text,                       -- bKash phone number that sent the payment
  -- Extended in migration 007 to cover every observable state. See the
  -- transaction-flow spec for the meaning of each value.
  status            text    not null default 'pending'
    check (status in (
      'pending', 'completed', 'failed', 'expired',
      'underpaid', 'msisdn_mismatch_review', 'refunded'
    )),
  -- What the SMS actually said vs amount_taka (what the row expected).
  -- Null until a confirmation/topup writes it (migration 007).
  observed_amount_taka integer,
  created_at        timestamp with time zone default timezone('utc'::text, now())
);

create index purchases_user_id_idx on purchases(user_id, created_at desc);

-- Unique txn ID prevents (a) two users claiming the same payment and
-- (b) duplicate confirmations doubling the credit grant.
create unique index purchases_payment_reference_key on purchases(payment_reference);

alter table purchases enable row level security;

create policy "Users can view own purchases" on purchases
  for select using (auth.uid() = user_id);

-- No INSERT policy for users — writes go through server-side API only.

-- Atomic decrement: raises 'insufficient_credits' if balance is already 0.
-- Service-role only (migration 008 closed the user-callable exploit).
-- Caller (api/optimize.ts) passes p_user_id explicitly using the
-- SUPABASE_SERVICE_ROLE_KEY client. End-user JWTs cannot reach this.
create or replace function consume_toolkit_credit(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_new_balance integer;
begin
  if p_user_id is null then
    raise exception 'user_id_required';
  end if;

  update public.profiles
    set toolkit_credits = toolkit_credits - 1
    where id = p_user_id
      and toolkit_credits > 0
    returning toolkit_credits into v_new_balance;

  if v_new_balance is null then
    raise exception 'insufficient_credits'
      using hint = 'User has no toolkit credits remaining.';
  end if;

  return v_new_balance;
end;
$$;
revoke execute on function consume_toolkit_credit(uuid) from public, anon, authenticated;

-- Refund 1 credit — called server-side when the AI optimizer fails after
-- a credit was already consumed. Service-role only (migration 008).
create or replace function refund_toolkit_credit(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_user_id is null then
    raise exception 'user_id_required';
  end if;
  update public.profiles
    set toolkit_credits = toolkit_credits + 1
    where id = p_user_id;
end;
$$;
revoke execute on function refund_toolkit_credit(uuid) from public, anon, authenticated;

-- Initiate a purchase: user-callable. The user has already (claims to have)
-- sent a bKash payment to the owner's number; they paste the transaction ID
-- and (optionally) their bKash phone number, and this function records a
-- pending row.
--
-- v3 (migration 012) adds MATCH-ON-SUBMIT: if the watcher already delivered a
-- verified SMS for this TrxID (recorded in inbound_payments because it arrived
-- before the user submitted), this function settles the purchase synchronously
-- — completing, underpaying, or flagging a mismatch — in the same locked path
-- confirm_purchase uses. For the common pay-first ordering this grants credits
-- inside the submit request instead of waiting for the watcher's next retry.
-- When no inbound SMS exists yet, the row stays 'pending' and the watcher
-- confirms it out-of-band via confirm_purchase as before.
--
-- The package mapping is hardcoded server-side so users cannot fake the
-- credit count or amount they're entitled to. Add new packages by editing
-- the `case` block. inbound_payments + record_inbound_payment live in the
-- Migration 012 section at the bottom of this file.
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
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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

  if exists (
    select 1 from public.purchases where payment_reference = p_transaction_id
  ) then
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

  -- Match-on-submit: settle now if the verified SMS already arrived.
  select * into v_inbound
  from public.inbound_payments
  where payment_reference = p_transaction_id and consumed_at is null
  for update;

  if found then
    if p_sender_msisdn is not null
       and v_inbound.sender_msisdn is not null
       and p_sender_msisdn <> v_inbound.sender_msisdn then
      update public.purchases
        set status = 'msisdn_mismatch_review', observed_amount_taka = v_inbound.amount_taka
        where id = v_purchase_id;
      insert into public.purchase_state_changes (purchase_id, from_status, to_status, actor, reason)
        values (v_purchase_id, 'pending', 'msisdn_mismatch_review', 'system-match',
                format('claimed=%s observed=%s', p_sender_msisdn, v_inbound.sender_msisdn));
      v_status := 'msisdn_mismatch_review';
    elsif v_inbound.amount_taka < v_amount_taka then
      update public.purchases
        set status = 'underpaid', observed_amount_taka = v_inbound.amount_taka
        where id = v_purchase_id;
      insert into public.purchase_state_changes (purchase_id, from_status, to_status, actor, reason)
        values (v_purchase_id, 'pending', 'underpaid', 'system-match',
                format('observed=%s expected=%s', v_inbound.amount_taka, v_amount_taka));
      v_status := 'underpaid';
    else
      update public.purchases
        set status = 'completed', observed_amount_taka = v_inbound.amount_taka
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
end;
$$;

-- Confirm a purchase: service-role-only. Called by the /api/confirm-purchase
-- webhook after the Flutter watcher matches a bKash SMS. v2 (migration 007)
-- adds amount + msisdn checks and writes to purchase_state_changes.
--
-- New behaviour vs v1:
--   - p_observed_amount_taka is the SMS-extracted amount.
--   - observed < expected → flip to 'underpaid', no credit grant, raise.
--   - observed > expected → grant + log surplus to purchase_overpayments.
--   - msisdn mismatch     → flip to 'msisdn_mismatch_review', raise.
--   - Every transition lands in purchase_state_changes.
create or replace function confirm_purchase(
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
  v_purchase public.purchases%rowtype;
  v_balance  integer;
  v_surplus  integer;
begin
  select * into v_purchase
  from public.purchases
  where payment_reference = p_transaction_id
    and status in ('pending', 'underpaid')
  for update;

  if not found then
    raise exception 'no_pending_purchase';
  end if;

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
    raise exception 'msisdn_mismatch';
  end if;

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
    raise exception 'underpaid';
  end if;

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

-- Lock down confirm_purchase: only service_role can run it.
revoke execute on function public.confirm_purchase(text, text, integer) from public;
revoke execute on function public.confirm_purchase(text, text, integer) from anon;
revoke execute on function public.confirm_purchase(text, text, integer) from authenticated;

-- RPC to delete a user and all their data
create or replace function public.delete_user()
returns void
language plpgsql
security definer -- Security definer allows the function to bypass RLS and delete from auth.users
as $$
begin
  -- Delete all associated data first to avoid FK constraints
  delete from public.experiences where user_id = auth.uid();
  delete from public.educations where user_id = auth.uid();
  delete from public.projects where user_id = auth.uid();
  delete from public.skills where user_id = auth.uid();
  delete from public.extracurriculars where user_id = auth.uid();
  delete from public.awards where user_id = auth.uid();
  delete from public.certifications where user_id = auth.uid();
  delete from public.affiliations where user_id = auth.uid();
  delete from public.publications where user_id = auth.uid();
  delete from public.languages where user_id = auth.uid();
  delete from public.references_list where user_id = auth.uid();
  delete from public.applications where user_id = auth.uid();
  delete from public.generated_resumes where user_id = auth.uid();
  delete from public.ai_call_log where user_id = auth.uid();
  delete from public.purchase_disputes where user_id = auth.uid();
  -- purchase_topups + purchase_overpayments + purchase_state_changes cascade
  -- via the purchases FK; delete purchases last among the related rows.
  delete from public.purchases where user_id = auth.uid();

  -- credit_ledger + profile_notes reference profiles with ON DELETE CASCADE,
  -- so they clear automatically when the profile row is deleted below.
  -- (languages, references_list, ai_call_log do NOT cascade — deleted above.)
  delete from public.profiles where id = auth.uid();

  -- Finally, delete the user from auth.users
  delete from auth.users where id = auth.uid();
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- Transaction-flow hardening (migration 007). See migration file for the
-- per-table rationale; this section is the fresh-DB mirror.
-- ─────────────────────────────────────────────────────────────────────────

-- Top-ups: N inbound SMS aggregating into one purchase (case #14).
create table if not exists purchase_topups (
  id                uuid default uuid_generate_v4() primary key,
  purchase_id       uuid references purchases(id) on delete cascade not null,
  payment_reference text not null,
  sender_msisdn     text,
  amount_taka       integer not null,
  created_at        timestamp with time zone default timezone('utc'::text, now()),
  unique(payment_reference)
);
alter table purchase_topups enable row level security;
create index if not exists purchase_topups_purchase_idx on purchase_topups(purchase_id);

-- Overpayment surplus log (case #4).
create table if not exists purchase_overpayments (
  id           uuid default uuid_generate_v4() primary key,
  purchase_id  uuid references purchases(id) on delete cascade not null,
  surplus_taka integer not null,
  resolution   text not null default 'pending'
    check (resolution in ('pending','refunded','kept_as_credit')),
  created_at   timestamp with time zone default timezone('utc'::text, now())
);
alter table purchase_overpayments enable row level security;
create index if not exists purchase_overpayments_purchase_idx on purchase_overpayments(purchase_id);

-- Orphan inbound SMS (cases #2, #5).
create table if not exists unmatched_inbound_sms (
  id                     uuid default uuid_generate_v4() primary key,
  payment_reference      text not null,
  sender_msisdn          text,
  amount_taka            integer not null,
  raw_body               text,
  sms_timestamp          timestamp with time zone not null,
  matched_to_purchase_id uuid references purchases(id),
  created_at             timestamp with time zone default timezone('utc'::text, now()),
  unique(payment_reference)
);
alter table unmatched_inbound_sms enable row level security;
create index if not exists unmatched_inbound_sms_unmatched_idx
  on unmatched_inbound_sms(created_at desc)
  where matched_to_purchase_id is null;

-- Customer-filed disputes (case #10).
create table if not exists purchase_disputes (
  id                uuid default uuid_generate_v4() primary key,
  user_id           uuid references profiles(id) not null,
  payment_reference text not null,
  notes             text,
  status            text not null default 'open'
    check (status in ('open','resolved','rejected')),
  operator_note     text,
  created_at        timestamp with time zone default timezone('utc'::text, now()),
  resolved_at       timestamp with time zone
);
alter table purchase_disputes enable row level security;
create policy "Users can view own disputes" on purchase_disputes
  for select using (auth.uid() = user_id);
create policy "Users can insert own disputes" on purchase_disputes
  for insert with check (auth.uid() = user_id);
create index if not exists purchase_disputes_user_idx on purchase_disputes(user_id, created_at desc);
create index if not exists purchase_disputes_open_idx on purchase_disputes(created_at desc) where status = 'open';

-- Append-only state-transition audit (cases #11/#12 + general).
create table if not exists purchase_state_changes (
  id          uuid default uuid_generate_v4() primary key,
  purchase_id uuid references purchases(id) on delete cascade not null,
  from_status text,
  to_status   text not null,
  actor       text not null,
  reason      text,
  created_at  timestamp with time zone default timezone('utc'::text, now())
);
alter table purchase_state_changes enable row level security;
create index if not exists purchase_state_changes_purchase_idx
  on purchase_state_changes(purchase_id, created_at desc);

-- Status lookup index for admin queries (find pending older than N).
create index if not exists purchases_status_created_idx on purchases(status, created_at desc);

-- Operator manual-confirm RPC (case #11). See migration 007 for the full
-- behaviour and override semantics. Service-role only.
create or replace function operator_confirm_purchase(
  p_transaction_id        text,
  p_override_msisdn_check boolean default false,
  p_override_amount_check boolean default false,
  p_reason                text default null
) returns table (user_id uuid, new_balance integer, credits_granted integer)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_purchase purchases%rowtype; v_balance integer;
begin
  select * into v_purchase from purchases
   where payment_reference = p_transaction_id
     and status in ('pending','underpaid','msisdn_mismatch_review','expired')
   for update;
  if not found then raise exception 'no_pending_purchase'; end if;
  update purchases set status = 'completed' where id = v_purchase.id;
  update profiles set toolkit_credits = toolkit_credits + v_purchase.credits_granted
    where id = v_purchase.user_id returning toolkit_credits into v_balance;
  insert into purchase_state_changes (purchase_id, from_status, to_status, actor, reason)
    values (v_purchase.id, v_purchase.status, 'completed', 'operator',
            coalesce(p_reason, '')
              || case when p_override_msisdn_check then ' [msisdn_override]' else '' end
              || case when p_override_amount_check then ' [amount_override]' else '' end);
  return query select v_purchase.user_id, v_balance, v_purchase.credits_granted;
end; $$;
revoke execute on function operator_confirm_purchase(text, boolean, boolean, text) from public, anon, authenticated;

-- Operator manual-refund (case #12). Service-role only.
create or replace function operator_refund_purchase(p_transaction_id text, p_reason text default null)
returns table (user_id uuid, new_balance integer)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_purchase purchases%rowtype; v_balance integer;
begin
  select * into v_purchase from purchases
   where payment_reference = p_transaction_id and status = 'completed' for update;
  if not found then raise exception 'not_refundable'; end if;
  update purchases set status = 'refunded' where id = v_purchase.id;
  update profiles set toolkit_credits = toolkit_credits - v_purchase.credits_granted
    where id = v_purchase.user_id returning toolkit_credits into v_balance;
  insert into purchase_state_changes (purchase_id, from_status, to_status, actor, reason)
    values (v_purchase.id, 'completed', 'refunded', 'operator', p_reason);
  return query select v_purchase.user_id, v_balance;
end; $$;
revoke execute on function operator_refund_purchase(text, text) from public, anon, authenticated;

-- Multi-SMS aggregation for underpayment recovery (case #14). Service-role only.
create or replace function apply_purchase_topup(
  p_purchase_id uuid, p_payment_ref text, p_sender_msisdn text,
  p_amount_taka integer, p_actor text default 'operator', p_reason text default null
) returns table (status_out text, observed_total integer, new_balance integer)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_purchase purchases%rowtype; v_total integer; v_balance integer; v_surplus integer;
begin
  select * into v_purchase from purchases where id = p_purchase_id for update;
  if not found then raise exception 'purchase_not_found'; end if;
  if v_purchase.status not in ('pending','underpaid') then
    raise exception 'purchase_not_topup_eligible';
  end if;
  insert into purchase_topups (purchase_id, payment_reference, sender_msisdn, amount_taka)
    values (p_purchase_id, p_payment_ref, p_sender_msisdn, p_amount_taka);
  select coalesce(v_purchase.observed_amount_taka, 0)
       + coalesce((select sum(amount_taka) from purchase_topups where purchase_id = p_purchase_id), 0)
    into v_total;
  if v_total >= v_purchase.amount_taka then
    update purchases set status = 'completed', observed_amount_taka = v_total where id = p_purchase_id;
    update profiles set toolkit_credits = toolkit_credits + v_purchase.credits_granted
      where id = v_purchase.user_id returning toolkit_credits into v_balance;
    insert into purchase_state_changes (purchase_id, from_status, to_status, actor, reason)
      values (p_purchase_id, v_purchase.status, 'completed', p_actor,
              format('topup ref=%s amount=%s new_total=%s', p_payment_ref, p_amount_taka, v_total)
              || coalesce(' ' || p_reason, ''));
    if v_total > v_purchase.amount_taka then
      v_surplus := v_total - v_purchase.amount_taka;
      insert into purchase_overpayments (purchase_id, surplus_taka) values (p_purchase_id, v_surplus);
    end if;
    return query select 'completed'::text, v_total, v_balance;
  else
    -- Still short. Flip to 'underpaid' (a no-op if already underpaid) so the
    -- customer's status pill shows the "send Tk N more" action card and
    -- operator queries for stuck rows surface this one.
    update purchases set status = 'underpaid', observed_amount_taka = v_total
      where id = p_purchase_id;
    insert into purchase_state_changes (purchase_id, from_status, to_status, actor, reason)
      values (p_purchase_id, v_purchase.status, 'underpaid', p_actor,
              format('topup ref=%s amount=%s still_short=%s',
                     p_payment_ref, p_amount_taka, v_purchase.amount_taka - v_total)
              || coalesce(' ' || p_reason, ''));
    return query select 'underpaid'::text, v_total, null::integer;
  end if;
end; $$;
revoke execute on function apply_purchase_topup(uuid, text, text, integer, text, text) from public, anon, authenticated;

-- Orphan-SMS dump (cases #2, #5). Service-role only.
create or replace function record_orphan_sms(
  p_payment_reference text, p_sender_msisdn text, p_amount_taka integer,
  p_raw_body text, p_sms_timestamp timestamp with time zone
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  insert into unmatched_inbound_sms
    (payment_reference, sender_msisdn, amount_taka, raw_body, sms_timestamp)
  values (p_payment_reference, p_sender_msisdn, p_amount_taka, p_raw_body, p_sms_timestamp)
  on conflict (payment_reference) do update
    set sender_msisdn = excluded.sender_msisdn, amount_taka = excluded.amount_taka,
        raw_body = excluded.raw_body, sms_timestamp = excluded.sms_timestamp
  returning id into v_id;
  return v_id;
end; $$;
revoke execute on function record_orphan_sms(text, text, integer, text, timestamp with time zone)
  from public, anon, authenticated;

-- bKash reversal SMS (case #7). Service-role only.
create or replace function record_purchase_reversal(p_transaction_id text, p_reason text default null)
returns table (user_id uuid, new_balance integer)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_purchase purchases%rowtype; v_balance integer;
begin
  select * into v_purchase from purchases
   where payment_reference = p_transaction_id and status = 'completed' for update;
  if not found then raise exception 'no_completed_purchase'; end if;
  update purchases set status = 'refunded' where id = v_purchase.id;
  update profiles set toolkit_credits = toolkit_credits - v_purchase.credits_granted
    where id = v_purchase.user_id returning toolkit_credits into v_balance;
  insert into purchase_state_changes (purchase_id, from_status, to_status, actor, reason)
    values (v_purchase.id, 'completed', 'refunded', 'flutter',
            coalesce(p_reason, 'bKash reversal SMS observed'));
  return query select v_purchase.user_id, v_balance;
end; $$;
revoke execute on function record_purchase_reversal(text, text) from public, anon, authenticated;

-- Customer-callable dispute insert (case #10).
create or replace function record_purchase_dispute(p_transaction_id text, p_notes text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if length(coalesce(p_transaction_id, '')) < 6 then raise exception 'invalid_transaction_id'; end if;
  insert into purchase_disputes (user_id, payment_reference, notes)
    values (auth.uid(), p_transaction_id, p_notes) returning id into v_id;
  return v_id;
end; $$;
grant execute on function record_purchase_dispute(text, text) to authenticated;

-- Operator dispute resolution. Service-role only.
create or replace function resolve_purchase_dispute(
  p_dispute_id uuid, p_resolution text, p_operator_note text default null
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_resolution not in ('resolved','rejected') then raise exception 'invalid_resolution'; end if;
  update purchase_disputes
    set status = p_resolution, operator_note = p_operator_note, resolved_at = now()
    where id = p_dispute_id;
end; $$;
revoke execute on function resolve_purchase_dispute(uuid, text, text) from public, anon, authenticated;

-- TTL-expire pending purchases > 24 h old (case #1). Service-role only.
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
  return v_affected;
end; $$;
revoke execute on function expire_stale_pending_purchases() from public, anon, authenticated;

-- ────────────────────────────────────────────────────────────────────────
-- Migration 009 — admin panel surface
-- ────────────────────────────────────────────────────────────────────────

-- Append-only operator action log. Layered alongside purchase_state_changes
-- (which tracks purchase-row transitions only). admin_audit_log covers
-- every operator action on every target.
create table if not exists admin_audit_log (
  id           uuid default uuid_generate_v4() primary key,
  actor        text not null default 'operator',
  action       text not null,
  target_kind  text not null,
  target_id    uuid,
  before_state jsonb,
  after_state  jsonb,
  reason       text,
  created_at   timestamp with time zone default timezone('utc'::text, now())
);
alter table admin_audit_log enable row level security;
create index if not exists admin_audit_log_target_idx on admin_audit_log(target_kind, target_id, created_at desc);
create index if not exists admin_audit_log_action_idx on admin_audit_log(action, created_at desc);
create index if not exists admin_audit_log_created_idx on admin_audit_log(created_at desc);

-- Operator-private notes on customer profiles.
create table if not exists profile_notes (
  id         uuid default uuid_generate_v4() primary key,
  user_id    uuid references profiles(id) on delete cascade not null,
  note       text not null,
  created_at timestamp with time zone default timezone('utc'::text, now())
);
alter table profile_notes enable row level security;
create index if not exists profile_notes_user_idx on profile_notes(user_id, created_at desc);

alter table profiles add column if not exists flagged_at timestamp with time zone;
create index if not exists profiles_flagged_idx on profiles(flagged_at) where flagged_at is not null;

alter table unmatched_inbound_sms add column if not exists reviewed_at timestamp with time zone;

-- Single shared audit-write RPC, called by every admin endpoint after its
-- underlying RPC succeeds. Not in the same transaction as the action —
-- see migration 009 header for trade-off.
create or replace function record_admin_action(
  p_action text, p_target_kind text, p_target_id uuid,
  p_before jsonb, p_after jsonb, p_reason text
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  if p_action is null or p_target_kind is null then raise exception 'action_and_target_kind_required'; end if;
  insert into admin_audit_log (action, target_kind, target_id, before_state, after_state, reason)
    values (p_action, p_target_kind, p_target_id, p_before, p_after, p_reason)
    returning id into v_id;
  return v_id;
end; $$;
revoke execute on function record_admin_action(text, text, uuid, jsonb, jsonb, text) from public, anon, authenticated;

-- Operator credit adjustments. Distinct from consume/refund (migration 008)
-- which are tied to the optimizer hot path. Deduct allows negative balance.
create or replace function admin_grant_credits(p_user_id uuid, p_amount integer)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_new_balance integer;
begin
  if p_user_id is null then raise exception 'user_id_required'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'amount_must_be_positive'; end if;
  update profiles set toolkit_credits = toolkit_credits + p_amount where id = p_user_id returning toolkit_credits into v_new_balance;
  if v_new_balance is null then raise exception 'user_not_found'; end if;
  return v_new_balance;
end; $$;
revoke execute on function admin_grant_credits(uuid, integer) from public, anon, authenticated;

create or replace function admin_deduct_credits(p_user_id uuid, p_amount integer)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_new_balance integer;
begin
  if p_user_id is null then raise exception 'user_id_required'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'amount_must_be_positive'; end if;
  update profiles set toolkit_credits = toolkit_credits - p_amount where id = p_user_id returning toolkit_credits into v_new_balance;
  if v_new_balance is null then raise exception 'user_not_found'; end if;
  return v_new_balance;
end; $$;
revoke execute on function admin_deduct_credits(uuid, integer) from public, anon, authenticated;

-- Operator purchase RPCs.
create or replace function admin_expire_purchase(p_purchase_id uuid, p_reason text)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare v_status text;
begin
  if p_purchase_id is null then raise exception 'purchase_id_required'; end if;
  select status into v_status from purchases where id = p_purchase_id for update;
  if not found then raise exception 'purchase_not_found'; end if;
  if v_status not in ('pending','underpaid','msisdn_mismatch_review') then
    raise exception 'not_expirable' using hint = format('Cannot expire row in status %s.', v_status);
  end if;
  update purchases set status = 'expired' where id = p_purchase_id;
  insert into purchase_state_changes (purchase_id, from_status, to_status, actor, reason)
    values (p_purchase_id, v_status, 'expired', 'operator', p_reason);
  return 'expired';
end; $$;
revoke execute on function admin_expire_purchase(uuid, text) from public, anon, authenticated;

create or replace function admin_reopen_purchase(p_purchase_id uuid, p_reason text)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare v_status text;
begin
  if p_purchase_id is null then raise exception 'purchase_id_required'; end if;
  select status into v_status from purchases where id = p_purchase_id for update;
  if not found then raise exception 'purchase_not_found'; end if;
  if v_status not in ('expired','failed') then
    raise exception 'not_reopenable' using hint = format('Cannot reopen row in status %s.', v_status);
  end if;
  update purchases set status = 'pending', created_at = timezone('utc'::text, now()) where id = p_purchase_id;
  insert into purchase_state_changes (purchase_id, from_status, to_status, actor, reason)
    values (p_purchase_id, v_status, 'pending', 'operator', p_reason);
  return 'pending';
end; $$;
revoke execute on function admin_reopen_purchase(uuid, text) from public, anon, authenticated;

create or replace function admin_grant_override(p_purchase_id uuid, p_reason text)
returns table (user_id uuid, new_balance integer, credits_granted integer)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_purchase purchases%rowtype; v_balance integer;
begin
  if p_purchase_id is null then raise exception 'purchase_id_required'; end if;
  select * into v_purchase from purchases where id = p_purchase_id for update;
  if not found then raise exception 'purchase_not_found'; end if;
  if v_purchase.status not in ('underpaid','msisdn_mismatch_review','expired') then
    raise exception 'not_grantable' using hint = format('Cannot grant override on status %s.', v_purchase.status);
  end if;
  update purchases set status = 'completed' where id = v_purchase.id;
  update profiles set toolkit_credits = toolkit_credits + v_purchase.credits_granted where id = v_purchase.user_id returning toolkit_credits into v_balance;
  insert into purchase_state_changes (purchase_id, from_status, to_status, actor, reason)
    values (v_purchase.id, v_purchase.status, 'completed', 'operator', coalesce(p_reason, 'operator override'));
  return query select v_purchase.user_id, v_balance, v_purchase.credits_granted;
end; $$;
revoke execute on function admin_grant_override(uuid, text) from public, anon, authenticated;

-- pg_trgm index for fast substring search on email in the admin Users tab.
create extension if not exists pg_trgm;
create index if not exists profiles_email_trgm_idx on profiles using gin (email gin_trgm_ops);

-- ────────────────────────────────────────────────────────────────────────
-- Migration 011 — webhook replay-protection nonce store
-- ────────────────────────────────────────────────────────────────────────
-- Backs the timestamp+nonce verification added to /api/_lib/webhookAuth.ts.
-- See `supabase/migrations/011_webhook_nonces.sql` for the rationale.
create table if not exists webhook_nonces (
  nonce      text primary key,
  created_at timestamp with time zone default timezone('utc', now()) not null,
  source     text not null default 'bkash'
);
alter table webhook_nonces enable row level security;
create index if not exists webhook_nonces_created_idx on webhook_nonces(created_at);

create or replace function acquire_webhook_nonce(p_nonce text, p_source text default 'bkash')
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into webhook_nonces (nonce, source) values (p_nonce, p_source)
    on conflict (nonce) do nothing;
  return FOUND;
end; $$;
revoke execute on function acquire_webhook_nonce(text, text) from public, anon, authenticated;

create or replace function prune_webhook_nonces() returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_deleted integer;
begin
  delete from webhook_nonces where created_at < timezone('utc', now()) - interval '10 minutes';
  get diagnostics v_deleted = ROW_COUNT;
  return v_deleted;
end; $$;
revoke execute on function prune_webhook_nonces() from public, anon, authenticated;

-- ────────────────────────────────────────────────────────────────────────
-- Migration 012 — near-real-time credit assignment
-- ────────────────────────────────────────────────────────────────────────
-- See supabase/migrations/012_realtime_and_match_on_submit.sql for rationale.
-- inbound_payments backs the match-on-submit logic in initiate_purchase v3
-- (above). purchases is added to the realtime publication so the web client
-- subscribes instead of polling.

-- Server-side memory of an HMAC-verified bKash SMS that arrived before the
-- customer submitted their TrxID. Consumed automatically by initiate_purchase.
create table if not exists inbound_payments (
  payment_reference    text primary key,
  sender_msisdn        text,
  amount_taka          integer not null,
  raw_body             text,
  sms_timestamp        timestamp with time zone,
  received_at          timestamp with time zone default timezone('utc', now()) not null,
  consumed_at          timestamp with time zone,
  consumed_purchase_id uuid references purchases(id)
);
alter table inbound_payments enable row level security;
create index if not exists inbound_payments_unconsumed_idx
  on inbound_payments(received_at) where consumed_at is null;

-- Called by /api/confirm-purchase (service-role) on a genuine 404.
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

-- expire_stale_pending_purchases also prunes inbound_payments (consumed rows +
-- anything older than 48h) so the table stays small. Overrides the earlier
-- definition.
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
    where consumed_at is not null or received_at < now() - interval '48 hours';
  return v_affected;
end; $$;
revoke execute on function expire_stale_pending_purchases() from public, anon, authenticated;

-- Realtime: let the web client subscribe to its own purchase row.
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
alter table purchases replica identity full;

-- ════════════════════════════════════════════════════════════════════
-- Analytics & BI foundation (migration 013)
-- ════════════════════════════════════════════════════════════════════

-- First-party product/funnel analytics. Insert-only RLS (anon+authenticated);
-- reads are service-role only (admin). No third-party SDK.
create table if not exists analytics_events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  anon_id text, user_id uuid, session_id text,
  event text not null, props jsonb not null default '{}'::jsonb,
  path text, referrer text, utm_source text, utm_medium text, utm_campaign text
);
create index if not exists analytics_events_event_time_idx on analytics_events (event, created_at desc);
create index if not exists analytics_events_user_time_idx  on analytics_events (user_id, created_at desc);
create index if not exists analytics_events_time_idx        on analytics_events (created_at desc);
alter table analytics_events enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='analytics_events' and policyname='analytics_events_insert') then
    create policy analytics_events_insert on analytics_events for insert to anon, authenticated
      with check (user_id is null or user_id = auth.uid());
  end if;
end $$;

-- Append-only journal of every toolkit_credits change (trigger-fed).
create table if not exists credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  delta integer not null, balance_after integer not null,
  reason text, created_at timestamptz not null default now()
);
create index if not exists credit_ledger_user_time_idx on credit_ledger (user_id, created_at desc);
create index if not exists credit_ledger_time_idx       on credit_ledger (created_at desc);
alter table credit_ledger enable row level security;
create or replace function log_credit_change() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.toolkit_credits is distinct from old.toolkit_credits then
    insert into credit_ledger (user_id, delta, balance_after, reason)
    values (new.id, new.toolkit_credits - old.toolkit_credits, new.toolkit_credits,
            nullif(current_setting('app.credit_reason', true), ''));
  end if;
  return new;
end; $$;
drop trigger if exists trg_log_credit_change on profiles;
create trigger trg_log_credit_change after update of toolkit_credits on profiles
  for each row execute function log_credit_change();

-- Operator-entered ad spend for CAC/ROAS.
create table if not exists marketing_spend (
  id uuid primary key default gen_random_uuid(),
  spend_date date not null, channel text not null, campaign text,
  amount_taka integer not null default 0, clicks integer, impressions integer,
  notes text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists marketing_spend_date_idx on marketing_spend (spend_date desc);
alter table marketing_spend enable row level security;

-- Acquisition + activity columns on profiles.
alter table profiles add column if not exists utm_source text;
alter table profiles add column if not exists utm_medium text;
alter table profiles add column if not exists utm_campaign text;
alter table profiles add column if not exists signup_referrer text;
alter table profiles add column if not exists last_active_at timestamptz;

-- AI cost/telemetry columns + widened kind.
alter table ai_call_log add column if not exists provider text;
alter table ai_call_log add column if not exists model text;
alter table ai_call_log add column if not exists prompt_tokens integer;
alter table ai_call_log add column if not exists completion_tokens integer;
alter table ai_call_log add column if not exists cost_usd numeric(12,6);
alter table ai_call_log add column if not exists status text;
alter table ai_call_log add column if not exists latency_ms integer;
-- AI failure diagnosis (migration 020). error_code taxonomy is defined by
-- GeminiErrorCode in src/infrastructure/ai/GeminiClient.ts and is intentionally
-- NOT constrained here — logCall() swallows its own errors, so a CHECK
-- violation would silently drop the row instead of failing loudly.
alter table ai_call_log add column if not exists error_code text;
alter table ai_call_log add column if not exists error_message text;
alter table ai_call_log add column if not exists model_attempts jsonb;
alter table ai_call_log add column if not exists thought_tokens integer;
alter table ai_call_log add column if not exists attempt_count smallint;
create index if not exists ai_call_log_errors_idx
  on ai_call_log (created_at desc, error_code) where error_code is not null;
do $$ begin
  if exists (select 1 from pg_constraint where conname='ai_call_log_kind_check' and conrelid='public.ai_call_log'::regclass) then
    alter table ai_call_log drop constraint ai_call_log_kind_check;
  end if;
  alter table ai_call_log add constraint ai_call_log_kind_check
    check (kind in ('optimize','optimize_general','toolkit','toolkit_item','extract_resume','normalize'));
end $$;

-- Free vs paid generation typing.
alter table generated_resumes add column if not exists generation_type text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname='generated_resumes_generation_type_check' and conrelid='public.generated_resumes'::regclass) then
    alter table generated_resumes add constraint generated_resumes_generation_type_check
      check (generation_type is null or generation_type in ('free_general','paid_tailored'));
  end if;
end $$;

-- Read-side views.
create or replace view v_daily_revenue as
  select date(created_at) as day, count(*) as orders,
         coalesce(sum(amount_taka),0) as revenue_taka, coalesce(sum(credits_granted),0) as credits_sold
  from purchases where status='completed' group by 1;
create or replace view v_daily_signups as
  select date(created_at) as day, count(*) as signups from profiles group by 1;
-- Thought tokens count toward the token total (they bill at the output rate),
-- and each column is coalesced individually: sum(a+b) yields NULL for any row
-- where either column is null, so sum() skipped those rows entirely and
-- pre-telemetry rows were silently excluded from total_tokens.
create or replace view v_daily_ai_usage as
  select date(created_at) as day, count(*) as calls,
         count(*) filter (where status='error') as errors,
         coalesce(sum(cost_usd),0) as cost_usd,
         coalesce(sum(coalesce(prompt_tokens,0)+coalesce(completion_tokens,0)+coalesce(thought_tokens,0)),0) as total_tokens,
         coalesce(sum(coalesce(thought_tokens,0)),0) as thought_tokens
  from ai_call_log group by 1;
-- "Which calls fail, and why" — the surface the OpenRouter setup never had.
create or replace view v_ai_failures_daily as
  select date(created_at) as day, kind, coalesce(error_code,'unclassified') as error_code,
         count(*) as failures, round(avg(latency_ms)) as avg_latency_ms,
         round(avg(attempt_count),2) as avg_attempts, max(error_message) as sample_message
  from ai_call_log where status='error'
    -- Migration 023: insufficient_credits (402) rows are logged so a rejected
    -- request still counts toward the daily cap, but no AI call ran behind them.
    -- Left in, they showed up as 'unclassified' beside real provider failures.
    and coalesce(error_code,'') <> 'insufficient_credits'
  group by 1,2,3;
-- Per-model health from model_attempts (the `model` column records only
-- whichever model ultimately served the response, hiding failed chain steps).
create or replace view v_ai_model_health as
  select a.attempt->>'model' as model, count(*) as attempts,
         count(*) filter (where (a.attempt->>'ok')::boolean) as successes,
         count(*) filter (where not (a.attempt->>'ok')::boolean) as failures,
         round(avg((a.attempt->>'ms')::numeric)) as avg_ms
  from ai_call_log l cross join lateral jsonb_array_elements(l.model_attempts) as a(attempt)
  where l.model_attempts is not null group by 1;
create or replace view v_credit_liability as
  select coalesce(sum(toolkit_credits) filter (where toolkit_credits>0),0) as outstanding_credits,
         count(*) filter (where toolkit_credits<0) as negative_balance_users
  from profiles;

-- Service-role lookup of the TRUE login email (profiles.email can drift).
create or replace function public.admin_auth_emails(p_ids uuid[])
returns table(id uuid, email text)
language sql security definer set search_path = public as $$
  select u.id, u.email::text from auth.users u where u.id = any(p_ids);
$$;
revoke all on function public.admin_auth_emails(uuid[]) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- Atomic AI-call reservation (migration 024)
-- ─────────────────────────────────────────────────────────────────────────
-- The daily caps used to be a read-then-write: count ai_call_log, then INSERT
-- only AFTER the provider returned. The gap between the two was the full provider
-- latency (5-30s), so a parallel burst all read the same pre-burst count and all
-- passed. reserve_ai_call closes it by counting and inserting a 'pending' row in
-- one advisory-locked transaction; finalize_ai_call fills in the outcome later.
create or replace function reserve_ai_call(
  p_kind text, p_overall_cap int, p_kind_cap int default 0, p_excluded_kinds text[] default '{}'
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid := auth.uid(); v_overall int; v_kind int; v_id uuid;
  v_exempt boolean := p_kind = any(p_excluded_kinds);
begin
  if v_user is null then raise exception 'not_authenticated'; end if;
  -- Per-user lock: without it, two concurrent transactions both read the
  -- pre-burst count under READ COMMITTED. Released automatically at commit.
  perform pg_advisory_xact_lock(hashtextextended(v_user::text, 0));
  select count(*) filter (where kind <> all(p_excluded_kinds)),
         count(*) filter (where kind = p_kind)
    into v_overall, v_kind
  from ai_call_log
  where user_id = v_user and created_at >= now() - interval '24 hours';
  if not v_exempt and v_overall >= p_overall_cap then
    raise exception 'rate_limited:%:%:overall', v_overall, p_overall_cap;
  end if;
  if p_kind_cap > 0 and v_kind >= p_kind_cap then
    raise exception 'rate_limited:%:%:%', v_kind, p_kind_cap, p_kind;
  end if;
  insert into ai_call_log (user_id, kind, status)
  values (v_user, p_kind, 'pending') returning id into v_id;
  return v_id;
end; $$;

-- A function, NOT an UPDATE policy on ai_call_log: a policy would let a user
-- rewrite any of their own telemetry rows, destroying the audit trail the caps
-- depend on. This can only touch the row id it is given, and only if it is theirs.
create or replace function finalize_ai_call(p_id uuid, p_meta jsonb)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update ai_call_log set
    provider          = coalesce(p_meta->>'provider', provider),
    model             = coalesce(p_meta->>'model', model),
    prompt_tokens     = coalesce((p_meta->>'prompt_tokens')::int, prompt_tokens),
    completion_tokens = coalesce((p_meta->>'completion_tokens')::int, completion_tokens),
    thought_tokens    = coalesce((p_meta->>'thought_tokens')::int, thought_tokens),
    cost_usd          = coalesce((p_meta->>'cost_usd')::numeric, cost_usd),
    status            = coalesce(p_meta->>'status', status),
    latency_ms        = coalesce((p_meta->>'latency_ms')::int, latency_ms),
    error_code        = coalesce(p_meta->>'error_code', error_code),
    error_message     = coalesce(p_meta->>'error_message', error_message),
    model_attempts    = coalesce(p_meta->'model_attempts', model_attempts),
    attempt_count     = coalesce((p_meta->>'attempt_count')::smallint, attempt_count)
  where id = p_id and user_id = auth.uid();
end; $$;

revoke all on function reserve_ai_call(text, int, int, text[]) from public, anon;
revoke all on function finalize_ai_call(uuid, jsonb) from public, anon;
grant execute on function reserve_ai_call(text, int, int, text[]) to authenticated, service_role;
grant execute on function finalize_ai_call(uuid, jsonb) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- Migration 026 — admin login throttle (per-IP lockout + attempt log)
-- ─────────────────────────────────────────────────────────────────────────

-- Every POST /api/admin/login attempt. Drives the lockout ladder and the
-- "Admin access" panel in the System tab. RLS on with no policies = deny-all;
-- service_role only. NEVER stores the submitted password.
create table if not exists admin_login_attempts (
  id              bigserial primary key,
  ip              text not null,
  username_tried  text,
  user_agent      text,
  -- 'pending' | 'failure' | 'success' | 'blocked'
  outcome         text not null default 'pending',
  created_at      timestamptz not null default now()
);
create index if not exists admin_login_attempts_ip_created_idx on admin_login_attempts (ip, created_at desc);
create index if not exists admin_login_attempts_created_idx on admin_login_attempts (created_at desc);
alter table admin_login_attempts enable row level security;
revoke all on admin_login_attempts from anon, authenticated;
grant select, insert, update, delete on admin_login_attempts to service_role;
grant usage, select on sequence admin_login_attempts_id_seq to service_role;

-- Reserve an attempt for this IP or refuse it. The 'pending' row is inserted
-- BEFORE credentials are checked and counts against concurrent siblings, so a
-- burst of parallel requests cannot each pass the ladder (the 024 bug shape).
-- Ladder, per IP, failures since that IP's last success, 15-minute window:
-- 5+ → 60s, 10+ → 15min, 20+ → 60min, measured from the latest attempt.
-- Deliberately NOT global: a global lock would let anyone lock the owner out of
-- the payment-recovery panel on demand.
create or replace function begin_admin_login_attempt(
  p_ip text,
  p_username text default null,
  p_user_agent text default null
)
returns table (attempt_id bigint, allowed boolean, retry_after_sec integer, recent_failures integer)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_window   constant interval := interval '15 minutes';
  v_ip       text := coalesce(nullif(trim(p_ip), ''), 'unknown');
  v_since    timestamptz;
  v_failures integer;
  v_last_at  timestamptz;
  v_lock_sec integer;
  v_retry    integer;
  v_id       bigint;
begin
  perform pg_advisory_xact_lock(hashtext('admin_login:' || v_ip));

  select greatest(
           coalesce(max(created_at) filter (where outcome = 'success'), now() - v_window),
           now() - v_window
         )
    into v_since
    from admin_login_attempts
   where ip = v_ip and created_at > now() - v_window;
  v_since := coalesce(v_since, now() - v_window);

  select count(*), max(created_at)
    into v_failures, v_last_at
    from admin_login_attempts
   where ip = v_ip
     and outcome in ('failure', 'pending', 'blocked')
     and created_at > v_since;

  v_lock_sec := case
                  when v_failures >= 20 then 3600
                  when v_failures >= 10 then 900
                  when v_failures >= 5  then 60
                  else 0
                end;
  if v_lock_sec > 0 and v_last_at is not null then
    v_retry := ceil(extract(epoch from (v_last_at + make_interval(secs => v_lock_sec)) - now()))::integer;
  else
    v_retry := 0;
  end if;

  if v_retry > 0 then
    insert into admin_login_attempts (ip, username_tried, user_agent, outcome)
    values (v_ip, left(coalesce(p_username, ''), 120), left(coalesce(p_user_agent, ''), 300), 'blocked')
    returning id into v_id;
    return query select v_id, false, v_retry, v_failures;
    return;
  end if;

  insert into admin_login_attempts (ip, username_tried, user_agent, outcome)
  values (v_ip, left(coalesce(p_username, ''), 120), left(coalesce(p_user_agent, ''), 300), 'pending')
  returning id into v_id;

  delete from admin_login_attempts where created_at < now() - interval '90 days';

  return query select v_id, true, 0, v_failures;
end; $$;

-- Only moves a row OUT of 'pending', so a replayed id cannot rewrite a
-- 'failure' into a 'success' and clear the ladder.
create or replace function finalize_admin_login_attempt(p_attempt_id bigint, p_success boolean)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update admin_login_attempts
     set outcome = case when p_success then 'success' else 'failure' end
   where id = p_attempt_id and outcome = 'pending';
end; $$;

revoke all on function begin_admin_login_attempt(text, text, text) from public, anon, authenticated;
revoke all on function finalize_admin_login_attempt(bigint, boolean) from public, anon, authenticated;
grant execute on function begin_admin_login_attempt(text, text, text) to service_role;
grant execute on function finalize_admin_login_attempt(bigint, boolean) to service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- Migration 027 — account origin signals (detection only)
-- ─────────────────────────────────────────────────────────────────────────

-- HMAC of the network origin per account, for spotting one person running many
-- accounts on throwaway emails. NEVER stores a raw IP; the digest is keyed with
-- IP_HASH_SALT (falls back to the service-role key). Nothing reads this to
-- block anyone — it feeds the System tab's "Abuse signals" panel so the
-- decision to add signup friction can be made on evidence.
--
-- Written by api/_lib/auth.ts on an account's authenticated API calls, NOT at
-- signup: signup is browser-to-Supabase with no server in the path. Supabase's
-- own auth.audit_log_entries has an ip_address column but is empty (GoTrue
-- prunes it), which is why this exists at all.
--
-- One row per (user, origin) — the counter carries volume, so the table grows
-- with distinct networks per person, not with traffic.
create table if not exists account_ip_signals (
  user_id    uuid not null references profiles(id) on delete cascade,
  ip_hash    text not null,
  first_seen timestamptz not null default now(),
  last_seen  timestamptz not null default now(),
  hits       integer not null default 1,
  primary key (user_id, ip_hash)
);
-- The question is "which accounts share this origin", so index the hash.
create index if not exists account_ip_signals_hash_idx on account_ip_signals (ip_hash);
create index if not exists account_ip_signals_last_seen_idx on account_ip_signals (last_seen desc);
alter table account_ip_signals enable row level security;
revoke all on account_ip_signals from anon, authenticated;
grant select, insert, update, delete on account_ip_signals to service_role;

-- Sits in the request path of every authenticated endpoint, so it is one
-- indexed upsert and nothing else. Prunes at 180 days on ~1 in 1000 calls so
-- there is no cron to forget about.
create or replace function record_account_ip(p_user_id uuid, p_ip_hash text)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_user_id is null or coalesce(trim(p_ip_hash), '') = '' then
    return;
  end if;

  insert into account_ip_signals (user_id, ip_hash)
  values (p_user_id, p_ip_hash)
  on conflict (user_id, ip_hash)
  do update set last_seen = now(), hits = account_ip_signals.hits + 1;

  if random() < 0.001 then
    delete from account_ip_signals where last_seen < now() - interval '180 days';
  end if;
end; $$;

revoke all on function record_account_ip(uuid, text) from public, anon, authenticated;
grant execute on function record_account_ip(uuid, text) to service_role;

-- ────────────────────────────────────────────────────────────────────────
-- Migration 028 — in-modal purchase verification + typo diagnosis
-- ────────────────────────────────────────────────────────────────────────
-- Lets the purchase modal answer "why is this still pending?" instead of
-- closing behind a navbar spinner. See
-- `supabase/migrations/028_purchase_verification_ux.sql` for the full
-- rationale, including the privacy/fraud rule that
-- `diagnose_pending_purchase` must NEVER return the payment_reference of an
-- unclaimed payment (purchases.sender_msisdn is customer-supplied and
-- unverified, so an msisdn match is not proof of ownership).

-- Liveness of the operator's Flutter SMS-watcher phone. Fed by
-- POST /api/confirm-purchase { kind: 'heartbeat', ... }. Without it,
-- "we haven't seen your SMS" is ambiguous between "your TrxID is wrong" and
-- "our phone is offline", and guessing wrong accuses a paying customer.
create table if not exists watcher_heartbeats (
  device_id    text primary key,
  last_seen_at timestamp with time zone not null default timezone('utc', now()),
  app_version  text,
  queue_depth  integer,
  ping_count   bigint not null default 1
);
alter table watcher_heartbeats enable row level security;
-- No user/anon policies — service-role + SECURITY DEFINER functions only.

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

-- Customer-facing diagnosis. User-callable; ownership via auth.uid().
-- Naturally rate-limited: needs an owned purchase row, and initiate_purchase
-- caps a user at 5 pending rows per 24h.
--
-- PRIVACY (migration 029, tightening 028): returns NOTHING about the unclaimed
-- payment it matched against — no reference, no amount, no masked sender, not
-- even a boolean. Ownership cannot be established at diagnosis time (the
-- customer's sender_msisdn is unverified and TrxID similarity is not
-- ownership), so any detail would describe a stranger's payment. The near-miss
-- search survives only to choose between the 'likely_typo' and 'nothing_found'
-- verdicts.
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
revoke execute on function diagnose_pending_purchase(text) from public;
grant  execute on function diagnose_pending_purchase(text) to authenticated, service_role;

-- "Edit & resubmit" after a mistyped TrxID. User-callable; own pending rows only.
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

-- expire_stale_pending_purchases() also prunes watcher_heartbeats (30 days).
-- Canonical body lives in migrations/028_purchase_verification_ux.sql.
