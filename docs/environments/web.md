# Web environments

## Files

- [`apps/web/.env.example`](../../apps/web/.env.example) — canonical list of env vars with descriptions and where to obtain each.
- `apps/web/.env` and `apps/web/.env.local` — local-only, gitignored.

## Where each var is consumed

- Vercel Functions in `apps/web/api/*` read the AI provider key (`GEMINI_API_KEY` — the only one), the Supabase service-role key, and `BKASH_WEBHOOK_SECRET`.

`GEMINI_API_KEY` must belong to a **paid-tier** Google project: the free tier trains on submitted prompts and permits human review, which contradicts our ToS §3 (and caps you at 15 RPM). Bound spend with a Cloud Console **spend cap** budget scoped to the Gemini API service — a plain budget only emails you.
- The Vite client reads only public `VITE_*` vars (Supabase URL + anon key).

For the bKash webhook secret rotation procedure, see [`docs/contracts/webhook-confirm-purchase.md`](../contracts/webhook-confirm-purchase.md) and [`apps/mobile/WHAT_IT_DOES.md`](../../apps/mobile/WHAT_IT_DOES.md) §5.
