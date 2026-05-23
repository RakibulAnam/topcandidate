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
  status            text    not null default 'pending'
    check (status in ('pending', 'completed', 'failed', 'refunded')),
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
-- SECURITY DEFINER + locked search_path so the user's JWT can call it without
-- a direct UPDATE policy and a hostile object in another schema cannot
-- shadow `profiles`.
create or replace function consume_toolkit_credit()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  new_balance integer;
begin
  update public.profiles
  set    toolkit_credits = toolkit_credits - 1
  where  id = auth.uid()
    and  toolkit_credits > 0
  returning toolkit_credits into new_balance;

  if new_balance is null then
    raise exception 'insufficient_credits'
      using hint = 'User has no toolkit credits remaining.';
  end if;

  return new_balance;
end;
$$;

-- Refund 1 credit — called server-side when the AI optimizer fails after
-- a credit was already consumed.
create or replace function refund_toolkit_credit()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.profiles
  set    toolkit_credits = toolkit_credits + 1
  where  id = auth.uid();
end;
$$;

-- Initiate a purchase: user-callable. The user has already (claims to have)
-- sent a bKash payment to the owner's number; they paste the transaction ID
-- and (optionally) their bKash phone number, and this function records a
-- pending row. NO credits are granted here — that happens out-of-band via
-- confirm_purchase below.
--
-- The package mapping is hardcoded server-side so users cannot fake the
-- credit count or amount they're entitled to. Add new packages by editing
-- the `case` block.
create or replace function initiate_purchase(
  p_package_id     text,
  p_transaction_id text,
  p_sender_msisdn  text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_credits       integer;
  v_amount_taka   integer;
  v_purchase_id   uuid;
  v_pending_count integer;
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

  return v_purchase_id;
end;
$$;

-- Confirm a purchase: service-role-only. Called by the /api/confirm-purchase
-- webhook, which is in turn called by the owner's Flutter app after it
-- detects a matching bKash SMS on the owner's phone. Atomically flips the
-- pending row to 'completed' and grants credits.
create or replace function confirm_purchase(
  p_transaction_id        text,
  p_observed_sender_msisdn text default null
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
    and status = 'pending'
  for update;

  if not found then
    raise exception 'no_pending_purchase'
      using hint = 'No pending purchase matches the given transaction ID.';
  end if;

  if v_purchase.sender_msisdn is not null
     and p_observed_sender_msisdn is not null
     and v_purchase.sender_msisdn <> p_observed_sender_msisdn
  then
    raise exception 'msisdn_mismatch'
      using hint = format(
        'Pending purchase claims sender %s but observed SMS came from %s.',
        v_purchase.sender_msisdn, p_observed_sender_msisdn
      );
  end if;

  update public.purchases
  set status = 'completed'
  where id = v_purchase.id;

  update public.profiles
  set toolkit_credits = toolkit_credits + v_purchase.credits_granted
  where id = v_purchase.user_id
  returning toolkit_credits into v_balance;

  return query select v_purchase.user_id, v_balance, v_purchase.credits_granted;
end;
$$;

-- Lock down confirm_purchase: only service_role can run it.
revoke execute on function public.confirm_purchase(text, text) from public;
revoke execute on function public.confirm_purchase(text, text) from anon;
revoke execute on function public.confirm_purchase(text, text) from authenticated;

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
  delete from public.purchases where user_id = auth.uid();

  -- Delete the profile
  delete from public.profiles where id = auth.uid();

  -- Finally, delete the user from auth.users
  delete from auth.users where id = auth.uid();
end;
$$;
