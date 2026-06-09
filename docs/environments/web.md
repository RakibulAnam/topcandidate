# Web environments

## Files

- [`apps/web/.env.example`](../../apps/web/.env.example) — canonical list of env vars with descriptions and where to obtain each.
- `apps/web/.env` and `apps/web/.env.local` — local-only, gitignored.

## Where each var is consumed

- Vercel Functions in `apps/web/api/*` read the AI provider key (`OPENROUTER_API_KEY`, or legacy `GROQ_API_KEY`/`GEMINI_API_KEY`), the Supabase service-role key, and `BKASH_WEBHOOK_SECRET`.
- The Vite client reads only public `VITE_*` vars (Supabase URL + anon key).

For the bKash webhook secret rotation procedure, see [`docs/contracts/webhook-confirm-purchase.md`](../contracts/webhook-confirm-purchase.md) and [`apps/mobile/WHAT_IT_DOES.md`](../../apps/mobile/WHAT_IT_DOES.md) §5.
