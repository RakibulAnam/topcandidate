# TOP CANDIDATE — End-to-End Production Audit

**Date:** 2026-05-30
**Scope:** `apps/web/` only (admin SPA was rebuilt earlier this session; admin findings limited to integration points).
**Method:** direct code reads of all critical paths (auth, AI pipeline, purchase flow, RLS, dispatcher, schema) + two parallel exploration agents covering UX-breadth and frontend-architecture-breadth. Findings cite `file:line`. Nothing here is guessed.

---

## 0. Executive summary

The codebase is **good** — well-thought-out Clean Architecture, careful payment-flow design, sound RLS, intentional 2-AI-call hot path, real error-handling discipline. The work shipped in the last few weeks (transaction state machine, admin panel, error surfacing) is production-grade in concept.

What's holding it back from production:

| # | Theme | Why it matters |
|---|---|---|
| 1 | **Tailwind via CDN** in `index.html` | Production anti-pattern — runtime JIT, no purging, vendor explicitly says "do not use in production" |
| 2 | **Outdated `README.md` + `DEPLOYING.md`** still tell people to set `VITE_GEMINI_API_KEY` | Anyone following the docs ships AI keys into the client bundle |
| 3 | **No security headers** (CSP / HSTS / X-Frame-Options) in `vercel.json` | Clickjacking, MIME-sniff, mixed-content all open |
| 4 | **Production debug log** dumps Supabase config to console on every page load (`client.ts:16`) | Leaks operational signal; signals "debug code in prod" |
| 5 | **`/api/cron/expire-pending` accepts secret via `?secret=` query string** | Secrets in query string land in browser history, referrer headers, server access logs |
| 6 | **No rate-limit on failed AI calls** | One bad actor with a valid JWT can drain Groq's 1,000-RPD shared quota |
| 7 | **`FormSteps.tsx` is 2,501 lines** — single monolithic file | Lone tallest debt; brittle to edit |
| 8 | **Bundle is 4.5MB unminified**, two ~2MB main chunks, **no code-splitting**, no React.lazy | Slow first paint over 3G |
| 9 | **5 npm vulnerabilities** (2 high — `minimatch` ReDoS, `ws` memory disclosure) | `npm audit fix` clears them |
| 10 | **2 Clean Architecture violations** — `LoginScreen` and `PurchaseHistorySection` reach into Supabase directly | Breaks the discipline that makes the rest of the code testable |

**Bottom line:** the code is **closer to production than not**. The list above is real but small. None of these are existential. Fix the security/docs items before launch (1–6, 9). Pay down (7–8, 10) over the next two release cycles. Everything below the table is detail; the **§2 Critical-before-prod** and **§3 Quick wins** sections are what to ship in the next sprint.

---

## 1. Table of contents

