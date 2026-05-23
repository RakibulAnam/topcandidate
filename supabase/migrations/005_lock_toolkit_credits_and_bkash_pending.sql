-- 005 — Close the toolkit-credits self-grant exploit AND restructure the
-- purchase flow for the bKash + Flutter-SMS-watcher design.
--
-- Why this migration exists
-- =========================
-- The `profiles` RLS policy (`Users can update own profile … for update
-- using (auth.uid() = id)`) is row-level only. Postgres RLS does not gate
-- columns. A signed-in user could therefore directly UPDATE
-- `profiles.toolkit_credits` from any browser console and self-grant
-- unlimited credits — bypassing the entire monetization layer. The audit on
-- 2026-05-08 confirmed this empirically (0 → 9999 in one fetch). This
-- migration locks the column.
--
-- Future flow (planned, partly implemented here)
-- ----------------------------------------------
-- We are NOT integrating a traditional payment gateway. The intended flow:
--   1. User clicks Buy → sees a screen with the owner's bKash number +
--      package amount + an input box for the bKash transaction ID.
--   2. User sends bKash to the owner's number, then pastes the txn ID.
--   3. Webapp calls `initiate_purchase()` — records a row in `purchases`
--      with `status = 'pending'` and `payment_reference = <txn id>`. No
--      credits granted yet.
--   4. A Flutter companion app on the owner's phone reads bKash SMS
--      notifications, extracts the txn ID + sender msisdn + amount, and
--      POSTs to a new `/api/confirm-purchase` webhook (HMAC-signed).
--   5. The webhook authenticates with `SUPABASE_SERVICE_ROLE_KEY` and calls
--      `confirm_purchase(txn_id)` which atomically flips `status` to
--      'completed' and increments `toolkit_credits`.
--
-- This migration handles steps 3 + 5 at the database layer. Steps 1, 2, and
-- 4 are implemented in `/api/purchase.ts`, `PurchaseModal.tsx`, and
-- `/api/confirm-purchase.ts` respectively. The Flutter app itself is
-- planned separately.
--
-- Idempotent: safe to re-run.

-- ── 1. Lock the toolkit_credits column at the privilege layer ─────────────
--
-- Row-level RLS doesn't restrict columns. We REVOKE blanket UPDATE on
-- `profiles` from authenticated/anon and re-GRANT only the columns users
-- legitimately edit (everything except the credits balance + the auto-
-- managed `id`, `created_at`). The existing RLS USING clause still gates
-- which rows the user can touch — the column GRANT layer enforces which
-- columns. Both layers must agree for a write to succeed.
--
-- The credit balance is now mutated ONLY by the SECURITY DEFINER functions
-- below, which run as the function owner regardless of column GRANTs.

revoke update on public.profiles from authenticated;
revoke update on public.profiles from anon;

grant update (
  full_name,
  email,
  phone,
  location,
  linkedin,
  github,
  website,
  user_type,
  onboarding_complete,
  updated_at
) on public.profiles to authenticated;

-- ── 2. Drop the old mock-purchase RPC ─────────────────────────────────────
--
-- `process_mock_purchase` was callable by any authenticated user with their
-- own JWT — it was SECURITY DEFINER and had no auth.uid()-scoped restriction
-- beyond writing to the caller's own row. A determined user could call it
-- directly from the browser to grant themselves credits without going through
-- /api/purchase. Replaced by the initiate/confirm split below.

drop function if exists public.process_mock_purchase(integer, integer, text);

-- ── 3. Add bKash sender MSISDN to purchases table ─────────────────────────
--
-- The Flutter SMS reader extracts the sender phone number from the bKash SMS
-- (e.g. "Cash In TK 200.00 from 01XXXXXXXXX successful, TrxID ABC123, …").
-- Storing it on the purchase row lets the confirm-webhook verify that the
-- user submitting the txn ID is the same person who actually sent the
-- payment. Optional for now; the v1 flow can match on txn ID alone.

alter table public.purchases
  add column if not exists sender_msisdn text;

-- For deduplication we want fast lookup by transaction id. The column
-- `payment_reference` already stores it. Add a unique index so a duplicate
-- submission cannot create two pending rows for the same txn — and so
-- `confirm_purchase` can rely on at-most-one match.

create unique index if not exists purchases_payment_reference_key
  on public.purchases(payment_reference);

-- ── 4. initiate_purchase ──────────────────────────────────────────────────
--
-- User-callable. Validates the package id (server-controlled — user CANNOT
-- choose how many credits they get) and the txn id shape, then inserts a
-- pending row. NO credits are granted here — this is just the "I claim I
-- sent bKash with this txn ID" record. Confirmation happens out-of-band
-- when the SMS arrives.
--
-- SECURITY DEFINER + locked search_path. The `with check (auth.uid() …)`
-- equivalent is enforced by the explicit `auth.uid()` insert column.
--
-- Returns the new purchase row ID so the client can poll its status if it
-- wants. (v1 doesn't poll — the webhook updates the credit balance which
-- the dashboard re-fetches; future v2 could add realtime via Supabase
-- channels.)

