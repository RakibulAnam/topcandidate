# Web API endpoints

All endpoints live under [`apps/web/api/`](../../apps/web/api/) (Vercel Functions, Node runtime). This file is an **index**, not a spec — for exact request/response shapes, read the handler source.

There are four auth models in play:

- **User JWT** — Supabase access token in `Authorization: Bearer <jwt>`. Verified by [`api/_lib/auth.ts`](../../apps/web/api/_lib/auth.ts).
- **HMAC (webhook)** — `X-Bkash-Webhook-Signature` (+ `X-Bkash-Webhook-Timestamp` for v2) over the raw body, keyed by `BKASH_WEBHOOK_SECRET`. Verified by [`api/_lib/webhookAuth.ts`](../../apps/web/api/_lib/webhookAuth.ts). See [`webhook-confirm-purchase.md`](webhook-confirm-purchase.md) and [`../architecture/webhook-replay-protection.md`](../architecture/webhook-replay-protection.md).
- **Admin key** — `X-Admin-Key` header, timing-safe compared to `ADMIN_API_KEY`. Verified by [`api/admin/_lib/adminAuth.ts`](../../apps/web/api/admin/_lib/adminAuth.ts).
- **Cron secret** — `Authorization: Bearer <CRON_SECRET>`.

## Customer endpoints (User JWT)

| Endpoint | File | Purpose |
| --- | --- | --- |
| `POST /api/optimize` | `optimize.ts` | Hot path. Consumes **1 toolkit credit**, then runs the optimizer + combined toolkit generator in parallel. `402` if no credits, `429` over daily cap (20/24h), `413` if JD > 20k chars, `503` if no AI provider. |
| `POST /api/optimize-general` | `optimize-general.ts` | General resume optimization (no target job description). Free — no credit gate. |
| `POST /api/toolkit-item` | `toolkit-item.ts` | Regenerate a single toolkit artifact (cover letter / outreach / LinkedIn / interview Qs). Free. |
| `POST /api/extract-resume` | `extract-resume.ts` | Parse an uploaded PDF/Word resume into profile data. |
| `POST /api/purchase` | `purchase.ts` | Record a **`pending`** row in the `purchases` table via the `initiate_purchase` RPC. No credits granted here. `409` duplicate TrxID, `429` if ≥ 5 pending in 24h. |
| `GET /api/my-purchase-status` | `my-purchase-status.ts` | Status of the caller's own purchase by `?txnId=`. Drives the navbar verifying-pill. |
| `POST /api/dispute-purchase` | `dispute-purchase.ts` | File a "paid but no credits" dispute (`record_purchase_dispute`). Max 3 / 24h, notes ≥ 10 chars. |

## Webhook endpoints (HMAC — Flutter watcher)

| Endpoint | File | Purpose |
| --- | --- | --- |
| `POST /api/confirm-purchase` | `confirm-purchase.ts` | **The payment webhook.** Matches the TrxID, validates amount + sender, grants credits via `confirm_purchase`. See [`webhook-confirm-purchase.md`](webhook-confirm-purchase.md). |
| `POST /api/orphan-inbound-sms` | `orphan-inbound-sms.ts` | Dump an SMS the watcher couldn't match after its 24h retry window (`record_orphan_sms`). |
| `POST /api/reverse-purchase` | `reverse-purchase.ts` | bKash reversal SMS → flip a `completed` row to `refunded` and decrement credits (`record_purchase_reversal`). |
| `POST /api/admin/parser-failures` | `admin/_handlers/parser-failures.ts` | (POST mode, HMAC) Dump an unparseable SMS body for operator review. (GET mode is admin-key gated — see below.) |

## Cron

| Endpoint | File | Purpose |
| --- | --- | --- |
| `GET /api/cron/expire-pending` | `cron/expire-pending.ts` | Flip `pending` purchases older than 24h to `expired` (`expire_stale_pending_purchases`). Gated by `CRON_SECRET` bearer. **Note:** `vercel.json` defines no `crons` block, so this is run via Supabase `pg_cron` (migration `007_optional_pg_cron.sql`) or the admin Settings "run expiry" button — not by Vercel Cron in this repo. |

## Admin endpoints (Admin key)

All admin actions are consolidated behind a single dynamic function [`api/admin/[action].ts`](../../apps/web/api/admin/[action].ts) (Vercel Hobby caps a deployment at 12 functions, so ~25 endpoints share one). The action name is the last path segment; handlers live in [`api/admin/_handlers/`](../../apps/web/api/admin/_handlers/) (the leading `_` keeps Vercel from deploying them as separate functions). Every write requires a `reason` and is logged to `admin_audit_log`.

| Group | Actions |
| --- | --- |
| Dashboard / audit | `dashboard`, `action-queue`, `audit-log`, `settings` |
| Purchases | `purchases`, `purchase-detail`, `pending`, `confirm-purchase`, `refund-purchase`, `expire-purchase`, `reopen-purchase`, `grant-override`, `purchase-note` |
| Users / credits | `users`, `user-detail`, `grant-credits`, `deduct-credits`, `flag-user`, `user-note` |
| Disputes | `disputes`, `resolve-dispute` |
| Orphans / parser | `orphans`, `match-orphan`, `orphan-mark-ignored`, `parser-failures`, `parser-mark-reviewed`, `parser-export` |

Helpers: auth [`api/_lib/auth.ts`](../../apps/web/api/_lib/auth.ts); rate-limit / daily-cap [`api/_lib/rateLimit.ts`](../../apps/web/api/_lib/rateLimit.ts); AI provider factory [`api/_lib/aiFactory.ts`](../../apps/web/api/_lib/aiFactory.ts) (OpenRouter when `OPENROUTER_API_KEY` set, else legacy Groq + Gemini); admin auth [`api/admin/_lib/adminAuth.ts`](../../apps/web/api/admin/_lib/adminAuth.ts).
