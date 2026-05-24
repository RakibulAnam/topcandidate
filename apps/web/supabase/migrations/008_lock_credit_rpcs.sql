-- 008 — Close the refund_toolkit_credit self-grant exploit.
--
-- Problem
-- =======
-- `consume_toolkit_credit()` and `refund_toolkit_credit()` were SECURITY
-- DEFINER + 0-arg + scoped by `auth.uid()` inside the function body. The
-- EXECUTE privilege was open to the `authenticated` role so end-user JWTs
-- could call them. The assumption was "only /api/optimize calls these" —
-- but nothing enforced that. A signed-in user could open the browser
-- console and run:
--
--   await window.supabase.rpc('refund_toolkit_credit')
--
-- to self-grant 1 credit per call. Same shape of exploit as the
-- direct-UPDATE attack closed in migration 005, just via the RPC layer.
--
-- Fix
-- ===
--  1. Replace both 0-arg functions with 1-arg versions that take a
--     `p_user_id uuid` parameter. The caller (server, with service-role)
--     decides whose balance to touch.
--  2. Revoke EXECUTE from `authenticated` and `anon`. Only service_role can
--     run these.
--  3. `api/optimize.ts` now uses SUPABASE_SERVICE_ROLE_KEY for the
--     consume/refund calls, passing `auth.userId` explicitly. The user JWT
--     no longer has any path to mutate toolkit_credits.
--
-- Idempotent: drop function + create or replace are both re-runnable.

-- Old signatures cannot be modified in place (return type / arg list
-- changed) — drop them first.
drop function if exists public.consume_toolkit_credit();
drop function if exists public.refund_toolkit_credit();

-- ── consume_toolkit_credit(p_user_id uuid) ────────────────────────────────
--
-- Atomic decrement. Raises 'insufficient_credits' if balance is 0.
-- Service-role only — see REVOKE block below.
create or replace function public.consume_toolkit_credit(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_new_balance integer;
begin
  if p_user_id is null then
    raise exception 'user_id_required';
  end if;

  update public.profiles
    set toolkit_credits = toolkit_credits - 1
    where id = p_user_id
      and toolkit_credits > 0
    returning toolkit_credits into v_new_balance;

  if v_new_balance is null then
    raise exception 'insufficient_credits'
      using hint = 'User has no toolkit credits remaining.';
  end if;

  return v_new_balance;
end;
$$;

revoke execute on function public.consume_toolkit_credit(uuid) from public;
revoke execute on function public.consume_toolkit_credit(uuid) from anon;
revoke execute on function public.consume_toolkit_credit(uuid) from authenticated;
-- service_role retains EXECUTE by default (SECURITY DEFINER owner == postgres,
-- service_role bypasses RLS and inherits postgres execute rights).

-- ── refund_toolkit_credit(p_user_id uuid) ─────────────────────────────────
--
-- Increment by 1. Called server-side when the optimizer rejects after a
-- credit was consumed. Service-role only.
create or replace function public.refund_toolkit_credit(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_user_id is null then
    raise exception 'user_id_required';
  end if;

  update public.profiles
    set toolkit_credits = toolkit_credits + 1
    where id = p_user_id;
end;
$$;

revoke execute on function public.refund_toolkit_credit(uuid) from public;
revoke execute on function public.refund_toolkit_credit(uuid) from anon;
revoke execute on function public.refund_toolkit_credit(uuid) from authenticated;
