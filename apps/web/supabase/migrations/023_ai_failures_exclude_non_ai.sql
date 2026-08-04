-- 023_ai_failures_exclude_non_ai.sql
--
-- v_ai_failures_daily is the "which AI calls fail, and why" surface. It was
-- counting rows where NO AI CALL EVER RAN.
--
-- /api/optimize writes an ai_call_log row with status='error' when the credit RPC
-- reports 'insufficient_credits' (402). That row is deliberate — it makes a
-- rejected request count toward the daily cap, so a valid JWT cannot spam the
-- endpoint for free (the C5 audit requirement). But it is a BILLING outcome, not
-- an AI outcome: no provider was contacted, no tokens were spent, nothing failed
-- on the AI path. Grouped into the failures view with error_code null, it landed
-- under 'unclassified' next to genuine provider errors — so a user running out of
-- credits looked exactly like the AI breaking, which is the one thing this view
-- exists to tell apart.
--
-- Two halves, and both are needed:
--   • api/optimize.ts now stamps errorCode='insufficient_credits' on that row.
--   • this view excludes it.
-- The row still exists and still counts toward the cap; it just stops being
-- reported as an AI failure. Anyone wanting the billing view can query
-- ai_call_log directly on that code.
--
-- No backfill: checked before writing this, prod holds 9 error rows, all of them
-- predating migration 020 (error_code did not exist yet) and none carrying the
-- "no AI ran" signature. There is nothing to reclassify.
--
-- Idempotent (create or replace) and additive — no column or policy changes.

create or replace view v_ai_failures_daily as
  select date(created_at)                     as day,
         kind,
         coalesce(error_code, 'unclassified') as error_code,
         count(*)                             as failures,
         round(avg(latency_ms))               as avg_latency_ms,
         round(avg(attempt_count), 2)         as avg_attempts,
         max(error_message)                   as sample_message
  from ai_call_log
  where status = 'error'
    -- Not an AI failure: the request was rejected before any provider call.
    and coalesce(error_code, '') <> 'insufficient_credits'
  group by 1, 2, 3;

comment on view v_ai_failures_daily is
  'Daily AI failures by kind and normalized error_code. EXCLUDES insufficient_credits (402) rows: those are billing rejections logged for the daily cap, with no AI call behind them.';

-- Re-assert migration 021's lockdown. Strictly belt-and-braces: `create or
-- replace view` PRESERVES an existing view's privileges and reloptions (only
-- drop-then-create loses them), and prod was verified before writing this to hold
-- exactly {postgres, service_role} with security_invoker already true. Restated
-- anyway so this file is self-sufficient — a future edit that reaches for
-- `drop view … cascade` instead of `replace` would otherwise silently reopen the
-- leak 021 closed, and nothing here would say so.
alter view v_ai_failures_daily set (security_invoker = true);
revoke all on v_ai_failures_daily from anon, authenticated;
