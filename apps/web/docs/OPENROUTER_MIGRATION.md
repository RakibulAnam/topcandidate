# TOP CANDIDATE — OpenRouter Migration & Production AI Strategy

> **STATUS: ACTIVE — executing step by step (decided 2026-06-09).** We are migrating the AI layer from Groq + Gemini direct to a single OpenRouter key. This doc is both the *strategy* (model choices, cost, routing) and the *execution plan* (phased, code-accurate steps). It supersedes the earlier "deferred proposal" revision.
>
> **Live state (updated 2026-06-10):** Phases 0–6 merged to `master` and live in production with `OPENROUTER_API_KEY` set. **Post-launch hotfix (2026-06-10):** the first real toolkit build 504'd (FUNCTION_INVOCATION_TIMEOUT) — DeepSeek V3.2 on the **optimizer** both failed the strict ID-preserving JSON validation *and* timed out >45s on a real multi-experience resume, then a `withRetry` retry pushed past Vercel's 60s cap. **Fixes shipped:** (1) optimizer → **Gemini 2.5 Flash primary** (DeepSeek dropped from the optimizer chain — it stays a toolkit fallback only); (2) `withRetry` is now **deadline-bounded** (total wall time per generator hard-capped; timeouts never retried) so the parallel optimizer(30s) ‖ toolkit(48s) hot path always fits 60s. Re-tested 4× on a realistic profile: 21–44s, 0 failures. `@google/genai` still kept one cycle as the panic switch.
>
> **Live-test findings (2026-06-09) — model strategy refined by evidence, not the original projection:** DeepSeek V3.2 is FAST on short output (optimizer ~14s) but TIMED OUT >55s on the toolkit's ~6k-token bilingual output, exceeding Vercel's 60s cap. Gemini 2.5 Flash did the same toolkit in ~20s with all four artifacts valid and strong Bengali (Latin-script ratio 0.05). **Therefore: DeepSeek primary for the optimizer; Gemini 2.5 Flash primary for the toolkit (and single-artifact); DeepSeek/Llama as fallbacks.** The earlier "DeepSeek primary for everything" plan was wrong on latency.
>
> ⚠️ **Model slugs and prices drift weekly.** Every slug/price in this doc was verified June 2026 against OpenRouter + price aggregators (confidence noted per row). **Re-verify at <https://openrouter.ai/models> before each phase ships.**

---

## 1. Executive summary

TopCandidate has **no chat, no support bot, no coding assistant, no RAG, no agents.** It runs four server-side, structured-JSON AI jobs:

| Workload | Endpoint | Shape | Token profile (approx) |
|---|---|---|---|
| **Optimizer** | `/api/optimize`, `/api/optimize-general` | resume → JSON | ~5K in / 3K out |
| **Toolkit** (bilingual EN/BN) | `/api/optimize` | cover letter + outreach + LinkedIn + interview Qs → JSON | ~15K in / 6K out |
| **Single-artifact regen** | `/api/toolkit-item` | one artifact (free retry) | ~8K in / 2K out |
| **Extractor** (multimodal) | `/api/extract-resume` | PDF/DOCX → profile JSON | ~2K in / 3K out |

**Recommended stack (validated by live testing; optimizer revised after the 2026-06-10 prod hotfix):** **Gemini 2.5 Flash primary for the optimizer AND the toolkit + single-artifact generators** — DeepSeek V3.2 was the original optimizer pick but broke the strict ID-preserving JSON and timed out on real resumes (504); it's now a toolkit-only fallback. **Llama 3.3 70B** is the optimizer fallback; **Gemini 2.5 Flash-Lite** the extractor (native PDF). Every generator is **deadline-bounded** (see §6/withRetry) so the parallel hot path fits Vercel's 60s cap. One OpenRouter key, **ZDR routing + Western-host allow-list**, **hard monthly spend cap.**

**Why this is safe to do as a Layer-4 change:** the domain interfaces (`IResumeOptimizer`, `IToolkitGenerator`, `ICoverLetterGenerator`, `IResumeExtractor`, …), use cases, `ResumeService`, presentation, and the `/api/*` entry points all stay untouched. Only `src/infrastructure/ai/` + `api/_lib/aiFactory.ts` change.

---

