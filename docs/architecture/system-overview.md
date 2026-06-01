# System overview

```
                    Customer (browser)
                          │
                          ▼
              ┌───────────────────────┐
              │  apps/web (Vite SPA)  │
              │  on Vercel            │
              │   ┌────────────────┐  │
              │   │ /api/* Vercel  │  │   server-only AI + payment endpoints
              │   │  Functions     │  │   (Groq, Gemini, confirm-purchase)
              │   └────────────────┘  │
              └────────────┬──────────┘
                           │
                  Supabase Postgres
                  (auth, profiles, resumes,
                   purchases, ai_call_log)
                           ▲
                           │  /api/confirm-purchase  (HMAC-SHA256)
                           │
              ┌────────────┴──────────┐
              │  apps/mobile          │
              │  Flutter (Android)    │
              │  bKash Watcher        │ ← operator's phone reads bKash SMS
              └───────────────────────┘
```

## Components

- **`apps/web/`** — Vite + React 19 SPA bundled by Vercel, with server-only Vercel Functions in `apps/web/api/`. AI provider keys (Groq, Gemini) and Supabase service-role key live ONLY in Vercel env vars. Client uses Supabase JWT bearer auth to call its own `/api/*` endpoints. Architecture detail: [`apps/web/AGENTS.md`](../../apps/web/AGENTS.md) §4.
- **`apps/mobile/`** — Single-tenant Flutter app on the operator's Android phone. Reads bKash payment-received SMS, POSTs HMAC-signed JSON to web's `/api/confirm-purchase`. State machine, retries, isolate model: [`apps/mobile/spec/`](../../apps/mobile/spec/).
- **Supabase** — Postgres + auth. Schema and migrations live with the web app at [`apps/web/supabase/`](../../apps/web/supabase/).
- **External AI providers** — Groq (primary, free tier, ~1000 RPD), Gemini 2.5 Flash (fallback + toolkit generators). Routed through `MultiProviderResumeOptimizer`. Free-tier rate caps drive the 2-concurrent-call hot-path budget documented in `apps/web/AGENTS.md`.

## The only cross-app coupling

The HMAC-signed webhook contract described in [`docs/contracts/webhook-confirm-purchase.md`](../contracts/webhook-confirm-purchase.md). The watcher calls four endpoints signed with the same `BKASH_WEBHOOK_SECRET` — `confirm-purchase`, `orphan-inbound-sms`, `reverse-purchase`, and `admin/parser-failures` (POST) — but `confirm-purchase` is the core of it. Everything else is independent.

## Trust boundaries

- Browser ↔ Vercel: HTTPS, Supabase JWT bearer.
- Vercel ↔ Supabase: service-role key, server-only.
- Vercel ↔ Groq/Gemini: API keys, server-only.
- Mobile ↔ Vercel: HTTPS + HMAC-SHA256. v2 protocol signs `<timestamp>.<body>` with a ±5 min window and a one-time nonce (replay protection); a legacy body-only path remains until `BKASH_WEBHOOK_REQUIRE_TIMESTAMP=true` is set.
- Mobile ↔ Android SMS subsystem: Android permissions (`RECEIVE_SMS`, `READ_SMS`).

## Where each concern is documented

| Concern | Doc |
| --- | --- |
| Web internals (layers, AI pipeline, screens) | [`apps/web/AGENTS.md`](../../apps/web/AGENTS.md) |
| Mobile architecture (isolate model, state machine) | [`apps/mobile/spec/03-architecture.md`](../../apps/mobile/spec/03-architecture.md), [`apps/mobile/spec/04-state-machine.md`](../../apps/mobile/spec/04-state-machine.md) |
| Database schema | [`apps/web/supabase/schema.sql`](../../apps/web/supabase/schema.sql) and migrations folder |
| Webhook contract | [`docs/contracts/webhook-confirm-purchase.md`](../contracts/webhook-confirm-purchase.md) |
| Deployment | [`docs/deployment/web-vercel.md`](../deployment/web-vercel.md), [`docs/deployment/mobile-android.md`](../deployment/mobile-android.md) |
