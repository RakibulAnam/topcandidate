-- 017_delete_user_complete.sql
--
-- Fix account deletion. The delete_user() RPC deletes a hardcoded list of the
-- user's child tables before removing the profile + auth.users row. Three
-- tables that reference profiles(id) with ON DELETE NO ACTION were added in
-- later migrations and never added to the list:
--   - languages        (migration 002)
--   - references_list   (migration 002)
--   - ai_call_log       (migration 003)
-- Any rows in them block `delete from profiles` with FK violation 23503
-- ("update or delete on table profiles violates foreign key constraint").
-- ai_call_log in particular always has rows once the user has generated
-- anything, so deletion failed for essentially every real account.
--
-- credit_ledger + profile_notes reference profiles with ON DELETE CASCADE, so
-- they clear automatically when the profile row is removed. analytics_events
-- has no FK to profiles/auth.users, so its orphaned user_id is harmless.

create or replace function public.delete_user()
returns void
language plpgsql
security definer -- bypasses RLS so it can delete from auth.users
as $$
begin
  -- Delete all associated data first to avoid FK constraints.
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

  -- credit_ledger + profile_notes cascade on the profile delete below.
  delete from public.profiles where id = auth.uid();

  -- Finally, delete the user from auth.users.
  delete from auth.users where id = auth.uid();
end;
$$;
