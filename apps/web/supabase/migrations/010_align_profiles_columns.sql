-- 010 — Align `profiles` with `schema.sql`.
--
-- Why this exists
-- ===============
-- `schema.sql` declares `profiles.created_at` and `profiles.updated_at` as
-- part of the original CREATE TABLE, but no historical migration ever
-- added them. Databases provisioned from an earlier version of
-- `schema.sql` (or before those columns existed in it) are missing both,
-- and there was no migration to backfill them.
--
-- Symptom: the admin Users tab fails with
--   "Supabase: column profiles.created_at does not exist"
-- because `users.ts` orders the list by `created_at`.
--
-- Fix: idempotently ADD COLUMN IF NOT EXISTS for both, then backfill
-- `created_at` from `auth.users.created_at` so existing rows get a
-- meaningful value (otherwise every existing row would land on `now()`
-- and the "Joined" column in the admin panel would be meaningless).
--
-- Safe to re-run.
--
-- ── 1. Add the columns if missing ─────────────────────────────────────
alter table public.profiles
  add column if not exists created_at timestamp with time zone
    default timezone('utc'::text, now());

alter table public.profiles
  add column if not exists updated_at timestamp with time zone;

-- ── 2. Backfill created_at from auth.users for existing rows ──────────
-- `auth.users.created_at` is always populated (Supabase Auth sets it on
-- signup). Service-role / owner can read the auth schema; this migration
-- runs as the database owner, so the SELECT is allowed.
update public.profiles p
  set created_at = u.created_at
  from auth.users u
  where p.id = u.id
    and (p.created_at is null
         -- guard against rows that just got the column's default of now()
         -- on add-column — those rows have created_at ~= now(); we replace
         -- only if the auth.users row is older.
         or (u.created_at is not null and abs(extract(epoch from (p.created_at - u.created_at))) > 5));

-- ── 3. Ensure the default is in place for new rows ────────────────────
-- ADD COLUMN IF NOT EXISTS only sets the default if the column was being
-- created. If the column already existed with no default, set one.
alter table public.profiles
  alter column created_at set default timezone('utc'::text, now());
