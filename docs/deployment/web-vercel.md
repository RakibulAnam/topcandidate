# Deployment — Web on Vercel

The web app deploys automatically from `master` via Vercel's GitHub integration.

## Vercel project settings

| Setting | Value |
| --- | --- |
| Framework Preset | Vite |
| **Root Directory** | `apps/web` |
| Build Command | `npm run build` (set in `apps/web/vercel.json`) — runs `npm run typecheck:api && vite build`, i.e. it type-checks `api/*.ts` (`tsconfig.api.json`) before the Vite build |
| Output Directory | `dist` |
| Install Command | `npm install` |
| Production Branch | `master` |
| Function timeout | 60s (set in `apps/web/vercel.json` for AI calls) |

The Root Directory setting is the **critical monorepo concern**: it tells Vercel to treat `apps/web/` as the project root. Set this once via Vercel dashboard → Project → Settings → General.

## Environment variables

Set in Vercel dashboard (Production + Preview + Development as needed). The canonical list and how to obtain each is in [`apps/web/.env.example`](../../apps/web/.env.example) and [`apps/web/DEPLOYING.md`](../../apps/web/DEPLOYING.md).

Highlights:
- `BKASH_WEBHOOK_SECRET` — shared with the mobile app via the operator's Settings tab. Signs all four watcher endpoints.
- `BKASH_WEBHOOK_REQUIRE_TIMESTAMP` — optional; set `true` to reject the legacy body-only signature and enforce the v2 (timestamp + nonce) protocol.
- Supabase service-role key — server-only.
- `OPENROUTER_API_KEY` — server-only; the primary AI provider (set a hard spend cap). Legacy `GROQ_API_KEY` + `GEMINI_API_KEY` are the fallback when it's absent. See [`apps/web/docs/OPENROUTER_MIGRATION.md`](../../apps/web/docs/OPENROUTER_MIGRATION.md).
- `ADMIN_API_KEY` — the HMAC secret used to sign/verify `/admin` session tokens (repurposed — it is no longer pasted as a key). The panel uses a username + password login: set `ADMIN_USERNAME` plus `ADMIN_PASSWORD_HASH` (scrypt, preferred) or `ADMIN_PASSWORD` (plaintext fallback). See `api/admin/_lib/session.ts`.
- `CRON_SECRET` — Bearer auth for the pending-purchase expiry job (see below).

## Pending-purchase expiry (no Vercel cron in this repo)

The 24h expiry job lives at `api/purchase-ops/_handlers/expire-pending.ts` (the `/api/cron/expire-pending` URL is preserved via a rewrite in `vercel.json` to `/api/purchase-ops/expire-pending` — the endpoint was consolidated under the `purchase-ops` dispatcher to fit Vercel Hobby's 12-function cap). It is gated by `CRON_SECRET` (`Authorization: Bearer <secret>`). **`vercel.json` has no `crons` block**, so Vercel does **not** schedule it. It runs one of two ways:

- **Supabase pg_cron** — apply `supabase/migrations/007_optional_pg_cron.sql` to schedule it inside Postgres.
- **Admin panel** — the operator triggers expiry on demand from the `/admin` panel.

(If you want Vercel to run it, add a `crons` entry to `vercel.json`.)

## Local development

```bash
cd apps/web
npm install
npm run dev   # Vite on http://localhost:3000
```

The Vercel Functions in `apps/web/api/` are not served by `vite dev`. To exercise them locally, use `vercel dev` (Vercel CLI) from `apps/web/` — but the more common path is to deploy to a preview URL and test there.

## Database migrations

SQL files live under [`apps/web/supabase/migrations/`](../../apps/web/supabase/migrations/). They are **idempotent** and **cumulative** (use `IF NOT EXISTS`). After adding one, run it in the Supabase SQL editor (or via `supabase db push` if the CLI is set up). The web's `AGENTS.md` documents the migration discipline in detail.
