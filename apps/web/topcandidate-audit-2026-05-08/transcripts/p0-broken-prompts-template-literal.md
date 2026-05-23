# P0 — `resumeOptimizerPrompts.ts` has a template-literal syntax error; all AI endpoints fail

**Severity**: P0 (launch blocker — every AI endpoint dies on import)
**Date**: 2026-05-08
**Files**: `src/infrastructure/ai/prompts/resumeOptimizerPrompts.ts`

## Symptom

In local `vercel dev`, every AI endpoint returns:

```
HTTP 500
A server error has occurred

FUNCTION_INVOCATION_FAILED
```

Confirmed for: `/api/optimize`, `/api/optimize-general`, `/api/extract-resume`, `/api/toolkit-item`. (`/api/purchase` works correctly with 401, because it does not import `aiFactory`.)

## Root cause

`buildSystemInstruction()` on lines 21–83 is one large template literal opened at line 22 (`return \`You are a senior...`) and closed at line 82 (`...verb choice.\`;`). Inside that template literal, line 41 contains:

```
5. SKILLS — Emit BOTH a flat JD-ordered list (`skills`) AND a grouped view (`skillCategories`).
```

Those backticks around `skills` and `skillCategories` are **literal byte 0x60** (verified via `hexdump -C`), not Unicode look-alikes. An unescaped backtick inside a template literal terminates the literal early — the parser then reads `skills` as a stray identifier and throws.

Line 52 has the same bug:

```
…Every item in `skillCategories` MUST also exist in the flat `skills` array…
```

(Lines 3 and 89 also have unescaped backticks but those are inside `//` comments and are fine.)

## Reproduction

`tsx`, `esbuild`, and `tsc` all reject the file:

```
$ node_modules/.bin/tsx -e "import('./src/infrastructure/ai/prompts/resumeOptimizerPrompts.ts')"
ERROR: Expected ";" but found "skills"
   resumeOptimizerPrompts.ts:41:49

$ node_modules/.bin/tsc --noEmit /tmp/test-parse.ts
test-parse.ts(2,19): error TS1005: ';' expected.
```

A 3-line minimal repro confirms the same parser behaviour:

```ts
function f(): string {
  return `Hello (`world`) test`;   // <-- same shape as line 41
}
```

## Why `npm run build` does not catch this

`npm run build` runs `vite build`, which only bundles client code. The broken file is imported only by `GeminiResumeOptimizer.ts` and `GroqResumeOptimizer.ts`, which are themselves imported only by `api/_lib/aiFactory.ts` (server-only). Vite's tree-shaker therefore drops the whole subtree out of the client bundle and never parses the broken file. Production builds rely on Vercel's separate API-bundling pipeline; whether that pipeline is somehow more permissive is unknown, but esbuild (which Vercel uses) clearly is not.

## Blast radius

- All tailored toolkit generations (paid path) fail: 502 to the user, but only **after** the credit was already consumed because `/api/optimize` calls `consume_toolkit_credit` BEFORE the AI step. The function then falls into the `catch` branch and calls `refund_toolkit_credit`, so credits should be refunded — assuming the function can run far enough to hit the catch. Given FUNCTION_INVOCATION_FAILED happens at import time, **the function may not run at all**, leaving the user charged with no resume and no error message they can act on.
- Free General Resume path (`/api/optimize-general`) — same failure, no resume.
- Resume extract from PDF/Word (`/api/extract-resume`) — same failure, the import flow is dead.
- Per-item toolkit retry (`/api/toolkit-item`) — same failure.

## Suggested fix

Escape the four offending backticks:

```diff
-5. SKILLS — Emit BOTH a flat JD-ordered list (`skills`) AND a grouped view (`skillCategories`).
+5. SKILLS — Emit BOTH a flat JD-ordered list (\`skills\`) AND a grouped view (\`skillCategories\`).
```

```diff
-… Every item in `skillCategories` MUST also exist in the flat `skills` array …
+… Every item in \`skillCategories\` MUST also exist in the flat \`skills\` array …
```

Or — safer for future edits — replace the surrounding backticks with quotation marks: `"skills"` and `"skillCategories"`. The model does not care whether the names are quoted, backticked, or bolded; the human reader does.

## Verification gap

The repository has CLAUDE.md hard rule #11 ("Verification commands: `npm run build` — must pass clean") and AGENTS.md §12 ("No test suite currently — no `npm test`"). Both rules are **insufficient** to catch this class of bug because `vite build` does not transit the API code path. Recommend adding to the verification protocol:

```bash
node_modules/.bin/tsc --noEmit -p api/tsconfig.json   # if api has its own tsconfig
# OR a one-liner that loads aiFactory under the API runtime:
node_modules/.bin/tsx -e "await import('./api/_lib/aiFactory.ts'); console.log('ok')"
```

This would have caught the bug in seconds.

## Audit consequence

This finding **blocks the live persona×JD matrix (Phase 3) and the live edge-case battery (Phase 4)** from running against the local environment. The audit pivots those phases to static analysis using the prompts and the validation/ files. This is recorded in the FINAL-REPORT alongside the toolkit_credits exploit as the second P0 launch blocker.
