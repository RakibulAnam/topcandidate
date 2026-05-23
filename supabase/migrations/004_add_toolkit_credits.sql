-- 004 — Toolkit credit system for monetization.
--
-- Why: tailored resume + toolkit generation (cover letter, outreach email,
-- LinkedIn note, interview questions) is a paid feature. Users start with
-- 0 credits; they buy a pack of 5 for ৳200. Each generation of a tailored
-- resume consumes 1 credit. The general resume remains free (separate API
-- endpoint, no credit gate).
--
-- Tables:
--   profiles.toolkit_credits  — current balance, fast lookup (no extra join)
--   purchases                 — full audit trail of every purchase event
--
-- Functions (SECURITY DEFINER — user JWT can call them, but users cannot
-- manipulate the credits column directly via RLS):
--   consume_toolkit_credit()  — atomic check-and-decrement; raises exception
--                               if balance is already 0
--   refund_toolkit_credit()   — increments by 1; called server-side when the
--                               AI optimizer fails after a credit was reserved
--
-- Idempotent: safe to re-run.

-- ── 1. Add credit balance column to profiles ─────────────────────────────────

alter table profiles
  add column if not exists toolkit_credits integer not null default 0;

-- ── 2. Purchases audit table ─────────────────────────────────────────────────

create table if not exists purchases (
  id                uuid    default uuid_generate_v4() primary key,
  user_id           uuid    references profiles(id) not null,
  credits_granted   integer not null,          -- 5 for the current pack
  amount_taka       integer not null,           -- 200 for the current pack
  payment_reference text,                       -- 'mock-<uuid>' now; real gateway txn ID later
  status            text    not null default 'completed'
    check (status in ('pending', 'completed', 'failed', 'refunded')),
  created_at        timestamp with time zone default timezone('utc'::text, now())
);

create index if not exists purchases_user_id_idx
  on purchases(user_id, created_at desc);

alter table purchases enable row level security;

-- Users can see their own purchase history (receipts, balance history).
drop policy if exists "Users can view own purchases" on purchases;
create policy "Users can view own purchases" on purchases
  for select using (auth.uid() = user_id);

-- No direct INSERT policy for users — all writes go through server-side
-- API functions (Vercel Functions using the service role key or a
-- security definer RPC), so clients cannot self-grant credits.

-- ── 3. Atomic consume function ───────────────────────────────────────────────
--
-- Called from api/optimize.ts (Vercel Function) via the user's JWT.
-- SECURITY DEFINER lets it bypass the lack of a direct UPDATE policy on
-- profiles.toolkit_credits. The WHERE auth.uid() = id clause ensures a user
-- can only consume their own credits.
--
-- Atomicity: the single UPDATE statement acquires a row lock; two concurrent
-- requests with only 1 credit left cannot both succeed — the second gets
-- 0 rows updated and raises the exception.
--
-- search_path is locked to (public, pg_temp) so a hostile object in another
-- schema cannot shadow `profiles` and hijack the function's elevated rights.

create or replace function consume_toolkit_credit()
returns integer   -- returns the new balance after decrement
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  new_balance integer;
begin
  update public.profiles
  set    toolkit_credits = toolkit_credits - 1
  where  id = auth.uid()
    and  toolkit_credits > 0
  returning toolkit_credits into new_balance;

  if new_balance is null then
    raise exception 'insufficient_credits'
      using hint = 'User has no toolkit credits remaining.';
  end if;

  return new_balance;
end;
$$;

-- ── 4. Refund function ───────────────────────────────────────────────────────
--
-- Called server-side only when the AI optimizer call fails AFTER a credit
-- was already consumed. Increments by 1 so the user is not charged for a
-- failed generation.

create or replace function refund_toolkit_credit()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.profiles
  set    toolkit_credits = toolkit_credits + 1
  where  id = auth.uid();
end;
$$;

-- ── 5. Mock purchase function ────────────────────────────────────────────────
--
-- Atomically records the purchase and grants credits in one transaction.
-- Called from api/purchase.ts (Vercel Function) via the user's JWT.
-- SECURITY DEFINER lets it write to purchases (no user INSERT policy) and
-- update profiles.toolkit_credits (no user UPDATE policy for that column).
--
-- In production this function will be replaced by a payment webhook that
-- verifies a signed payload from the gateway before calling a server-side
-- grant. For the mock phase, calling this directly is intentional.

create or replace function process_mock_purchase(
  p_credits     integer,
  p_amount_taka integer,
  p_reference   text
)
returns integer   -- returns new toolkit_credits balance
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  new_balance integer;
begin
  insert into public.purchases (user_id, credits_granted, amount_taka, payment_reference, status)
  values (auth.uid(), p_credits, p_amount_taka, p_reference, 'completed');

  update public.profiles
  set    toolkit_credits = toolkit_credits + p_credits
  where  id = auth.uid()
  returning toolkit_credits into new_balance;

  return new_balance;
end;
$$;
