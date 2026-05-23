# Deployment — Web on Vercel

The web app deploys automatically from `master` via Vercel's GitHub integration.

## Vercel project settings

| Setting | Value |
| --- | --- |
| Framework Preset | Vite |
| **Root Directory** | `apps/web` |
| Build Command | `npm run build` (inherits from `apps/web/package.json`) |
| Output Directory | `dist` |
| Install Command | `npm install` |
| Production Branch | `master` |
| Function timeout | 60s (set in `apps/web/vercel.json` for AI calls) |

The Root Directory setting is the **critical monorepo concern**: it tells Vercel to treat `apps/web/` as the project root. Set this once via Vercel dashboard → Project → Settings → General.

## Environment variables

Set in Vercel dashboard (Production + Preview + Development as needed). The canonical list and how to obtain each is in [`apps/web/.env.example`](../../apps/web/.env.example) and [`apps/web/DEPLOYING.md`](../../apps/web/DEPLOYING.md).

Highlights:
- `BKASH_WEBHOOK_SECRET` — shared with the mobile app via the operator's Settings tab.
- Supabase service-role key — server-only.
- Groq + Gemini API keys — server-only.

## Local development

```bash
cd apps/web
npm install
npm run dev   # Vite on http://localhost:3000
```

The Vercel Functions in `apps/web/api/` are not served by `vite dev`. To exercise them locally, use `vercel dev` (Vercel CLI) from `apps/web/` — but the more common path is to deploy to a preview URL and test there.

## Database migrations

SQL files live under [`apps/web/supabase/migrations/`](../../apps/web/supabase/migrations/). They are **idempotent** and **cumulative** (use `IF NOT EXISTS`). After adding one, run it in the Supabase SQL editor (or via `supabase db push` if the CLI is set up). The web's `AGENTS.md` documents the migration discipline in detail.
