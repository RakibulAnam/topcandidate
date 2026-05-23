# Session Context — bKash Payment Flow + Production Audit Work

**Last updated:** 2026-05-14 (after the Vite-env-injection bug fix).
**Audience:** A future AI session that needs to pick up where the 2026-05-08 audit + bKash-flow implementation left off.

## How to use this file

1. **First read `AGENTS.md`** at the repo root — the canonical repo context (architecture, layering rules, schema, brand tokens, env vars).
2. **Then read `CLAUDE.md`** — hard rules that override defaults (no gradients, no new doc files, verification protocol).
3. **Then read this file** — what was done during the 2026-05-08 audit and the bKash-flow implementation, what's still pending, and what to do for production rollout.

Optional supporting documents in the same folder:
- `PHASE-1-REPORT.md` — original five-area static audit with scores.
- `EDGE-CASES.md` — 18-case static + live review.
- `TOOLKIT-CRITIQUE.md` — three deep-dive critiques of live AI output.
- `FINAL-REPORT.md` — original audit verdict + top-10 punch list.
- `PROMPT-flutter-bkash-watcher.md` — self-contained spec to build the Flutter SMS-watcher app in a fresh chat session.
- `PROMPT-transaction-flow-edge-cases.md` — self-contained spec for hardening every transaction edge case.

## Section 1 — TL;DR state of the codebase

- **TOP CANDIDATE** is a BD-market AI resume + toolkit builder. React 19 + Vite + Tailwind + Supabase + Vercel Functions. AI providers: Groq (primary optimizer) → Gemini (fallback + all toolkit generators).
- A full audit was run 2026-05-08. Three production-blockers (P0s) were identified.
- **P0 #1 (toolkit_credits self-grant exploit)** — FIXED. Migration 005 added column-level GRANT lockdown on `profiles`. Direct UPDATE of `toolkit_credits` from a signed-in browser now returns `permission denied for column toolkit_credits`. The user (project owner) has run migration 005 in Supabase SQL editor.
- **P0 #2 (resumeOptimizerPrompts.ts syntax error → every AI endpoint dies)** — FIXED. Unescaped backticks on lines 41 + 52 replaced with double quotes. Live `/api/optimize` now returns 200.
- **P0 #3 (anti-fabrication guard tech-only)** — FIXED. Added six BD industry token buckets (banking, pharma, garments, FMCG, NGO, telecom) into the fabrication guard. Verified live by catching a "Bangladesh Bank" fabrication attempt in Arif (garments merchandiser) × bKash PM stretch-fit pair.
- **Bonus fix during audit**: cliché-strip post-pipeline step. The system prompt's banned-cliché list (`proven track record`, `passionate`, `team player`, etc.) slipped through in 3/3 live persona runs. A 17-pattern deterministic regex strip now runs after the optimizer returns. Verified live: Sumaiya's regenerated summary no longer contains "proven track record".
- **Bonus fix during audit**: narrowed ~30 TECH_TOKENS single-word entries that false-positived on common English words. `Next`, `Express`, `Spring`, `Go`, `Apple`, `Block`, `Square`, `Oracle`, `Adobe`, `Chef`, `Puppet`, etc. either removed entirely or replaced with multi-word forms (`Next.js`, `Express.js`, `Spring Boot`, `Apple Inc`, `Block Inc`, `Square Inc`, `Oracle Corporation`, `Adobe Inc`, `Chef Configuration Management`, `Puppet Configuration Management`). Smoke tests confirm "express interest" / "spring season" no longer trigger fabrication.
- **bKash purchase flow scaffolded end-to-end** (no traditional payment gateway). User sends bKash to owner's number out-of-band → pastes Transaction ID in PurchaseModal → server records `pending` purchase → Flutter SMS-watcher on owner's phone reads bKash SMS → POSTs HMAC-signed webhook to `/api/confirm-purchase` → credits granted. The Flutter app is NOT yet built. For local dev, a `/api/dev-mock-confirm` endpoint + `VITE_BKASH_MOCK_AUTOCONFIRM` flag auto-confirms purchases 3 seconds after submission.
- **Vite env injection bug discovered + fixed 2026-05-14**: PurchaseModal initially read env vars via `(import.meta as unknown as {...})?.env ?? {}`. Vite's static-substitution heuristic only recognizes the direct `import.meta.env.X` pattern; the cast defeated it, so `import.meta.env` was undefined at runtime and the bKash number + dev-mock badge didn't render. Fix: replaced with direct access (`import.meta.env.VITE_BKASH_PAYMENT_NUMBER`). End-to-end mock flow now works live.

