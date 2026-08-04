-- 025_harden_definer_functions.sql
--
-- Pre-launch hardening from Supabase's own security advisors. NOT fixing an
-- active vulnerability — verified before writing this that none of these is
-- currently exploitable — but removing reach nothing needs, before real money
-- moves through the system.
--
-- WHAT THE ADVISORS FOUND, and what is actually true:
--
-- 1. Five SECURITY DEFINER functions were EXECUTE-able by `anon`, i.e. callable
--    unauthenticated via /rest/v1/rpc/<name>. All five derive the user from
--    auth.uid(), which is NULL for anon, and `user_id` is NOT NULL on purchases,
--    purchase_disputes and credit_ledger — so an anon call hits a constraint
--    violation and writes nothing. The door is shut, but only because a NOT NULL
--    constraint happens to be holding it. That is accidental protection: make one
--    of those columns nullable later and an unauthenticated caller can forge a
--    purchase row with a chosen bKash TrxID, which is exactly the value the
--    mobile watcher matches payments on. Revoked rather than relied upon.
--
-- 2. `handle_new_user` and `log_credit_change` are TRIGGER functions and were
--    callable as RPCs by anon AND authenticated. There is no reason for either to
--    be reachable from the API at all.
--
--    Revoking EXECUTE does NOT break the triggers. Postgres checks function
--    privileges when the trigger is CREATED, not each time it fires; the trigger
--    runs as part of the table's DML, not as the caller. Do not "restore" these
--    grants thinking signup will break — it will not.
--
-- 3. `handle_new_user` and `delete_user` had NO search_path, and
--    `log_credit_change` had `public` without `pg_temp`. On a SECURITY DEFINER
--    function a mutable search_path is a privilege-escalation path: anything that
--    can create an object in an earlier-resolving schema (pg_temp included) can
--    shadow a table or function the definer body references and have it run with
--    the owner's rights. `delete_user` matters most here — it is destructive.
--    Pinned to the same `public, pg_temp` the rest of this project already uses
--    (consume_toolkit_credit, confirm_purchase, reserve_ai_call, finalize_ai_call).
--
-- Left alone deliberately:
--   • The ten `rls_enabled_no_policy` INFO notices. RLS on with zero policies is
--     DENY-ALL, which is the correct posture for server-only tables
--     (admin_audit_log, credit_ledger, inbound_payments, webhook_nonces, …) that
--     only service_role touches. Adding policies would loosen them, not harden.
--   • `pg_trgm` in the public schema. Moving an extension invalidates dependent
--     indexes and operator-class references; the risk of the move exceeds the
--     hygiene benefit on a live database.

-- ──────────────────────────────────────────────────────────────────
-- 1. Pin search_path on the three definer functions missing it
-- ──────────────────────────────────────────────────────────────────
alter function public.handle_new_user()    set search_path = public, pg_temp;
alter function public.delete_user()        set search_path = public, pg_temp;
alter function public.log_credit_change()  set search_path = public, pg_temp;

-- ──────────────────────────────────────────────────────────────────
-- 2. Trigger functions: unreachable from the API, both roles
-- ──────────────────────────────────────────────────────────────────
-- REVOKE FROM `public` IS THE LOAD-BEARING PART. Postgres grants EXECUTE to the
-- PUBLIC pseudo-role by default when a function is created, and anon/authenticated
-- INHERIT it. A first pass here revoked from `anon, authenticated` only and
-- changed nothing measurable — has_function_privilege('anon', …) still returned
-- true, because the inherited PUBLIC grant was untouched. Always include `public`.
revoke all on function public.handle_new_user()   from public, anon, authenticated;
revoke all on function public.log_credit_change() from public, anon, authenticated;

-- ──────────────────────────────────────────────────────────────────
-- 3. User-facing RPCs: signed-in only, never anon
-- ──────────────────────────────────────────────────────────────────
-- Each already scopes its work to auth.uid(); this removes the pointless
-- unauthenticated entry point. Revoke wholesale (incl. PUBLIC), then grant back to
-- `authenticated` only — the app calls these with a user JWT.
revoke all on function public.delete_user() from public, anon, authenticated;
revoke all on function public.initiate_purchase(text, text, text) from public, anon, authenticated;
revoke all on function public.record_purchase_dispute(text, text) from public, anon, authenticated;

grant execute on function public.delete_user() to authenticated;
grant execute on function public.initiate_purchase(text, text, text) to authenticated;
grant execute on function public.record_purchase_dispute(text, text) to authenticated;

-- ──────────────────────────────────────────────────────────────────
-- 4. Verified after applying
-- ──────────────────────────────────────────────────────────────────
-- has_function_privilege('anon', …) is now false for all five. handle_new_user and
-- log_credit_change are service_role-only; the other three are
-- authenticated + service_role.
--
-- SIGNUP RE-TESTED END TO END, because this migration touches the signup trigger:
-- created a throwaway user through /auth/v1/signup and confirmed handle_new_user
-- still inserted the profiles row (full_name carried from user metadata,
-- toolkit_credits 0), then removed the probe. Revoking EXECUTE does not stop a
-- trigger firing.
--
-- OPS NOTE, unrelated to this migration but found while testing: profiles_id_fkey
-- is ON DELETE NO ACTION, so deleting a user straight from the Supabase dashboard
-- fails while their profiles row exists. The app's own delete_user() removes the
-- profile first, so account deletion works — but a manual dashboard delete needs
-- delete_user() (or a manual profiles delete) first.
