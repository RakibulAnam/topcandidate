# End-to-End Flow — How TopCandidate Works

> The definitive guide to the whole system: business + technical, customer + operator, web + mobile + database.
> Verified against the code (not just other docs). Where a detail is load-bearing, the source file is cited.
> Companion reading: [`architecture/system-overview.md`](architecture/system-overview.md), [`contracts/webhook-confirm-purchase.md`](contracts/webhook-confirm-purchase.md), [`architecture/webhook-replay-protection.md`](architecture/webhook-replay-protection.md).

---

## 1. Executive Summary

**TopCandidate** is an AI career-toolkit website for job seekers (primarily in Bangladesh). A user pastes a job description and AI writes them a tailored **resume, cover letter, outreach email, LinkedIn message, and interview questions**. Generating a tailored package costs **"toolkit credits."**

Users buy credits with **bKash** (Bangladesh mobile money). There is **no automated payment gateway** — integrating bKash's merchant gateway isn't viable at this stage. Instead the system uses a **manual-pay + companion-app** model:

1. The user sends money via their own bKash app to the **operator's personal bKash number**, then types the **Transaction ID (TrxID)** into the website.
2. The website records a **`pending`** purchase — *no credits yet.*
3. The **operator's Android phone** runs a small custom app (the "watcher"). When bKash texts *that phone* a "you received money" SMS, the watcher reads it, extracts the TrxID + amount + sender, and securely tells the website "this payment is real."
4. The website matches the TrxID, checks the amount, and **grants the credits**. The user's balance updates live (Supabase Realtime).

**How fast does this feel?** Near-real-time. If the bKash SMS reached the operator's phone *before* the customer submits their TrxID (common), credits are granted **in the submit request, ~1-2s** (match-on-submit). If the customer submits *first*, credits land as soon as the SMS arrives — carrier-SMS time **+ <3s** of our processing (immediate dispatch + Realtime push). Worst case is carrier-bound: SMS delivery is outside our control.

So there are **two apps and one database**, and the two apps never talk directly — the phone only sends one kind of signed message ("a payment arrived") to the website.

| Piece | What it is | Job |
|---|---|---|
| **Web app** | React 19 SPA + Vercel serverless functions | Everything the customer sees; records purchases; grants credits; runs AI; admin panel |
| **Mobile app** | Flutter Android app on the operator's phone | Reads bKash SMS, tells the web app a payment arrived |
| **Supabase** | Hosted Postgres + login | Stores users, profiles, resumes, purchases, credits |

---

## 2. System Architecture Overview

```
                          Customer (web browser)
                                   │
                                   │  HTTPS + Supabase login token (JWT)
                                   ▼
              ┌─────────────────────────────────────────┐
              │  WEB APP  (apps/web)  — hosted on Vercel  │
              │                                           │
              │  • React 19 single-page app (the UI)      │
              │  • /api/* serverless functions (backend)  │
              │      purchase · confirm-purchase ·        │
              │      optimize · admin/* · cron            │
              └───────────────┬─────────────────┬─────────┘
              service-role key │                 │ API keys (server-only)
                               ▼                 ▼
                    ┌────────────────┐   ┌──────────────────┐
                    │  SUPABASE      │   │  OpenRouter       │
                    │  Postgres+Auth │   │  (AI; or legacy   │
                    │                │   │   Groq+Gemini)    │
                    └────────────────┘   └──────────────────┘
                               ▲
                               │  POST /api/confirm-purchase
                               │  (HMAC-SHA256 + timestamp + nonce)
                               │
              ┌────────────────┴──────────────┐
              │  MOBILE APP (apps/mobile)      │
              │  Flutter, Android-only         │
              │  "bKash Watcher" v1.3.0+4      │
              │  runs on the operator's phone  │
              └────────────────┬──────────────┘
                               ▲
                               │  Android SMS broadcast
                          bKash payment SMS
```

### Component responsibilities

