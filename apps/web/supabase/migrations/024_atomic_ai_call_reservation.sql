-- 024_atomic_ai_call_reservation.sql
--
-- Makes the daily AI caps actually enforceable under concurrency.
--
-- THE BUG. assertWithinLimit() SELECTed ai_call_log, counted in JS, and threw if
-- over cap. The row was only INSERTed by logCall() AFTER the provider call
-- returned. So the window between "check" and "record" was the full provider
-- latency — 5 to 30 seconds, not microseconds. Fire 50 concurrent requests with
-- 7 rows already in the window against a cap of 8: all 50 SELECT before the first
-- row lands, all 50 see 7 < 8, all 50 pass, all 50 run AI. 57 calls against an
-- 8/day cap.
--
-- THE FIX. Reserve first, finalize after:
--   1. reserve_ai_call() takes a per-user advisory lock, counts, and INSERTs a
--      status='pending' row — all in ONE transaction. The row exists before the
--      provider is called, so the next request counts it.
--   2. finalize_ai_call() fills in the outcome (model, tokens, cost, error) on
--      that reserved row when the call terminates.
--
-- Why an advisory lock and not just the INSERT: under READ COMMITTED two
-- concurrent transactions can both run the count before either inserts, so the
-- count alone is not enough. pg_advisory_xact_lock serialises per user (and only
-- per user — different users never contend) and releases automatically at commit
-- or rollback, so a crashed function cannot wedge the lock.
--
-- Both functions are SECURITY DEFINER with search_path pinned, matching
-- consume_toolkit_credit. finalize_ai_call is a function rather than an UPDATE
-- RLS policy on purpose: a policy would let a user rewrite any of their own
-- telemetry rows at will, which destroys the audit trail the caps depend on. The
-- function can only touch the row id it is given, and only if that row is theirs.
--
-- A reserved row that never gets finalized stays 'pending' and keeps counting
-- toward the cap until it ages out of the 24h window. That is the correct
-- accounting: a function that timed out mid-generation really did consume
-- provider capacity. No sweeper needed — the window is the expiry.
--
-- status has no CHECK constraint (verified before writing this), so 'pending'
-- needs no schema change. v_ai_failures_daily only reads status='error', so
-- pending rows never appear as failures.

-- ──────────────────────────────────────────────────────────────────
-- 1. reserve_ai_call — atomic count-and-claim
-- ──────────────────────────────────────────────────────────────────
-- Returns the reserved row's id. Raises 'rate_limited:<used>:<cap>:<scope>' when
-- over cap; the caller parses that into a 429.
--
-- p_excluded_kinds are kinds that neither COUNT toward nor are GATED BY the
-- overall cap ('normalize' today — profile polishing must not starve a paid
-- generation). Previously the exclusion was one-directional: normalize rows were
-- filtered out of the count but a normalize REQUEST was still refused once the
-- overall cap was hit. Both directions now match the documented intent; normalize
-- remains bounded by its own per-kind cap.
create or replace function reserve_ai_call(
  p_kind            text,
  p_overall_cap     int,
  p_kind_cap        int      default 0,      -- 0 = no per-kind cap
  p_excluded_kinds  text[]   default '{}'
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user    uuid := auth.uid();
  v_overall int;
  v_kind    int;
  v_id      uuid;
  v_exempt  boolean := p_kind = any(p_excluded_kinds);
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;

  -- Serialise this user's reservations. Scoped to the user id, so unrelated users
  -- never block each other. Released automatically at transaction end.
  perform pg_advisory_xact_lock(hashtextextended(v_user::text, 0));

  select count(*) filter (where kind <> all(p_excluded_kinds)),
         count(*) filter (where kind = p_kind)
    into v_overall, v_kind
  from ai_call_log
  where user_id = v_user
    and created_at >= now() - interval '24 hours';

  if not v_exempt and v_overall >= p_overall_cap then
    raise exception 'rate_limited:%:%:overall', v_overall, p_overall_cap;
  end if;

  if p_kind_cap > 0 and v_kind >= p_kind_cap then
    raise exception 'rate_limited:%:%:%', v_kind, p_kind_cap, p_kind;
  end if;

  insert into ai_call_log (user_id, kind, status)
  values (v_user, p_kind, 'pending')
  returning id into v_id;

  return v_id;
end;
$$;

comment on function reserve_ai_call(text, int, int, text[]) is
  'Atomically checks the daily AI caps and reserves a pending ai_call_log row. Advisory-locked per user so a parallel burst cannot overshoot. Raises rate_limited:<used>:<cap>:<scope>.';

-- ──────────────────────────────────────────────────────────────────
-- 2. finalize_ai_call — fill in the outcome on a reserved row
-- ──────────────────────────────────────────────────────────────────
-- jsonb rather than 12 positional params so adding a telemetry column later does
-- not change the signature. Keys are extracted EXPLICITLY (never merged
-- wholesale) so a caller cannot set columns this function does not name.
-- coalesce keeps any existing value when a key is absent.
create or replace function finalize_ai_call(p_id uuid, p_meta jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update ai_call_log set
    provider          = coalesce(p_meta->>'provider', provider),
    model             = coalesce(p_meta->>'model', model),
    prompt_tokens     = coalesce((p_meta->>'prompt_tokens')::int, prompt_tokens),
    completion_tokens = coalesce((p_meta->>'completion_tokens')::int, completion_tokens),
    thought_tokens    = coalesce((p_meta->>'thought_tokens')::int, thought_tokens),
    cost_usd          = coalesce((p_meta->>'cost_usd')::numeric, cost_usd),
    status            = coalesce(p_meta->>'status', status),
    latency_ms        = coalesce((p_meta->>'latency_ms')::int, latency_ms),
    error_code        = coalesce(p_meta->>'error_code', error_code),
    error_message     = coalesce(p_meta->>'error_message', error_message),
    model_attempts    = coalesce(p_meta->'model_attempts', model_attempts),
    attempt_count     = coalesce((p_meta->>'attempt_count')::smallint, attempt_count)
  where id = p_id
    and user_id = auth.uid();   -- never let one user finalize another's row
end;
$$;

comment on function finalize_ai_call(uuid, jsonb) is
  'Fills the outcome onto a row reserved by reserve_ai_call. Own-row only. A function rather than an UPDATE policy so users cannot rewrite arbitrary telemetry.';

-- ──────────────────────────────────────────────────────────────────
-- 3. Grants
-- ──────────────────────────────────────────────────────────────────
-- Reachable with a user JWT (both derive the user from auth.uid(), never from a
-- parameter). anon gets nothing — every AI endpoint authenticates first.
revoke all on function reserve_ai_call(text, int, int, text[]) from public, anon;
revoke all on function finalize_ai_call(uuid, jsonb) from public, anon;
grant execute on function reserve_ai_call(text, int, int, text[]) to authenticated, service_role;
grant execute on function finalize_ai_call(uuid, jsonb) to authenticated, service_role;

-- Counting scans (user_id, created_at) which ai_call_log_user_created_idx already
-- covers, so the reservation adds one index scan plus one insert per call.
