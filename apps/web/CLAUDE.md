# CLAUDE.md — web app

> Read [`AGENTS.md`](AGENTS.md) first (web-specific context), and the root [`../../AGENTS.md`](../../AGENTS.md) for monorepo-wide topology.
> This file adds Claude Code-specific rules for the **web app** only. Root-level Claude rules live at [`../../CLAUDE.md`](../../CLAUDE.md).

## Hard rules

1. **Keep `AGENTS.md` accurate.** After any feature add/remove, architecture change, schema change, or brand token change, update the relevant section of `AGENTS.md` **in the same commit as the change**. An outdated AGENTS.md is worse than none — it makes future agents confidently wrong. The maintenance protocol and per-section responsibilities live at the top of `AGENTS.md`.

2. **No new documentation files** (`*.md`) unless the user explicitly asks. Update the existing ones (AGENTS.md, CLAUDE.md, README.md, DEPLOYING.md) instead.

3. **Brand constraints are non-negotiable.** No gradients. No generic blue / indigo / purple palettes. Accent color is Saffron (`accent-*`); primary ink is `brand-*`; neutrals are `charcoal-*` (warm stone). The wordmark is two words — "TOP" in `brand-700`, "CANDIDATE" in `accent-500`. Never a square "T" badge.

4. **Respect Clean Architecture layering.** Domain depends on nothing. Infrastructure implements domain interfaces. Presentation goes through `ResumeService`, never direct-imports a Gemini class. If you think you need to break this, stop and ask.

5. **New AI generator? Use the established recipe, and respect the 2-call hot path.** Domain interface → use case → Gemini impl (`infrastructure/ai/`) → wire in `dependencies.ts` → inject into `ResumeService`. Initial generation is capped at **two concurrent Gemini calls** (optimizer + combined `GeminiToolkitGenerator`) because free-tier RPM is the binding constraint. Do not re-fan toolkit-like artifacts into parallel calls from `optimizeResume()` — extend the combined generator's schema/prompt instead. Per-item retry flows (`regenerateToolkitItem`) may call single-artifact generators.

6. **Database changes ship with a migration file.** Add `supabase/migrations/<nnn>_<name>.sql` (idempotent — use `if not exists`). Also reflect the change in `supabase/schema.sql`. Tell the user to run it in the Supabase SQL editor.

7. **`Preview.tsx` numeric sizes are in pt** and must match `PdfResumeExporter` exactly, so what the user sees on screen is what they download. Don't switch to px inside the resume render.

8. **No test harness.** This repo has no `npm test`. Don't add one unsolicited. Verification = `npm run build` (just `vite build` — it transpiles TS but does **not** type-check) + manual browser pass.

9. **Run a "mobile impact check" before declaring any non-trivial change done.** The mobile bKash watcher (`apps/mobile/`) is loosely coupled to the web app but cares about a narrow set of web surfaces. Before saying you're done, verify whether the change touches any of:

   - **The webhook handler** `api/confirm-purchase.ts` — payload schema, response codes (200 / 400 / 401 / 404 / 409 / 503 / 5xx), HMAC behavior, idempotency. Canonical contract: [`../../docs/contracts/webhook-confirm-purchase.md`](../../docs/contracts/webhook-confirm-purchase.md).
   - **The `purchases` table and rows the web creates** (`api/purchase.ts`, related Supabase columns / RLS, the `payment_reference` [bKash TrxID] lookup). Mobile expects to find these rows when it POSTs; schema changes that affect lookup or column names break the watcher.
   - **The shared `BKASH_WEBHOOK_SECRET`** env var — rotation requires coordinating with the operator's phone settings (see [`../../docs/contracts/webhook-confirm-purchase.md`](../../docs/contracts/webhook-confirm-purchase.md) for the rotation procedure).
   - **Customer-facing purchase status UI states** (waiting / confirming / confirmed / expired / mismatch). Mobile's `apps/mobile/WHAT_IT_DOES.md` §6 documents the expected user-visible flow.

   At the end of the response, emit a **"Mobile impact"** block with one of:

   - **`Mobile impact: none.`** — the change touches nothing in the list above.
   - **`Mobile impact: yes —`** followed by a bulleted list naming the mobile-side changes needed: which files in `apps/mobile/` (typically `lib/dispatch/webhook_client.dart`, `lib/dispatch/dispatcher.dart`, or `spec/01-server-contract.md`), what to update, and why. If the webhook contract itself changes, also flag that [`../../docs/contracts/webhook-confirm-purchase.md`](../../docs/contracts/webhook-confirm-purchase.md) MUST be updated in the same PR — that's the cross-app rule from the root [`../../CLAUDE.md`](../../CLAUDE.md).

   Skip the block only for purely cosmetic edits (typo fixes, comment-only changes, isolated profile-UI tweaks with no schema effect). For everything else, even when the answer is "none", say so explicitly so the operator knows the check happened.

## Verification commands

```bash
npm run build          # vite build — must pass clean (transpiles TS, does NOT type-check)

# Smoke-test that the server-only API code path imports cleanly. `vite build`
# only bundles client code and tree-shakes server-only files (api/_lib/aiFactory
# and the Gemini/Groq generators), so a syntax error in those files passes
# `npm run build` undetected. This catches it.
node_modules/.bin/tsx -e "await import('./api/_lib/aiFactory.ts'); console.log('ok')"
```

For UI changes: start `npm run dev`, exercise the flow yourself, and report what you tested. If you couldn't test the UI from this environment, say so explicitly — don't claim success.

## Skills

Three skill packages are active at `~/.claude/skills/` (mirrored from `.agent/skills/`):

- `composition-patterns` — React composition rules
- `react-best-practices` — React 19 patterns
- `web-design-guidelines` — web design standards

Consult via the Skill tool when working in those domains.

## When the user says "ship it"

Before declaring done:
1. `npm run build` is clean
2. `AGENTS.md` reflects reality
3. Any SQL migration is both written as a file **and** surfaced to the user as a script to run
4. No gradient, no blue, no purple snuck in
5. The **Mobile impact** block (rule 9) is included — even if "none"
