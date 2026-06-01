# TOP CANDIDATE — OpenRouter Migration Plan

> ⚠️ **STATUS: NOT IMPLEMENTED — proposal only (as of 2026-06-01).** None of this has shipped. The live code still uses **Groq + Gemini direct**: `api/_lib/aiFactory.ts` builds only `MultiProviderResumeOptimizer` (Groq primary → Gemini fallback) plus the Gemini toolkit/extractor generators. There is **no `OpenRouterClient`, no `OPENROUTER_API_KEY`, and no OpenRouter entry in `aiFactory.ts` or `dependencies.ts`**. `@google/genai` is still a dependency. Treat everything below as a forward-looking design doc, not a description of the current system. If you came here looking for how AI calls actually work today, see `AGENTS.md` §9.

> Replace the current multi-provider AI stack (Groq + Gemini direct, with separate keys and separate billing) with **a single OpenRouter key** that fronts all models — DeepSeek, Llama 3.3, Gemini Flash, anything else. Add **prompt caching** on the giant static system prompts to cut input cost ~85%.
>
> Total engineering time: **~3–5 days of focused work**. Risk: medium (touches every AI call path). Rollback: easy — old generators stay in git until validated.

---

## 0. Why we're doing this

### Current pain points (verified against `api/_lib/aiFactory.ts`)
- **Two AI provider accounts** to manage: Groq (closed to new buyers anyway) and Google AI Studio. Two billing surfaces, two sets of keys, two dashboards.
- **No real spending cap**: Gemini Cloud Console only sends *alerts* — you can blow past your budget. Groq is currently free-tier-only.
- **Failover logic hand-rolled** in `MultiProviderResumeOptimizer.ts` (cooldown table, 10-min penalty box) — ~150 lines of code that OpenRouter does natively.
- **No prompt caching** today. `resumeOptimizerPrompts.ts` (34KB) + `toolkitContext.ts` (41KB) ship with every call. That's ~15K stable tokens repeated 500K+ times/year at our 50K-user target. Pure waste.
- **One model per generator**: if Gemini Flash hiccups, the toolkit fails. If Groq is down, optimizer falls all the way back to a 30s+ Gemini call.

