-- 002 — Add languages + references sub-tables to the profile.
--
-- Why: Bangladeshi corporate hiring (banks, conglomerates, MNCs in Dhaka /
-- Chattogram) expects an explicit Languages section (Bengali + English at
-- minimum) and 2–3 named References on the CV. These were also valuable
-- globally for multilingual roles. Both are profile-level sub-tables, mirror
-- the existing publications/affiliations pattern, RLS-gated to the owner.
--
-- Idempotent: safe to re-run.

-- ────────────────────────────────────────────────
-- LANGUAGES
-- ────────────────────────────────────────────────
create table if not exists languages (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references profiles(id) not null,
  name text,
  proficiency text check (proficiency in ('Native', 'Fluent', 'Professional', 'Conversational', 'Basic')),
  created_at timestamp with time zone default timezone('utc'::text, now())
);

alter table languages enable row level security;

drop policy if exists "Users can view own languages" on languages;
create policy "Users can view own languages" on languages
  for select using (auth.uid() = user_id);

drop policy if exists "Users can insert own languages" on languages;
create policy "Users can insert own languages" on languages
  for insert with check (auth.uid() = user_id);

drop policy if exists "Users can update own languages" on languages;
create policy "Users can update own languages" on languages
  for update using (auth.uid() = user_id);

drop policy if exists "Users can delete own languages" on languages;
create policy "Users can delete own languages" on languages
  for delete using (auth.uid() = user_id);

-- ────────────────────────────────────────────────
-- REFERENCES (table name `references_list` because `references` is a
-- reserved keyword in Postgres and a hassle to quote everywhere).
-- ────────────────────────────────────────────────
create table if not exists references_list (
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

drop policy if exists "Users can view own references" on references_list;
create policy "Users can view own references" on references_list
  for select using (auth.uid() = user_id);

drop policy if exists "Users can insert own references" on references_list;
create policy "Users can insert own references" on references_list
  for insert with check (auth.uid() = user_id);

drop policy if exists "Users can update own references" on references_list;
create policy "Users can update own references" on references_list
  for update using (auth.uid() = user_id);

drop policy if exists "Users can delete own references" on references_list;
create policy "Users can delete own references" on references_list
  for delete using (auth.uid() = user_id);
