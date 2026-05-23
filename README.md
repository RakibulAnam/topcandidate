# TopCandidate

The TopCandidate platform — a single repo for the web app and its mobile companion.

## Layout

```
topcandidate/
├── apps/
│   ├── web/         — Vite + React 19 + Vercel Functions + Supabase (the customer-facing product)
│   └── mobile/      — Flutter Android-only bKash payment-confirmation watcher (operator-side)
├── docs/            — Product, architecture, contracts, decisions, workflows (see docs/README is implicit; start at AGENTS.md)
├── AGENTS.md        — Entry point for AI coding agents
├── CLAUDE.md        — Claude Code-specific rules
└── .claude/         — Shared Claude Code project settings
```

The two apps are loosely coupled by a single HTTPS webhook contract — see [`docs/contracts/webhook-confirm-purchase.md`](docs/contracts/webhook-confirm-purchase.md). There is no shared runtime code.

## Quick start

- **Web:** `cd apps/web && npm install && npm run dev` (Vite on `:3000`). Build: `npm run build`. See [`docs/deployment/web-vercel.md`](docs/deployment/web-vercel.md).
- **Mobile:** `cd apps/mobile && flutter pub get && flutter analyze && flutter test`. Android build: `flutter build apk`. See [`docs/deployment/mobile-android.md`](docs/deployment/mobile-android.md).

## Where to look

| Need | Read |
| --- | --- |
| What this platform is | [`docs/product/overview.md`](docs/product/overview.md) |
| How the pieces fit together | [`docs/architecture/system-overview.md`](docs/architecture/system-overview.md) |
| The webhook between apps | [`docs/contracts/webhook-confirm-purchase.md`](docs/contracts/webhook-confirm-purchase.md) |
| Web app internals | [`apps/web/AGENTS.md`](apps/web/AGENTS.md) |
| Mobile app internals | [`apps/mobile/AGENTS.md`](apps/mobile/AGENTS.md) and [`apps/mobile/spec/`](apps/mobile/spec/) |
| Branching / release flow | [`docs/workflows/branching.md`](docs/workflows/branching.md) |
| Why decisions were made | [`docs/decisions/`](docs/decisions/) |

## Working with AI agents

Start by reading [`AGENTS.md`](AGENTS.md). It is short on purpose — it points to the per-app `AGENTS.md` files and the topic-scoped docs above.
