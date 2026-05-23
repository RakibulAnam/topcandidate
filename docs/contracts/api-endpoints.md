# Web API endpoints

All endpoints live under [`apps/web/api/`](../../apps/web/api/) (Vercel Functions, Node runtime). Client calls them via the Supabase JWT bearer.

| Endpoint | File | Purpose |
| --- | --- | --- |
| `POST /api/optimize` | `optimize.ts` | Generate ATS-tailored resume (gated by toolkit credits). |
| `POST /api/optimize-general` | `optimize-general.ts` | General resume (no JD, 24h cooldown for free tier). |
| `POST /api/toolkit-item` | `toolkit-item.ts` | Per-item regenerate for individual toolkit artifact. |
| `POST /api/extract-resume` | `extract-resume.ts` | Upload PDF/Word resume → parse to profile data. |
| `POST /api/purchase` | `purchase.ts` | Create a `pending_purchase` row (currently mocked). |
| `POST /api/confirm-purchase` | `confirm-purchase.ts` | **Mobile webhook** — see [`webhook-confirm-purchase.md`](webhook-confirm-purchase.md). |
| `POST /api/dev-mock-confirm` | `dev-mock-confirm.ts` | Local development helper for bypassing the watcher. |

Auth helper: [`apps/web/api/_lib/auth.ts`](../../apps/web/api/_lib/auth.ts). Rate-limit / daily-cap helper: [`apps/web/api/_lib/rateLimit.ts`](../../apps/web/api/_lib/rateLimit.ts). AI provider factory: [`apps/web/api/_lib/aiFactory.ts`](../../apps/web/api/_lib/aiFactory.ts).

_For request/response shapes per endpoint, read the handler source. This file is an index, not a spec._