| Component | Responsibility | Holds which secrets |
|---|---|---|
| **Browser (React SPA)** | UI, login, purchase form, AI requests, status polling, admin UI | The user's login token; for the operator, the admin key — both in `localStorage` |
| **Vercel `/api/*` functions** | The only code allowed to touch AI keys, the service-role DB key, and credit-granting logic | `SUPABASE_SERVICE_ROLE_KEY`, `OPENROUTER_API_KEY` (or legacy `GROQ_API_KEY`/`GEMINI_API_KEY`), `BKASH_WEBHOOK_SECRET`, `ADMIN_API_KEY`, `CRON_SECRET` |
| **Supabase Postgres** | Stores everything; enforces Row-Level Security; runs credit logic inside `SECURITY DEFINER` functions | — |
| **Supabase Auth** | Email/password login, issues JWTs (email confirmation **off**) | — |
| **Flutter watcher** | Reads bKash SMS, signs and POSTs confirmations | `BKASH_WEBHOOK_SECRET` (operator types it in) |
| **OpenRouter** (or legacy Groq / Gemini) | The actual AI text generation — DeepSeek optimizer + Gemini-Flash toolkit/extractor via one key | — |

### How components communicate
- **Browser → Vercel:** HTTPS + Supabase JWT bearer.
- **Vercel → Supabase:** the **service-role key** (bypasses Row-Level Security) — server-only.
- **Vercel → OpenRouter** (or legacy Groq/Gemini): API key, server-only.
- **Phone → Vercel:** HTTPS + **HMAC-SHA256** over the exact request bytes + a timestamp + a one-time nonce (replay protection).
- **Phone → Android OS:** `RECEIVE_SMS` / `READ_SMS` permissions.

### Why each component exists
- The **web app** is the product. The `/api/*` split exists so secrets and credit logic never reach the browser.
- The **mobile app** automates the operator's otherwise-manual job of watching bKash SMS and matching them to website orders.
- **Supabase** gives auth + a SQL database where the money-critical logic lives in locked-down functions (defense against a malicious browser).

---

## 3. User Journey

| Step | What the user sees | What happens behind the scenes | Data created / updated |
|---|---|---|---|
| **Create account** | Sign-up form (`LoginScreen`) | `supabase.auth.signUp`; email confirmation is **off**, so a session is issued immediately (`AuthContext.tsx`) | `auth.users` row → trigger `handle_new_user` creates a `profiles` row with `toolkit_credits = 0` |
| **Log in** | Sign-in form | `signInWithPassword`; JWT stored client-side | — |
| **Build profile** | Profile screens (experience, education, skills…) | Repositories write directly to Supabase tables under the user's JWT (RLS-scoped) | `experiences`, `educations`, `skills`, … |
| **Choose to buy** | `PurchaseModal` — shows operator's bKash number + price | One package only: **five-pack = 5 credits / ৳200** (hardcoded in `initiate_purchase`) | — |
| **Pay** | User opens *their own* bKash app, Send Money ৳200 | The website is **not** involved in moving money | — |
| **Submit TrxID** | Paste TrxID (+ optional phone), click submit | `POST /api/purchase` → `initiate_purchase` RPC (v3). **Match-on-submit:** if the bKash SMS already arrived, credits are granted *in this request* | `purchases` row (`status = 'pending'`, or `completed` immediately if the payment was already recorded in `inbound_payments`) |
| **Wait** | Navbar "Verifying…" pill (3-step timeline) | Pill subscribes to its purchase row via **Supabase Realtime** (sub-second) + a 20s fallback poll of `GET /api/my-purchase-status`, no time cap | — |
| **Validation** | (nothing visible) | Operator's phone gets the bKash SMS → watcher confirms it (see §5) | `purchases.status` flips |
| **Credits assigned** | Pill shows "5 credits added" (often instantly on submit) | `confirm_purchase` / match-on-submit adds credits, audits the change; Realtime pushes the update | `profiles.toolkit_credits += 5`; `purchase_state_changes` row |
| **Use credits** | Generate a tailored package in the Builder | `POST /api/optimize` consumes 1 credit, runs AI | `toolkit_credits -= 1`; `ai_call_log` row; `generated_resumes` |

---

## 4. Credit Purchase Flow

```
User → Purchase Request → Transaction Submission → Validation → Credit Assignment
```

### Step-by-step (with real code)

