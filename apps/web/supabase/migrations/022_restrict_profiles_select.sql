-- 022_restrict_profiles_select.sql
--
-- SECURITY FIX — live PII leak, pre-existing.
--
-- `profiles` carried the Supabase quickstart boilerplate policy, verbatim:
--     "Public profiles are viewable by everyone."  SELECT  USING (true)
-- granted to role `public` (which covers both `anon` and `authenticated`). RLS was
-- enabled, so it LOOKED protected, but the policy permitted every row.
--
-- The table is not a social profile — it holds full_name, email, phone, location,
-- linkedin, github, website, toolkit_credits, and the UTM/referrer acquisition
-- fields. With the anon key (public by design, it ships in the client bundle) that
-- was the entire user base's contact details readable by anyone.
--
-- Safe to tighten: every application read is `.eq('id', userId)` for the caller's
-- own row (SupabaseProfileRepository, AuthContext) — there is no public-profile
-- feature. The /admin panel reads profiles via SUPABASE_SERVICE_ROLE_KEY, which
-- bypasses RLS, so operator views are unaffected.
--
-- Verified after applying: anon sees 0 rows; the logged-in test account sees
-- exactly 1 (its own) and its toolkit_credits still resolve.

drop policy if exists "Public profiles are viewable by everyone." on profiles;

create policy "Users can view own profile"
  on profiles for select
  using (auth.uid() = id);