### What OpenRouter gives us
- **One API key** for ~300 models. Single dashboard, single Stripe-billed credit balance.
- **Hard spending cap** that *rejects requests* when hit (vs Gemini's email-only alerts).
- **Native failover** via the `models:` array — pass `["deepseek/...", "llama/...", "google/..."]` and OpenRouter tries them in order on a single round trip.
- **Provider sticky routing**: OpenRouter sends follow-up requests to the same backend that just served you, **maximizing cache hits**.
- **Automatic prompt caching** for DeepSeek + Gemini 2.5 (implicit, no code changes). Optional explicit `cache_control` markers for tighter control.
- **Universal PDF input** — even for models that aren't natively multimodal, OpenRouter parses on the way in. We can finally drop the special-case Gemini `@google/genai` SDK for the resume extractor.

### Net cost impact (50K users / month projection)

| Line item | Today (direct providers) | After migration |
|---|---|---|
| Optimizer (250K paid + 250K free calls) | ~$2,400/yr | **~$400/yr** (Llama 3.3 70B via DeepInfra @ $0.20/$0.20, served through OpenRouter) |
| Toolkit (250K calls, ~15K input tokens each) | ~$5,500/yr | **~$1,000/yr** (DeepSeek V3.2 + caching = 85% input cut) |
| Extractor (125K calls) | ~$1,125/yr | **~$200/yr** (Gemini Flash-Lite via OpenRouter) |
| Failover & ops | hand-rolled | $0 |
| **Total** | **~$9,000/yr** | **~$1,600/yr** |

Savings primarily come from (a) cheaper underlying models and (b) caching the static prompt prefixes that don't change between requests.

---

## 1. Pre-flight checklist (30 min)

Do all of these before writing any code.

- [ ] Read this whole doc once end-to-end. Skim, but read.
- [ ] Confirm `npm run build` passes on `master`
- [ ] Confirm the smoke-test command from CLAUDE.md passes:
   ```bash
   node_modules/.bin/tsx -e "await import('./api/_lib/aiFactory.ts'); console.log('ok')"
   ```
- [ ] Check current Vercel env vars in dashboard: `GROQ_API_KEY`, `GEMINI_API_KEY` should both be present
- [ ] Sign up at <https://openrouter.ai> (use the same email as Vercel/Supabase/GitHub for sanity)
- [ ] Enable 2FA on OpenRouter immediately (Settings → Security)
- [ ] Create an API key: **Settings → API Keys → Create Key**. Name it `topcandidate-prod`.
- [ ] **Set the key's spending limit**: in the same UI, set **Monthly limit: $20** to start. You can raise later. Requests exceeding this will be rejected with a clear error.
- [ ] Top up $10 in credits (Settings → Credits → Add Credit). Stripe accepts BDT cards.

---

## 2. Architecture — what we're building toward

### Today

```
                   ┌─────────────────────────────────────┐
                   │      MultiProviderResumeOptimizer    │
                   │   (cooldown table, 10-min penalty)   │
                   └────────┬────────────────┬────────────┘
                            ▼                ▼
                  GroqResumeOptimizer  GeminiResumeOptimizer
                    (api.groq.com)     (@google/genai SDK)
                    GROQ_API_KEY       GEMINI_API_KEY

   GeminiToolkitGenerator ─────────────────────┐
   GeminiCoverLetterGenerator ─────────────────┤
   GeminiOutreachEmailGenerator ───────────────┼─►  @google/genai SDK
   GeminiLinkedInMessageGenerator ─────────────┤    GEMINI_API_KEY
   GeminiInterviewQuestionsGenerator ──────────┤
   GeminiResumeExtractor (PDF) ────────────────┘
```

### After

```
                  ┌──────────────────────────────────────┐
                  │    OpenRouterClient (one adapter)    │
                  │  • cache_control on system prompts   │
                  │  • models: [primary, ...fallbacks]   │
                  │  • OpenAI-compatible fetch           │
                  └──────────────────┬───────────────────┘
                                     ▼
                          api.openrouter.ai/v1
                            OPENROUTER_API_KEY
                                 (one key)
                                     │
              ┌──────────────────────┼──────────────────────┐
              ▼                      ▼                      ▼
       DeepSeek V3.2         Llama 3.3 70B (DeepInfra)  Gemini 2.5 Flash
       (toolkit primary)     (optimizer primary)        (fallback for both)
```

Six generator classes become **thin wrappers** around one client. Same prompts, same validation, same retry logic. The dirty bits (auth, failover, caching, PDF encoding) all live inside `OpenRouterClient`.

### What we delete

- `MultiProviderResumeOptimizer.ts` — failover moves to OpenRouter's `models:` array
- The `@google/genai` SDK dependency from `package.json` (eventually — keep one cycle for safety)
- `GROQ_API_KEY` and `GEMINI_API_KEY` env vars in Vercel (after validation)

### What we keep unchanged

- All domain interfaces (`IResumeOptimizer`, `IToolkitGenerator`, etc.)
- All prompts (`prompts/resumeOptimizerPrompts.ts`, `prompts/toolkitContext.ts`)
- All post-pipeline validation (`normalizeSkills`, `filterFabricatedSkills`, `reorderLeadBulletByJDFit`, etc.)
- All use cases
- `ResumeService` orchestration
- The Vercel function entry points (`api/*.ts`)
- The 2-call hot path rule

This is the load-bearing point: **clean architecture means the migration is a Layer 4 (infrastructure) change only**. Domain, application, presentation untouched.

---

## 3. Prompt caching on OpenRouter — what to actually do

Caching is the biggest cost lever in this migration. Understand it before writing code.

### Two caching modes, two different cost models

| Mode | Providers | How it works | Code change |
|---|---|---|---|
| **Implicit** | DeepSeek, Gemini 2.5, OpenAI | Provider auto-detects repeated prefixes between requests and caches them | **None — works for free** |
| **Explicit** | Anthropic, also works on Gemini for tighter control | You mark cacheable sections in the message with `cache_control: { type: "ephemeral" }` | Add markers to the message structure |

### Discount on cache hits (per OpenRouter pricing pass-through)

| Provider | Cache miss (input) | Cache hit (input) | Savings |
|---|---|---|---|
| DeepSeek V3.2 | $0.27/M | $0.027/M | **90%** |
| Gemini 2.5 Flash | $0.30/M | $0.075/M | **75%** |
| Anthropic Sonnet | $3.00/M | $0.30/M | 90% (not relevant — too expensive for us) |

### How our prompts naturally win at caching

`resumeOptimizerPrompts.ts` has structure: a **system prompt** (~3K stable tokens, never changes between calls) followed by **user content** (the JD + candidate data, changes every call).

`toolkitContext.ts` is even more cacheable: ~10K of fabrication dictionaries + fit-mode rules + guard definitions that **never vary**, followed by per-call candidate evidence + JD.

If we send the stable part *first* (which we already do — see the order in `buildSystemPrompt()` and `buildCandidateContext()`), DeepSeek auto-caches it. From the second call onward in a 30-minute window, that prefix is served at 1/10th the price.

### The math at 50K users

Per toolkit call without caching:
- ~15K input tokens × $0.27/M = $0.00405

Per toolkit call with cache hit:
- ~10K static (cached) × $0.027/M = $0.00027
- ~5K dynamic × $0.27/M = $0.00135
- **Total: $0.00162** (60% cheaper per call)

Across 250K paid toolkit calls/year: **$2,430 → $972 = ~$1,500/yr saved on toolkit input alone**.

### What we have to do in code

For DeepSeek and Gemini 2.5 (implicit caching, our primary providers): **nothing**. Just make sure the system prompt comes *first* and is *byte-identical* across calls. Don't inject timestamps, random IDs, or per-user customization into the prefix. Our prompts already follow this — verify during migration.

For explicit caching (optional, only if we want to force cache behavior on Anthropic or for tighter Gemini control), add markers like this when building messages:

```ts
const messages = [
  {
    role: 'system',
    content: [
      {
        type: 'text',
        text: SYSTEM_PROMPT_STABLE_PORTION,
        cache_control: { type: 'ephemeral' },  // <-- marks the boundary
      },
    ],
  },
  {
    role: 'user',
    content: USER_INPUT_DYNAMIC,
  },
];
```

OpenRouter forwards `cache_control` to whichever underlying provider supports it. For DeepSeek + Gemini, it's a no-op (they cache implicitly). For Anthropic, it's required.

**Recommendation:** start with implicit only. Add explicit markers later if dashboard metrics show poor cache hit rates.

### Cache key best practices (gotchas)

- The cached portion is keyed by **byte content of the prefix**. Even a single different character invalidates the cache.
- Cache lifetime is typically **5 minutes** on DeepSeek, **5 minutes** on Gemini implicit, longer on Anthropic explicit.
- **Provider sticky routing** matters: if OpenRouter sends one request to DeepSeek-via-Fireworks and the next to DeepSeek-via-Together, neither sees the other's cache. OpenRouter handles this automatically via sticky routing, but verify in the dashboard.
- Don't `console.log` the prompt with a timestamp inside the stable portion. Common mistake.

---

## 4. Step-by-step migration

Each phase is independently shippable. Don't combine phases into one PR — small PRs are easier to roll back.

### Phase 1 — Build the OpenRouter client (Day 1)

**Goal:** one low-level adapter class. No business logic yet.

Create `src/infrastructure/ai/OpenRouterClient.ts`. Mirror `GroqResumeOptimizer.ts`'s plain-`fetch` pattern. Rough shape:

```ts
// src/infrastructure/ai/OpenRouterClient.ts
//
// Single low-level client for all OpenRouter calls. OpenAI-compatible.
// Supports model fallback chain, JSON mode, multimodal (PDF), and
// passes cache_control through for explicit caching providers.

export interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | OpenRouterContentPart[];
}

export interface OpenRouterContentPart {
  type: 'text' | 'image_url' | 'file';
  text?: string;
  image_url?: { url: string };
  file?: { filename: string; file_data: string };  // base64 data URL
  cache_control?: { type: 'ephemeral' };
}

export interface OpenRouterRequest {
  model: string;                          // primary model
  models?: string[];                      // fallback chain
  messages: OpenRouterMessage[];
  response_format?: { type: 'json_object' | 'json_schema'; json_schema?: object };
  temperature?: number;
  max_tokens?: number;
  // provider routing — important for sticky cache hits
  provider?: { allow_fallbacks?: boolean; data_collection?: 'allow' | 'deny' };
}

export class OpenRouterClient {
  private readonly apiKey: string;
  private readonly baseURL = 'https://openrouter.ai/api/v1';
  private readonly httpReferer = 'https://topcandidate.com';     // OpenRouter tracks this
  private readonly title = 'TOP CANDIDATE';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async chat(req: OpenRouterRequest, timeoutMs = 60_000): Promise<string> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${this.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': this.httpReferer,
          'X-Title': this.title,
        },
        body: JSON.stringify(req),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`OpenRouter ${res.status}: ${errText}`);
      }
      const data = await res.json();
      // OpenRouter returns OpenAI-compatible shape
      const content = data.choices?.[0]?.message?.content;
      if (typeof content !== 'string') {
        throw new Error('OpenRouter returned no content');
      }
      return content;
    } finally {
      clearTimeout(timer);
    }
  }
}
```

**Test this in isolation before going further:**

```bash
node_modules/.bin/tsx -e "
import { OpenRouterClient } from './src/infrastructure/ai/OpenRouterClient.ts';
const c = new OpenRouterClient(process.env.OPENROUTER_API_KEY);
const out = await c.chat({
  model: 'deepseek/deepseek-chat-v3.1',
  messages: [{ role: 'user', content: 'Reply with exactly the word PONG.' }],
  max_tokens: 10,
});
console.log(out);
"
```

Should print `PONG` (or similar). Add `OPENROUTER_API_KEY` to your shell env first. If this works, the client is good.

**Commit and merge:** `feat(ai): add OpenRouterClient base adapter`.

### Phase 2 — Port the resume optimizer (Day 2)

**Goal:** replace `GroqResumeOptimizer` + `GeminiResumeOptimizer` + `MultiProviderResumeOptimizer` with one `OpenRouterResumeOptimizer`.

Create `src/infrastructure/ai/OpenRouterResumeOptimizer.ts`:

```ts
import { OpenRouterClient } from './OpenRouterClient';
import {
  buildSystemPrompt,
  buildUserPrompt,
  validateOptimizedResponse,
  /* ...other shared exports from prompts/resumeOptimizerPrompts.ts... */
} from './prompts/resumeOptimizerPrompts';
import type { IResumeOptimizer } from '../../domain/usecases/OptimizeResumeUseCase';
import type { ResumeData, OptimizedResumeData } from '../../domain/entities/Resume';

const OPTIMIZER_MODELS = [
  'meta-llama/llama-3.3-70b-instruct',     // primary  (~$0.20/$0.20, English, JSON mode)
  'deepseek/deepseek-chat-v3.1',            // fallback ($0.27/$0.42, also great)
  'google/gemini-2.5-flash',                // fallback ($0.30/$2.50, last resort)
];

export class OpenRouterResumeOptimizer implements IResumeOptimizer {
  private readonly client: OpenRouterClient;

  constructor(apiKey: string) {
    this.client = new OpenRouterClient(apiKey);
  }

  async optimize(data: ResumeData): Promise<OptimizedResumeData> {
    const systemPrompt = buildSystemPrompt();    // STABLE — gets cached
    const userPrompt = buildUserPrompt(data);    // DYNAMIC

    const raw = await this.client.chat({
      model: OPTIMIZER_MODELS[0],
      models: OPTIMIZER_MODELS,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3,
      max_tokens: 8000,
    });

    const parsed = JSON.parse(raw) as OptimizedResumeData;
    validateOptimizedResponse(parsed);
    return parsed;
  }
}
```

Update `api/_lib/aiFactory.ts`:

```ts
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY ?? '';

export const resumeOptimizer = OPENROUTER_KEY
  ? new OpenRouterResumeOptimizer(OPENROUTER_KEY)
  : null;
```

(Keep the old Groq+Gemini chain in a `LEGACY_*` const for one PR cycle as a safety net.)

**Test:**
- `npm run build` clean
- `vercel dev` locally, run a real optimize call, compare output JSON shape against a recent production run
- Verify the post-pipeline (`normalizeSkills`, `enforceBulletDensity`, etc.) still passes — should, since we didn't touch it

**Cost validation:**
- Trigger 3 optimize calls in a row at `https://openrouter.ai/activity`
- First call: full input billed at $0.20/M (Llama, no cache)
- Second + third: input still billed at $0.20/M (Llama doesn't cache — that's expected). For DeepSeek primary, you'd see cache savings; we chose Llama as primary because it's cheaper *uncached* than DeepSeek cached, for this English-only structured task.

**Commit:** `feat(ai): port resume optimizer to OpenRouter`.

### Phase 3 — Port the combined toolkit generator (Day 3 — the hard one)

**Goal:** replace `GeminiToolkitGenerator.ts` with `OpenRouterToolkitGenerator.ts`. This is where caching pays off.

Why DeepSeek as primary here (not Llama)?
- Bilingual interview Q&A. BanglaMATH and Artificial Analysis benchmarks confirm DeepSeek matches Gemini Flash for Bengali; Llama drops noticeably.
- Toolkit prompt is fat (~15K tokens). DeepSeek's 90% cache discount applies. Llama 3.3 70B on DeepInfra does NOT cache.
- Slower (~30s) than Llama (~15s), but the toolkit runs in parallel with the optimizer so user-perceived latency = max() of the two. Optimizer is faster on Llama, so toolkit's 30s is the bottleneck either way.

Create `src/infrastructure/ai/OpenRouterToolkitGenerator.ts`:

```ts
import { OpenRouterClient } from './OpenRouterClient';
import {
  buildToolkitSystemPrompt,
  buildCandidateContext,
  assertNoFabricatedTools,
  assertOutreachSpecificity,
  assertInterviewAnchorCoverage,
  /* all your existing exports from prompts/toolkitContext.ts */
} from './prompts/toolkitContext';
import { classifyFitMode } from './prompts/toolkitContext';
import type { IToolkitGenerator } from '../../domain/usecases/GenerateToolkitUseCase';
import type { ResumeData, GeneratedToolkit } from '../../domain/entities/Resume';

const TOOLKIT_MODELS = [
  'deepseek/deepseek-chat-v3.1',         // primary — bilingual, cheap, caches
  'google/gemini-2.5-flash',              // fallback — bilingual, schema-enforced
  'meta-llama/llama-3.3-70b-instruct',   // last resort — weaker BN but reliable
];

export class OpenRouterToolkitGenerator implements IToolkitGenerator {
  private readonly client: OpenRouterClient;

  constructor(apiKey: string) {
    this.client = new OpenRouterClient(apiKey);
  }

  async generate(data: ResumeData): Promise<GeneratedToolkit> {
    const fit = classifyFitMode(data);
    const systemPrompt = buildToolkitSystemPrompt(fit);   // STABLE — caches
    const userPrompt = buildCandidateContext(data, fit);  // DYNAMIC

    const raw = await this.client.chat(
      {
        model: TOOLKIT_MODELS[0],
        models: TOOLKIT_MODELS,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.5,
        max_tokens: 6000,
      },
      90_000,  // toolkit gets a 90s ceiling — DeepSeek can be slow on long prompts
    );

    const parsed = JSON.parse(raw) as GeneratedToolkit;

    // EXISTING per-artifact validation, untouched
    assertNoFabricatedTools(parsed, data);
    if (parsed.outreachEmail) assertOutreachSpecificity(parsed.outreachEmail, data, fit.mode === 'stretch' ? 'either' : 'both');
    if (parsed.interviewQuestions && fit.mode !== 'stretch') {
      assertInterviewAnchorCoverage(parsed.interviewQuestions.map(q => q.answerStrategy), data);
    }

    return parsed;
  }
}
```

Notes:
- All your existing fabrication / specificity / anchor-coverage guards run unchanged. They live in `toolkitContext.ts` and are model-agnostic.
- `withRetry` in `ResumeService` still wraps this — one retry on guard failure, before falling back to per-item retry.
- Don't be tempted to lower `max_tokens` to save money. Truncated interview prep (especially bilingual) is what triggers anchor-coverage failures.

**Test (this is the important test):**
1. Pick 5 production resumes with diverse JDs (one tech, one banking, one pharma, one career-switcher / stretch mode, one BD-specific)
2. Run each through both the old `GeminiToolkitGenerator` and the new `OpenRouterToolkitGenerator`
3. Diff:
   - Cover letter — both should pass fabrication guard
   - Outreach email — both should hit specificity (company name + candidate proper noun)
   - LinkedIn — under 280 chars on both
   - Interview Qs — at least 6, with `questionBn` populated (this is where DeepSeek vs Gemini Bengali quality diverges; eyeball the Bangla)
4. If even one Bengali translation looks robotic, swap the model order: put `google/gemini-2.5-flash` first. Cost goes up but quality stays.

**Commit:** `feat(ai): port toolkit generator to OpenRouter with DeepSeek primary`.

### Phase 4 — Port the 4 single-artifact (per-item retry) generators (Day 4)

These are called from `/api/toolkit-item` for the free per-item regenerate flow.

Each is a smaller version of Phase 3. Same pattern:

```ts
// OpenRouterCoverLetterGenerator.ts
const MODELS = ['deepseek/deepseek-chat-v3.1', 'google/gemini-2.5-flash'];

export class OpenRouterCoverLetterGenerator implements ICoverLetterGenerator {
  constructor(private apiKey: string) {}
  async generate(data: ResumeData): Promise<string> {
    const client = new OpenRouterClient(this.apiKey);
    const fit = classifyFitMode(data);
    const raw = await client.chat({
      model: MODELS[0],
      models: MODELS,
      messages: [
        { role: 'system', content: buildCoverLetterSystemPrompt(fit) },
        { role: 'user', content: buildCandidateContext(data, fit) },
      ],
      temperature: 0.5,
      max_tokens: 1500,
    });
    assertNoFabricatedTools({ coverLetter: raw }, data);
    return raw.trim();
  }
}
```

Repeat for `OpenRouterOutreachEmailGenerator`, `OpenRouterLinkedInMessageGenerator`, `OpenRouterInterviewQuestionsGenerator`. The interview Q one needs `response_format: { type: 'json_object' }` because it returns an array of structured objects with Bangla fields.

**Test:** trigger a per-item regenerate for each artifact from the Preview screen.

**Commit:** `feat(ai): port single-artifact generators to OpenRouter`.

### Phase 5 — Port the resume extractor (Day 4 cont.)

The trickiest because it's multimodal. Currently `GeminiResumeExtractor.ts` uses `@google/genai`'s file upload feature.

OpenRouter universal PDF support lets us send the PDF as base64 inline:

```ts
// OpenRouterResumeExtractor.ts
export class OpenRouterResumeExtractor implements IResumeExtractor {
  constructor(private apiKey: string) {}

  async extract(base64File: string, mimeType: string): Promise<ResumeData> {
    const client = new OpenRouterClient(this.apiKey);
    const raw = await client.chat({
      model: 'google/gemini-2.5-flash-lite',                          // cheap; native PDF
      models: ['google/gemini-2.5-flash-lite', 'google/gemini-2.5-flash'],
      messages: [
        { role: 'system', content: EXTRACTOR_SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Extract this resume into the schema.' },
            {
              type: 'file',
              file: {
                filename: 'resume.pdf',
                file_data: `data:${mimeType};base64,${base64File}`,
              },
            },
          ],
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0,
      max_tokens: 4000,
    });
    return JSON.parse(raw) as ResumeData;
  }
}
```

OpenRouter parses Word documents and other non-PDF formats too — same `type: 'file'` syntax with appropriate `file_data` data URL.

**Test:** upload 3 real resumes (PDF, .docx, image-based PDF that requires OCR). Verify the returned `ResumeData` has the expected fields populated.

**Commit:** `feat(ai): port resume extractor to OpenRouter with universal file input`.

### Phase 6 — Cutover and cleanup (Day 5)

**6a. Update `dependencies.ts` and `api/_lib/aiFactory.ts`** to wire all new classes and remove `LEGACY_*` constants. Keep the old generator files in `src/infrastructure/ai/legacy/` for one release cycle. The DI wiring change is what flips production traffic.

**6b. Add the new env var and remove the old ones, IN THIS ORDER:**

1. Vercel dashboard → project → Settings → Environment Variables
2. **Add** `OPENROUTER_API_KEY` (production + preview + development scopes)
3. Redeploy to confirm the new key works
4. Run a real generate end-to-end on the deployed preview URL
5. Only AFTER verification: **remove** `GROQ_API_KEY` and `GEMINI_API_KEY` from Vercel

**6c. Drop the dependency:**

```bash
npm uninstall @google/genai
npm run build  # confirm nothing else references it
```

Search and remove any lingering imports:

```bash
grep -rn "@google/genai" src/ api/ index.html
```

The import map in `index.html` should also drop the `@google/genai` line.

**6d. Update `AGENTS.md`:**

This is the part where CLAUDE.md §1 will yell at you if you skip it. Update these sections:

- **§2 Tech stack** — replace "AI providers: Groq → Gemini fallback" with "AI provider: OpenRouter (single key, routes to DeepSeek primary, Llama fallback, Gemini fallback)"
- **§4 Architecture** — update the diagram to show one `OpenRouterClient` instead of separate Groq + Gemini SDK boxes
- **§7 Key files** — list new generators, mark old ones as moved to `legacy/` (or deleted, depending on what you chose)
- **§9 External services** — full rewrite of the "AI providers" subsection. Note the OpenRouter dashboard URL, the spending cap, and provider sticky routing for cache hits.
- **§12 Env vars** — remove `GROQ_API_KEY` and `GEMINI_API_KEY` lines, add `OPENROUTER_API_KEY`

Do this **in the same PR as 6a–6c**. Per CLAUDE.md, AGENTS.md must reflect reality at commit time.

**Commit:** `feat(ai): finalize OpenRouter cutover, drop Groq+Gemini direct`.

---

## 5. Validation & monitoring (ongoing)

### Day-of cutover smoke test

In incognito on the deployed URL:

- [ ] Sign in
- [ ] Build a tailored resume (paid path) → optimizer + toolkit complete in <60s
- [ ] Preview shows: resume, cover letter, outreach email, LinkedIn note, interview Qs with Bangla
- [ ] Click "Regenerate" on cover letter card → free per-item retry works
- [ ] Click "Regenerate" on interview Qs card → Bangla translations re-populate
- [ ] Build a General Resume (free path) → optimizer-only flow completes
- [ ] Upload a PDF resume → extractor returns populated `ResumeData`

If any step fails, immediate rollback:
1. Vercel → Environment Variables → re-add `GROQ_API_KEY` and `GEMINI_API_KEY`
2. Revert the cutover commit (`git revert <sha>`), push, redeploy

### Week 1 — dashboard discipline

Once a day, open <https://openrouter.ai/activity>:

- **Cache hit rate** on the toolkit generator should climb to 70–85% by day 3 once warm
- **Cost per call** should match the projections in §0:
  - Optimizer: ~$0.0016/call
  - Toolkit: ~$0.0016/call (with cache hits)
  - Extractor: ~$0.0017/call
- **Failover events** — how often Llama falls back to DeepSeek falls back to Gemini. <2% is healthy; >5% means the primary model is having problems and you should reorder.

### Spending cap behavior

When the OpenRouter $20/mo cap triggers (it shouldn't until ~5K users), users see a clean error from your `/api/optimize`. Handle it:

```ts
// in api/optimize.ts error handler, add:
if (err.message?.includes('OpenRouter 402') || err.message?.includes('credit')) {
  return res.status(503).json({
    code: 'ai_provider_credit_exhausted',
    message: 'AI service is temporarily unavailable. Please try again in a few minutes.',
  });
}
```

Set up a Slack/email alert at 70% of cap so you can top up before hitting it.

---

## 6. Risks & mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| DeepSeek's Bangla quality on a specific JD type is worse than Gemini | Medium | Phase 3 manual A/B on 5 diverse resumes. If even one fails, reorder models so Gemini is primary for toolkit. |
| OpenRouter has an outage | Low | Provider sticky routing means a single backend outage gets routed past. A full OpenRouter outage is rare and short. Keep the legacy Gemini direct path in `legacy/` for one cycle as a panic switch. |
| Cache hit rate stays low (<40%) | Low-Medium | Audit the system prompt — make sure it's byte-identical between calls. No timestamps, no user IDs in the prefix. |
| OpenRouter adds latency vs direct | Low | OpenRouter routes are typically <50ms slower than direct. Negligible for our 15–60s call durations. |
| Per-call cost is higher than projected because most calls miss cache | Medium first month | First-call cache misses are unavoidable on a fresh window. Steady-state cost is what we projected; the first 24h after a deploy will be 2–3× higher. |
| `cache_control` ergonomics burn time on Phase 3 | Low | Skip explicit caching. Implicit on DeepSeek + Gemini is enough. Revisit only if dashboard shows low cache hits. |
| Bengali interview quality regression slips past A/B | Medium | Add a simple `language === 'bn'` quality check in the post-pipeline: ratio of Latin-script characters in `questionBn` should be <30% (allowing for English terms like "CFA", "Basel III"). Throw if exceeded, triggers `withRetry`. |

---

## 7. Rollback plan

If anything goes seriously wrong after the cutover and the smoke test fails:

```bash
# 1. Revert the cutover commit
git revert <cutover-commit-sha>
git push origin master

# 2. Re-add the old env vars in Vercel
#    (GROQ_API_KEY and GEMINI_API_KEY — they're in your password manager, right?)

# 3. Verify the legacy generators in src/infrastructure/ai/legacy/ are imported again
#    The revert should restore aiFactory.ts to its previous state automatically

# 4. Wait for Vercel to redeploy (~90 seconds), smoke-test
```

The reason we move legacy generators to `legacy/` instead of deleting them in Phase 6 is exactly this scenario.

**Delete `legacy/` only after 7 days of clean OpenRouter operation in production.** Then do `npm uninstall @google/genai` and update AGENTS.md §7 to remove the legacy references.

---

## 8. Final cost picture (50K users / month, post-migration)

```
                     Per call    Annual @ scale
Optimizer (Llama)    $0.0016    × 500K calls  =  $800
Toolkit (DeepSeek    $0.0016    × 250K calls  =  $400
  with cache)
Extractor (Flash-    $0.0017    × 125K calls  =  $212
  Lite via OR)
Per-item retries     $0.0008    × 50K calls   =  $40
─────────────────────────────────────────────────────
AI subtotal                                    ~$1,450/yr
OpenRouter 5% credit top-up fee                 ~$75/yr
─────────────────────────────────────────────────────
Total AI cost                                  ~$1,525/yr
```

**Compare to today's ~$9,000/yr projection at the same scale.** Net saving: ~$7,500/yr. The savings come 50% from caching, 50% from cheaper underlying models.

Combined with everything else in `docs/PRODUCTION_SETUP.md`:

```
50K-user monthly bill (after this migration):
  Vercel Pro             $20
  Supabase Pro           $25
  OpenRouter (capped)    ~$127 ($1,525/12)
  bKash fees (1.5%)      $120 (proportional to revenue)
  Domain (1/12)          $0.87
  ─────────────────────────────
  Total                  ~$293/month
  Revenue                $81,400/month
  Net                    $81,107/month (99.6% margin)
```

---

## 9. Quick-reference checklist

Tape this next to the PRODUCTION_SETUP checklist.

- [ ] OpenRouter account, 2FA enabled, $20/mo spend cap set
- [ ] `OPENROUTER_API_KEY` added to Vercel (all three scopes)
- [ ] Phase 1: `OpenRouterClient.ts` built, isolated test passes
- [ ] Phase 2: `OpenRouterResumeOptimizer.ts` wired, real optimize call works
- [ ] Phase 3: `OpenRouterToolkitGenerator.ts` wired, 5-resume A/B passes Bengali quality
- [ ] Phase 4: 4 single-artifact generators ported, per-item retry confirmed
- [ ] Phase 5: Extractor ported, PDF + DOCX both work
- [ ] Phase 6a: `aiFactory.ts` cutover, legacy files moved to `legacy/`
- [ ] Phase 6b: Old env vars removed from Vercel **after** verification
- [ ] Phase 6c: `@google/genai` uninstalled, `index.html` import map cleaned
- [ ] Phase 6d: `AGENTS.md` §2 / §4 / §7 / §9 / §12 all updated
- [ ] Full smoke test passed on production domain
- [ ] OpenRouter dashboard checked daily for 1 week (cache hit rate, failover rate, cost per call)
- [ ] (Day 7+) `legacy/` folder deleted

---

*Last updated: 2026-05-20. Verify OpenRouter pricing and model availability at <https://openrouter.ai/models> before starting — model names and prices drift weekly.*
