# Prompt — Harden the bKash purchase flow against every edge case

> Paste the entire body below into a fresh Claude (or other) chat session
> with access to the existing repo. The receiving session has no memory
> of prior conversations — this prompt is fully self-contained.

---

I have a SaaS web app (React + Vite + Vercel + Supabase + Postgres + RLS) that sells credit packs in BDT. There is no commercial payment gateway; instead, the customer sends bKash to my personal number, pastes the bKash Transaction ID into the web app, and a Flutter SMS-watcher app on my own phone reads the resulting bKash SMS and POSTs to a webhook to confirm the purchase. The happy path is implemented and shipping. **Your job is to harden every edge case around it.**

The work has three threads, in priority order:
1. New Postgres state machine + migration so every observable state has a name and a path forward.
2. New API endpoints for the cases that currently leave a purchase stuck.
3. UI surfaces for the customer (status of their submission) and for me, the operator (manual reconciliation tools).

## 0. Real-world incidents witnessed before this prompt runs — START HERE

Two cases from §2 have been promoted to **P0 — ship these first, in this
order, before touching anything else in this prompt**:

### P0-A — Case #3 (underpayment). REVENUE LEAK.

On 2026-05-17 the operator sent Tk 30 for a Tk 200 package while
testing the watcher with a real bKash send. The system granted the
full 5-credit pack anyway because `confirm_purchase` doesn't compare
amounts. In production today, a customer can pay Tk 1 and get a full
pack. **Do not expose the purchase flow to any real customer before
this is fixed.**

The minimum-viable patch is the amount check in
`api/confirm-purchase.ts` BEFORE the RPC call — return HTTP 409 with
`code: 'underpaid'` if the SMS-observed amount is less than the
pending row's `amount_taka`. That alone closes the revenue leak even
before the full state machine + top-up UX from §2 row #3 ship. The
watcher already handles 409 as a terminal `mismatch` state, so the
operator will get a notification and can recover via P0-B below.

### P0-B — Case #11 (operator manual confirm). RECOVERY PATH.

On 2026-05-17 the operator's Flutter watcher crashed mid-transaction
during a real Tk 200 send. The pending row sat indefinitely with no
self-serve recovery path. The only way back was an out-of-band curl
with the bKash webhook secret pasted into a terminal under stress.