## 2. Verified models & pricing (per 1M tokens, June 2026)

| Model | Slug | Input | Output | Ctx | JSON | Role here | Conf |
|---|---|---|---|---|---|---|---|
| **DeepSeek V3.2** | `deepseek/deepseek-v3.2` | $0.229 | $0.343 | 131K | Yes | **Toolkit fallback only** — dropped from the optimizer (broke ID-preserving JSON + timed out, 2026-06-10 504) | High |
| **Gemini 2.5 Flash** | `google/gemini-2.5-flash` | $0.30 | $2.50 | 1M | Yes | **Toolkit + single-artifact primary**; optimizer fallback | High |
| **Gemini 2.5 Flash-Lite** | `google/gemini-2.5-flash-lite` | $0.10 | $0.40 | 1M | Yes | **Extractor primary** (native PDF) | High |
| **Llama 3.3 70B** | `meta-llama/llama-3.3-70b-instruct` | $0.10 | $0.32 | 128K | via prompt | Optimizer fallback (English) | High |
| **Qwen3 235B** | `qwen/qwen3-235b-a22b` | ~$0.46 | ~$0.90 | 256K | Yes | Optional BN fallback (119 langs incl. Bengali) | Med |
| GLM-4.6 / Kimi K2 | `z-ai/glm-4.6` / `moonshotai/kimi-k2` | ~$0.43 / ~$0.55 | ~$1.74 / ~$2.20 | ~200–256K | Yes | **Not used** — coding/agent focus, pricey output | Med |

**Avoid for this product:** Gemini Flash as the toolkit *primary* (its $2.50/M output makes the verbose toolkit ~4× costlier); GLM/Kimi (wrong domain); any reasoning/`-exp`/`-preview` slug in prod (reasoning tokens bill as output and blow up structured-task cost; preview slugs get deprecated).

