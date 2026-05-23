-- 003 — Per-user AI call audit log, used for daily-cap enforcement.
--
-- Why: API keys live on the server (Vercel functions) post the
-- /api/* migration. Without per-user limits, a single signed-in user could
-- still burn the whole project's daily AI quota or run up the paid bill.
-- This table records every AI call so /api/* can rate-limit by user.
--
-- RLS: users can read their own log (for "X of 20 used today" UI later).
-- Inserts are done server-side via the user's JWT, so the auth.uid() = user_id
-- check passes naturally without needing a service role key.
--
-- Idempotent: safe to re-run.

create table if not exists ai_call_log (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references profiles(id) not null,
  kind text not null check (kind in ('optimize', 'toolkit_item', 'extract_resume')),
  created_at timestamp with time zone default timezone('utc'::text, now())
);

-- Composite index for the common "count user's calls in last 24h" query.
create index if not exists ai_call_log_user_created_idx
  on ai_call_log(user_id, created_at desc);

alter table ai_call_log enable row level security;

drop policy if exists "Users can view own ai_call_log" on ai_call_log;
create policy "Users can view own ai_call_log" on ai_call_log
  for select using (auth.uid() = user_id);

drop policy if exists "Users can insert own ai_call_log" on ai_call_log;
create policy "Users can insert own ai_call_log" on ai_call_log
  for insert with check (auth.uid() = user_id);