1. **Purchase request.** `PurchaseModal.tsx` shows the operator's bKash number (`VITE_BKASH_PAYMENT_NUMBER`) and the ৳200 price. The user pays out-of-band via their own bKash app.
2. **Transaction submission.** The user pastes the TrxID → `purchasePackage()` → `POST /api/purchase` (`api/purchase.ts`) → `initiate_purchase` RPC v3 (`schema.sql`).
   - **Validation rules (`initiate_purchase`):** package must be `five-pack` (else `unknown_package_id` → 400); TrxID ≥ 6 chars (else `invalid_transaction_id` → 400); TrxID globally unique (else `duplicate_transaction_id` → 409); the user must have < 5 pending purchases in the last 24h (else `too_many_pending` → 429).
   - **DB change:** inserts a `purchases` row — `status='pending'`, `credits_granted=5`, `amount_taka=200`, `payment_reference=<TrxID>`, optional `sender_msisdn`.
   - **Match-on-submit (migration 012):** after inserting the pending row, `initiate_purchase` checks `inbound_payments` for a matching, HMAC-verified bKash SMS that already arrived. If one exists (the common **pay-first** ordering), it settles the purchase synchronously in the same locked path `confirm_purchase` uses — granting credits (`completed`), or flagging `underpaid` / `msisdn_mismatch_review`. The RPC now returns `{ purchaseId, status, creditsGranted, newBalance }`, so `/api/purchase` returns the final state and `PurchaseModal` can show the confirmed overlay immediately. **Submit-first ordering** still returns `pending` and is settled out-of-band by the webhook.
   - The frontend then calls `writePendingPurchase()` and the navbar `VerifyingPurchasePill` subscribes to the row via Supabase Realtime (+ 20s fallback poll).
3. **Validation.** The operator's phone receives the bKash SMS and POSTs `confirm-purchase` (see §5 + §7). For the pay-first case the credits are already granted; this becomes an idempotent `200 alreadyConfirmed`.
4. **Credit assignment (`confirm_purchase`, service-role only):**
   - Locks the matching `pending`/`underpaid` row `FOR UPDATE`.
   - Checks sender (mismatch → `msisdn_mismatch_review`, 409) and amount (too little → `underpaid`, 409).
   - Otherwise: `status='completed'`, `profiles.toolkit_credits += 5`, writes a `purchase_state_changes` audit row, logs any surplus to `purchase_overpayments`.

### Success path
- **Pay-first (common):** SMS already recorded in `inbound_payments` → submit settles via match-on-submit → `completed` in the submit request (~1-2s) → modal shows the confirmed overlay immediately.
- **Submit-first:** Pending → SMS arrives → watcher confirms → `completed` → Supabase Realtime pushes the change → pill shows "5 credits added" → auto-dismisses after 4s.

### Failure paths
| Failure | Result |
|---|---|
| Too little paid | `underpaid` (409); pill shows "send ৳N more"; operator can top-up or override |
| Typo'd TrxID | Watcher's SMS never matches; after 24h becomes an **orphan** for manual matching |
| SMS arrives before submission | `confirm_purchase` → 404; the server records the verified SMS to `inbound_payments`, so the customer's later submit settles instantly via match-on-submit. The watcher also retries (escalating backoff, up to 24h) as a backstop — a later retry hits the now-completed row → 200 idempotent |
| Wrong sender phone | `msisdn_mismatch_review` (409); manual review |
| Never credited | User files a **dispute**; operator resolves in admin panel |
| bKash reverses the payment | `/api/reverse-purchase` → `refunded`, credits decremented |

---

## 5. Mobile App Flow

**Why it exists:** to automate the operator's manual job of reading bKash SMS and matching them to website orders. **Single-tenant** — one operator, one phone. Version **1.3.0+4**, package `bkash_watcher`. Android-only by design.

