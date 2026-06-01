# Deployment — Web on Vercel

The web app deploys automatically from `master` via Vercel's GitHub integration.

## Vercel project settings

| Setting | Value |
| --- | --- |
| Framework Preset | Vite |
| **Root Directory** | `apps/web` |
| Build Command | `vite build` (set in `apps/web/vercel.json`; same as `npm run build`) |
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
- Groq + Gemini API keys — server-only.
- `ADMIN_API_KEY` — gates the `/admin` panel (`X-Admin-Key` header).
- `CRON_SECRET` — Bearer auth for the pending-purchase expiry job (see below).

## Pending-purchase expiry (no Vercel cron in this repo)

The 24h expiry job lives at `api/cron/expire-pending.ts` and is gated by `CRON_SECRET` (`Authorization: Bearer <secret>`). **`vercel.json` has no `crons` block**, so Vercel does **not** schedule it. It runs one of two ways:

- **Supabase pg_cron** — apply `supabase/migrations/007_optional_pg_cron.sql` to schedule it inside Postgres.
- **Admin panel** — the operator triggers expiry on demand from the `/admin` panel.

(The `expire-pending.ts` header comment and `.env.example` still describe a "every 15 min" Vercel cron — that cadence is not configured here. If you want Vercel to run it, add a `crons` entry to `vercel.json`.)

## Local development

```bash
cd apps/web
npm install
npm run dev   # Vite on http://localhost:3000
```

The Vercel Functions in `apps/web/api/` are not served by `vite dev`. To exercise them locally, use `vercel dev` (Vercel CLI) from `apps/web/` — but the more common path is to deploy to a preview URL and test there.

## Database migrations

SQL files live under [`apps/web/supabase/migrations/`](../../apps/web/supabase/migrations/). They are **idempotent** and **cumulative** (use `IF NOT EXISTS`). After adding one, run it in the Supabase SQL editor (or via `supabase db push` if the CLI is set up). The web's `AGENTS.md` documents the migration discipline in detail.
