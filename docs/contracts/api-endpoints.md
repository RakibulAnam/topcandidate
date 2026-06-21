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
| `POST /api/optimize` | `optimize.ts` | Hot path. Consumes **1 toolkit credit**, then runs the resume optimizer only (toolkit moved to `/api/toolkit`, 2026-06-11; the response's `toolkit` field is a stale-client stub). `402` if no credits, `429` over daily cap (20/24h), `413` if JD > 20k chars, `503` if no AI provider. |
| `POST /api/toolkit` | `toolkit.ts` | Combined toolkit bundle (cover letter + outreach + LinkedIn note + interview prep), fired by the client in parallel with `/api/optimize`. Free — the optimizer's credit covers the generation. `429` over daily cap, `413` if JD > 20k chars. |
| `POST /api/optimize-general` | `optimize-general.ts` | General resume optimization (no target job description). Free — no credit gate; per-kind cap 5/24h on top of the overall 20/24h. |
| `POST /api/toolkit-item` | `toolkit-item.ts` | Regenerate a single toolkit artifact (cover letter / outreach / LinkedIn / interview Qs). Free. |
| `POST /api/normalize-item` | `normalize-item.ts` | "Polished profile" — normalize one raw profile description (informal EN / Bangla / Banglish) into canonical English bullets + evidenced skills + coaching gaps. Fired on save (not per generation). Free; `kind='normalize'` has its own per-kind daily cap and is **excluded** from the overall 20/24h AI cap. `413` if text > 4k chars, `503` on the legacy AI path (no normalizer — OpenRouter-only). |
| `POST /api/extract-resume` | `extract-resume.ts` | Parse a resume into profile data. Body is `{ fileData, mimeType }`: `mimeType: 'text/plain'` → `fileData` is text the client already extracted with pdf.js (the normal path); `application/pdf`/Word → `fileData` is base64 of the raw file (scanned/image fallback). `415` unsupported mime. |
| `POST /api/purchase` | `purchase.ts` | Record a **`pending`** row in the `purchases` table via the `initiate_purchase` RPC. No credits granted here. `409` duplicate TrxID, `429` if ≥ 5 pending in 24h. |
| `GET /api/my-purchase-status` | `purchase-ops/_handlers/status.ts` | Status of the caller's own purchase by `?txnId=`. Drives the navbar verifying-pill. Public URL is unchanged; `vercel.json` rewrites it to `/api/purchase-ops/status` (consolidated 2026-06-15 to fit Hobby's 12-function cap). |
| `POST /api/dispute-purchase` | `purchase-ops/_handlers/dispute.ts` | File a "paid but no credits" dispute (`record_purchase_dispute`). Max 3 / 24h, notes ≥ 10 chars. Public URL unchanged; rewritten to `/api/purchase-ops/dispute`. |

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
| `GET /api/cron/expire-pending` | `purchase-ops/_handlers/expire-pending.ts` | Flip `pending` purchases older than 24h to `expired` (`expire_stale_pending_purchases`). Gated by `CRON_SECRET` bearer. Public URL unchanged; `vercel.json` rewrites it to `/api/purchase-ops/expire-pending`. **Note:** `vercel.json` defines no `crons` block, so this is run via Supabase `pg_cron` (migration `007_optional_pg_cron.sql`) or the admin Settings "run expiry" button — not by Vercel Cron in this repo. |

> **Dispatcher note (2026-06-15):** `my-purchase-status`, `dispute-purchase`, and `cron/expire-pending` no longer have their own function files. They were consolidated behind a single dynamic function [`api/purchase-ops/[action].ts`](../../apps/web/api/purchase-ops/[action].ts) (handlers in [`api/purchase-ops/_handlers/`](../../apps/web/api/purchase-ops/_handlers/)) to fit Vercel Hobby's 12-function cap. `vercel.json` rewrites the original public URLs to `/api/purchase-ops/{status,dispute,expire-pending}`, so callers are unchanged. The HMAC webhook endpoints (`confirm-purchase`, `reverse-purchase`, `orphan-inbound-sms`) are deliberately **not** folded in — they need `bodyParser: false` for raw-body signature verification.

## Admin endpoints (Admin key)

All admin actions are consolidated behind a single dynamic function [`api/admin/[action].ts`](../../apps/web/api/admin/[action].ts) (Vercel Hobby caps a deployment at 12 functions, so ~25 endpoints share one). The action name is the last path segment; handlers live in [`api/admin/_handlers/`](../../apps/web/api/admin/_handlers/) (the leading `_` keeps Vercel from deploying them as separate functions). Every write requires a `reason` and is logged to `admin_audit_log`.

The registered actions (see the `HANDLERS` map in `api/admin/[action].ts`):

| Group | Actions |
| --- | --- |
| Auth / dashboard / audit | `login` (the only **unauthenticated** action — does its own checks), `dashboard`, `summary`, `action-queue`, `audit-log`, `settings` |
| Purchases | `purchases`, `purchase-detail`, `pending`, `confirm-purchase`, `refund-purchase`, `expire-purchase`, `reopen-purchase`, `grant-override`, `purchase-note` |
| Users / credits | `users`, `user-detail`, `grant-credits`, `deduct-credits`, `flag-user`, `user-note` |
| Disputes | `disputes`, `resolve-dispute` |
| Orphans / parser | `orphans`, `match-orphan`, `orphan-mark-ignored`, `parser-failures`, `parser-mark-reviewed`, `parser-export` |
| Analytics / growth (migration 013) | `revenue-analytics`, `revenue-export`, `customer-intelligence`, `product-analytics`, `marketing`, `marketing-spend`, `system-health` |

Helpers: auth [`api/_lib/auth.ts`](../../apps/web/api/_lib/auth.ts); rate-limit / daily-cap [`api/_lib/rateLimit.ts`](../../apps/web/api/_lib/rateLimit.ts); AI provider factory [`api/_lib/aiFactory.ts`](../../apps/web/api/_lib/aiFactory.ts) (OpenRouter when `OPENROUTER_API_KEY` set, else legacy Groq + Gemini); admin auth [`api/admin/_lib/adminAuth.ts`](../../apps/web/api/admin/_lib/adminAuth.ts).
