# ADR-0002: Single AI provider — direct Google Gemini, no aggregator

- **Date:** 2026-08-04
- **Status:** Accepted

## Context

The AI layer had been through two providers. It began on Google AI Studio directly, then moved to **OpenRouter** in June 2026 to cut cost and reach DeepSeek behind one key and one bill.

OpenRouter did not hold up in production. Roughly **30% of Gemini calls failed** with an upstream shared-pool 429 that arrives as **HTTP 200 + `finish_reason: 'error'`** — a shape OpenRouter's own `models[]` fallback does not treat as a failure. The cause is structural rather than transient: OpenRouter routes Gemini traffic over its *own pooled* Google credentials, so buying OpenRouter credits buys spend, not quota. Three successive mitigations shipped against it (a `finish_reason=error` detector, per-retry chain rotation, wider retry budgets) and none addressed the cause.

Two facts discovered while evaluating the exit reshaped the decision:

1. **`gemini-2.5-flash` and `gemini-2.5-flash-lite` return HTTP 404** — *"no longer available to new users"* — on a freshly created key, versioned aliases included. They still appear in `models.list`, so listing a model is not proof you can call it. OpenRouter could still serve them only because its own Google account is grandfathered. Going direct therefore **forced** a move to Gemini 3.x; it was not an optional upgrade.
2. **`gemini-3.5-flash-lite` is priced identically to `gemini-2.5-flash`** ($0.30/$2.50 per 1M) and is Google's own documented replacement for it. Measured on our real prompts it was the fastest of the candidates (optimizer 1.9s vs 11.9s for `3.6-flash`), emitted zero thought tokens, and produced the cleanest Bengali.

Cost turned out not to be a deciding factor at all. Measured spend across the whole prior quarter was **$0.199**, and a paid generation costs **~$0.0101** against ~$1.59 net revenue per ৳200 five-credit pack — about **3% of net revenue**. Even the most expensive credible option left >86% margin. The binding constraints were **reliability** and **Bengali output quality**, not price.

## Decision

**One provider: the direct Google Gemini API, one key (`GEMINI_API_KEY`), no aggregator.**

1. A single transport, `src/infrastructure/ai/GeminiClient.ts`, on `@google/genai`. All eight generators wrap it; `api/_lib/aiFactory.ts` gates on `GEMINI_API_KEY` alone.
2. **Failover moves client-side.** Google has no server-side `models[]`, so `generate()` walks an ordered chain inside one shared wall-clock budget. `gemini-3.5-flash-lite` leads every chain.
3. **Gemini 3.x only.** 2.5 is unreachable and must not be reintroduced.
4. **Groq is removed too.** Its `MultiProviderResumeOptimizer` path was only reachable when `OPENROUTER_API_KEY` was unset — effectively never — and `llama-3.3-70b` is weak at Bengali, so the bilingual toolkit it would have served was not an acceptable degradation. It was nominal resilience, not real.
5. **The key must be on a paid tier.** Google's free tier trains on submitted prompts and permits human review; ToS §3 promises users otherwise. Spend is bounded by a Cloud Console **spend cap** budget (a plain budget only sends email) scoped to the Gemini API service, beneath a mandatory Tier-1 cap.
6. **Failure telemetry is part of the decision, not a follow-up.** Migration 020 adds `error_code`, `error_message`, `model_attempts`, `thought_tokens`, `attempt_count`. The old schema could not answer "why did this fail, and on which model" — which is precisely why the 429 problem went undiagnosed for weeks.

## Why not the alternatives

- **OpenRouter with BYOK** (attach our own Google key to OpenRouter) genuinely fixes the quota problem, costs nothing below 1M requests/month, and needs zero code change. Rejected because the operator wants one vendor, one bill, one dashboard — a legitimate preference, and BYOK still leaves an intermediary in the request path for no remaining benefit.
- **A non-Google primary** (Claude Haiku 4.5 at +128% cost, or GPT-5-mini at −19%) would have removed the Google dependency entirely. Rejected because it stakes the bilingual EN/BN toolkit — a genuine differentiator for a Bangladeshi audience — on unverified Bengali quality, in exchange for solving a problem (cost) that measurement showed we do not have.
- **`gemini-3.6-flash` as primary.** Rejected on evidence: 4× the cost, 6× slower, and *dirtier* Bengali than the flash-lite model. It is a mid-chain fallback only.
- **Vertex AI.** Provisioned throughput and enterprise controls we do not need, at meaningful GCP setup cost.

## Consequences

- **Single-vendor concentration, accepted knowingly.** Every model in every chain is Google, so a Google-wide outage takes down all six AI workloads simultaneously. The former non-Google last resort is gone. Adding a second provider later is cheap — the app depends on the domain interfaces (`IResumeOptimizer`, `IToolkitGenerator`, …), not on these classes — but it is a deliberate future decision, not an oversight.
- Provider-specific knowledge now lives in the codebase and must not be "simplified" away: `thinkingBudget: 0` returns 400 on two of the three models (`thinkingLevel: MINIMAL` is the only portable form); Google returns **400, not 401**, for a bad API key; a 429's human message is byte-identical for per-minute and per-day limits, so only the structured `quotaId` distinguishes them.
- `@google/genai` inverts role: it is now the *active* dependency, not the legacy one slated for removal.
- `TermsOfService.tsx` §3, §5 and §7 no longer name Groq, and §3 now states the paid-tier data commitment.
- Verification is script-based, since the repo has no test harness: `npm run ai:selftest` (offline classifier regression over recorded real payloads, plus a live taxonomy walk) and the `bench` / `e2e` / `tier` / `gaps` modes of `apps/web/scripts/ai-probe.ts`.

## Trigger to revisit

- A Google outage causes user-visible downtime — add a second provider behind the existing interfaces.
- Bengali quality regresses on a Gemini model update, or a non-Google model demonstrably beats it on our own bilingual fixtures.
- Volume grows to where the Tier-1 $250/month cap or the 300 RPM limit binds.
- Google gates or reprices `gemini-3.5-flash-lite` the way it gated 2.5.