## Section 2 — Transaction-flow architecture (the meat)

### Customer-facing flow

```
1.  Customer opens PurchaseModal (auto-opens on 402, or via credit pill click)
2.  Modal shows: pack price (৳200 for 5 credits), bKash number, 3-step instructions
3.  Customer sends bKash to the displayed number OUT-OF-BAND (via the bKash app on their phone)
4.  Customer pastes the bKash Transaction ID (TrxID) into the modal form
5.  Customer optionally enters their bKash sender number (helps match faster)
6.  Customer clicks Submit → POST /api/purchase → calls SQL initiate_purchase RPC
7.  Server inserts a row in `purchases` with status='pending' (NO credits granted yet)
8.  Modal shows "Verifying bKash transaction…" (3s in mock mode; until SMS arrives in production)

—— Production path (Flutter app required) ——
9a. bKash SMS arrives on the OWNER's phone with the matching TrxID
10a. Owner's Flutter SMS-watcher app parses the SMS (TrxID, sender msisdn, amount)
11a. Flutter app HMAC-SHA256-signs the JSON body with BKASH_WEBHOOK_SECRET
12a. Flutter app POSTs to /api/confirm-purchase with X-Bkash-Webhook-Signature header
13a. Server verifies signature (timing-safe compare) → calls confirm_purchase RPC via service-role
14a. confirm_purchase atomically flips the purchase row to 'completed' AND increments toolkit_credits
15a. (Future: Supabase Realtime push notifies the browser; for now the dashboard re-fetches on next interaction)

—— Dev/mock path (current behaviour without Flutter app) ——
9b. PurchaseModal waits 3s, then automatically calls /api/dev-mock-confirm
10b. /api/dev-mock-confirm authenticates the user, looks up their pending purchase
11b. Calls confirm_purchase via service-role with the user-supplied msisdn (so internal check passes)
12b. Credits granted, modal closes, dashboard re-fetches → credit pill updates from 0 → 5
```

### Database schema (after migration 005)

```
profiles
  ├─ id, full_name, email, phone, location, linkedin, github, website
  ├─ user_type, onboarding_complete, updated_at, created_at
  └─ toolkit_credits      integer not null default 0
     • RLS row policy: auth.uid() = id
     • Column-level GRANT: UPDATE only on listed editable cols; NOT on toolkit_credits
     • Toolkit_credits mutated only via SECURITY DEFINER RPCs below

purchases
  ├─ id, user_id, created_at
  ├─ credits_granted     integer       (5 for the current 'five-pack')
  ├─ amount_taka         integer       (200 for the current 'five-pack')
  ├─ payment_reference   text unique   (the bKash TrxID — unique index prevents dupes)
  ├─ sender_msisdn       text          (bKash phone that sent the payment; optional)
  └─ status              text          ('pending'|'completed'|'failed'|'refunded')
     • RLS: users SELECT their own; INSERT only via initiate_purchase RPC
     • status starts 'pending'; flips to 'completed' via confirm_purchase

RPCs (all SECURITY DEFINER, set search_path = public, pg_temp):
  • consume_toolkit_credit()                                      → user-callable; atomic decrement
  • refund_toolkit_credit()                                       → user-callable; +1 increment
  • initiate_purchase(p_package_id, p_transaction_id, p_sender_msisdn) → user-callable; inserts pending
  • confirm_purchase(p_transaction_id, p_observed_sender_msisdn)  → SERVICE-ROLE ONLY (EXECUTE revoked)
  • delete_user()                                                 → user-callable; cascades delete
```

