# CLAUDE.md — monorepo root

> Read [`AGENTS.md`](AGENTS.md) first. This file adds Claude Code-specific rules that apply at the repo root.

## Hard rules

1. **Open in the right working directory.** When working on web, `cd apps/web`. When working on mobile, `cd apps/mobile`. Each app's per-directory `CLAUDE.md` and `AGENTS.md` only loads automatically from inside that directory. Running everything from the repo root means you'll miss the per-app rules.
2. **Per-app rules supersede this file** when you're inside an app. The root `CLAUDE.md` is for cross-cutting concerns only.
3. **Don't auto-create new docs at root.** The `docs/` skeleton is already laid out. Fill in stubs when the corresponding work happens; don't write speculative docs.
4. **One ADR per architectural decision.** New `docs/decisions/NNNN-*.md` whenever a structural choice is made. Keep them under one page.
5. **Verification commands live per-app.** There is no root `npm test`, no root `flutter` invocation. Don't add a root build orchestrator (no Turbo, no Make) unless and until both apps share enough that orchestration pays for itself.

## When making a cross-app change

A change to the webhook contract touches three files minimum:
1. `apps/web/api/confirm-purchase.ts` (handler)
2. `apps/mobile/lib/dispatch/webhook_client.dart` and/or `dispatcher.dart` (sender)
3. `docs/contracts/webhook-confirm-purchase.md` (the spec)

If only one of these changes, your PR is incomplete.
