-- 026_admin_login_throttle.sql
--
-- Makes the admin login actually resistant to online guessing, and gives the
-- operator a record of every attempt.
--
-- THE GAP. The only brake on POST /api/admin/login was `await sleep(400)` on
-- failure, with a code comment saying a counter wasn't feasible because Vercel
-- functions are stateless. Two problems with that:
--
--   1. The sleep delays ONE invocation. Vercel runs invocations concurrently,
--      so 200 parallel guesses are each delayed 400ms and none of them wait for
--      each other — the attacker's throughput is unaffected while the delay
--      burns our function time.
--   2. The functions are stateless; the DATABASE is not. This is the same shape
--      as the AI cap in 024: check-then-act across a network call, fixed by
--      reserving the slot inside one transaction under an advisory lock.
--
-- THE FIX, mirroring reserve_ai_call / finalize_ai_call:
--   begin_admin_login_attempt()    — counts recent failures for the caller's IP
--                                    under a per-IP advisory lock, and either
--                                    refuses (returning retry_after_sec) or
--                                    INSERTs a 'pending' row and returns its id.
--   finalize_admin_login_attempt() — flips that row to 'success' or 'failure'.
--
-- The pending row is inserted BEFORE credentials are checked, so it already
-- counts against the window for every concurrent sibling request. Firing 200 at
-- once no longer buys 200 guesses: the 5th one onward is refused.
--
-- WINDOW + LADDER (per IP, failures since that IP's last success):
--   0-4    → allowed
--   5-9    → locked 1 minute
--   10-19  → locked 15 minutes
--   20+    → locked 60 minutes
-- Lock expiry is measured from the most recent attempt, so continuing to hammer
-- keeps extending it. The count is taken BEFORE the current attempt is inserted,
-- so in practice five wrong passwords go through and the sixth is refused —
-- enough for ordinary fat-fingering. A correct password resets the count (see
-- v_since below), so mistyping a few times and then getting it right starts
-- clean rather than leaving the operator one slip from a lockout.
--
-- WHY PER-IP AND NOT GLOBAL. A global lock would let anyone lock the OWNER out
-- of the panel on demand — and this panel is the recovery surface for real
-- payments, so a cheap remote DoS on purchase confirmation is worse than the
-- attack it prevents. Per-IP can't be evaded by header spoofing: Vercel
-- overwrites x-forwarded-for at the edge and does not forward external values
-- (trusted-proxy forwarding is Enterprise-only). A distributed attack across
-- many IPs is NOT stopped by this migration — that needs an edge WAF rate-limit
-- rule and/or a second factor. What this migration guarantees is that every
-- such attempt is now recorded and visible in the System tab.
--
-- RLS: enabled with NO policies — deny-all, service_role only, the same posture
-- as admin_audit_log and credit_ledger (see 025's note). Both functions are
-- SECURITY DEFINER with search_path pinned to `public, pg_temp` and EXECUTE
-- revoked from anon/authenticated, matching 025.

-- ──────────────────────────────────────────────────────────────────
-- 1. The attempt log
-- ──────────────────────────────────────────────────────────────────
create table if not exists public.admin_login_attempts (
  id           bigserial primary key,
  ip           text not null,
  -- What was submitted, for forensics ("are they guessing the username too?").
  -- Truncated by the caller. NEVER store the password, not even hashed.
  username_tried text,
  user_agent   text,
  -- 'pending'  — slot reserved, credentials not yet checked
  -- 'failure'  — credentials rejected
  -- 'success'  — credentials accepted
  -- 'blocked'  — refused by the ladder before credentials were checked
  outcome      text not null default 'pending',
  created_at   timestamptz not null default now()
);

comment on table public.admin_login_attempts is
  'Every /api/admin/login attempt. Drives the per-IP lockout ladder in begin_admin_login_attempt and the "Admin access" panel in the System tab. Service-role only (RLS deny-all).';

create index if not exists admin_login_attempts_ip_created_idx
  on public.admin_login_attempts (ip, created_at desc);
create index if not exists admin_login_attempts_created_idx
  on public.admin_login_attempts (created_at desc);

alter table public.admin_login_attempts enable row level security;
-- Intentionally no policies: deny-all for anon + authenticated.

revoke all on public.admin_login_attempts from anon, authenticated;
grant select, insert, update, delete on public.admin_login_attempts to service_role;
grant usage, select on sequence public.admin_login_attempts_id_seq to service_role;

-- ──────────────────────────────────────────────────────────────────
-- 2. begin_admin_login_attempt — reserve a slot or refuse
-- ──────────────────────────────────────────────────────────────────
-- Returns one row: (attempt_id, allowed, retry_after_sec, recent_failures).
-- When allowed is false, attempt_id is the id of the 'blocked' row that was
-- recorded (so refusals are auditable too) and retry_after_sec is what the
-- caller should put in the Retry-After header.
create or replace function public.begin_admin_login_attempt(
  p_ip text,
  p_username text default null,
  p_user_agent text default null
)
returns table (attempt_id bigint, allowed boolean, retry_after_sec integer, recent_failures integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_window      constant interval := interval '15 minutes';
  v_ip          text := coalesce(nullif(trim(p_ip), ''), 'unknown');
  v_since       timestamptz;
  v_failures    integer;
  v_last_at     timestamptz;
  v_lock_sec    integer;
  v_retry       integer;
  v_id          bigint;
begin
  -- Serialise per IP. Without this, concurrent requests all count before any
  -- inserts and every one of them passes the ladder (the 024 bug, again).
  perform pg_advisory_xact_lock(hashtext('admin_login:' || v_ip));

  -- Count only failures AFTER this IP's most recent success, and only inside
  -- the window. A correct password therefore clears the ladder for that IP.
  select greatest(
           coalesce(max(created_at) filter (where outcome = 'success'), now() - v_window),
           now() - v_window
         )
    into v_since
    from public.admin_login_attempts
   where ip = v_ip
     and created_at > now() - v_window;

  v_since := coalesce(v_since, now() - v_window);

  -- 'pending' counts as a failure: a reserved-but-unfinished attempt is either
  -- in flight or was abandoned, and neither should hand out a free guess.
  select count(*), max(created_at)
    into v_failures, v_last_at
    from public.admin_login_attempts
   where ip = v_ip
     and outcome in ('failure', 'pending', 'blocked')
     and created_at > v_since;

  v_lock_sec := case
                  when v_failures >= 20 then 3600
                  when v_failures >= 10 then 900
                  when v_failures >= 5  then 60
                  else 0
                end;

  if v_lock_sec > 0 and v_last_at is not null then
    v_retry := ceil(extract(epoch from (v_last_at + make_interval(secs => v_lock_sec)) - now()))::integer;
  else
    v_retry := 0;
  end if;

  if v_retry > 0 then
    insert into public.admin_login_attempts (ip, username_tried, user_agent, outcome)
    values (v_ip, left(coalesce(p_username, ''), 120), left(coalesce(p_user_agent, ''), 300), 'blocked')
    returning id into v_id;
    return query select v_id, false, v_retry, v_failures;
    return;
  end if;

  insert into public.admin_login_attempts (ip, username_tried, user_agent, outcome)
  values (v_ip, left(coalesce(p_username, ''), 120), left(coalesce(p_user_agent, ''), 300), 'pending')
  returning id into v_id;

  -- Opportunistic pruning, so this table needs no cron. 90 days is long enough
  -- to investigate an incident after the fact and short enough to stay tiny.
  delete from public.admin_login_attempts where created_at < now() - interval '90 days';

  return query select v_id, true, 0, v_failures;
end;
$$;

-- ──────────────────────────────────────────────────────────────────
-- 3. finalize_admin_login_attempt — record the outcome
-- ──────────────────────────────────────────────────────────────────
-- Only ever moves a row out of 'pending', so a replayed or bogus id cannot
-- rewrite history (in particular it cannot turn a 'failure' into a 'success'
-- and thereby clear the ladder).
create or replace function public.finalize_admin_login_attempt(
  p_attempt_id bigint,
  p_success boolean
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.admin_login_attempts
     set outcome = case when p_success then 'success' else 'failure' end
   where id = p_attempt_id
     and outcome = 'pending';
end;
$$;

-- ──────────────────────────────────────────────────────────────────
-- 4. Lock down EXECUTE (025's rule: nothing reachable that needn't be)
-- ──────────────────────────────────────────────────────────────────
revoke all on function public.begin_admin_login_attempt(text, text, text) from anon, authenticated, public;
revoke all on function public.finalize_admin_login_attempt(bigint, boolean) from anon, authenticated, public;
grant execute on function public.begin_admin_login_attempt(text, text, text) to service_role;
grant execute on function public.finalize_admin_login_attempt(bigint, boolean) to service_role;