### API endpoints

| Endpoint | Auth | Purpose | Status |
|---|---|---|---|
| `POST /api/optimize` | User JWT | Tailored toolkit (paid; consumes 1 credit, optimizer + combined toolkit) | Shipping |
| `POST /api/optimize-general` | User JWT | Free path (master resume, optimizer only, no toolkit, no credit) | Shipping |
| `POST /api/toolkit-item` | User JWT | Single-item retry (cover letter / outreach / LinkedIn / interview Qs) — FREE | Shipping |
| `POST /api/extract-resume` | User JWT | PDF/Word resume extract | Shipping |
| `POST /api/purchase` | User JWT | Initiate bKash purchase (records pending row) | Shipping |
| `POST /api/confirm-purchase` | HMAC | Webhook for Flutter SMS-watcher | Shipping (no client yet) |
| `POST /api/dev-mock-confirm` | User JWT + env flag | DEV ONLY — auto-confirm a pending purchase | Shipping (delete before prod) |

### UI components

- `src/presentation/components/PurchaseModal.tsx` — bKash flow modal with state machine: `idle → submitting → verifying → confirmed → close`. Reads `VITE_BKASH_PAYMENT_NUMBER` and `VITE_BKASH_MOCK_AUTOCONFIRM` from `import.meta.env` **via the direct-access pattern** (do not destructure into a local var — that defeats Vite's static substitution).
- `src/presentation/DashboardScreen.tsx` — `onSuccess={() => loadData()}` because purchases are now async; credits arrive later via the webhook.
- `src/presentation/BuilderScreen.tsx` — `handlePurchaseSuccess` no longer takes a `newBalance` arg (drops the auto-resume-after-purchase flow since credits aren't there immediately).
- `src/infrastructure/api/purchaseClient.ts` — typed client. New return shape: `{ success, purchaseId, status: 'pending', message }` instead of the old `{ creditsGranted, newBalance }`.

### Locale strings

Both `en.ts` and `bn.ts` have full keys for the bKash flow (`purchaseModal.bkashStepsTitle`, `bkashStep1/2/3`, `bkashTxnIdLabel`, `bkashSenderLabel`, `submit`, `verifying`, `pendingNotice`, `confirmedToast`, `duplicateTxn`, `invalidTxn`, `mockBadge`, ...). TS type-imports `Dictionary` from `en.ts`, so structural parity is build-time enforced.

### Required env vars (server-only NOT prefixed `VITE_`)

```
# AI providers
GROQ_API_KEY                       # primary optimizer
GEMINI_API_KEY                     # toolkit + extractor + fallback optimizer

# Supabase
VITE_SUPABASE_URL                  # client-visible
VITE_SUPABASE_ANON_KEY             # client-visible
SUPABASE_SERVICE_ROLE_KEY          # server-only — used by /api/confirm-purchase
                                    # and /api/dev-mock-confirm

# bKash flow
VITE_BKASH_PAYMENT_NUMBER          # client-visible — shown to customers in PurchaseModal
BKASH_WEBHOOK_SECRET               # server-only — 32-byte hex, shared with Flutter app
                                    # Generate with: openssl rand -hex 32

# Dev-only — DELETE FROM PRODUCTION
VITE_BKASH_MOCK_AUTOCONFIRM=true   # client flag; PurchaseModal auto-fires mock-confirm
BKASH_MOCK_AUTOCONFIRM=true        # server flag; /api/dev-mock-confirm accepts requests
```

## Section 3 — Files added or modified

### Migrations
- `supabase/migrations/005_lock_toolkit_credits_and_bkash_pending.sql` — column-level GRANT, drops `process_mock_purchase`, adds `initiate_purchase` + `confirm_purchase`, `purchases.sender_msisdn`, unique index on `payment_reference`. **Run in Supabase SQL editor; idempotent.**
- `supabase/schema.sql` — mirrors the post-005 state for fresh-DB bootstrap.

### Server
- `api/purchase.ts` — rewritten to call `initiate_purchase`. Maps Postgres exceptions to 400/409/429.
- `api/confirm-purchase.ts` — NEW webhook. HMAC-SHA256 timing-safe verification + service-role RPC call.
- `api/dev-mock-confirm.ts` — NEW dev-only. Authenticates user, ensures they own the pending purchase, calls `confirm_purchase` via service-role. **Delete before production ship.**

### Client
- `src/infrastructure/api/purchaseClient.ts` — new request/response types.
- `src/presentation/components/PurchaseModal.tsx` — bKash flow + state machine + mock auto-confirm. **Pay attention to the direct `import.meta.env.X` pattern — don't refactor to use an intermediate variable; Vite will silently break.**
- `src/presentation/DashboardScreen.tsx`, `src/presentation/BuilderScreen.tsx` — adapted to async credit grant.
- `src/presentation/i18n/locales/en.ts`, `bn.ts` — new purchaseModal keys.

### AI prompts (the audit fixes)
- `src/infrastructure/ai/prompts/resumeOptimizerPrompts.ts` — backticks escaped (P0 #2); `stripBannedCliches()` added.
- `src/infrastructure/ai/prompts/toolkitContext.ts` — BD industry buckets (`BANKING_TOKENS`, `PHARMA_TOKENS`, `GARMENTS_TOKENS`, `FMCG_TOKENS`, `NGO_TOKENS`, `TELECOM_TOKENS`) + alias dictionary additions; narrowed false-positive TECH_TOKENS.
- `src/infrastructure/ai/GroqResumeOptimizer.ts`, `GeminiResumeOptimizer.ts` — `stripBannedCliches` wired into the post-pipeline.

### Docs
- `AGENTS.md` — §4 monetization rewritten (bKash flow); §8 migrations list updated; §12 env vars; §13 known-debt entries refreshed.
- `CLAUDE.md` — verification protocol now includes `tsx -e "await import('./api/_lib/aiFactory.ts')"` smoke check.
- `.env.example` — new env var documentation with security notes.

## Section 4 — Pending production work (in priority order)

### Must-do before launch

1. **Build the Flutter SMS-watcher app.**
   Use `PROMPT-flutter-bkash-watcher.md` in a fresh Claude chat session. The prompt is fully self-contained. Estimated build time: 4–8 hours of Claude-session time. Deliverable: a sideloadable APK that runs on the owner's phone, watches bKash SMS, parses them, HMAC-signs and POSTs to `/api/confirm-purchase`.
   - Match `BKASH_WEBHOOK_SECRET` on both sides (Flutter app's Settings tab + Vercel env).
   - Test end-to-end by sending yourself a small bKash payment.
2. **Harden the transaction flow against edge cases.**
   Use `PROMPT-transaction-flow-edge-cases.md` in a fresh Claude chat session. The prompt covers 20 edge cases (underpayment, overpayment, msisdn mismatch, orphan SMS, refunds, expiry, disputes, race conditions). Adds migration 006, ~12 new API endpoints, a `/admin` SPA, and a test suite. Estimated: a few days of work.
3. **Close the `refund_toolkit_credit` sibling exploit.**
   `refund_toolkit_credit()` is currently user-callable and increments by 1 unconditionally. A signed-in user can call `await supabase.rpc('refund_toolkit_credit')` from any browser console and self-grant 1 credit per call.
   **Fix shape**: refactor `/api/optimize.ts` to use `SUPABASE_SERVICE_ROLE_KEY` for the consume/refund calls instead of the user JWT, then add to the next migration:
   ```sql
   revoke execute on function refund_toolkit_credit, consume_toolkit_credit from authenticated, anon;
   ```
   Same model the bKash flow already uses for `confirm_purchase`.
4. **Delete dev mock scaffolding.**
   - Remove `api/dev-mock-confirm.ts`.
   - In `PurchaseModal.tsx`, delete the `mockConfirm()` function and the `if (MOCK_AUTOCONFIRM) { ... }` branch in `handleSubmit`.
   - Delete `VITE_BKASH_MOCK_AUTOCONFIRM` and `BKASH_MOCK_AUTOCONFIRM` from `.env`, `.env.example`, and Vercel.
   - Delete the matching locale keys: `purchaseModal.mockBadge`, `verifying`, `confirmedToast`.
   - On Vercel: ensure both `*_MOCK_AUTOCONFIRM` vars are unset for the Production environment specifically (the guards on the server endpoint check both flags).

### Should-do before scale

5. **Replace static credit-balance refetch with Supabase Realtime push.**
   Currently the dashboard re-fetches credit balance on every `loadData()` call. For a tighter pending → confirmed UX, subscribe to `profiles` UPDATE events filtered to `id = auth.uid()` via `supabase.channel(...).on('postgres_changes', ...)`. Then the dashboard credit pill updates the instant the webhook fires, without the user touching anything.
6. **Daily digest email for stuck purchases.**
   A cron job (Vercel cron or pg_cron) that emails the owner if any `purchases.status = 'pending'` row is > 12 h old. Helps catch Flutter-app downtime / phone-offline cases before customers complain. See `PROMPT-transaction-flow-edge-cases.md` §5 for the structure.

### Nice-to-have polish

7. **BD-market landing-page rewrite.** Currently has "FAANG", "series-B", `$120 / 60 min` consultant prices, and Indian/Western testimonial names. Replace with BD-relatable copy + BDT pricing. See `PHASE-1-REPORT.md` §d for the full punch list.
8. **`user_type` schema/domain mismatch.** `Resume.ts:3` says `'experienced' | 'student'`; `schema.sql:7` says `('student','professional')`. Pick one; either change the domain type to match schema, or write a migration that drops + re-adds the constraint to match the domain.
9. **ProfileScreen.tsx gradient.** Line 206 uses `bg-gradient-to-r from-brand-50 to-brand-100/60` — violates CLAUDE.md hard rule #3. Replace with `bg-brand-50`.
10. **Locale parity content gaps.** 5 keys in `bn.ts` are full English strings: `sectionSummary`, `sectionExperience`, `sectionProjects`, `sectionEducation`, `placeholderName`. They render in the resume preview chrome — Bengali users see English text.

## Section 5 — Verification protocol

Before declaring any change shipped:

```bash
# 1. Client-side build clean
npm run build

# 2. Server-side API code path imports cleanly. vite build only bundles
# client code; server-only files (api/_lib/aiFactory and the Gemini/Groq
# generators) are tree-shaken out, so a syntax error there passes
# `npm run build` undetected. This catches it.
node_modules/.bin/tsx -e "await import('./api/_lib/aiFactory.ts'); console.log('ok')"

# 3. Live smoke — these are the four AI endpoints; all should return 401 (auth
# required) NOT 500 (FUNCTION_INVOCATION_FAILED).
curl -s -X POST http://localhost:3000/api/optimize -d '{}' -H "Content-Type: application/json"
curl -s -X POST http://localhost:3000/api/optimize-general -d '{}' -H "Content-Type: application/json"
curl -s -X POST http://localhost:3000/api/extract-resume -d '{}' -H "Content-Type: application/json"
curl -s -X POST http://localhost:3000/api/toolkit-item -d '{}' -H "Content-Type: application/json"
```

For the bKash flow specifically, after running migration 005:

```bash
# Should now reject direct UPDATE of toolkit_credits:
curl -s -X PATCH "$VITE_SUPABASE_URL/rest/v1/profiles?id=eq.$YOUR_USER_ID" \
  -H "apikey: $VITE_SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $YOUR_JWT" \
  -H "Content-Type: application/json" \
  -d '{"toolkit_credits": 9999}'
# Expect: "permission denied for column toolkit_credits"
```

UI verification of the mock flow (dev mode):
- Sign in → credit pill shows `Buy generations` (0 credits).
- Click pill → modal shows `DEV MOCK MODE — AUTO-CONFIRMS IN ~3S` badge + the real bKash number from `VITE_BKASH_PAYMENT_NUMBER`.
- Paste any 6+ char TrxID → Submit.
- Watch state machine: Submitting… → Verifying bKash transaction… (3s) → modal closes.
- Credit pill updates to `5 generations remaining`.
- Verify in SQL editor: `select * from purchases order by created_at desc limit 1;` — `status` should be `'completed'`.

## Section 6 — Important quirks to know

### Vite env injection (the bug that bit us 2026-05-14)

Vite's `import.meta.env.X` substitution is **AST-pattern-based**. It only kicks in for the direct access form. These all defeat it and result in `undefined` at runtime:

```ts
// BROKEN — none of these work
const ENV = import.meta.env;
const x = ENV.VITE_FOO;

const ENV = (import.meta as any).env;
const x = ENV.VITE_FOO;

const ENV = (import.meta as unknown as { env?: ... })?.env ?? {};
const x = ENV.VITE_FOO;
```

Use the direct form ONLY:
```ts
const x = import.meta.env.VITE_FOO || 'fallback';
```

`src/vite-env.d.ts` already has `/// <reference types="vite/client" />` so TypeScript types `import.meta.env.VITE_*` cleanly with no cast.

### Two-call AI hot path

Initial generation runs exactly TWO concurrent Gemini calls:
- `optimizer` (resume bullets + skills + summary) — via Groq → Gemini fallback router.
- combined `GeminiToolkitGenerator` — cover letter + outreach + LinkedIn + interview Qs in one schema.

Per-item retries (via `/api/toolkit-item`) hit single-artifact generators and are FREE (no credit consumed). Free-tier RPM is the binding constraint; do NOT re-fan toolkit calls into N parallel ones.

### Credit-consume / refund design

On `/api/optimize`:
1. `consume_toolkit_credit()` runs FIRST (atomic decrement).
2. Then optimizer + toolkit in `Promise.allSettled`.
3. Optimizer rejects → call `refund_toolkit_credit()` so the user isn't charged for nothing.
4. Optimizer succeeds but toolkit rejects → credit KEPT (user got a resume; per-item retries are free).

### Brand constraints (do not violate)

- No gradients anywhere.
- No blue / indigo / purple. Palette: `brand-*` (warm near-black ink), `accent-*` (saffron gold), `charcoal-*` (warm stone neutrals).
- Wordmark is two words: "TOP" in `brand-700`, "CANDIDATE" in `accent-500`.
- No emojis in UI unless the user asked for them.

### Architecture layering

Clean architecture, dependencies flow inward: Presentation → Application (ResumeService) → Domain (interfaces) ← Infrastructure (Gemini/Supabase implementations). Domain depends on nothing. Presentation goes through `ResumeService`, never direct-imports a Gemini class.

## Section 7 — Open questions

When the human user opens the next session, these are the most likely things they'll want to do, in priority order:

1. **Build the Flutter app** — paste `PROMPT-flutter-bkash-watcher.md` into a fresh Claude session.
2. **Harden the transaction flow** — paste `PROMPT-transaction-flow-edge-cases.md` into another fresh Claude session.
3. **Commit + push** — there are uncommitted changes from the audit. Suggested commit boundaries:
   - `fix: close toolkit_credits exploit; bKash + Flutter SMS-watcher flow; cliché strip + BD-bucket fabrication guards`
   - `chore: audit findings + Flutter app prompt + transaction-flow prompt`
4. **Deploy to a Vercel preview** — verify env vars are scoped correctly (mock flags must be OFF on Production); confirm the flow works under real cold-start.
5. **Close the `refund_toolkit_credit` sibling exploit** when the Flutter app + edge-case work lands (same migration).

## Section 8 — Audit reports for reference

If you need the original audit findings:

- `PHASE-1-REPORT.md` — Five-area scoring (Privacy 3/5, AI prompt quality 2/5, ATS export 4/5, BD market fit 2/5, Failure handling 4/5). Pre-fix scores.
- `TOOLKIT-CRITIQUE.md` — Three live (persona × JD) deep-dives: Sumaiya / banking 4.87/5, Arif / garments→fintech 4.30/5 (BD-bucket fabrication guard fired correctly), Tasnim / NGO 4.76/5. Composite 4.64/5 post-fix.
- `EDGE-CASES.md` — 18 cases reviewed statically + live spot checks for credit-zero, gibberish reject, fabrication guard.
- `FINAL-REPORT.md` — Verdict + top-10 punch list + "if you fix 3" list.

## Quick reference — "what file is what" cheat sheet

```
Audit & handoff (you are here):
  topcandidate-audit-2026-05-08/SESSION-CONTEXT.md       ← THIS FILE
  topcandidate-audit-2026-05-08/PROMPT-flutter-bkash-watcher.md
  topcandidate-audit-2026-05-08/PROMPT-transaction-flow-edge-cases.md
  topcandidate-audit-2026-05-08/FINAL-REPORT.md
  topcandidate-audit-2026-05-08/PHASE-1-REPORT.md
  topcandidate-audit-2026-05-08/EDGE-CASES.md
  topcandidate-audit-2026-05-08/TOOLKIT-CRITIQUE.md
  topcandidate-audit-2026-05-08/generated-text/          ← live AI output samples

Canonical repo context:
  AGENTS.md                                              ← READ FIRST
  CLAUDE.md                                              ← hard rules
  README.md, DEPLOYING.md                                ← user-facing docs

Code modified in this audit:
  supabase/migrations/005_lock_toolkit_credits_and_bkash_pending.sql
  supabase/schema.sql
  api/purchase.ts                                        ← rewritten
  api/confirm-purchase.ts                                ← NEW (production webhook)
  api/dev-mock-confirm.ts                                ← NEW (dev only — delete pre-prod)
  src/infrastructure/api/purchaseClient.ts               ← rewritten
  src/presentation/components/PurchaseModal.tsx          ← rewritten (mock state machine)
  src/presentation/DashboardScreen.tsx                   ← onSuccess no-arg
  src/presentation/BuilderScreen.tsx                     ← onSuccess no-arg
  src/presentation/i18n/locales/en.ts                    ← bkash purchaseModal keys
  src/presentation/i18n/locales/bn.ts                    ← bkash purchaseModal keys
  src/infrastructure/ai/prompts/resumeOptimizerPrompts.ts ← P0 #2 fix + stripBannedCliches
  src/infrastructure/ai/prompts/toolkitContext.ts        ← P0 #3 fix (BD industry buckets)
  src/infrastructure/ai/GroqResumeOptimizer.ts           ← wired stripBannedCliches
  src/infrastructure/ai/GeminiResumeOptimizer.ts         ← wired stripBannedCliches
  AGENTS.md                                              ← updated §4, §8, §12, §13
  CLAUDE.md                                              ← updated verification protocol
  .env.example                                           ← new env vars + dev mock flags

Env vars that must be set for the bKash flow to work:
  SUPABASE_SERVICE_ROLE_KEY                              ← server-only
  BKASH_WEBHOOK_SECRET                                   ← server-only
  VITE_BKASH_PAYMENT_NUMBER                              ← client (your bKash number)
  VITE_BKASH_MOCK_AUTOCONFIRM=true   (DEV ONLY)
  BKASH_MOCK_AUTOCONFIRM=true        (DEV ONLY)
```
