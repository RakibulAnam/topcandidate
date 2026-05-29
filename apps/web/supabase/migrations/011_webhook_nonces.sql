-- 011 — Webhook replay-protection nonce store.
--
-- Why this exists
-- ===============
-- The Flutter SMS-watcher signs webhook requests with HMAC-SHA256, which
-- proves authenticity but NOT freshness. An attacker who captures a valid
-- request (e.g. via a compromised proxy log) can replay it indefinitely.
-- Migration 011 introduces:
--   1. A timestamp header in the wire contract (see migration's companion
--      changes in `api/_lib/webhookAuth.ts` and `docs/contracts/`).
--   2. This `webhook_nonces` table to remember request fingerprints inside
--      the validity window, so a duplicate request — even with a still-
--      valid signature — is rejected.
--
-- A nonce is `sha256(<timestamp> ":" <body>)` — deterministic, so legitimate
-- retries of the same body (e.g. transient network failure) collide and the
-- second call is silently rejected. The DB-level `confirm_purchase` RPC is
-- already idempotent on TrxID, so the customer outcome is unchanged.
--
-- TTL
-- ===
-- The timestamp-window enforcement on the API side rejects requests > 5 min
-- old, so any nonce older than 5 min is irrelevant. We retain nonces for
-- 10 min (2× the window) to handle minor clock skew, then auto-prune via
-- the `prune_webhook_nonces()` function below — call it from pg_cron
-- alongside the existing pending-expiry job, or inline from the API.
--
-- Idempotent. Safe to re-run.

create table if not exists public.webhook_nonces (
  nonce        text primary key,
  created_at   timestamp with time zone default timezone('utc', now()) not null,
  source       text not null default 'bkash'  -- room for additional webhook sources later
);

alter table public.webhook_nonces enable row level security;
-- service_role only; no user-facing policies.

create index if not exists webhook_nonces_created_idx
  on public.webhook_nonces (created_at);

-- One-shot acquire: returns true if this nonce is new (and was inserted),
-- false if it already exists (replay). Service-role only.
create or replace function public.acquire_webhook_nonce(
  p_nonce  text,
  p_source text default 'bkash'
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.webhook_nonces (nonce, source)
  values (p_nonce, p_source)
  on conflict (nonce) do nothing;
  -- found_rows on plpgsql INSERTs is `FOUND` after the statement.
  return FOUND;
end;
$$;

revoke execute on function public.acquire_webhook_nonce(text, text) from public, anon, authenticated;

-- Prune nonces older than 10 minutes. Call from pg_cron alongside
-- expire_stale_pending_purchases(), or invoke inline at low frequency.
create or replace function public.prune_webhook_nonces()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deleted integer;
begin
  delete from public.webhook_nonces
    where created_at < timezone('utc', now()) - interval '10 minutes';
  get diagnostics v_deleted = ROW_COUNT;
  return v_deleted;
end;
$$;

revoke execute on function public.prune_webhook_nonces() from public, anon, authenticated;
