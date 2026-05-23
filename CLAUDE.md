# CLAUDE.md

> Read `AGENTS.md` first. It is the canonical agent context for this repo.
> This file adds Claude Code-specific rules that AGENTS.md does not cover.

## Hard rules

1. **Keep `AGENTS.md` accurate.** After any feature add/remove, architecture change, schema change, or brand token change, update the relevant section of `AGENTS.md` **in the same commit as the change**. An outdated AGENTS.md is worse than none — it makes future agents confidently wrong. The maintenance protocol and per-section responsibilities live at the top of `AGENTS.md`.

2. **No new documentation files** (`*.md`) unless the user explicitly asks. Update the existing ones (AGENTS.md, CLAUDE.md, README.md, DEPLOYING.md) instead.

3. **Brand constraints are non-negotiable.** No gradients. No generic blue / indigo / purple palettes. Accent color is Saffron (`accent-*`); primary ink is `brand-*`; neutrals are `charcoal-*` (warm stone). The wordmark is two words — "TOP" in `brand-700`, "CANDIDATE" in `accent-500`. Never a square "T" badge.

4. **Respect Clean Architecture layering.** Domain depends on nothing. Infrastructure implements domain interfaces. Presentation goes through `ResumeService`, never direct-imports a Gemini class. If you think you need to break this, stop and ask.

5. **New AI generator? Use the established recipe, and respect the 2-call hot path.** Domain interface → use case → Gemini impl (`infrastructure/ai/`) → wire in `dependencies.ts` → inject into `ResumeService`. Initial generation is capped at **two concurrent Gemini calls** (optimizer + combined `GeminiToolkitGenerator`) because free-tier RPM is the binding constraint. Do not re-fan toolkit-like artifacts into parallel calls from `optimizeResume()` — extend the combined generator's schema/prompt instead. Per-item retry flows (`regenerateToolkitItem`) may call single-artifact generators.

6. **Database changes ship with a migration file.** Add `supabase/migrations/<nnn>_<name>.sql` (idempotent — use `if not exists`). Also reflect the change in `supabase/schema.sql`. Tell the user to run it in the Supabase SQL editor.

7. **`Preview.tsx` numeric sizes are in pt** and must match `PdfResumeExporter` exactly, so what the user sees on screen is what they download. Don't switch to px inside the resume render.

8. **No test harness.** This repo has no `npm test`. Don't add one unsolicited. Verification = `npm run build` (tsc is part of Vite) + manual browser pass.

## Verification commands

```bash
npm run build          # tsc + vite build — must pass clean

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