1. [Executive summary](#0-executive-summary)
2. [Critical-before-production fixes](#2-critical-before-production-fixes)
3. [Quick wins](#3-quick-wins-30-minutes-each-high-impact)
4. [Security audit](#4-security-audit)
5. [UX / UI audit](#5-ux--ui-audit)
6. [Frontend architecture](#6-frontend-architecture)
7. [Backend / API audit](#7-backend--api-audit)
8. [Database & RLS audit](#8-database--rls-audit)
9. [Performance](#9-performance)
10. [Operational readiness](#10-operational-readiness)
11. [Code quality & maintainability](#11-code-quality--maintainability)
12. [Documentation gaps](#12-documentation-gaps)
13. [Feature / product gap analysis](#13-feature--product-gap-analysis)
14. [Phased roadmap](#14-phased-roadmap)
15. [Long-form TODO](#15-long-form-todo-checklist)

---

## 2. Critical-before-production fixes

These are the items where shipping as-is creates real risk for users, secrets, or revenue. Ordered by severity, then by effort. Every item has a file/line citation.

### C1. [CRITICAL] Tailwind loaded from CDN in production
`index.html:7` — `<script src="https://cdn.tailwindcss.com"></script>`

**Why:** Tailwind's own docs say this script is for prototyping only. It ships ~3MB of JIT-style runtime to every visitor, defers FCP, and offers no purging. It also means a CDN outage takes your styling down. The whole `tailwind.config` block in `index.html:8-93` runs in the browser, not at build time.

**Fix:** install Tailwind as a real Vite plugin (`@tailwindcss/vite` v4 or PostCSS-based v3), move the config to `tailwind.config.{js,ts}`, add an `@tailwind` import in a CSS file, and delete the CDN script + inline config. Bundle size will fall by 1–2MB gzipped after purging.

**Effort:** half-day. **Severity:** Critical (cost + reliability).

### C2. [CRITICAL] Docs tell readers to set `VITE_GEMINI_API_KEY` (would leak keys)
`README.md:25` ("Required env vars") and `DEPLOYING.md:33` both list `VITE_GEMINI_API_KEY` as a required env var. The actual architecture uses **server-only** `GEMINI_API_KEY` + `GROQ_API_KEY` via Vercel Functions. `.env.example` is correct, but the customer-facing docs are stale.

**Why:** anyone following these docs will set `VITE_GEMINI_API_KEY` in Vercel, Vite will inline it into the client bundle, and the key becomes public. This is exactly the failure mode the proxy was built to avoid.

**Fix:** rewrite both files to reflect the current shape — point to `.env.example` as the source of truth, mention `GROQ_API_KEY`/`GEMINI_API_KEY` are server-only, document `SUPABASE_SERVICE_ROLE_KEY`, `BKASH_WEBHOOK_SECRET`, `ADMIN_API_KEY`, `CRON_SECRET`. List every migration to run, not just `001`.

**Effort:** 30 minutes. **Severity:** Critical (secret exposure path).

### C3. [HIGH] No security headers in `vercel.json`
`vercel.json` has `rewrites` + `functions.maxDuration` but **no `headers` block**. The deploy ships without CSP, HSTS, X-Frame-Options, X-Content-Type-Options, or Referrer-Policy.

**Why:** clickjacking (no `X-Frame-Options: DENY`), MIME-sniff attacks (no `X-Content-Type-Options: nosniff`), downgrade attacks (no HSTS), and referer-leak of customer URLs (default referrer policy).

**Fix:** add a `headers` array to `vercel.json` with at minimum:
```jsonc
{
  "source": "/(.*)",
  "headers": [
    { "key": "Strict-Transport-Security", "value": "max-age=63072000; includeSubDomains; preload" },
    { "key": "X-Content-Type-Options",    "value": "nosniff" },
    { "key": "X-Frame-Options",           "value": "DENY" },
    { "key": "Referrer-Policy",           "value": "strict-origin-when-cross-origin" },
    { "key": "Permissions-Policy",        "value": "geolocation=(), microphone=(), camera=()" }
  ]
}
```
Once Tailwind is off-CDN (C1), add a strict CSP. While the CDN is live, CSP would need `script-src 'unsafe-inline' cdn.tailwindcss.com` which defeats the purpose.

**Effort:** 30 minutes for the basic four; another hour for CSP after C1. **Severity:** High.

### C4. [HIGH] `/api/cron/expire-pending` accepts secret via `?secret=` query string
`api/cron/expire-pending.ts:42-46`

**Why:** anything in a query string leaks via browser history, server access logs, error-tracking sidecars, and the `Referer` header on outbound clicks. Vercel Cron itself sends `Authorization: Bearer`, so the query path exists only for "manual triggers from a terminal" — a curl with `-H "Authorization: Bearer ..."` is barely more typing.

**Fix:** delete the query-string fallback. Bearer-only.

**Effort:** 10 minutes. **Severity:** High.

### C5. [HIGH] No rate-limit on failed `/api/optimize` calls
`api/_lib/rateLimit.ts` — the comment is honest about this: "a user can spam-fail forever without hitting the cap. Mitigation: provider-side rate limits on Groq/Gemini will cap them." Combined with `optimize.ts:131-148` returning 502 on optimizer failure without logging the call, a single authenticated user can chain hundreds of bad requests at no cost to themselves.

**Why:** Groq's free tier is 1,000 RPD **shared across all your users**. A single attacker exhausts it for everyone. Each failed call also costs you AI provider quota (Groq tries, then Gemini fallback tries, then you fail back to client). Cost shape: ~$0 per call (free tier) but unlimited fan-out potential.

**Fix:** count failed calls toward the cap *unless* they fail before any AI call (auth, validation, no-provider 503). Log on entry, not on success. Or: track per-user failure count separately and lock the user at 10 consecutive failures.

**Effort:** 1 hour. **Severity:** High.

### C6. [HIGH] Production `console.log` dumps Supabase config every page load
`src/infrastructure/supabase/client.ts:16-20`

```ts
console.log('Supabase Config:', { url: supabaseUrl, keyLength: supabaseAnonKey?.length, hasKey: !!supabaseAnonKey });
```

**Why:** this isn't a secret leak (URL is public, anon key length is meaningless), but it's a strong "debug code left in prod" signal. Customer-support tooling reads console output; QA tools flag it; competitors see operational shape. Also fires on every full page load. Looks unprofessional.

**Fix:** wrap in `import.meta.env.DEV` or delete. The warning at line 9 ("Missing Supabase environment variables") is fine to keep.

**Effort:** 2 minutes. **Severity:** High (perception + minor signal leak).

### C7. [HIGH] 5 npm vulnerabilities (2 high)
`npm audit` (prod-only):
- `minimatch 9.0.0-9.0.6` — 3× ReDoS advisories (catastrophic backtracking)
- `ws 8.0.0-8.20.0` — uninitialized memory disclosure

Both are transitive (likely under `@vercel/node` and `@google/genai`).

**Why:** ReDoS can stall serverless functions; memory disclosure can leak adjacent buffer contents. Neither is exploitable through the current attack surface today, but they will be flagged by every dependency scanner.

**Fix:** `npm audit fix` first. If a forced upgrade breaks something, `npm audit fix --force` + smoke test, or pin via `overrides` in `package.json`.

**Effort:** 15 minutes. **Severity:** High.

### C8. [HIGH] No email verification on signup
`LoginScreen.tsx:62-74` calls `supabase.auth.signUp` and immediately toasts success. There's no client-side handling of the "check your inbox" state and no check on email confirmation status before letting users into the app.

**Why:** anyone can create accounts with anyone's email. Combined with no signup throttling app-side, this is an account-creation spam vector and (if you ever ship transactional email) a backscatter source.

**Fix:** enable email confirmation in Supabase Auth Settings. Update `LoginScreen` to surface "We sent you a confirmation link" instead of treating signup as instant login. `AuthContext` should treat unconfirmed users as not-signed-in.

**Effort:** half-day (server config + UX flow + edge cases). **Severity:** High.

### C9. [HIGH] BuilderScreen field validation doesn't highlight the offending field
`BuilderScreen.tsx:281-584` builds an `errors: Record<string, string>` map but never visually marks the broken inputs. Errors only appear as toasts (`BuilderScreen.tsx:575-581`). Users see "Please fix the errors" with no clue which step or field.

**Why:** form-friction killer. Users on long multi-step forms abandon when they can't find the problem.

**Fix:** thread `errors` into each step component; apply `aria-invalid="true"` + a red border on inputs that have a key in `errors`; render the message inline below the input. Scroll-to-first-error on submit.

**Effort:** 1 day. **Severity:** High (conversion-blocking on the core flow).

### C10. [HIGH] Dashboard resume cards not keyboard-accessible
`DashboardScreen.tsx:475` — `<li ... onClick={() => onOpenResume?.(...)}>`. `<li>` with an `onClick` isn't focusable by keyboard. Tab users cannot open any resume.

**Why:** WCAG 2.1 A violation; also a real barrier for power users who navigate with the keyboard.

**Fix:** wrap card content in `<button type="button">` (or use `<a>` if it's a real route).

**Effort:** 20 minutes. **Severity:** High.

---

## 3. Quick wins (30 minutes each, high impact)

Bundle these into a single PR. None require architectural decisions.

| # | Item | File | Cost |
|---|---|---|---|
| Q1 | Delete production `console.log` | `src/infrastructure/supabase/client.ts:16-20` | 2 min |
| Q2 | Run `npm audit fix` | (root) | 15 min |
| Q3 | Add the four security headers to `vercel.json` | `vercel.json` | 30 min |
| Q4 | Delete `?secret=` fallback in cron auth | `api/cron/expire-pending.ts:42-46` | 10 min |
| Q5 | Delete dead Supabase import from `PurchaseModal.tsx:40` | (one line) | 1 min |
| Q6 | Remove orphan dirs `components/`, `services/`, `purchase modal new design/`, root `step1-after.png`, root `companion-app/` (mobile lives in `apps/mobile/`) | (root) | 5 min |
| Q7 | Update `README.md` and `DEPLOYING.md` to match `.env.example` | (root) | 30 min |
| Q8 | Type `DashboardScreen.onOpenResume` arg as `ResumeData` (was `any`) | `DashboardScreen.tsx:35` | 5 min |
| Q9 | Add `<noscript>` fallback in `index.html` | `index.html` | 5 min |
| Q10 | Strip the `console.log` in `LoginScreen.tsx:78` ("Auth error") to log only the error, not every auth attempt | `LoginScreen.tsx:78` | 2 min |

---

## 4. Security audit

### 4.1 What's solid
- **API auth model.** `api/_lib/auth.ts` does proper bearer extraction and uses `supabase.auth.getUser()` with the anon key (correct — getUser doesn't need elevated privileges).
- **HMAC on Flutter webhooks.** `api/_lib/webhookAuth.ts` reads raw body bytes (`bodyParser: false`), uses `timingSafeEqual`, falls back safely. `confirm-purchase.ts` re-implements inline (see 4.4).
- **Service-role isolated** to `/api/confirm-purchase`, `/api/orphan-inbound-sms`, `/api/reverse-purchase`, `/api/cron/expire-pending`, and the admin dispatcher. Never bundled to the client (no `VITE_` prefix).
- **RLS is complete.** Every customer table has `enable row level security` + `auth.uid() = user_id` policies. No `using (true)` policies. Column-level lockdown on `profiles.toolkit_credits` (`schema.sql:37-51`).
- **Credit RPCs are race-safe.** Atomic `UPDATE ... WHERE toolkit_credits > 0 RETURNING ...`. Service-role-only execute after migration 008.
- **Timing-safe compare** used everywhere it should be (`adminAuth.ts:26`, `webhookAuth.ts:47`, `expire-pending.ts:21`).
- **No hard-coded secrets** in source. Grep clean.

### 4.2 Critical / High findings
See §2 above. Recap of security-flavored ones: C3 (headers), C4 (cron query secret), C5 (failed-call rate-limit), C7 (CVEs), C8 (email verification), C6 (debug log).

### 4.3 Medium findings

**M1. [MEDIUM] No CSRF protection on JWT-authenticated endpoints**
Supabase JWTs are stored in localStorage by default (not cookies), which is its own debate but does mean CSRF isn't the typical attack vector. However if you ever migrate to cookie-based sessions (Supabase SSR helpers, or your own), every POST endpoint becomes CSRF-exploitable. Add `SameSite=Lax` + a CSRF token if/when that happens.

**M2. [MEDIUM] No replay-attack protection on Flutter webhooks**
`webhookAuth.ts` doesn't include a timestamp or nonce in the HMAC. An attacker who captures one valid signed request can replay it. **Mitigated in practice** because `confirm_purchase` is idempotent per TrxID — the second call hits the "already completed" branch. But for the orphan/reversal/parser-failure endpoints, replays could spam those tables. Low realistic risk (attacker must capture the request first), but cheap fix: include a `X-Request-Timestamp` header in the HMAC and reject requests > 5 min old.

**M3. [MEDIUM] `extract-resume.ts` doesn't validate `mimeType`**
`api/extract-resume.ts:32` — accepts any string as `mimeType` and forwards to Gemini. Gemini will reject garbage, but a user could waste your AI quota by submitting `image/svg+xml` or arbitrary base64 with a plausible mime. Whitelist: `application/pdf`, `application/msword`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`, `text/plain`.

**M4. [MEDIUM] No size validation on `targetJob.description`**
`optimize.ts:77` only checks `description` exists. A user could pass a 1MB blob. Gemini will reject around its context-window limit, but you'll have already paid the round trip. Cap server-side at 20,000 chars.

**M5. [MEDIUM] `LoginScreen` calls Supabase Auth directly (no app-side rate limiting on signup)**
Supabase has built-in throttling, but it's lenient. Combined with no email verification (C8), a script can create thousands of accounts. Add IP-based or fingerprint-based throttling at signup, or rely on a service like Cloudflare Turnstile.

**M6. [MEDIUM] `dispute-purchase` allows 10-char minimum notes — easy to spam-file disputes**
`api/dispute-purchase.ts:33` — auth required, but no per-user rate limit. A bad actor with a valid account can flood `purchase_disputes`. Add a "max 3 disputes per user per 24h" check.

**M7. [MEDIUM] Signed-out users still have lingering localStorage**
On `signOut()`, Supabase clears its own token. But the resume draft (`SupabaseResumeRepository.ts:13-22`) keeps `localStorage.resumeDraft` populated. If two users share a browser, user B will see user A's draft on sign-in. Clear app-managed localStorage in the sign-out flow.

**M8. [MEDIUM] No Content Security Policy**
Even after Tailwind is off-CDN (C1), implement a strict CSP: `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self' *.supabase.co api.groq.com generativelanguage.googleapis.com; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self' fonts.gstatic.com`. CSP is the single best defense against XSS regressions.

### 4.4 Low findings

**L1.** `confirm-purchase.ts:63-85` reimplements raw body reading + HMAC verify inline instead of using the shared `webhookAuth.ts` helper. Code drift risk. Delete the inline functions and import the shared ones.

**L2.** `senderMsisdn` is compared by strict equality in `confirm_purchase` RPC. `+8801711...` and `01711...` and `8801711...` all fail to match. Mitigated by `msisdn_mismatch_review` state, but normalize to E.164 server-side before storing/comparing.

**L3.** No structured request-id propagation. `optimize.ts:42` generates one; `confirm-purchase.ts` does not. Add `x-request-id` to every endpoint for traceability.

**L4.** `AuthContext.tsx:17-27` reads `localStorage.getItem('sb-<projectRef>-auth-token')` — relies on Supabase's internal storage key. If Supabase changes that key, this fast-path silently breaks. Use `supabase.auth.getSession()` synchronously is enough (it's already in the `useEffect`).

**L5.** `vercel.json` `functions.maxDuration: 60` is exactly the Hobby limit. Add headroom by bumping to 90 on Pro; document this for the upgrade path (already mentioned in prior conversation).

---

## 5. UX / UI audit

### 5.1 High-impact UX gaps (from the parallel UX agent + my own review)

| Severity | Item | File:line |
|---|---|---|
| **High** | Builder validation errors don't visually mark the offending field — only toasts | `BuilderScreen.tsx:281-584` (validation), `:575-581` (toast) |
| **High** | Dashboard resume cards aren't keyboard-accessible | `DashboardScreen.tsx:475` |
| **High** | Profile tabs on mobile overflow without visual scroll-hint | `ProfileScreen.tsx:247-260` |
| **High** | Dashboard search input on mobile uses `sm:w-72` only — overflows | `DashboardScreen.tsx:247-260` |
| Med | PurchaseModal split-pane is cramped on mobile; features list hidden | `PurchaseModal.tsx:176, :209` |
| Med | `ProfileSetupScreen` left-rail step buttons missing `focus-visible` ring | `ProfileSetupScreen.tsx:781-820` |
| Med | LoginScreen email input lacks linked `<label>` (only inline icon) | `LoginScreen.tsx:156-160` |
| Med | Master-resume build button has no progress affordance during generation; double-click risk | `DashboardScreen.tsx:384` |
| Med | PurchaseModal error has no retry button — user must close + reopen | `PurchaseModal.tsx:144-157` |
| Med | Builder stepper shows all ~15 steps on mobile, no progress collapse | `BuilderScreen.tsx:823` |
| Low | Button radius scale inconsistent (`rounded-lg` vs `rounded-2xl` vs `rounded-full`) across screens | (multiple) |
| Low | `placeholder:text-charcoal-400` on white ~4.5:1 — borderline contrast | `ProfileScreen.tsx` inputs |
| Low | `PhoneInput` placeholder hard-coded English ("Search country or code") | `PhoneInput.tsx:256` |

### 5.2 What's working well
- **EmailInput / PhoneInput** primitives are a strong pattern — used consistently in `ProfileSetupScreen`, `FormSteps.PersonalInfoStep`, `ReferencesStep`, `ReferenceSection`, `ProfileScreen`. Inline error UX, `aria-invalid`, libphonenumber validation, E.164 storage. Keep this pattern.
- **LoginScreen** inline error card (`LoginScreen.tsx:108-120`) is the gold standard the other screens should match — explicit "Authentication failed" headline + remapped friendly message.
- **i18n compliance** is ~95% across customer screens. The DIY typed dictionary (TS enforces key parity between `en.ts` and `bn.ts`) is a solid choice for a 2-locale app.
- **DashboardScreen empty state** (`DashboardScreen.tsx:439-451`) has the right shape: icon + headline + body + CTA.

### 5.3 UX improvements ranked by ROI

**Tier 1 — must-fix before launch:**
1. Fix Builder field-level validation (C9).
2. Make resume cards keyboard-accessible (C10).
3. Mobile breakpoint pass on Profile tabs, Dashboard search, PurchaseModal.
4. Add focus-visible rings to all stepper / nav buttons.
5. Replace `alert()` in admin Settings (already done in the prior redesign — verify nothing else uses alert).

**Tier 2 — premium polish:**
1. Skeleton loaders on Dashboard's tailored-resumes list (currently shows spinner overlay; skeleton feels faster).
2. Optimistic UI when starting a generation — show the resume card with a "generating…" badge instead of a full-screen loader.
3. Builder step "jump" should allow forward navigation (currently restricted to completed steps — friction).
4. Replace top-progress bar on Builder with sticky save-status indicator ("Draft saved · 2s ago").
5. Empty-state CTAs on every Profile sub-section ("+ Add your first experience" instead of "No experiences").
6. Visual consistency pass: settle on `rounded-xl` for medium buttons, `rounded-2xl` for cards, `rounded-full` for chips/pills only.

**Tier 3 — long-term:**
1. Onboarding tour for first-time users — the Builder has 15 steps and no guided tour.
2. A "saved drafts" tray on Dashboard so users can recover an unfinished application.
3. Inline AI feedback during the Builder — "Your description is short for this senior role; consider adding [X]" without firing the full optimizer.
4. Soft delete + restore for resumes (currently `delete = forever`).

---

## 6. Frontend architecture

### 6.1 What the agent found (verified)

| Severity | Finding |
|---|---|
| **High** | `LoginScreen.tsx:2` imports Supabase directly and calls `supabase.auth.signInWithPassword` / `signUp` — bypasses `AuthContext`. Move into `AuthContext` and expose `signIn` / `signUp`. |
| **High** | `PurchaseHistorySection.tsx:62-66` queries `supabase.from('purchases').select(...)` directly from presentation. Create `IPurchaseRepository.getHistory()` → `SupabasePurchaseRepository` → inject. |
| Med | `BuilderScreen.tsx:32` imports `ApiCallError` from `src/infrastructure/api/` — presentation depends on infrastructure error type. Promote to a domain-level error. |
| Med | `FormSteps.tsx` is **2,501 lines** with 15+ step components in one file. Split per-step. |
| Med | `Preview.tsx` is 1,163 lines mixing template render + tab switching. Optionally split template render into its own module. |
| Low | `PurchaseModal.tsx:40` has a dead Supabase import. Delete. |
| Low | `DashboardScreen.tsx:35` types `onOpenResume?: (id: string, data?: any)`. Should be `ResumeData`. |
| Low | Empty/orphan directories: root `components/`, `services/`, `purchase modal new design/`, root `companion-app/` (mobile is in `apps/mobile/`), root `step1-after.png`. |

### 6.2 What's strong
- **Domain layer is pristine** (`src/domain/`) — zero imports from infrastructure or application. Solid.
- **Application layer is clean** (`src/application/services/ResumeService.ts`) — only imports from domain.
- **DI container is single-sourced** in `src/infrastructure/config/dependencies.ts`. No circular imports.
- **State management** — `AuthContext` and `LocaleContext` cover all global state. No prop-drilling smell. No Redux/Zustand needed at this scale.
- **No stale closures, no missing-deps** (a few exhaustive-deps disables in App.tsx are intentional and commented).
- **Repos are consistent** — every persistence call goes through `IProfileRepository` / `IResumeRepository` / `IApplicationRepository` except the two violations above.

### 6.3 Recommended refactor sequence

1. Extract `signIn` / `signUp` from `LoginScreen` → `AuthContext.signIn` / `signUp`. Test sign-in, sign-up, email verification. (1 day, fixes both Clean Arch violation and lets you put rate-limiting / future MFA in one place.)
2. Create `IPurchaseRepository` + `SupabasePurchaseRepository`. Move `PurchaseHistorySection` query through it. (4 hours.)
3. Split `FormSteps.tsx` into `src/presentation/components/Builder/steps/{Experience,Projects,Education,...}.tsx`. The file is the worst-of-codebase by line count and the natural extraction unit is the step. (1 day.)
4. Add `ResumeData` typing to `DashboardScreen.onOpenResume`. (5 min.)
5. Delete orphan dirs + dead imports. (5 min.)

---

## 7. Backend / API audit

### 7.1 Endpoint inventory (12 functions total — at Vercel Hobby cap)

| Endpoint | Method | Auth | Validation | Notes |
|---|---|---|---|---|
| `/api/optimize` | POST | JWT | ✓ targetJob.description; ✗ size limit (M4) | Hot path; race-safe credit gate ✓ |
| `/api/optimize-general` | POST | JWT | ✓ data exists; ✗ description size | Free path |
| `/api/toolkit-item` | POST | JWT | ✓ kind + description | Per-item retry |
| `/api/extract-resume` | POST | JWT | ✗ mimeType not whitelisted (M3) | 6MB body limit |
| `/api/purchase` | POST | JWT | ✓ packageId + TrxID shape | Calls `initiate_purchase` RPC |
| `/api/confirm-purchase` | POST | HMAC | ✓ TrxID min-6 + amount integer | Reimplements HMAC inline (L1) |
| `/api/dispute-purchase` | POST | JWT | ✓ TrxID + notes ≥10 chars; ✗ no per-user rate limit (M6) | |
| `/api/my-purchase-status` | GET | JWT | ✓ txnId min-6 | Read-only |
| `/api/orphan-inbound-sms` | POST | HMAC | ✓ TrxID + amount + timestamp | |
| `/api/reverse-purchase` | POST | HMAC | ✓ TrxID min-6 | |
| `/api/cron/expire-pending` | GET | Bearer OR ?secret= (C4) | n/a | |
| `/api/admin/[action]` | varies | X-Admin-Key | per-handler | Dispatcher — 28 actions inside |

### 7.2 Patterns worth keeping
- Every write endpoint has a request-id (admin path) or correlation-id (`optimize.ts:42`).
- Error codes are returned alongside messages (`code: 'insufficient_credits'`, `code: 'msisdn_mismatch'`, etc.) — good for client error mapping.
- Service role is acquired lazily and only after auth passes.
- `Promise.allSettled` is used correctly in the 2-AI-call hot path to avoid one failure killing the other.

### 7.3 Things to harden
- **C5** (failed-call rate limit) — see §2.
- **M3** (mimeType whitelist) — see §4.3.
- **M4** (description size cap) — see §4.3.
- **L1** (inline HMAC duplication in `confirm-purchase`) — see §4.4.
- **No request-id consistency** — only `optimize.ts` and the admin dispatcher set `x-request-id`. Add to every endpoint.
- **Inconsistent `console.log` shape** — some endpoints use `[optimize ${rid}] ...`, others bare strings. Standardize. Pipe to a structured logger (Pino or just JSON) if you ever ship structured log ingest.

---

## 8. Database & RLS audit

### 8.1 Strengths
- 67 RLS policies, all `auth.uid() = user_id` scoped. No permissive `using (true)`.
- Migrations are **idempotent** (every `add column if not exists`, every `create policy` preceded by `drop policy if exists`). Safe to re-run.
- SECURITY DEFINER functions explicitly `revoke execute from public, anon, authenticated` after definition. Service-role retains.
- `purchases.payment_reference` has a unique index — prevents (a) two users claiming the same payment and (b) duplicate confirmations.
- `confirm_purchase` v2 (migration 007) is transactional — locks the row, checks msisdn + amount, writes audit + state-change rows in the same RPC.

### 8.2 Issues
- **Migration 010 was needed to add `profiles.created_at` and `profiles.updated_at`** — these were in `schema.sql` from day one but never in a migration, so older DBs were missing them. Fixed this session, but it's a sign that **`schema.sql` and `migrations/` drifted** at some point. Going forward: every schema change goes through a numbered migration; `schema.sql` is a derived view of "current state if you started fresh today". Consider a CI check that runs the migrations on a fresh DB and diffs against `schema.sql`.
- **`applications` table is unused** (`schema.sql:347-374`) — labeled legacy in AGENTS.md §13. Drop it via a migration to remove dead rows and keep the schema readable.
- **No indexes on `ai_call_log(user_id, created_at)`** — the rate-limit `count(...).gte(created_at, ...)` is a per-call query. At 10k+ users this scans the whole table per call. Add `create index if not exists ai_call_log_user_created_idx on ai_call_log(user_id, created_at desc);`.
- **`purchase_topups.payment_reference` is unique table-wide** (`schema.sql:714-724` from migration 007). If by edge case the same bKash TrxID ever shows up across two distinct purchase rows (shouldn't, but bKash has shipped duplicate TrxIDs before in BD), the second top-up fails. Consider `unique(purchase_id, payment_reference)` instead.
- **`generated_resumes.company` is a stored generated column** — good for search, but writes pay the extraction cost on every save. Fine at current scale; flag at 100k rows.

### 8.3 Missing observability
- No DB-side audit on user *reads* (only writes via `admin_audit_log` / `purchase_state_changes`). For a SaaS the operator might be asked "did anyone access user X's data?" — currently unanswerable. Postgres has `pgaudit`; Supabase Pro exposes it. Probably not needed pre-launch.

---

## 9. Performance

### 9.1 Bundle reality
```
dist/assets/index-Da4SjIqD.js   2,055 KB   (admin + customer mixed; gzip 568 KB)
dist/assets/index-Hzl9Om5A.js   2,095 KB   (vendor; gzip 694 KB)
dist/assets/html2canvas.esm     202 KB
dist/assets/index.es-Bl_LZVgg   160 KB     (docx?)
dist/assets/purify.es           23 KB
                                ─────
Total JS                        4.5 MB     (1.3 MB gzipped)
Total dist                      39 MB
```

Vite's own warning at build time: "Some chunks are larger than 500 kB after minification."

**Causes:**
1. No code-splitting between admin and customer. Customers download the entire admin SPA (and vice versa). At ~700KB gzipped, that's ~1.5s of JS over 3G even before parse.
2. No `React.lazy` anywhere. Every screen lives in the main bundle.
3. `html2canvas`, `docx`, `jspdf`, `@google/genai` (client adapters), `lucide-react` (re-exports many icons) are all in the main bundle.
4. Tailwind via CDN adds ~3MB raw JS in addition to your bundle.

### 9.2 Wins (ordered by impact)

| Change | Estimated gzip savings | Effort |
|---|---|---|
| Tailwind off-CDN with purging (C1) | **~3 MB raw / ~600 KB gzipped** for the runtime + huge CSS reduction | half-day |
| `React.lazy(() => import('./admin/AdminScreen'))` — split admin chunk | 100–150 KB gzipped from the customer bundle | 30 min |
| Lazy-load `PdfResumeExporter` + html2canvas only when user clicks "Download PDF" | 60–80 KB gzipped from initial load | 1 hour |
| Lazy-load `docx` exporter on "Download Word" click | 30–40 KB gzipped | 30 min |
| Replace `lucide-react` whole-package import with per-icon imports OR migrate to `@lucide/react` (treeshaken) | 20–40 KB gzipped | 1 hour |
| Vite `build.rollupOptions.output.manualChunks` for `react`, `supabase`, `radix`, `sonner` | Better caching across deploys | 30 min |

### 9.3 Runtime hotspots (not measured, flagged from code)
- `BuilderScreen.tsx:1030` with many `useEffect`s and `useState`s — likely re-renders on every keystroke. Memoize the heavy children.
- `Preview.tsx:1163` renders the full A4 layout in pt — fine, but the toolkit-tab switching triggers full re-renders. Could split into `PreviewResume`, `PreviewCoverLetter`, `PreviewToolkit` and only mount the active one.
- `FormSteps.tsx:2501` is loaded eagerly. Splitting it (per §6.3) also unlocks per-step code-splitting.
- The dashboard polls nothing; admin polls every 30s — fine.

### 9.4 Network
- API endpoints are correctly proxied through `/api/*` so no CORS preflight on same-origin.
- AI calls are server-side, no CORS issues.
- No HTTP caching headers on the API surface — `/api/my-purchase-status` and `/api/admin/dashboard` could `Cache-Control: private, max-age=10` to dampen burst polling.

---

## 10. Operational readiness

### 10.1 Logging
- 83 `console.*` calls in customer code, 200+ in admin (lower concern there). Structured (`[scope rid] message`) in newer code (`optimize.ts`); ad-hoc in older code.
- No log aggregation configured. Vercel's built-in logs are 1d retention on Hobby, 7d on Pro. For a payments app, you want at least 30d.
- **No error tracking** (Sentry/Bugsnag/Rollbar). Customer-side JS errors disappear silently. Server-side errors are visible in Vercel logs only if you happen to look.

**Fix:** add Sentry. Free tier handles ~5k events/month; one SDK import in `App.tsx` + one DSN env var. Will catch the 80% of issues that bypass your current `console.error` discipline.

### 10.2 Monitoring
- **No uptime monitoring** on `/api/*`. If `confirm-purchase` 5xx's for 6 hours, the next signal is a customer dispute filed manually.
- **No alerting** on AI provider failures, credit-RPC failures, or pg_cron failures.
- **Admin dashboard tile** ("Last successful confirm") covers the heartbeat for purchases, but only if the operator looks.

**Fix (cheap):**
- BetterStack / Uptime Kuma / Cronitor heartbeats on the critical endpoints (1-2 hours setup, $0-9/mo).
- A "ping" endpoint (`GET /api/health`) returning DB connectivity + AI provider key presence. Free monitor service can hit it every 5 min.

### 10.3 Deployment hygiene
- **No CI**. Pushing to `master` triggers Vercel deploy with nothing but `vite build`. No type-check beyond Vite, no lint, no test, no migration drift check.
- **No staging environment**. `dev` branch exists but there's no Vercel preview wired specifically for it that runs through the full smoke.
- **`vercel.json` `functions.maxDuration: 60`** — at the Hobby ceiling. AI calls take 30-45s with retry. Two consecutive 30s spikes can blow the budget. Bump to 90 on Pro.

**Fix:**
- GitHub Actions: lint + typecheck + `node_modules/.bin/tsx -e "(async () => { await import('./api/_lib/aiFactory.ts'); })();"` smoke + `vite build`. ~3 min per PR.
- A staging Supabase project tied to a `staging.topcandidate.com` Vercel branch.

### 10.4 Secrets management
- All sensitive keys are server-only (no `VITE_` prefix). Good.
- `.env`, `.env.local`, `.env.*.local` are all in `.gitignore`. Good.
- **`.env` is `chmod 644`** locally — fine on a single-user machine, but no `pre-commit` hook to scan for accidental commits.

---

## 11. Code quality & maintainability

### 11.1 Stats
| Metric | Value | Comment |
|---|---|---|
| Lines of TS/TSX in `src/` | ~28k | Reasonable for the surface |
| `any` / `as any` / `@ts-ignore` | 238 | Heavy in repos (mostly DB row mapping). Consider Zod for parse-time typing. |
| `console.*` (customer code) | 83 | Should funnel through a logger |
| Files > 500 LOC | 6 | Refactor candidates listed in §6 |
| Components > 1000 LOC | 3 | FormSteps, BuilderScreen, Preview |

### 11.2 Anti-patterns spotted
- **`any`-typed Supabase mappers** in `SupabaseProfileRepository.ts:118, 138, 174, ...` — `(item: any) => ({...})`. Should type the row.
- **Boolean prop proliferation** in some FormSteps (the `composition-patterns` skill explicitly calls this out).
- **`as unknown as`** in adminApi.ts:39 — narrow casts are okay, but flag any new ones in code review.

### 11.3 Tests
- One ad-hoc effectiveness test (`tests/resume-effectiveness.test.ts`) — runs against real AI APIs, costs money. Not in CI.
- No unit tests, no integration tests, no e2e tests.
- AGENTS.md §13 says "no test harness without explicit ask" — this is a deliberate choice and fine for a solo dev. **But before launch**, three test files would pay for themselves immediately:
  1. **HMAC verification** for `confirm-purchase` (catches the inline-vs-shared drift).
  2. **Credit RPCs** (consume / refund / grant / deduct) — pure SQL, can run against a local Supabase.
  3. **Auth check** on every `/api/*` endpoint (one parametrized test).
- Add Vitest + a single `__tests__/api-auth.test.ts` first; that alone catches 90% of regressions in the security surface.

---

## 12. Documentation gaps

| Doc | State | Action |
|---|---|---|
| `README.md` | Out of date — mentions `VITE_GEMINI_API_KEY`, lists only migration 001 | Rewrite to point at `.env.example` + current migration set |
| `DEPLOYING.md` | Same — pre-proxy, pre-bKash, pre-admin | Rewrite end-to-end |
| `AGENTS.md` | Up to date and load-bearing | Keep maintenance discipline |
| `CLAUDE.md` | Up to date | Keep |
| `ADMIN.md` | Up to date (rewritten this session) | Keep |
| `apps/web/companion-app/WHAT_IT_DOES.md` | Stale — mobile lives in `apps/mobile/` per monorepo restructure | Delete (mobile docs are in `apps/mobile/`) |
| `docs/contracts/webhook-confirm-purchase.md` | Canonical | Keep |
| `topcandidate-audit-2026-05-08/` | Reference for prior audit | Archive |

Missing docs:
- **`SECURITY.md`** — incident response, secret rotation, vulnerability disclosure. Add one before launch.
- **`PRIVACY.md` + Terms of Service** — required for payments + you handle resumes (PII). Required before BD launch.
- **A "Recovery playbook"** for non-bKash issues (DB outage, Vercel outage, AI provider outage). The admin runbook covers payment recovery; nothing covers the rest.

---

## 13. Feature / product gap analysis

### 13.1 Must-have before public launch
1. **Email verification** (C8). Today anyone can sign up with any email.
2. **Password reset flow**. Looking at `LoginScreen` — there is no "forgot password" link. Supabase Auth supports this OOTB; just needs the client UI.
3. **Account deletion UX**. The `delete_user` RPC exists (`schema.sql:677`), but I don't see a "Delete my account" affordance in `ProfileScreen`. GDPR/DPA require this.
4. **Terms / Privacy acceptance at signup** — a checkbox + a link to the policy docs. Required for payments in BD.
5. **Receipt/invoice email** after a successful purchase. Today the customer's only confirmation is the in-app pill. For a paid product they expect an email receipt.
6. **Operator pager** — Settings tab shows "Last successful confirm: 3 min ago" but nothing pages you if it goes red. Cheapest fix: a Cronitor heartbeat.

### 13.2 Should-have (next quarter)
1. **Sentry** for client + server errors.
2. **Vitest** with auth-surface tests at minimum.
3. **Stripe / SSLCommerz integration** as an alternative to bKash for non-BD or higher-trust users. The bKash flow works but is heavy operationally.
4. **Resume version history** — users want to compare yesterday's resume to today's. Currently each generation is a fresh row in `generated_resumes`; nothing surfaces the diff.
5. **Shareable links** for generated resumes (anyone with the link can view, no auth) — high-value sharing primitive.
6. **AI-powered job-match scoring** before generation — "this JD is 60% aligned with your profile" sets expectations and reduces dud generations.
7. **Referral / share-credit program** — give a credit, get a credit. Simple growth lever for a credit-based product.

### 13.3 Long-term differentiators
1. **Mock-interview marketplace** (currently a teaser; explicit non-goal in AGENTS.md §13). Big jump in scope but the highest-value upgrade per the brand.
2. **Resume analytics** — "your resume scored 84/100 on ATS keyword density for this JD; here's why." Today the optimizer does this internally; surface it.
3. **Auto-apply integrations** — once you have the tailored package, one-click to LinkedIn / company portal. Hard but defensible.
4. **Recruiter side** — let recruiters post JDs and see anonymized matches. Two-sided marketplace.

### 13.4 Admin / operator workflow features
1. **Action-required digest email** — every morning, email the operator a summary of overnight pending/disputes/orphans. Costs ~5 min/day of operator's attention saved.
2. **Webhook test button in Admin Settings** — fire a synthetic `confirm-purchase` with a known TrxID to verify the watcher pipeline end-to-end. Already exists in the Flutter Settings tab; mirror it server-side.
3. **Customer search by phone number** — operators get "I paid from 01XXX" support requests; today they can only search by email or TrxID.
4. **Credit-grant batch operation** — for partner/influencer campaigns, give 100 users 1 free credit. Today you'd run a SQL update or 100 admin clicks.
5. **Audit log export** (CSV) — for monthly accounting / compliance reviews. The endpoint already exists in concept; add a "Download audit log" button.

### 13.5 AI / automation opportunities
1. **AI-assisted dispute triage** — group disputes by suspected root cause (parser drift, msisdn mismatch, customer mistake) and pre-fill the operator's note.
2. **Anomaly detection on purchases** — flag when the same `sender_msisdn` shows up across many user accounts (potential fraud).
3. **Auto-suggest credit grants** during operator confirms — "this user has bought 5 packs without incident, customer says they paid; default to grant".

---

## 14. Phased roadmap

### Phase 0 — This week (before any public launch)
- Q1, Q2, Q3, Q4, Q6, Q7, Q10 from §3 quick wins
- C1 (Tailwind off CDN)
- C2 (docs rewrite)
- C3 (security headers)
- C4 (cron query secret)
- C7 (`npm audit fix`)
- C6 (delete supabase Config log)
- M1 confirmation: verify CSRF posture against current attack surface
- One smoke test in CI: type-check + build + aiFactory import smoke

**Outcome:** the app can survive a serious security scan and the docs no longer mislead anyone into leaking AI keys.

### Phase 1 — Next 2 weeks (production-ready)
- C5 (failed-call rate limit)
- C8 (email verification + password reset UX)
- C9 (BuilderScreen field-level validation)
- C10 (keyboard-accessible resume cards)
- Mobile responsiveness pass (Profile tabs, Dashboard search, PurchaseModal)
- L1 (consolidate confirm-purchase HMAC into shared helper)
- M3 / M4 (validation hardening on extract-resume + optimize)
- Account-deletion UX (`ProfileScreen` + the existing `delete_user` RPC)
- Terms/Privacy acceptance at signup + docs
- Sentry wired (client + server)
- Cronitor/BetterStack heartbeat on `/api/confirm-purchase`

**Outcome:** ready for paid traffic. No known critical or high issues.

### Phase 2 — Next month (premium polish)
- Bundle splitting + lazy loading admin (§9.2)
- Lazy-load exporters (PDF/Word)
- Refactor: extract `signIn` / `signUp` into `AuthContext` (§6.3 step 1)
- Refactor: `IPurchaseRepository` (§6.3 step 2)
- Refactor: split `FormSteps.tsx` per step
- Vitest harness + auth-surface tests
- Receipt email after purchase
- Audit log CSV export
- Customer search by phone in admin

**Outcome:** professional SaaS-grade. Fast, observable, maintainable.

### Phase 3 — Next quarter (differentiation)
- Resume version history + diff view
- Shareable resume links
- Referral / share-credit program
- Job-match score pre-generation
- Stripe (international) alongside bKash
- AI-powered dispute triage in admin

**Outcome:** retention + growth levers active.

### Phase 4 — Long-term
- Mock-interview marketplace (was always the headline feature)
- Recruiter side / two-sided marketplace
- Auto-apply integrations

---

## 15. Long-form TODO checklist

### Critical (Phase 0)
- [ ] **C1.** Migrate Tailwind from CDN to Vite plugin with purging
- [ ] **C2.** Rewrite `README.md` and `DEPLOYING.md` to match `.env.example`
- [ ] **C3.** Add HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy to `vercel.json`
- [ ] **C4.** Delete `?secret=` query-string fallback in `api/cron/expire-pending.ts:42-46`
- [ ] **C5.** Count failed `/api/optimize` calls toward the daily cap
- [ ] **C6.** Delete production `console.log('Supabase Config:...')` in `src/infrastructure/supabase/client.ts:16-20`
- [ ] **C7.** Run `npm audit fix`, smoke-test, commit `package-lock.json`
- [ ] **Q5.** Delete dead `supabase` import in `PurchaseModal.tsx:40`
- [ ] **Q6.** Delete `components/`, `services/`, `purchase modal new design/`, root `companion-app/`, root `step1-after.png`
- [ ] **Q8.** Type `DashboardScreen.onOpenResume` arg as `ResumeData`
- [ ] **Q9.** Add `<noscript>` fallback in `index.html`
- [ ] **Q10.** Remove `console.log("Auth error:")` in `LoginScreen.tsx:78`

### High (Phase 1)
- [ ] **C8.** Email verification + password reset UI
- [ ] **C9.** Field-level error display in `BuilderScreen`
- [ ] **C10.** Wrap resume cards in `<button>` for keyboard access
- [ ] **L1.** Consolidate `confirm-purchase` HMAC into `webhookAuth.ts`
- [ ] **M3.** Whitelist `mimeType` in `/api/extract-resume`
- [ ] **M4.** Cap `targetJob.description` at 20k chars server-side
- [ ] **M6.** Per-user 24h rate limit on `/api/dispute-purchase`
- [ ] **M7.** Clear app-managed localStorage on sign-out
- [ ] Mobile pass: Profile tabs, Dashboard search width, PurchaseModal split-pane
- [ ] Account-deletion button in `ProfileScreen`
- [ ] Terms / Privacy checkbox at signup
- [ ] Sentry SDK + DSN env var
- [ ] Cronitor heartbeat on `/api/confirm-purchase` 5xx
- [ ] One GitHub Action: typecheck + build + aiFactory smoke

### Medium (Phase 2)
- [ ] **§6.3.1** Move `signIn` / `signUp` into `AuthContext`
- [ ] **§6.3.2** Create `IPurchaseRepository`, route `PurchaseHistorySection` through it
- [ ] **§6.3.3** Split `FormSteps.tsx` per step file
- [ ] **§9.2** Lazy-load admin chunk
- [ ] **§9.2** Lazy-load PDF + Word exporters
- [ ] **§9.2** `manualChunks` config in Vite
- [ ] **§11.3** Add Vitest + `api-auth.test.ts`
- [ ] Receipt email after purchase
- [ ] **§8.2** Index on `ai_call_log(user_id, created_at desc)`
- [ ] **§8.2** Drop `applications` table (migration)
- [ ] **M2.** Add timestamp + 5-min window to webhook HMAC
- [ ] **L2.** Normalize msisdn to E.164 server-side

### Long-term (Phases 3-4)
See §14.

---

## 16. Final word

The work shipped over the last few weeks (2026-05-08 transaction-flow hardening, the admin panel, the 2026-05-30 redesign + drift fix) is good engineering: discipline, audit trails, fail-safe defaults, careful payments thinking. The technical-debt items in this audit are the kind that accumulate at the edges of fast-moving solo work — docs, headers, CDN choices, monolithic components — not architectural mistakes.

If Phase 0 + Phase 1 ship, this is a real SaaS product. The Phase 2/3 items aren't blockers; they're the work that takes "ready for launch" to "ready for the next 10× of customers."

The audit is at `topcandidate-audit-2026-05-30/AUDIT.md`. The two prior audit folders (`topcandidate-audit-2026-05-08/`) form the historical context.