### How SMS monitoring works
- **Broadcast-driven, not polling.** The `another_telephony` plugin registers an Android `SMS_RECEIVED` receiver.
- **Two-isolate model:** a **UI isolate** listener (app open) and a **service isolate** listener inside a **foreground service** (app closed). The foreground service (`flutter_background_service`, notification id `1001`, type `dataSync`, `stopWithTask=false`) keeps it alive; a `BootReceiver` re-arms it after reboot.
- **Immediate dispatch + safety net:** the background SMS handler (`backgroundMessageHandler`) now *stores the SMS and dispatches immediately* (builds a `Dispatcher` and runs `tick()`), so a backgrounded SMS no longer waits for the periodic tick. A **WorkManager** periodic task still fires every ~15 min (Android's floor) as the backstop to drain any queued/retrying rows.
- **Permissions** (`AndroidManifest.xml`): `RECEIVE_SMS`, `READ_SMS`, `INTERNET`, `FOREGROUND_SERVICE` (+`DATA_SYNC`), `POST_NOTIFICATIONS`, `RECEIVE_BOOT_COMPLETED`, `WAKE_LOCK`, `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`.

### How transactions are detected & parsed (`bkash_parser.dart`)
- **Sender filter:** any sender whose address contains "bkash" (case-insensitive) — loose on purpose to tolerate `IM-BKASH`, `VM-BKASH`, etc.
- **Extracts:** TrxID (`TrxID\s+([A-Za-z0-9]{10})`, uppercased), amount (`Tk\s+([\d,]+(?:\.\d+)?)`, **floored** to whole Taka), sender (`from\s+(01\d{9})`, nullable). A valid parse **requires** a TrxID and an amount.
- **Classifies** (order matters): `refund` (Reversal) → `ibankingDeposit` → `sent` → `received` → `unknown`. Only `received` is confirmed; `refund` is reversed; the rest are ignored.
- **Unparseable SMS** (no TrxID) are fire-and-forgotten to `/api/admin/parser-failures` so the operator can fix the parser later.

### How matching & validation are performed
The watcher does **not** match orders itself — it sends the parsed facts to the server, which matches the TrxID against the `purchases` table. The watcher stores every SMS locally in SQLite (`processed_sms`, **deduplicated on `trx_id`**) and runs a state machine.

### Dispatcher state machine & how results come back (`dispatcher.dart`)
| Webhook response | Watcher state | Retry behavior |
|---|---|---|
| **200** | `done` (terminal) | Notify "credits granted" (suppressed if `alreadyConfirmed`) |
| **400 / 401 / 503** | `failed` | No retry; operator alerted on 401/503 |
| **404** | `waitingUser` | Retry on escalating backoff (`waitingUserBackoff`: 20s → 40s → 1m → 2m → 5m), up to **288×** (24h), then dump as orphan. Now a backstop: the server records the verified SMS to `inbound_payments`, so the customer's submit settles via match-on-submit and a later retry hits the completed row → 200 |
| **409** | `mismatch` (terminal) | No retry; notify underpayment / sender mismatch |
| **5xx / timeout / network** | `retrying` | Backoff **5s → 15s → 45s → 2m → 6m → 18m → 1h**, give up after 24h |

Crash recovery: rows stuck in `sending` for >60s reset to `retrying`.

### How it signs requests (`webhook_client.dart`)
Webhook **v2**: generates a UTC ISO-8601 timestamp, computes `HMAC-SHA256(secret, "<timestamp>.<body>")`, sends `X-Bkash-Webhook-Timestamp` + `X-Bkash-Webhook-Signature`. The server derives the replay nonce from `"<timestamp>:<body>"` (colon — deliberately different from the signature's dot). Settings (webhook URL + secret) live in `flutter_secure_storage`.

---

## 6. Web App Flow

### Customer-facing functionality
| Screen | Purpose | Calls |
|---|---|---|
| `LandingScreen` | Marketing | — |
| `LoginScreen` / `AuthContext` | Sign in/up, password reset | Supabase Auth |
| `ProfileSetupScreen` / `ProfileScreen` | Build profile | Supabase tables (RLS) + `extract-resume` |
| `BuilderScreen` | Paste JD → generate tailored package | `optimize`, `toolkit-item`, `optimize-general` |
| `DashboardScreen` | Saved resumes, credits, purchase history | `generated_resumes`, `purchases` (RLS) |
| Purchase UI | Buy + track (live via Supabase Realtime, sub-second; 20s fallback poll, no time cap) | `PurchaseModal`, `VerifyingPurchasePill` (`subscribeToPurchase` in `purchaseStatusClient.ts`), `CreditsBadge` |

### Credit management
- **Earned:** via `confirm_purchase` (webhook), `operator_confirm_purchase` / `admin_grant_override` / `apply_purchase_topup` (operator), or `admin_grant_credits` (manual).
- **Spent:** `consume_toolkit_credit` (1 per `/api/optimize`), refunded via `refund_toolkit_credit` if the optimizer fails.
- **Removed:** `record_purchase_reversal` (bKash reversal), `admin_deduct_credits`, `operator_refund_purchase`.
- **Rate limit:** 20 AI calls / rolling 24h per user (`ai_call_log`, `rateLimit.ts`).

### Admin functionality (`/admin`)
- **Auth:** a single shared `ADMIN_API_KEY` (no roles), sent as `X-Admin-Key`, timing-safe compared (`adminAuth.ts`). Handlers use the **service-role** client (bypasses RLS).
- **Routing:** all ~25 endpoints behind one dynamic function `api/admin/[action].ts` (Vercel Hobby caps a deployment at 12 functions); handlers in `_handlers/`.
- **Tabs:** Dashboard (counters + "needs attention" queue), Purchases (confirm/expire/refund/grant-override/reopen), Users (grant/deduct credits, flag, notes), Disputes (resolve/reject), Orphans (match SMS to a pending order), Parser failures (review + export a corpus), Audit log, Settings (env health, manual expiry trigger).
- Every write requires a `reason` and is recorded in `admin_audit_log` (best-effort, after the action).

---

## 7. Database Flow

The DB is **Supabase Postgres**, protected by two layers: **Row-Level Security** (users see only their own rows) and **column lockdown + `SECURITY DEFINER` functions** (users *cannot* write `toolkit_credits` directly — credits change only inside server-side functions callable by the service-role key, per migration 005/008).

| Table | Purpose | Who writes | Role in the flow |
|---|---|---|---|
| **`profiles`** | One per user; holds **`toolkit_credits`** (the balance), `flagged_at` | User edits profile fields; credits only via DB functions | Where credits live |
| `experiences`, `educations`, `skills`, … | Resume building blocks | User (RLS) | Source data for AI |
| `applications`, `generated_resumes` | Saved AI outputs (resume + toolkit JSON) | User (RLS) | Output storage |
| `ai_call_log` | One row per AI call | User (RLS) | Daily rate-limit + audit |
| **`purchases`** | **One row per purchase.** TrxID in `payment_reference` (**UNIQUE**). In the `supabase_realtime` publication (`REPLICA IDENTITY FULL`) so the browser can subscribe to its own row | Server only | The monetization spine |
| **`inbound_payments`** | An HMAC-verified bKash SMS that arrived **before** the customer submitted their TrxID. Consumed automatically (match-on-submit), usually within seconds; pruned at 48h. RLS on, **no user policies** | Server only (`record_inbound_payment` + match-on-submit) | Enables near-real-time pay-first credit grants. Distinct from `unmatched_inbound_sms` (the 24h orphan queue) — never shows in the Orphans tab |
| `purchase_state_changes` | Append-only status-change audit | DB functions | Every flip recorded |
| `purchase_overpayments` | Surplus when a user overpays | DB functions | Overpayment handling |
| `purchase_topups` | Multiple SMS aggregating to one order | DB functions | Underpayment recovery |
| `unmatched_inbound_sms` | **Orphans** + parser failures (`PARSE_FAIL_*`) | Watcher (webhook) | Reconciliation queue |
| `purchase_disputes` | "I paid but no credits" reports | User files; operator resolves | Customer recourse |
| `admin_audit_log` | Every operator action (before/after) | Admin endpoints | Operator accountability |
| `profile_notes` | Operator's private notes on users | Admin | Support |
| `webhook_nonces` | One-time tokens (10-min TTL) | Webhook | Replay protection |

**`purchases.status` lifecycle:**
```
pending ──confirm(ok)──► completed ──reversal/operator──► refunded
   │                         ▲
   ├──amount too low──► underpaid ──topup/override──► completed
   ├──sender wrong──► msisdn_mismatch_review ──override──► completed
   └──24h, no pay──► expired ──operator reopen──► pending
```

**Key DB functions** (all `SECURITY DEFINER`; service-role-only except `initiate_purchase` and `record_purchase_dispute`, which are user-callable):
`initiate_purchase` (v3 — record pending + match-on-submit), `confirm_purchase` (grant), `record_inbound_payment` (store a pre-submit verified SMS), `consume_toolkit_credit` / `refund_toolkit_credit` (spend/refund), `operator_confirm_purchase` / `operator_refund_purchase` / `apply_purchase_topup` / `admin_grant_override` / `admin_grant_credits` / `admin_deduct_credits` (operator tools), `record_orphan_sms`, `record_purchase_reversal`, `record_purchase_dispute` / `resolve_purchase_dispute`, `expire_stale_pending_purchases` (also prunes `inbound_payments`), `acquire_webhook_nonce` / `prune_webhook_nonces`.

---

## 8. API Flow

See [`contracts/api-endpoints.md`](contracts/api-endpoints.md) for the full index. The four auth models:

| Auth model | Who | How |
|---|---|---|
| **User JWT** | Customer browser | `Authorization: Bearer <supabase-jwt>` (`auth.ts`) |
| **HMAC** | Flutter watcher | `X-Bkash-Webhook-Signature` (+ `X-Bkash-Webhook-Timestamp`) over raw body (`webhookAuth.ts`) |
| **Admin key** | Operator | `X-Admin-Key` ≡ `ADMIN_API_KEY` (`adminAuth.ts`) |
| **Cron secret** | Scheduler | `Authorization: Bearer <CRON_SECRET>` |

| Endpoint | Caller | Purpose | Key error handling |
|---|---|---|---|
| `POST /api/purchase` | User | Record pending purchase | 400 invalid, 409 duplicate, 429 too many pending |
| `GET /api/my-purchase-status` | User | Status for the pill | 400 missing txnId, 404 no row |
| `POST /api/dispute-purchase` | User | File a dispute | 400 short notes, 429 >3/24h |
| `POST /api/optimize` | User | Spend credit, run AI | 402 no credits, 429 daily cap, 413 JD too long, 503 no provider, 502 optimizer failed (credit refunded) |
| `POST /api/optimize-general`, `/api/toolkit-item`, `/api/extract-resume` | User | Free AI helpers | 401, 429 |
| `POST /api/confirm-purchase` | Watcher (HMAC) | Confirm payment → grant | 401 bad sig, 400 bad body, 404 no pending, 409 mismatch/underpaid, 200 idempotent, 503 misconfig |
| `POST /api/orphan-inbound-sms` | Watcher (HMAC) | Dump unmatched SMS | 401, 400 |
| `POST /api/reverse-purchase` | Watcher (HMAC) | Reversal → refund | 401, 404 no completed |
| `GET /api/cron/expire-pending` | Cron | Expire >24h pending | 401 bad secret, 503 unconfigured |
| `/api/admin/[action]` | Operator | ~25 admin actions | 401 bad key, 400 missing reason, 404 unknown action |

---

## 9. Sequence Diagrams

### User purchase flow
```
User        PurchaseModal     /api/purchase    Postgres        bKash(phone)   Watcher   /api/confirm   profiles
 │  send ৳200 via bKash app ─────────────────────────────────────►│
 │  paste TrxID ──►│
 │                 │ POST /api/purchase ──►│ initiate_purchase ──►│
 │                 │                       │  INSERT purchases(pending)
 │                 │◄── 200 pending ───────│
 │                 │ writePendingPurchase (localStorage)
 │   (pill subscribes via Supabase Realtime + 20s fallback poll)  │
 │                                              bKash SMS ───────►│ parse + store (dedup TrxID)
 │                                                                │ POST confirm ──►│ confirm_purchase
 │                                                                │                 │  status=completed
 │                                                                │                 │  credits += 5 ──►│
 │                                                                │◄── 200 ─────────│
 │  pill: "5 credits added" ◄──────────── my-purchase-status: completed
```

### Transaction validation flow
```
bKash SMS
   → [Android SMS_RECEIVED broadcast] → sms_listener
   → bkash_parser (TrxID, amount floored, sender)
   → processed_sms (UNIQUE trx_id dedup) → dispatcher
   → POST /api/confirm-purchase  (HMAC v2: timestamp + nonce)
       → verify signature + ±5min window + claim nonce       → else 401
       → confirm_purchase RPC (row lock; sender check; amount check)
       → UPDATE purchases.status='completed'; profiles.toolkit_credits += 5
       → INSERT purchase_state_changes (audit)
   → 200 → dispatcher marks 'done' → notify operator
```

### Admin flow
```
Operator → /admin (paste ADMIN_API_KEY) → X-Admin-Key header
   → /api/admin/[action] → requireAdmin (timing-safe compare)
   → service-role Supabase client (bypasses RLS)
   → e.g. grant-credits → admin_grant_credits RPC → profiles.toolkit_credits += N
   → record_admin_action → admin_audit_log (before/after + reason)
   → UI refreshes
```

---

## 10. Edge Cases & Failure Scenarios

| Scenario | How the system handles it |
|---|---|
| **Failed payment (none sent)** | No SMS ever arrives; the `pending` row is expired after 24h (`expire_stale_pending_purchases`); pill shows "expired," user can resubmit. |
| **Duplicate TrxID** | `initiate_purchase` rejects with `duplicate_transaction_id` (409). The `purchases.payment_reference` UNIQUE index is the hard guarantee — two users can't claim one payment, and a payment can't be confirmed twice. |
| **Invalid TrxID** | < 6 chars rejected at both `/api/purchase` and the DB function (400). |
| **Missing SMS / SMS before submission** | `confirm_purchase` returns 404 (`no_pending_purchase`). The server records the verified SMS to `inbound_payments`, so when the customer submits their TrxID, `initiate_purchase` settles the purchase instantly via match-on-submit. The watcher also retries (escalating backoff, 24h) as a backstop — a later retry hits the now-completed row → 200 idempotent. A genuinely-missing SMS still expires/orphans after the 24h window. |
| **SMS parsing failure** | If the watcher can't extract a TrxID, it POSTs the raw body to `/api/admin/parser-failures` (stored as `PARSE_FAIL_<hash>`); the operator reviews + exports a corpus to fix the Dart parser. *(A parseable-but-unclassified "unknown" SMS becomes a local `failed` row with no server signal — a known gap.)* |
| **Network failures** | Watcher retries with exponential backoff (5s→1h) for 24h. A legitimate retry after a missed `200` carries a fresh timestamp+nonce (passes replay protection) and hits the already-`completed` row → server returns **200 idempotent**, so no double-grant. |
| **Underpayment** | `confirm_purchase` flips to `underpaid` (409). Customer pill shows "send ৳N more"; operator uses `apply_purchase_topup` (aggregates partial SMS) or `admin_grant_override`. |
| **Sender mismatch** | `msisdn_mismatch_review` (409); operator confirms with `overrideMsisdnCheck` if legitimate. |
| **Overpayment** | Credits granted + surplus logged to `purchase_overpayments`. |
| **bKash reversal** | Reversal SMS → `/api/reverse-purchase` → `record_purchase_reversal` flips `completed` → `refunded` and decrements credits (balance may go negative; `/api/optimize` refuses to run at ≤ 0). |
| **Captured request replayed by an attacker** | Rejected by the timestamp window (±5 min) + one-time nonce (`webhook_nonces`). |
| **Credit assignment failure (AI side)** | `/api/optimize` consumes a credit before AI; if the optimizer fails it calls `refund_toolkit_credit`. If only the toolkit fails, the credit is kept and per-item retries are free. |

---

## 11. Known Limitations

- **Single operator / single phone.** By design. Multi-operator payment confirmation is out of scope.
- **No Vercel cron configured.** `vercel.json` has no `crons` block, so 24h pending-expiry depends on Supabase `pg_cron` (migration 007) or the admin "run expiry" button. *(A stale comment in `api/cron/expire-pending.ts` and a note in `.env.example` previously implied a 15-min Vercel cron; the `.env.example` note is corrected, the code comment remains and should be fixed.)*
- **Admin key is a single shared secret in `localStorage`** — no roles, no 2FA, no IP allowlist, no rate-limit on the gate. Accepted single-operator trade-off; it's the dominant security risk.
- **Admin audit is best-effort, not transactional** — written after the action RPC; a crash between them leaves an un-audited mutation (cross-check `purchase_state_changes`).
- **One package only** (`five-pack`). Multi-package pricing is not implemented.
- **`flag-user` is cosmetic** — sets `flagged_at` and a UI chip but nothing auto-restricts a flagged user.
- **Parseable-but-unclassified SMS** create silent local `failed` rows with no server signal.
- **OpenRouter is not implemented** — `docs/OPENROUTER_MIGRATION.md` is a proposal; the live AI stack is Groq + Gemini (`aiFactory.ts`).
- **No automated test harness** on the web app (verification = `npm run build` + manual pass). The mobile app has Dart unit tests under `apps/mobile/test/`.
- **No push / FCM / email** — "credits ready" reaches the browser via Supabase Realtime (live while the tab is open) and resolves on the next visit otherwise. There is no web-push, FCM, or email notification channel; for a user actively waiting on the purchase pill (the common case, now ~1–2 s) it isn't needed. Add web-push/FCM later only as a re-engagement channel for users who left the page.
- **Carrier SMS delivery is outside our control.** Match-on-submit and immediate dispatch removed the app-side latency, but submit-first grants still wait on however long bKash takes to text the operator's phone.

> **Resolved (was on this list):** the fixed 5-min 404 retry, the up-to-15-min backgrounded-dispatch wait, and the 5-min web poll cap. See §4/§5 — match-on-submit (migration 012), immediate background dispatch (watcher 1.3.0+4), and Supabase Realtime now make credit assignment near-real-time.

---

## 12. How the System Works for New Developers

**Mental model.** A customer pays the operator directly by mobile money, then tells the website "I paid — here's my receipt number." The website writes an IOU (`pending`). The operator's phone is a robot cashier watching the operator's bKash inbox; when the matching "money received" text arrives, the robot phones the website — signed so no one can impersonate it — and says "receipt AB12CD34EF is legit for ৳200." The website checks the amount and sender, then hands over the credits.

**Core business logic lives in the database.** The money-critical rules are Postgres `SECURITY DEFINER` functions in [`apps/web/supabase/schema.sql`](../apps/web/supabase/schema.sql), not in the API handlers. The handlers authenticate, then call an RPC. Read `initiate_purchase` and `confirm_purchase` first — they *are* the purchase flow.

**Critical files, in reading order:**
1. [`AGENTS.md`](../AGENTS.md) (root) → topology.
2. [`docs/contracts/webhook-confirm-purchase.md`](contracts/webhook-confirm-purchase.md) → the one cross-app contract.
3. [`apps/web/supabase/schema.sql`](../apps/web/supabase/schema.sql) → the whole data model + business logic.
4. [`apps/web/api/confirm-purchase.ts`](../apps/web/api/confirm-purchase.ts) + [`api/_lib/webhookAuth.ts`](../apps/web/api/_lib/webhookAuth.ts) → the security-critical path.
5. [`apps/web/api/purchase.ts`](../apps/web/api/purchase.ts) + [`PurchaseModal.tsx`](../apps/web/src/presentation/components/PurchaseModal.tsx) + [`VerifyingPurchasePill.tsx`](../apps/web/src/presentation/components/Layout/VerifyingPurchasePill.tsx) → the customer side.
6. [`apps/mobile/lib/dispatch/`](../apps/mobile/lib/dispatch/) + [`lib/sms/`](../apps/mobile/lib/sms/) → the watcher.

**Important services / layers:**
- Web is **Clean Architecture**: Presentation → Application (`ResumeService`) → Domain ← Infrastructure. Presentation never imports a Gemini class directly (see `apps/web/AGENTS.md`).
- AI is proxied: the browser calls `/api/*` (`ProxyClients.ts`); the server holds the key (`aiFactory.ts` — OpenRouter when `OPENROUTER_API_KEY` is set, else legacy Groq + Gemini).
- Mobile is an isolate + state-machine design (see `apps/mobile/spec/`).

**Key architecture decisions:**
- **Polyglot monorepo, no shared code** — the only coupling is the webhook contract (ADR [`docs/decisions/0001`](decisions/0001-adopt-polyglot-monorepo.md)).
- **Credits never writable from the browser** — column lockdown + service-role-only RPCs (migrations 005/008).
- **Raw-body HMAC + timestamp + nonce** — byte-exact signing avoids JSON re-serialization drift; v2 adds replay protection (migration 011).
- **One admin function** — `api/admin/[action].ts` consolidates ~25 endpoints under Vercel's 12-function Hobby cap.

**The five things most likely to break the system:**
1. Renaming the `purchases` table or its `payment_reference` / `status` columns (breaks the watcher's match).
2. Changing the webhook payload, headers, or response codes without updating the phone (and `webhook-confirm-purchase.md`, in the same PR).
3. Rotating `BKASH_WEBHOOK_SECRET` on the server without re-entering it on the phone (every confirm → 401).
4. Removing the timestamp/nonce handling without coordinating the v1↔v2 rollout flag (`BKASH_WEBHOOK_REQUIRE_TIMESTAMP`).
5. Calling `confirm_purchase` from a user JWT — it's service-role-only and will be rejected.
