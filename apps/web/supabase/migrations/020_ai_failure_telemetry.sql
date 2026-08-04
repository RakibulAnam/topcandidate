-- 020_ai_failure_telemetry.sql
--
-- Makes AI failures diagnosable. Until now ai_call_log recorded status as only
-- 'success' | 'error' with no reason and no record of which model was tried, so
-- the recurring OpenRouter shared-pool 429 was invisible in our own data — we
-- found it by reading provider docs, not by querying. That must not repeat on
-- the direct-Gemini path, where a sequential model chain means a single logical
-- call can touch several models before succeeding or failing.
--
-- Additive and idempotent: every column is nullable, no existing column or
-- policy changes, and existing rows stay valid. Safe to run on production.
--
-- error_code is deliberately NOT constrained by a CHECK. logCall() swallows its
-- own errors by design (telemetry must never fail a user's generation), so a
-- constraint violation from a newly-added taxonomy value would silently discard
-- the row instead of erroring loudly — worse than accepting an unknown string.
-- The authoritative taxonomy lives in GeminiErrorCode in
-- src/infrastructure/ai/GeminiClient.ts:
--   rate_limit | quota_exhausted | timeout | schema_invalid | json_parse
--   | guard_rejected | safety_blocked | truncated | empty_response
--   | model_unavailable | auth | billing_required | upstream_error | unknown
-- ('guard_rejected' = the provider succeeded but OUR fabrication/specificity
--  guards refused the content; set in api/_lib/aiTelemetry.ts, not by the client.)

-- ──────────────────────────────────────────────────────────────────
-- 1. Failure-diagnosis columns
-- ──────────────────────────────────────────────────────────────────
alter table ai_call_log add column if not exists error_code    text;
alter table ai_call_log add column if not exists error_message text;

-- Per-model outcomes for one logical call, oldest attempt first, e.g.
--   [{"model":"gemini-3.5-flash-lite","ok":false,"code":"rate_limit","ms":900},
--    {"model":"gemini-3.6-flash","ok":true,"ms":8400}]
-- This is what makes a fallback rescue visible instead of looking like a clean
-- first-try success, and it is how we spot a primary model quietly degrading.
alter table ai_call_log add column if not exists model_attempts jsonb;

-- Gemini 3.x bills thinking tokens at the OUTPUT rate. Without this column,
-- cost_usd understates every 3.x call: gemini-3.6-flash at its default thinking
-- level spent 721 thought tokens against 147 visible output tokens in testing.
alter table ai_call_log add column if not exists thought_tokens integer;

-- Transport attempts for this logical call (chain walk + outer retries).
alter table ai_call_log add column if not exists attempt_count  smallint;

comment on column ai_call_log.error_code is
  'Normalized failure class; see GeminiErrorCode in src/infrastructure/ai/GeminiClient.ts. Null on success.';
comment on column ai_call_log.model_attempts is
  'Ordered per-model attempt outcomes for one logical call: [{model,ok,code,ms}].';
comment on column ai_call_log.thought_tokens is
  'Gemini 3.x thinking tokens. Billed at the output rate — include in cost.';

-- ──────────────────────────────────────────────────────────────────
-- 2. Index for the error-breakdown queries the admin panel will run
-- ──────────────────────────────────────────────────────────────────
-- Partial: failures are the minority of rows, so this stays small while making
-- "errors by code over the last N days" an index-only scan.
create index if not exists ai_call_log_errors_idx
  on ai_call_log (created_at desc, error_code)
  where error_code is not null;

-- ──────────────────────────────────────────────────────────────────
-- 3. v_daily_ai_usage — count thinking tokens, and stop dropping partial rows
-- ──────────────────────────────────────────────────────────────────
-- Two fixes:
--   (a) thought_tokens joins the token total, so 3.x cost/volume is truthful.
--   (b) the old expression sum(prompt_tokens + completion_tokens) evaluates to
--       NULL for any row where EITHER column is null, and sum() then skips that
--       row entirely — so rows logged before migration 013 (35 of 101 at time of
--       writing) were silently excluded from total_tokens. Coalescing each
--       column individually counts what we actually have.
create or replace view v_daily_ai_usage as
  select date(created_at)                                   as day,
         count(*)                                           as calls,
         count(*) filter (where status = 'error')            as errors,
         coalesce(sum(cost_usd), 0)                          as cost_usd,
         coalesce(sum(coalesce(prompt_tokens, 0)
                    + coalesce(completion_tokens, 0)
                    + coalesce(thought_tokens, 0)), 0)       as total_tokens,
         coalesce(sum(coalesce(thought_tokens, 0)), 0)       as thought_tokens
  from ai_call_log
  group by 1;

-- ──────────────────────────────────────────────────────────────────
-- 4. v_ai_failures_daily — the "which calls fail, and why" surface
-- ──────────────────────────────────────────────────────────────────
create or replace view v_ai_failures_daily as
  select date(created_at)                as day,
         kind,
         coalesce(error_code, 'unclassified') as error_code,
         count(*)                        as failures,
         round(avg(latency_ms))          as avg_latency_ms,
         round(avg(attempt_count), 2)    as avg_attempts,
         max(error_message)              as sample_message
  from ai_call_log
  where status = 'error'
  group by 1, 2, 3;

-- Per-model health, including how often a model appears in a chain and how
-- often it is the one that failed. Reads model_attempts rather than `model`,
-- because `model` records only whichever model ultimately served the response.
create or replace view v_ai_model_health as
  select a.attempt ->> 'model'                                          as model,
         count(*)                                                       as attempts,
         count(*) filter (where (a.attempt ->> 'ok')::boolean)          as successes,
         count(*) filter (where not (a.attempt ->> 'ok')::boolean)      as failures,
         round(avg((a.attempt ->> 'ms')::numeric))                      as avg_ms
  from ai_call_log l
  cross join lateral jsonb_array_elements(l.model_attempts) as a(attempt)
  where l.model_attempts is not null
  group by 1;
