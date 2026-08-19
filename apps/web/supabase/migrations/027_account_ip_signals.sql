-- 027_account_ip_signals.sql
--
-- Collects the ONE signal you cannot reconstruct after the fact: which accounts
-- share a network origin. Detection only — nothing in this migration blocks,
-- throttles, or refuses anything.
--
-- WHY NOW, when there is no abuse. Signup/usage origin is not recorded anywhere
-- today. Supabase's own auth.audit_log_entries has an ip_address column but is
-- EMPTY on this project (GoTrue prunes it), so it cannot be relied on. If
-- multi-accounting starts in three months, no query can answer "did this start
-- in March?" unless the rows already exist. Everything else in the anti-abuse
-- ladder (free-tier caps, email normalisation, OTP) can be added the day it is
-- needed; this one cannot.
--
-- WHAT IS STORED. An HMAC-SHA256 of the IP, keyed with a server-side secret —
-- never the raw address. That is pseudonymisation, not anonymisation: anyone
-- holding the secret could hash all 4 billion IPv4 addresses and reverse it. It
-- is chosen because the operator never needs the address itself, only the
-- ability to see that 40 accounts share one origin. Rotating the secret
-- (IP_HASH_SALT) breaks correlation with rows written before the rotation,
-- which is the intended escape hatch if the table is ever considered too
-- sensitive to keep.
--
-- One row per (user, origin), not one per request: the counter and last_seen
-- carry the volume, so the table grows with distinct networks a user connects
-- from — a handful per person — rather than with traffic.
--
-- Deliberately NOT a signup hook. Signup happens browser-to-Supabase with no
-- server in the path, so there is nothing to instrument there; the row is
-- written on the account's first authenticated API call instead
-- (api/_lib/auth.ts). Accounts that sign up and never call an endpoint are
-- missed, which is fine: they consume no AI budget, and the metric that matters
-- is spend by accounts that never pay. A scripted attacker who talks to
-- Supabase directly and never calls our API is also missed — this catches
-- casual multi-accounting, and it is worth being honest that it is a tripwire,
-- not a wall.
--
-- RLS on with no policies (deny-all, service-role only), functions SECURITY
-- DEFINER with search_path pinned and EXECUTE revoked, matching 025 and 026.

create table if not exists public.account_ip_signals (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  ip_hash    text not null,
  first_seen timestamptz not null default now(),
  last_seen  timestamptz not null default now(),
  hits       integer not null default 1,
  primary key (user_id, ip_hash)
);

comment on table public.account_ip_signals is
  'Detection-only: HMAC of the network origin per account, for spotting one person running many accounts. Never stores a raw IP. Written by api/_lib/auth.ts on authenticated API calls; read by the admin System tab.';

-- The lookup that matters is "which accounts share this origin", so index the
-- hash, not the user.
create index if not exists account_ip_signals_hash_idx
  on public.account_ip_signals (ip_hash);
create index if not exists account_ip_signals_last_seen_idx
  on public.account_ip_signals (last_seen desc);

alter table public.account_ip_signals enable row level security;

revoke all on public.account_ip_signals from anon, authenticated;
grant select, insert, update, delete on public.account_ip_signals to service_role;

-- Upsert one observation. Cheap by design: it sits in the request path of every
-- authenticated endpoint, so it is a single indexed upsert and nothing else.
create or replace function public.record_account_ip(p_user_id uuid, p_ip_hash text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_user_id is null or coalesce(trim(p_ip_hash), '') = '' then
    return;
  end if;

  insert into public.account_ip_signals (user_id, ip_hash)
  values (p_user_id, p_ip_hash)
  on conflict (user_id, ip_hash)
  do update set last_seen = now(), hits = public.account_ip_signals.hits + 1;

  -- Opportunistic prune, ~1 in 1000 calls so the hot path stays a single
  -- upsert. 180 days is long enough to see a seasonal pattern and short enough
  -- that stale origins age out on their own; no cron to forget about.
  if random() < 0.001 then
    delete from public.account_ip_signals where last_seen < now() - interval '180 days';
  end if;
end;
$$;

revoke all on function public.record_account_ip(uuid, text) from anon, authenticated, public;
grant execute on function public.record_account_ip(uuid, text) to service_role;