Ship `POST /api/admin/confirm-purchase` (case #11) before the next
real transaction. Body: `{ transactionId, observedMsisdn?,
overrideMsisdnCheck?, reason }`. Auth: `X-Admin-Key` header against a
new `ADMIN_API_KEY` env var (separate value from
`BKASH_WEBHOOK_SECRET` — different blast radius). Calls the same
`confirm_purchase` RPC under service role; logs to
`purchase_state_changes` with actor `'operator'` + reason. Roughly 30
lines. This becomes the safety net for every future watcher failure,
parser drift, sender-ID change, or carrier oddity.

### Why these two first

Without P0-A: anyone deliberately underpays and the system gives away
free credits. Without P0-B: the next watcher failure (and there will
be a next one) requires an engineer in the loop. Neither is
acceptable for a production payment surface. Everything else in §2 is
supporting work and can ship in any order after these two — though
the customer-facing status polling from §6 is the strongest next
candidate.

---

## 1. What's already in place (do not rebuild)

**Database** (already migrated):
- `purchases (id, user_id, credits_granted, amount_taka, payment_reference, sender_msisdn, status, created_at)` where `status IN ('pending','completed','failed','refunded')`.
- Unique index on `payment_reference`.
- RPC `initiate_purchase(p_package_id, p_transaction_id, p_sender_msisdn)` — user-callable, validates package server-side, inserts a `pending` row.
- RPC `confirm_purchase(p_transaction_id, p_observed_sender_msisdn)` — service-role only; flips a pending row to `completed`, grants credits in `profiles.toolkit_credits`. Both RPCs are SECURITY DEFINER with locked search_path.
- RLS column-level GRANT lockdown on `profiles` so users cannot direct-UPDATE `toolkit_credits`.

**Endpoints** (already shipping):
- `POST /api/purchase` — calls `initiate_purchase`. 400 / 409 / 429 on validation failures.
- `POST /api/confirm-purchase` — HMAC-SHA256-gated webhook. Calls `confirm_purchase` via service-role.
- `POST /api/dev-mock-confirm` — DEV ONLY scaffolding to be deleted before prod.

**Constraint inputs (memorise):**
- BDT only, integer taka.
- Currently one package: `five-pack` = 5 credits for ৳200.
- bKash msisdn format: `01XXXXXXXXX` (11 digits).

## 2. The edge cases — every one of them, with required handling

For each case below, you will:
- Add a status value (or sub-state column) so the row is no longer ambiguous.
- Add the API or cron path that drives it forward.
- Add a customer-visible UI message and an operator-visible admin row.

| # | Scenario | Today | Required handling |
|---|---|---|---|
| 1 | Customer submits TrxID, never sends bKash | Stuck in `pending` forever | TTL-expire after 24 h via cron → status `expired`. Notify customer ("we never saw your bKash payment; if you sent it, contact support@<email>"). Cron job runs every 15 min. |
| 2 | Customer sends bKash, never submits TrxID on the web | Flutter app POSTs but no pending row matches → 404 from webhook | Flutter retries for 24 h (already specced). After 24 h, the unmatched SMS lives only on the phone — orphan. Add an `unmatched_inbound_sms` table and a webhook variant `POST /api/orphan-inbound-sms` for the Flutter app to dump unmatchable SMS into for operator reconciliation. |
| 3 | Customer sends LESS than required (e.g. ৳150 for a ৳200 pack) | The Flutter SMS-watcher will POST `amountTaka: 150`. confirm_purchase doesn't currently check amount → grants the full pack. | confirm_purchase must compare `p_observed_amount_taka` against the row's `amount_taka`. If less → flip to `underpaid`, do NOT grant credits, notify customer ("we received ৳<actual> but the pack costs ৳<expected>; please send the difference referencing the same TrxID, or contact support for refund"). The customer can either send the difference (a NEW SMS will arrive that the Flutter app posts; we need a `top_up` flow — see #14) or request a refund manually. |
| 4 | Customer sends MORE than required (e.g. ৳500 for a ৳200 pack) | Same as #3 — currently grants only the configured pack | Treat as `completed` for the configured package + log the surplus in a new `purchase_overpayments` table for the operator to manually refund or treat as a tip. Notify customer ("we received ৳<actual>; you've been credited for the ৳<expected> pack and the extra ৳<surplus> is sitting as a credit on your account — contact us if you'd like a refund"). |
| 5 | TrxID typo on the customer's side (digit transposed) | The pending row has the typo'd ID; the SMS arrives with the real ID. Webhook 404s. | Two mitigations: (a) on `initiate_purchase`, normalize the TrxID (trim whitespace, uppercase, strip non-alphanumeric); (b) the orphan SMS from #2 is the recovery path — operator manually matches. Build an admin tool. |
| 6 | Customer sends from a different phone than they declared | `confirm_purchase` returns `msisdn_mismatch`; status stays `pending`; webhook 409 | Add a status `msisdn_mismatch_review`. Notify operator. Do NOT auto-grant. Operator decides via admin tool: "approve anyway" (overrides msisdn check) or "reject". |
| 7 | Bank reversal / bKash refund | bKash sends a reversal SMS to the operator's phone | Flutter classifies and posts to `POST /api/reverse-purchase` (new). That endpoint flips the `completed` row to `refunded` and DECREMENTS `toolkit_credits`. If the customer has already used those credits — see #8. |
| 8 | Customer used credits before the reversal arrived | Refund would leave `toolkit_credits` negative | Allow negative balance in DB but block all paid endpoints when balance ≤ 0 (the existing 402 path already handles this). Notify customer ("a previous purchase was reversed; your balance is -2 — purchase a new pack to clear it"). Add an admin override to forgive negative balance. |
| 9 | Two webhook hits for the same SMS (Flutter retried before getting our 200) | confirm_purchase uses `for update` + status filter — second call finds row already `completed`, 404s | Already idempotent. Confirm test coverage exists. |
| 10 | Customer disputes ("I sent the money, no credits") | No formal channel | Add `POST /api/dispute-purchase` (auth required) — captures TrxID + customer notes. Inserts into `purchase_disputes` with status `open`. Operator sees it on the admin dashboard alongside the pending / orphan rows. |
| 11 | Operator manual confirm | `select confirm_purchase(...)` from SQL editor under service role | Build `POST /api/admin/confirm-purchase` — service-role-equivalent, gated by `ADMIN_API_KEY` (new env var, separate from the bKash secret). Body: `{ transactionId, overrideMsisdnCheck?: bool, reason?: string }`. Logs reason to a new `purchase_state_changes` audit table. |
| 12 | Operator manual refund | None | `POST /api/admin/refund-purchase` — flips a `completed` row to `refunded`, decrements credits, logs reason to audit. Same admin auth as #11. |
| 13 | Operator matches an orphan SMS to a customer's pending row | None | `POST /api/admin/match-orphan` — takes orphan-SMS-id + pending-purchase-id, runs the same confirmation logic, audits the manual link. |
| 14 | Customer top-up after underpayment (#3) | Currently no path | When the customer sends the missing amount with the SAME TrxID — bKash actually creates a new TrxID for the second send, so we have to support multi-SMS aggregation. Add `purchase_topups` table linking N inbound SMS to one pending purchase. confirm_purchase logic becomes: sum of all matched SMS amounts ≥ required → confirm. Below required → stay `underpaid`. Above → as #4 surplus. |
| 15 | Webhook signature is wrong (rotated secret, attacker probe) | 401 returned | Already correct. Add rate limiting (max 30 requests / min from a single IP). |
| 16 | Supabase outage when webhook hits | 5xx returned, Flutter retries | Already correct. Add a Sentry-style error log so I'm alerted before customers complain. |
| 17 | Multiple customers paste the same TrxID (one is fraud) | Unique index → second `initiate_purchase` returns `duplicate_transaction_id` (409) | First-wins is OK. Surface the 409 in the dispute channel — the legitimate user files a dispute, operator reconciles via #11/#12. |
| 18 | Customer pastes a TrxID from a previous successful purchase trying to double-claim | Unique index catches it → 409 | Already correct. Add a customer-facing message that's clearer than "duplicate transaction id" — say "This transaction has already been credited to your account — please send a new bKash payment." |
| 19 | bKash SMS format change (rare but happens) | Flutter parser may stop matching | Operationally, the Flutter app surfaces parsing failures. Expose a `/api/admin/parser-failures` endpoint where the Flutter app POSTs every SMS it failed to classify; I review and update the parser. |
| 20 | Operator's phone is offline / Flutter app uninstalled | All confirms backlog on the phone | Already correct from the Flutter side (retries indefinitely). On the server side, the customer sees their `pending` purchase indefinitely and may give up. Send a daily summary email to the operator if any pending row > 12 h old. |

## 3. Schema diff

```sql
-- Migration: 006_transaction_flow_hardening.sql

-- Expand the status enum.
alter table public.purchases
  drop constraint if exists purchases_status_check;
alter table public.purchases
  add constraint purchases_status_check check (status in (
    'pending',
    'completed',
    'failed',
    'expired',
    'underpaid',
    'msisdn_mismatch_review',
    'refunded'
  ));

-- Track the actual amount we observed via SMS, separately from the
-- amount the customer was supposed to send.
alter table public.purchases
  add column if not exists observed_amount_taka integer;

-- Top-ups: N inbound SMS aggregating into one purchase. For underpayment
-- recovery (case #14).
create table if not exists public.purchase_topups (
  id              uuid default uuid_generate_v4() primary key,
  purchase_id     uuid references public.purchases(id) on delete cascade not null,
  payment_reference text not null,
  sender_msisdn   text,
  amount_taka     integer not null,
  created_at      timestamp with time zone default timezone('utc', now()),
  unique(payment_reference)
);

-- Surplus / overpayment audit (case #4).
create table if not exists public.purchase_overpayments (
  id              uuid default uuid_generate_v4() primary key,
  purchase_id     uuid references public.purchases(id) on delete cascade not null,
  surplus_taka    integer not null,
  resolution      text not null default 'pending'
    check (resolution in ('pending','refunded','kept_as_credit')),
  created_at      timestamp with time zone default timezone('utc', now())
);

-- Orphan inbound SMS — the Flutter app dumps unmatchable SMS here for
-- operator reconciliation (case #2 / #5).
create table if not exists public.unmatched_inbound_sms (
  id              uuid default uuid_generate_v4() primary key,
  payment_reference text not null,
  sender_msisdn   text,
  amount_taka     integer not null,
  raw_body        text,
  sms_timestamp   timestamp with time zone not null,
  matched_to_purchase_id uuid references public.purchases(id),
  created_at      timestamp with time zone default timezone('utc', now()),
  unique(payment_reference)
);

-- Customer-filed disputes (case #10).
create table if not exists public.purchase_disputes (
  id              uuid default uuid_generate_v4() primary key,
  user_id         uuid references public.profiles(id) not null,
  payment_reference text not null,
  notes           text,
  status          text not null default 'open'
    check (status in ('open','resolved','rejected')),
  created_at      timestamp with time zone default timezone('utc', now())
);

-- Full audit trail of state transitions (case #11/#12 + general).
create table if not exists public.purchase_state_changes (
  id              uuid default uuid_generate_v4() primary key,
  purchase_id     uuid references public.purchases(id) on delete cascade not null,
  from_status     text,
  to_status       text not null,
  actor           text not null,    -- 'system','operator:<id>','flutter','customer'
  reason          text,
  created_at      timestamp with time zone default timezone('utc', now())
);

-- RLS for customer-facing tables (disputes only — others are operator-only):
alter table public.purchase_disputes enable row level security;
create policy "Users can view own disputes" on public.purchase_disputes
  for select using (auth.uid() = user_id);
create policy "Users can insert own disputes" on public.purchase_disputes
  for insert with check (auth.uid() = user_id);

-- Operator-only tables: NO RLS policies for users. service_role only.
alter table public.purchase_topups enable row level security;
alter table public.purchase_overpayments enable row level security;
alter table public.unmatched_inbound_sms enable row level security;
alter table public.purchase_state_changes enable row level security;

-- TTL-expire pending purchases > 24 h old (case #1). Cron via pg_cron
-- or via Vercel cron + service-role.
create or replace function public.expire_stale_pending_purchases()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  affected integer;
begin
  with expired as (
    update public.purchases
    set status = 'expired'
    where status = 'pending'
      and created_at < now() - interval '24 hours'
    returning id, status
  )
  insert into public.purchase_state_changes (purchase_id, from_status, to_status, actor, reason)
  select id, 'pending', 'expired', 'system', 'TTL exceeded' from expired;
  get diagnostics affected = row_count;
  return affected;
end;
$$;
```

## 4. API endpoints to add

### Customer-facing
- `GET /api/my-purchase-status?txnId=...` — auth required. Returns `{ status, observedAmount?, message }` so the customer's web UI can show "verifying", "credits added", "underpaid: please send Tk N more", "expired".
- `POST /api/dispute-purchase` — auth required. Body: `{ transactionId, notes }`. Inserts a row in `purchase_disputes`.

### Operator-facing (gated by `ADMIN_API_KEY` header)
- `GET /api/admin/dashboard` — counts of pending / completed today / disputed / expired.
- `GET /api/admin/pending` — list of `pending` rows > N min old.
- `GET /api/admin/orphans` — list of orphan SMS with no matching pending row.
- `POST /api/admin/match-orphan` — body `{ smsId, purchaseId, reason }`.
- `POST /api/admin/confirm-purchase` — body `{ transactionId, overrideMsisdnCheck?, reason }`.
- `POST /api/admin/refund-purchase` — body `{ transactionId, reason }`.
- `POST /api/admin/resolve-dispute` — body `{ disputeId, resolution: 'resolved' | 'rejected', operatorNote }`.

### Flutter-facing (signed with `BKASH_WEBHOOK_SECRET`)
- `POST /api/orphan-inbound-sms` (already mentioned) — for SMS the Flutter app couldn't match after 24 h.
- `POST /api/reverse-purchase` — for bKash reversal SMS.
- `POST /api/admin/parser-failures` — for SMS the Flutter parser couldn't classify.

## 5. Cron job

Either Vercel cron (free on Hobby — once-daily) or pg_cron in Supabase (any cadence). Use pg_cron if available; cleaner. Cadence:
- Every 15 min: `select public.expire_stale_pending_purchases();`
- Every hour: send the operator a digest email if any pending row > 12 h old (case #20).

## 6. UI changes I want

**Customer-facing (in PurchaseModal.tsx and DashboardScreen.tsx):**
- After submitting, the modal closes and a small "Verifying purchase…" pill appears in the navbar. It polls `/api/my-purchase-status` every 10 s for up to 5 min. On `completed`, it briefly turns green and disappears. On `underpaid`, it offers an actionable card ("send Tk N more, ref the same TrxID"). On `msisdn_mismatch_review`, it offers "Contact support". On `expired`, it offers "Resubmit" (links back to PurchaseModal).
- Add "Purchase history" section to the dashboard (or to ProfileScreen) so customers can see their own row history with status badges.

**Operator-facing (new):**
- Build a thin admin SPA at `/admin` (gated by `ADMIN_API_KEY` in localStorage; ugly but adequate for one-person ops). Three tabs: Pending, Orphans, Disputes. Each tab is a table with row-level action buttons.

## 7. Tests I want

- **Postgres unit tests** (pgTAP or just SQL fixtures + assertions) for every new RPC.
- **Vercel function tests** with `vitest` + a Supabase-local-emulator. Cover the matrix of:
  - underpayment (single send, exact amount, then no top-up; underpayment + top-up that brings it to exact; underpayment + over-top-up; underpayment + nothing → eventual expire).
  - overpayment.
  - msisdn mismatch + override.
  - duplicate webhook hits.
  - signature failure modes.
  - admin endpoints with wrong / missing key.
- **End-to-end happy path** — Playwright script that walks signup → purchase modal → mock-confirm → dashboard balance.

## 8. Things you should NOT do

- Do not introduce a generic "credits" abstraction. The repo has the explicit-integer-per-feature pattern; keep `toolkit_credits` as one column.
- Do not allow customers to change package id mid-flow. Server-side mapping is authoritative.
- Do not retry confirm_purchase for `msisdn_mismatch_review` automatically. That's an operator-decision state.
- Do not silently auto-refund on overpayment. The operator is the only authority on refunds; the system records, surfaces, and waits.
- Do not introduce a new `service_role` use without an HMAC or admin-key gate.

## 9. Deliverables

1. **`006_transaction_flow_hardening.sql`** with everything from §3, idempotent.
2. **Updated `schema.sql`** mirroring the new state.
3. **All new API endpoint files** with full handler implementations and inline doc comments matching the existing `api/_lib/auth.ts` style.
4. **A short `ADMIN.md`** describing how the operator uses the admin endpoints + the digest email cadence.
5. **The customer-facing polling + status pill** wired into the existing `PurchaseModal.tsx` / `DashboardScreen.tsx` (preserve the current Tailwind + Saffron / Ink design system — no gradients, no blue/indigo/purple).
6. **The `/admin` SPA** (a single `AdminScreen.tsx` is fine — three tabs, raw HTML tables, no need for fancy UI).
7. **Tests** as in §7.

Stop and ask before adding any new third-party SDK or before introducing a payment-gateway integration. The point of this work is to make the bKash + Flutter flow bulletproof, not to swap it out.