**Sources:** [OpenRouter Models](https://openrouter.ai/models) · [DeepSeek V3.2](https://openrouter.ai/deepseek/deepseek-v3.2) · [Gemini 2.5 Flash-Lite](https://openrouter.ai/google/gemini-2.5-flash-lite) · [pricepertoken.com](https://pricepertoken.com/) · [costgoat Jun 2026](https://costgoat.com/compare/llm-api)

---

## 3. Cost analysis

A **"generation"** = optimizer + toolkit (the 2-call paid hot path). There is no chat turn to bill.

**Per generation:**

| Stack | Per generation | Per 1,000 |
|---|---|---|
| DeepSeek both (no cache) | **~$0.0077** | ~$7.70 |
| DeepSeek both (warm toolkit cache) | ~$0.0056 | ~$5.60 |
| Llama optimizer + DeepSeek toolkit | ~$0.0070 | ~$7.00 |
| Gemini Flash both | ~$0.0285 | ~$28.50 |

Free General Resume (optimizer only): ~$0.0026 DeepSeek / ~$0.0015 Llama. Extractor (Flash-Lite/upload): ~$0.0014.

**By scale** (assume ~50% of registered users generate monthly; each active ≈ 3 paid + 1 free + 2 retries + 1 extract ≈ **$0.04/active user/mo**):

| Registered | Active | Est. monthly AI cost |
|---|---|---|
| 100 | 50 | **~$2** |
| 1,000 | 500 | **~$20** |
| 10,000 | 5,000 | **~$200** |

Your $15–20/mo target ≈ ~1,000 users. At 10K, ~$200/mo — but a 5-credit pack is ৳200 (~$1.65) and costs ~$0.0077 in AI → **AI COGS ≈ 0.5% of paid revenue.** Cost scales *with* revenue.

**Worst case:** abuse of free/retry paths. Now bounded by the per-user 20-calls/day cap (failed calls counted — see §rate-limit below) **and** the OpenRouter hard cap (rejects at limit). Reasoning-token blowup avoided by disabling reasoning.

**Safeguards (all required):** hard **$20/mo** cap on the key; **alert at 70%** ($14); `max_tokens` ceilings (optimizer 8K, toolkit 6K); reasoning disabled.

**Token optimization (priority order):** (1) disable reasoning, (2) implicit prompt caching on the ~10K static toolkit prefix (ZDR-compatible), (3) keep the system prompt byte-identical so caching fires, (4) trim evidence corpus if toolkit input >15K.

---

## 4. Architecture

```
   Vercel /api/{optimize,toolkit-item,extract-resume,optimize-general}
        │  JWT auth · credit gate · rateLimit (20/day, failures counted) · logCall→analytics
        ▼
   OpenRouterClient (one fetch adapter)
     • models[] failover    • response_format: json_object    • reasoning:{enabled:false}
     • provider:{ data_collection:'deny', only:[vetted hosts] } / zdr:true
     • timeout ≤55s (Vercel cap 60s)    • returns { content, model, usage }→UsageSink→aiCost
        │
   ┌─────────────┼──────────────┐
   ▼             ▼              ▼
 OPTIMIZER         TOOLKIT           EXTRACTOR
 gemini-2.5-flash  gemini-2.5-flash  gemini-2.5-flash-lite
 llama-3.3-70b     deepseek-v3.2     gemini-2.5-flash
                   llama-3.3-70b
```

| Concern | Design |
|---|---|
| Primary/fallback | Per-workload `models[]` chain (above) |
| Failover | Native via `models[]`; optional thin cooldown wrapper |
| Rate limiting | `ai_call_log` 20/day, **failures counted** (done) |
| Retry | Existing `withRetry` + `safeJsonParse`; **`embedSchemaSpec:true`** for json_object |
| Caching | Implicit (DeepSeek/Gemini), ZDR-safe, implicit-only to start |
| Cost monitoring | `UsageSink → resolveCost → logCall` (migration 013); update `aiCost.ts` PRICE_TABLE |
| Analytics | Admin Revenue/Product/System BI tabs |
| Error handling | Per-artifact `errors` map (never reintroduce all-or-nothing throw); 402/credit-exhausted → clean 503 |
| Observability | Structured `[scope rid]` logs + admin tiles; **add Sentry** + `GET /api/health` (post-migration) |

### PII / data routing (hard requirement before cutover)
Resumes are heavy PII. OpenRouter defaults to fanning out to third-party hosts; DeepSeek's first-party endpoint is China-based. Therefore on **every** request:
- `provider: { data_collection: 'deny' }` and/or `zdr: true` (OpenRouter's [ZDR routing](https://openrouter.ai/docs/guides/features/zdr) — implicit KV caching is ZDR-compatible per OpenRouter).
- `provider.only: [...]` to allow-list vetted Western hosts (DeepInfra/Fireworks/Together/Novita) for the DeepSeek model — **Chinese model ≠ Chinese hosting; routing controls where inference runs.**
- Name the AI sub-processors honestly in `PRIVACY.md` (owed before BD launch regardless).

---

## 5. Implementation gotchas — the real code (DO NOT skip)

These are verified facts about the current code. The earlier draft of this doc got them wrong; the snippets in §6 are correct against these.

| Area | Reality (verified) |
|---|---|
| Optimizer prompt | Export is **`buildSystemInstruction()`** (not `buildSystemPrompt`). `buildUserPrompt(data, { embedSchemaSpec })` — Gemini passes `false` (uses `responseSchema`), **Groq passes `true`**. For OpenRouter `json_object` you **must pass `true`** (no schema enforcement). `validateOptimizedResponse(input, output)` — **two args**. `safeJsonParse` exists. |
| Toolkit prompt | The toolkit system instruction is a **private method `buildSystemInstruction(mode)` inside `GeminiToolkitGenerator`** (+ `stretchSystemBlock()`), **not** in `toolkitContext.ts`. Phase 0 extracts it. |
| Toolkit validation | `generate()` validates **per artifact in try/catch into an `errors` map** and ships good artifacts even when one fails. **Never** lift guards to top-level throws. Guard signature: `assertNoFabricatedTools(output: string, data, options?)` — takes a **string**; lower-level `detectFabricatedTokens(text, evidence)` is used per artifact. |
| Telemetry | Every generator takes a trailing **`usage?: UsageSink`** and fills `provider/model/promptTokens/completionTokens`; `optimize.ts` feeds it to `resolveCost`+`logCall`. The OpenRouter client **must surface `usage`** or the BI dashboards go blind. Add new model ids to `api/_lib/aiCost.ts` PRICE_TABLE. |
| Timeouts | `vercel.json` `maxDuration: 60`. Cap any client timeout **≤55s** (a 90s timeout is a silent no-op). |
| Extractor | `IResumeExtractor.extract(fileData, mimeType[, usage]): Promise<ExtractedProfileData>` — partial profile, **not** `ResumeData`. |
| aiFactory | Exports `resumeOptimizer`, `toolkitGenerator`, `coverLetterGenerator`, `outreachEmailGenerator`, `linkedInMessageGenerator`, `interviewQuestionsGenerator`, `resumeExtractor` — each `null` if its key is missing. |

---

## 6. Step-by-step execution

Each phase is an independent PR. Keep Groq+Gemini live until the final cutover. `OPENROUTER_API_KEY` (server-only, never `VITE_`) is required to test Phases 1+.

### Phase 0 — Extract system prompts to the shared module
Move `buildSystemInstruction(mode)` / `stretchSystemBlock()` / `buildPrompt(...)` out of `GeminiToolkitGenerator` (and the cover-letter/outreach/etc. classes) into `prompts/toolkitContext.ts` (or a sibling `toolkitPrompts.ts`). **Pure refactor, zero behavior change.** Verify: `npm run build` clean + `node_modules/.bin/tsx -e "await import('./api/_lib/aiFactory.ts')"` ok + a manual generate produces byte-identical prompts.

### Phase 1 — `OpenRouterClient`
`src/infrastructure/ai/OpenRouterClient.ts` — surfaces `usage`, ≤55s timeout, ZDR routing:

```ts
export interface OpenRouterUsage { prompt_tokens?: number; completion_tokens?: number; }
export interface OpenRouterResult { content: string; model?: string; usage?: OpenRouterUsage; }
export interface OpenRouterContentPart {
  type: 'text' | 'image_url' | 'file';
  text?: string; image_url?: { url: string };
  file?: { filename: string; file_data: string }; cache_control?: { type: 'ephemeral' };
}
export interface OpenRouterMessage { role: 'system'|'user'|'assistant'; content: string | OpenRouterContentPart[]; }
export interface OpenRouterRequest {
  model: string; models?: string[]; messages: OpenRouterMessage[];
  response_format?: { type: 'json_object' }; temperature?: number; max_tokens?: number;
  reasoning?: { enabled: boolean };
  provider?: { allow_fallbacks?: boolean; data_collection?: 'deny'; only?: string[]; zdr?: boolean };
}

export class OpenRouterClient {
  private readonly baseURL = 'https://openrouter.ai/api/v1';
  constructor(private readonly apiKey: string) {}
  async chat(req: OpenRouterRequest, timeoutMs = 55_000): Promise<OpenRouterResult> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${this.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json',
          'HTTP-Referer': 'https://topcandidate.app', 'X-Title': 'TOP CANDIDATE',
        },
        body: JSON.stringify(req), signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
      const data = await res.json();
      const content = data.choices?.[0]?.message?.content;
      if (typeof content !== 'string') throw new Error('OpenRouter returned no content');
      return { content, model: data.model, usage: data.usage };
    } finally { clearTimeout(timer); }
  }
}
```
Smoke test: `tsx` a one-line PONG call against a **verified** DeepSeek slug.

### Phase 2 — Optimizer (`OpenRouterResumeOptimizer implements IResumeOptimizer`)
Use `buildSystemInstruction()`, `buildUserPrompt(data, { embedSchemaSpec: true })`, `validateOptimizedResponse(data, parsed)`, `safeJsonParse`, fill `usage`. Models: `[deepseek-v3.2, gemini-2.5-flash, llama-3.3-70b-instruct]`. `provider:{ data_collection:'deny' }`, `reasoning:{ enabled:false }`. A/B the JSON parse-failure rate vs Gemini before trusting it.

### Phase 3 — Toolkit (`OpenRouterToolkitGenerator implements IToolkitGenerator`)
After Phase 0. Use the extracted `buildToolkitSystemInstruction(fit.mode)` + `buildCandidateContext`. **Mirror the per-artifact `errors`-map validation exactly** (`detectFabricatedTokens` per artifact, `assertOutreachSpecificity(text, data, mode)`, `assertInterviewAnchorCoverage` when `fit.mode !== 'stretch'`). Models: `[gemini-2.5-flash, deepseek-v3.2, meta-llama/llama-3.3-70b-instruct]` — **Gemini primary** (DeepSeek timed out >55s on the long bilingual output in live testing; Gemini ~20s). Timeout ≤55s. ✅ Live-tested 2026-06-09: 20.3s, all 4 artifacts valid, Bengali Latin-ratio 0.05.

### Phase 4 — Single-artifact generators
Port cover-letter/outreach/LinkedIn/interview the same way (free `/api/toolkit-item`). Guards take **strings** (A5). Keep `usage`. Interview-Q needs `response_format: json_object`.

### Phase 5 — Extractor (`OpenRouterResumeExtractor implements IResumeExtractor`)
`extract(fileData, mimeType, usage?): Promise<ExtractedProfileData>`. Send the file as a `file` content part (base64 data URL); model `gemini-2.5-flash-lite` → `gemini-2.5-flash`. **Confirm real PDF + DOCX extraction works on OpenRouter before dropping `@google/genai`** — OpenRouter file input may need the file-parser plugin; this is the riskiest phase.

### Phase 6 — Cutover & clean the old engine
- Flip `aiFactory.ts` exports to OpenRouter classes behind the key check; move old `Gemini*`/`Groq*`/`MultiProvider*` to `src/infrastructure/ai/legacy/` (keep one release cycle as the panic switch).
- Update `api/_lib/aiCost.ts` PRICE_TABLE (deepseek-v3.2, llama-3.3-70b-instruct, gemini-2.5-flash-lite) and **`AGENTS.md` §2/§4/§7/§9/§12 in the same PR**.
- Vercel env: **add** `OPENROUTER_API_KEY` (all scopes) → redeploy → real end-to-end generate on preview → only then **remove** `GROQ_API_KEY`/`GEMINI_API_KEY`.
- After the validation window (7 clean days): `npm uninstall @google/genai`, `grep -rn "@google/genai" src/ api/ index.html`, drop the import-map line, **delete `legacy/`**.

---

## 7. Launch checklist

- [ ] §5 gotchas respected in every ported class
- [ ] PII routing: ZDR / `data_collection:'deny'` / host allow-list on every call; `PRIVACY.md` updated
- [ ] Slugs re-verified live; pinned in one config const
- [ ] `OPENROUTER_API_KEY` server-only; hard $20/mo cap + 70% alert
- [ ] `embedSchemaSpec:true`; reasoning disabled; `max_tokens` ceilings; ≤55s timeouts
- [ ] Per-artifact `errors` map preserved; UsageSink filled; `aiCost.ts` updated
- [ ] Extractor PDF+DOCX confirmed before `@google/genai` removal
- [ ] Legacy path retained one cycle; rollback runbook ready
- [ ] `npm run build` clean + aiFactory import smoke green; AGENTS.md updated same PR
- [ ] Sentry + `/api/health` (fast-follow)

## 8. Risk assessment

| Risk | Likelihood | Severity | Mitigation |
|---|---|---|---|
| PII to untrusted/Chinese infra | Med | High | ZDR + deny + Western-host allow-list |
| Bengali regression (DeepSeek) | Med | Med | 5-resume A/B; Latin-script-ratio check on `questionBn` (<30%)→retry; reorder Gemini-primary |
| JSON-mode malformed output | Med | Med | `embedSchemaSpec:true` + `safeJsonParse` + retry |
| Reasoning-token cost blowup | Med | Med-High | `reasoning:{enabled:false}` |
| OpenRouter full outage | Low | High | Legacy Gemini-direct panic switch (one cycle) |
| Spend cap hit mid-day | Low | Med | Hard cap + 70% alert + clean 503 |
| Slug deprecation / price drift | High | Low-Med | Pin slugs; re-verify at deploy; cost telemetry catches drift |

## 9. Rollback
Revert the cutover commit → re-add `GROQ_API_KEY`/`GEMINI_API_KEY` in Vercel → redeploy (~90s) → smoke-test. `legacy/` generators are the panic switch; delete only after 7 clean days.

---

*Strategy + pricing researched and verified 2026-06-09. Status: ACTIVE. Re-verify model slugs/prices before each phase ships.*
