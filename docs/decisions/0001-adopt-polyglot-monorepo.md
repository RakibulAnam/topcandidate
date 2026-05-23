# ADR-0001: Adopt a polyglot monorepo (no workspace tooling)

- **Date:** 2026-05-23
- **Status:** Accepted

## Context

Two projects were developed independently:
- `Web/ats-resume-builder/` — TypeScript / React / Vercel Functions / Supabase. Customer-facing product. Already a git repo with deployed production.
- `Mobile/bkash_watcher/` — Flutter / Dart, Android-only. Operator-side payment-confirmation watcher. Not under version control. Already shipped to production.

The two are coupled only by a single HTTPS webhook (`POST /api/confirm-purchase` with HMAC-SHA256). No shared runtime code exists today and none is plausibly needed in the near term.

The operator is a solo developer working heavily with AI coding agents. The maintenance cost of separate repos (two AGENTS.md, two CLAUDE.md, two issue trackers, no shared docs for the contract) was creating drift between web's understanding of the contract and mobile's implementation of it.

## Decision

Adopt a **polyglot monorepo** rooted at `topcandidate/` with the following constraints:

1. Both apps live under `apps/` — `apps/web/` and `apps/mobile/`.
2. **No workspace tooling.** No npm/pnpm workspaces, no Turborepo, no Nx. Each app is built and deployed independently using its own native toolchain (`npm run build` for web, `flutter build` for mobile).
3. **No `packages/` directory.** It would imply a shared TypeScript package, which we don't have and don't need. If a genuine code-shaped sharing need appears later, we'll re-open this decision.
4. **One canonical source of truth per concern**, at the root, in `docs/`. The webhook contract, decisions, branching strategy, and architectural overviews all live there. Per-app docs stay inside the apps.
5. **Git history of the web app is preserved** by moving `.git` to the new root and using rename detection. Mobile starts fresh (it had no history).

## Why not the alternatives

- **Two separate repos:** would have kept perfect isolation, but doubles the AI-agent context load and lets the webhook contract drift. Solo developer can't afford that overhead.
- **npm workspaces / Turborepo:** would justify itself only if web and mobile shared TypeScript code. They don't — mobile is Dart. Tooling without payoff is debt.
- **Submodules:** rejected for solo + AI-agent workflows. Submodule operations are non-obvious to agents and frequently produce surprising states.

## Consequences

- Vercel project must point its "Root Directory" setting at `apps/web/` (changed from repo root).
- Each app maintains its own `.gitignore`, lockfile, env files, and `.claude/settings.local.json`. The root `.gitignore` and `.claude/settings.json` cover only cross-cutting concerns.
- Cross-app changes (i.e. webhook contract changes) require simultaneous edits in `apps/web/`, `apps/mobile/`, AND `docs/contracts/webhook-confirm-purchase.md`. This is documented in the root `AGENTS.md` and `CLAUDE.md`.
- Future apps (`apps/admin/`, `apps/marketing/`, etc.) fit the same shape without restructure.

## Trigger to revisit

Open this ADR again when ANY of the following becomes true:
- A genuine reusable TypeScript module emerges (e.g. a typed Supabase client wrapper, shared validation schemas) that both web and a future TS-based mobile/admin app would import.
- Build times exceed what `npm run build` can manage on its own and orchestration would actually save wall-clock time.
- A second mobile platform appears (iOS), in which case `apps/mobile/` may need to split.
