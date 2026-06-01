# TOP CANDIDATE — web

Paste a job description, get a complete application package: ATS-tailored resume, cover letter, cold outreach email to the hiring manager, LinkedIn note, and an interview-prep sheet of the 6–8 questions you'll actually be asked.

> **For AI agents** (Claude Code, Cursor, etc.): the canonical context document is [`AGENTS.md`](./AGENTS.md). Claude Code-specific rules in [`CLAUDE.md`](./CLAUDE.md). Operator runbook in [`ADMIN.md`](./ADMIN.md).

## Stack

React 19 + TypeScript 5.8 + Vite 6 + Tailwind v4 + Supabase + Vercel Functions. Clean Architecture across `src/domain/` → `src/application/` → `src/infrastructure/` → `src/presentation/`. All AI calls server-side via `api/*` Vercel Functions; provider keys never reach the client.

## Quick start

```bash
npm install
cp .env.example .env     # then fill in the values per the comments
npm run dev              # Vite dev server (frontend only; API routes will 404)
npm run dev:full         # `vercel dev` — frontend + serverless functions
npm run build            # tsc + Vite production build
```

## Required environment variables

See [`.env.example`](./.env.example) for the full annotated list. In short:

### Server-only (never `VITE_`-prefixed — bundled into Vercel Functions, not the client)

| Variable | What it does |
|---|---|
| `GROQ_API_KEY` | Primary resume optimizer. Free at https://console.groq.com/keys (1,000 RPD). |
| `GEMINI_API_KEY` | Fallback optimizer + all toolkit generators (cover letter, outreach, LinkedIn, interview prep, resume extractor). Free at https://aistudio.google.com/app/apikey (20 RPD). |
| `SUPABASE_SERVICE_ROLE_KEY` | Bypasses RLS. Used server-side by the HMAC webhooks (`/api/confirm-purchase`, `/api/orphan-inbound-sms`, `/api/reverse-purchase`), `/api/cron/expire-pending`, `/api/optimize` (the service-role-only credit RPCs from migration 008), and the admin dispatcher. |
| `BKASH_WEBHOOK_SECRET` | HMAC-SHA256 secret shared with the Flutter SMS-watcher in `apps/mobile/`. Generate with `openssl rand -hex 32`. |
| `BKASH_WEBHOOK_REQUIRE_TIMESTAMP` | Optional. Set to `'true'` to enforce webhook protocol v2 (timestamp ±5min window + nonce replay protection, migration 011). Default (unset) accepts the legacy unsigned-timestamp path. |
| `ADMIN_API_KEY` | Gates `/admin` and `/api/admin/*`. Generate with `openssl rand -hex 32`. |
| `CRON_SECRET` | Bearer auth on `/api/cron/expire-pending`. Note: `vercel.json` has no `crons` block, so Vercel does NOT schedule this automatically — the expiry runs via Supabase pg_cron (migration `007_optional_pg_cron.sql`) or the admin Settings button. Generate with `openssl rand -hex 32`. |

### Client-visible (`VITE_`-prefixed — bundled into the browser)

| Variable | What it does |
|---|---|
| `VITE_SUPABASE_URL` | Supabase Project Settings → API. |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key. Public by design; RLS gates every table. |
| `VITE_BKASH_PAYMENT_NUMBER` | Operator's bKash number, shown in the purchase modal. |

**Never put `VITE_GEMINI_API_KEY` or `VITE_GROQ_API_KEY` in your env.** AI keys are server-only; the proxy at `/api/*` is the only thing that talks to providers. If you see a `VITE_GEMINI_API_KEY` instruction in an older doc, ignore it — it predates the proxy migration.

## Database

Run `supabase/schema.sql` once on a fresh Supabase project, **then every file in `supabase/migrations/` in numerical order**. Each migration is idempotent (`add column if not exists` etc.) so re-running is safe.

At time of writing, the full set is:
- `001_add_toolkit_column.sql`
- `002_add_languages_and_references.sql`
- `003_add_ai_call_log.sql`
- `004_add_toolkit_credits.sql`
- `005_lock_toolkit_credits_and_bkash_pending.sql`
- `006_add_company_generated_column.sql`
- `007_transaction_flow_hardening.sql`
- `007_optional_pg_cron.sql` *(enable `pg_cron` first in Supabase Extensions; needed on Vercel Hobby where sub-daily cron isn't available)*
- `008_lock_credit_rpcs.sql`
- `009_admin_panel.sql`
- `010_align_profiles_columns.sql`
- `011_webhook_nonces.sql` *(replay protection for the HMAC webhooks — nonce table + timestamp window)*

See [`DEPLOYING.md`](./DEPLOYING.md) for the full first-deploy walk-through.

## Verification

```bash
npm run build          # tsc (part of Vite) + production bundle — must pass clean

# Server-only smoke for /api/admin/* and the AI factory. `vite build` tree-shakes
# server-only files, so a syntax error in those files passes `npm run build`
# undetected. This catches it.
node_modules/.bin/tsx -e "(async () => { await import('./api/admin/[action].ts'); await import('./api/_lib/aiFactory.ts'); console.log('ok'); })();"
```

There is no automated test suite. Verification = the two commands above + a manual browser pass.

## What's in the box

- Multi-step Builder (Personal info → Sections → Experience → Projects → Education → Skills → Extras → Languages → References → Generate → Preview)
- Two AI optimizer providers (Groq primary, Gemini fallback) with automatic cooldown
- One combined toolkit generator (cover letter + outreach email + LinkedIn note + interview prep) — the "2-call hot path"
- bKash purchase flow with HMAC-signed Flutter watcher confirmation (see `apps/mobile/`)
- Operator admin SPA at `/admin` (Dashboard / Users / Purchases / Disputes / Orphans / Parser failures / Audit log / Settings)
- Locale toggle (English + Bengali) with locale-aware font stacks

## Project structure

```
apps/web/
├── api/                    Vercel Functions (server)
│   ├── admin/[action].ts   Admin dispatcher — single function, ~26 sub-handlers
│   ├── confirm-purchase.ts bKash webhook (HMAC-gated)
│   ├── optimize.ts         Paid hot-path (optimizer + combined toolkit)
│   ├── optimize-general.ts Free path (optimizer only)
│   ├── toolkit-item.ts     Per-item retry (free)
│   └── ...
├── src/
│   ├── domain/             Entities + use cases (no dependencies)
│   ├── application/        Services that orchestrate use cases
│   ├── infrastructure/     Supabase, AI providers, repositories, DI
│   └── presentation/       React screens + components
├── supabase/
│   ├── schema.sql          Fresh-DB bootstrap
│   └── migrations/         Numbered, idempotent
├── docs/                   Cross-app contracts + ADRs
└── topcandidate-audit-*/   Audit history
```
