-- 021_revoke_analytics_views.sql
--
-- SECURITY FIX — live leak, verified by curl with only the anon key (2026-08-04).
--
-- Every v_* analytics view was SELECTable by `anon`, and the anon key ships inside
-- the client bundle, so these were readable by anyone on the internet, no login:
--   v_daily_revenue     — daily revenue, order counts, credits sold
--   v_daily_ai_usage    — AI cost figures
--   v_credit_liability  — outstanding credit liability
--   v_ai_failures_daily — failure telemetry incl. sample provider error text
--   v_ai_model_health   — per-model call volumes
--
-- Root cause is twofold: Supabase grants the public roles broad SELECT on new
-- public-schema objects, AND these views are owned by `postgres` with
-- security_invoker unset, so they execute with the OWNER's rights and bypass RLS
-- on ai_call_log / purchases / profiles entirely. RLS on the base tables was
-- therefore no protection at all here.
--
-- Safe to revoke: every consumer is an /admin handler using
-- SUPABASE_SERVICE_ROLE_KEY (only revenue-analytics.ts reads a view), and
-- service_role bypasses grants.

revoke all on v_daily_revenue     from anon, authenticated;
revoke all on v_daily_signups     from anon, authenticated;
revoke all on v_daily_ai_usage    from anon, authenticated;
revoke all on v_credit_liability  from anon, authenticated;
revoke all on v_ai_failures_daily from anon, authenticated;
revoke all on v_ai_model_health   from anon, authenticated;

-- Defence in depth: honour the QUERYING user's RLS rather than the owner's rights,
-- so a future accidental GRANT cannot re-open the same hole.
alter view v_daily_revenue     set (security_invoker = true);
alter view v_daily_signups     set (security_invoker = true);
alter view v_daily_ai_usage    set (security_invoker = true);
alter view v_credit_liability  set (security_invoker = true);
alter view v_ai_failures_daily set (security_invoker = true);
alter view v_ai_model_health   set (security_invoker = true);

-- Stop the next view created here from being world-readable by default.
alter default privileges in schema public revoke select on tables from anon;
