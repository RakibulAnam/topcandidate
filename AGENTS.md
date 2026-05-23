# AGENTS.md — TopCandidate (monorepo root)

> Read this first. It's deliberately short. The depth lives in per-app and topic-scoped docs.

## What this repo is

A polyglot monorepo with two independent apps that share **only** an HTTPS webhook contract:

- **`apps/web/`** — TypeScript / React 19 / Vite / Vercel Functions / Supabase. Customer-facing product.
- **`apps/mobile/`** — Dart / Flutter, Android-only. Operator-side bKash payment-confirmation watcher.

No shared runtime code. No npm workspaces, no Turborepo. See [`docs/decisions/0001-adopt-polyglot-monorepo.md`](docs/decisions/0001-adopt-polyglot-monorepo.md) for why.

## Where to load context from (in order)

1. **This file** — topology, rules, where to look.
2. The per-app `AGENTS.md` for whichever app you're touching:
   - [`apps/web/AGENTS.md`](apps/web/AGENTS.md) — clean-architecture layers, AI pipeline, rate limits, brand rules.
   - [`apps/mobile/AGENTS.md`](apps/mobile/AGENTS.md) — isolate model, state machine, retry schedule.
3. Topic-scoped docs in [`docs/`](docs/) when relevant:
   - Cross-app webhook contract → [`docs/contracts/webhook-confirm-purchase.md`](docs/contracts/webhook-confirm-purchase.md)
   - Branching / release → [`docs/workflows/branching.md`](docs/workflows/branching.md)
   - Decision history → [`docs/decisions/`](docs/decisions/)

Don't crawl the whole tree. Read the file that matches the layer you're in.

## Rules that apply across both apps

1. **Keep AGENTS.md accurate.** Whichever AGENTS.md is closest to your change must be updated in the same commit. Stale agent docs are worse than no docs. Per-app maintenance protocols live at the top of each per-app AGENTS.md.
2. **Cross-app changes need both sides updated.** Any change to the webhook payload, headers, or response codes is a coordinated change in `apps/web/api/confirm-purchase.ts` AND `apps/mobile/lib/dispatch/` AND [`docs/contracts/webhook-confirm-purchase.md`](docs/contracts/webhook-confirm-purchase.md). All three move in the same PR.
3. **No shared-code package today.** If you're tempted to create `packages/shared/`, stop. The two apps are in different language ecosystems; the only shared artifact is a webhook contract, which is documented, not coded. Re-open the discussion only when a genuine code-shaped sharing need appears.
4. **Each app's stack stays in its app.** No npm scripts at root. No Flutter config at root. Each app is independently buildable and deployable.
5. **Default branch is `master`.** Vercel deploys from it. See [`docs/workflows/branching.md`](docs/workflows/branching.md).
6. **Architectural decisions get an ADR** in [`docs/decisions/`](docs/decisions/). One file per decision, lowest-unused number prefix, short.

## Per-app rules (don't re-state here — read in the app's AGENTS.md)

- Web brand palette (Saffron / Ink / Charcoal), Clean Architecture layering, 2-call hot-path budget for AI, migration discipline → `apps/web/AGENTS.md` + `apps/web/CLAUDE.md`.
- Mobile single-tenant model, isolate boundary, backoff schedule, retry semantics → `apps/mobile/AGENTS.md` + `apps/mobile/spec/`.

## When you're stuck

Ask. Don't speculate. The user prefers a direct question over invented context.
