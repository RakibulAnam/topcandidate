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
  delete from public.applications where user_id = auth.uid();
  delete from public.generated_resumes where user_id = auth.uid();
  delete from public.purchase_disputes where user_id = auth.uid();
  -- purchase_topups + purchase_overpayments + purchase_state_changes cascade
  -- via the purchases FK; delete purchases last among the related rows.
  delete from public.purchases where user_id = auth.uid();

  -- Delete the profile
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
do $$ begin
  if exists (select 1 from pg_constraint where conname='ai_call_log_kind_check' and conrelid='public.ai_call_log'::regclass) then
    alter table ai_call_log drop constraint ai_call_log_kind_check;
  end if;
  alter table ai_call_log add constraint ai_call_log_kind_check
    check (kind in ('optimize','optimize_general','toolkit','toolkit_item','extract_resume'));
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
create or replace view v_daily_ai_usage as
  select date(created_at) as day, count(*) as calls,
         count(*) filter (where status='error') as errors,
         coalesce(sum(cost_usd),0) as cost_usd,
         coalesce(sum(prompt_tokens+completion_tokens),0) as total_tokens
  from ai_call_log group by 1;
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