create or replace function public.initiate_purchase(
  p_package_id     text,
  p_transaction_id text,
  p_sender_msisdn  text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_credits     integer;
  v_amount_taka integer;
  v_purchase_id uuid;
  v_pending_count integer;
begin
  -- Server-controlled package mapping. Users cannot fake credit/amount values.
  -- Add new packages here when they ship.
  case p_package_id
    when 'five-pack' then
      v_credits     := 5;
      v_amount_taka := 200;
    -- Future packages go here, e.g.:
    -- when 'twenty-pack' then v_credits := 20; v_amount_taka := 700;
    else
      raise exception 'unknown_package_id'
        using hint = 'Valid packages: five-pack.';
  end case;

  -- Basic txn ID shape check. bKash transaction IDs are usually 10-character
  -- alphanumeric strings. We accept 6+ to be permissive (gateway formats
  -- evolve), but reject empty / obviously-bogus inputs before they pollute
  -- the table. Tighter validation lives in the API + UI layers.
  if length(coalesce(p_transaction_id, '')) < 6 then
    raise exception 'invalid_transaction_id'
      using hint = 'bKash transaction ID is required and must be at least 6 characters.';
  end if;

  -- Refuse duplicate submissions of the same txn id, regardless of status.
  -- Two users can't both claim the same payment; one user can't double-submit
  -- the same payment.
  if exists (
    select 1 from public.purchases where payment_reference = p_transaction_id
  ) then
    raise exception 'duplicate_transaction_id'
      using hint = 'This bKash transaction ID has already been submitted.';
  end if;

  -- Anti-spam: cap pending purchases per user in the rolling 24h window.
  -- A real bKash payment + SMS confirmation takes ~30 seconds; nobody
  -- legitimately needs >5 pending submissions in a day.
  select count(*) into v_pending_count
  from public.purchases
  where user_id = auth.uid()
    and status = 'pending'
    and created_at > now() - interval '24 hours';

  if v_pending_count >= 5 then
    raise exception 'too_many_pending'
      using hint = 'Too many pending purchases. Wait for confirmation or contact support.';
  end if;

  insert into public.purchases (
    user_id, credits_granted, amount_taka, payment_reference, sender_msisdn, status
  ) values (
    auth.uid(), v_credits, v_amount_taka, p_transaction_id, p_sender_msisdn, 'pending'
  )
  returning id into v_purchase_id;

  return v_purchase_id;
end;
$$;

-- ── 5. confirm_purchase ───────────────────────────────────────────────────
--
-- Called ONLY by the /api/confirm-purchase webhook (which authenticates the
-- Flutter SMS-watcher via HMAC and connects to Supabase using the
-- service-role key). NOT callable from end-user JWTs.
--
-- Takes a txn id (and optionally the sender msisdn extracted by the Flutter
-- app from the bKash SMS) and:
--   - Locks the matching pending purchase row (`for update`).
--   - Refuses if no row matches, or if the row is already completed.
--   - Optional: refuses if the SMS-extracted msisdn doesn't match the row's
--     stored sender msisdn (when both present). Reduces "I'll claim someone
--     else's bKash payment" attacks.
--   - Flips status to 'completed' and increments toolkit_credits in one
--     transaction.
--
-- Returns user_id + new balance so the webhook can log + the future
-- realtime channel can push the update.
--
-- We REVOKE EXECUTE from public/anon/authenticated below — only the
-- service_role can run this.

create or replace function public.confirm_purchase(
  p_transaction_id        text,
  p_observed_sender_msisdn text default null
)
returns table (user_id uuid, new_balance integer, credits_granted integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_purchase   public.purchases%rowtype;
  v_balance    integer;
begin
  -- Lock the pending row so concurrent webhook hits cannot double-grant.
  select * into v_purchase
  from public.purchases
  where payment_reference = p_transaction_id
    and status = 'pending'
  for update;

  if not found then
    raise exception 'no_pending_purchase'
      using hint = 'No pending purchase matches the given transaction ID.';
  end if;

  -- If both the user-claimed msisdn and the SMS-observed msisdn are present,
  -- they must match. Skip when either is null (legacy rows / older flows).
  if v_purchase.sender_msisdn is not null
     and p_observed_sender_msisdn is not null
     and v_purchase.sender_msisdn <> p_observed_sender_msisdn
  then
    raise exception 'msisdn_mismatch'
      using hint = format(
        'Pending purchase claims sender %s but observed SMS came from %s.',
        v_purchase.sender_msisdn,
        p_observed_sender_msisdn
      );
  end if;

  update public.purchases
  set status = 'completed'
  where id = v_purchase.id;

  update public.profiles
  set toolkit_credits = toolkit_credits + v_purchase.credits_granted
  where id = v_purchase.user_id
  returning toolkit_credits into v_balance;

  return query select v_purchase.user_id, v_balance, v_purchase.credits_granted;
end;
$$;

-- Lock down confirm_purchase so end-user JWTs cannot call it. Only
-- service_role (which the webhook server uses) can execute.

revoke execute on function public.confirm_purchase(text, text) from public;
revoke execute on function public.confirm_purchase(text, text) from anon;
revoke execute on function public.confirm_purchase(text, text) from authenticated;

-- ── 6. Sanity comment block ──────────────────────────────────────────────
--
-- After this migration runs, the only paths that can mutate
-- profiles.toolkit_credits are:
--   - consume_toolkit_credit()  (user JWT, decrement-only, atomic)
--   - refund_toolkit_credit()   (user JWT, increment by 1; called by
--                                /api/optimize when the optimizer fails)
--   - confirm_purchase()        (service-role only; called by the bKash
--                                Flutter SMS-watcher webhook)
-- Direct UPDATE attempts from anon/authenticated will fail with a
-- privilege error from the column GRANT layer.
