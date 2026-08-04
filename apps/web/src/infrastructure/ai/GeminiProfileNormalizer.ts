// Infrastructure — Gemini implementation of IProfileItemNormalizer
// ("polished profile"). Direct-Google port of OpenRouterProfileNormalizer.
//
// One cheap, deterministic (temp 0) call per profile item, run on profile SAVE —
// not per generation, so it is off the 2-call paid hot path. Deadline 30s: this
// runs in the background of a profile edit, so a slow attempt should die rather
// than hold a function open.
//
// PORT NOTES (this file is the canonical template for the other 7 generators):
//   • Transport is GeminiClient. The model fallback chain is now walked
//     CLIENT-side (Google has no server-side models[] equivalent), so `models`
//     is an ordered array and the client advances on transport failure.
//   • `thinkingLevel` defaults to MINIMAL inside the client. Do not pass
//     thinkingBudget:0 — it returns 400 on 3.5-flash-lite and 3.6-flash.
//   • Usage fields are camelCase now (`promptTokens`, not `prompt_tokens`) and
//     include `thoughtTokens` + `attempts`. `vite build` does NOT type-check
//     src/, so a typo here fails silently and cost telemetry degrades to a
//     4-chars/token estimate — worth the care.
//   • The catch block copies `err.attempts` into the sink so a FAILED call still
//     records which models were tried; otherwise failures log an empty chain.
//
// Model choice: 3.5-flash-lite leads everywhere — measured fastest (1.9s vs 3.0s
// for 3.1-flash-lite on the optimizer), 0 thought tokens, cleanest Bengali, and
// priced identically to the gemini-2.5-flash this project used to run.
// 3.1-flash-lite is the cheaper fallback and adequate for mechanical work.
// NOTE: unlike the OpenRouter chain, there is no non-Google last resort — the
// Llama escape hatch is gone, so a Google-wide outage fails this path.

import { NormalizedItemContent } from '../../domain/entities/Resume.js';
import {
  IProfileItemNormalizer,
  ProfileItemContext,
} from '../../domain/usecases/NormalizeProfileItemUseCase.js';
import { resetUsageAttempt, type UsageSink } from './usage.js';
import { fixBrandSpellingsInAll } from './prompts/brandFidelity.js';
import { GeminiClient, GeminiError, GEMINI_MODELS, withRetry, rotateModels } from './GeminiClient.js';
import {
  NORMALIZER_SYSTEM_INSTRUCTION,
  buildNormalizerUserPrompt,
  NORMALIZER_SCHEMA,
} from './prompts/normalizerPrompts.js';

const NORMALIZER_MODELS = [GEMINI_MODELS.FLASH_LITE_35, GEMINI_MODELS.FLASH_LITE_31];

export class GeminiProfileNormalizer implements IProfileItemNormalizer {
  private readonly client: GeminiClient;
  // 30s gives room for 3 attempts of the richer output before giving up —
  // still a background save, well under the 60s function cap.
  private readonly deadlineMs = 30_000;

  constructor(apiKey: string) {
    this.client = new GeminiClient(apiKey);
  }

  async normalize(
    text: string,
    context: ProfileItemContext,
    usage?: UsageSink,
  ): Promise<NormalizedItemContent> {
    return withRetry(async (remainingMs, attempt) => {
      // Lead each retry with the next model: a per-minute 429 is scoped
      // PerProjectPerModel, so rotating escapes the throttle immediately
      // instead of waiting out Google's advised ~53s window.
      const chain = rotateModels(NORMALIZER_MODELS, attempt);
      // Clear last attempt's token fields so a failure row can't inherit them —
      // see resetUsageAttempt.
      resetUsageAttempt(usage);
      try {
        const result = await this.client.generate(
          {
            models: chain,
            systemInstruction: NORMALIZER_SYSTEM_INSTRUCTION,
            contents: buildNormalizerUserPrompt(text, context),
            responseJsonSchema: NORMALIZER_SCHEMA as Record<string, unknown>,
            temperature: 0,
            // Headroom for a rich multi-project entry to serialize fully — a
            // dense native entry can run ~1500-2000 completion tokens; 4000
            // keeps strict schema output from truncating mid-object (which
            // trips JSON.parse → the no-bullets retry path).
            maxOutputTokens: 4000,
          },
          remainingMs,
        );

        if (usage) {
          usage.provider = 'gemini';
          usage.model = result.model;
          usage.promptTokens = result.usage?.promptTokens;
          usage.completionTokens = result.usage?.completionTokens;
          usage.thoughtTokens = result.usage?.thoughtTokens;
          usage.attempts = result.attempts;
        }

        const parsed = JSON.parse(result.text) as NormalizedItemContent;
        if (!Array.isArray(parsed.bullets) || parsed.bullets.length === 0) {
          throw new Error('Normalizer returned no bullets');
        }
        // Defensive trims — tiny payload, cheap to sanitize. Awards render as
        // ONE tight resume line. For everything else the prompt scales
        // bullet/skill count to the input's richness (faithful expansion —
        // pre-trimming here is permanent loss); the 20-caps are defensive
        // anti-runaway ceilings, NOT targets.
        const isAward = context.kind === 'award';
        parsed.bullets = parsed.bullets.map((b) => b.trim()).filter(Boolean).slice(0, isAward ? 1 : 20);
        parsed.skills = (parsed.skills ?? []).map((s) => s.trim()).filter(Boolean).slice(0, 20);

        // Repair local brand names against the candidate's OWN spelling. Done
        // HERE rather than downstream because these bullets are STORED as the
        // polished profile — the optimizer, cover letter, outreach and LinkedIn
        // note all build on them, so a corruption saved here is inherited by
        // every artifact the user ever generates. Measured 2026-08-04: "bkash"
        // came back as "bakesh" roughly 1 run in 10, which zeroes the ATS match
        // on the single best keyword a BD fintech candidate has.
        {
          const evidence = `${text} ${context.title ?? ''} ${context.organization ?? ''} ${context.technologies ?? ''}`;
          const b = fixBrandSpellingsInAll(parsed.bullets, evidence);
          parsed.bullets = b.values;
          const k = fixBrandSpellingsInAll(parsed.skills, evidence);
          parsed.skills = k.values;
          const fixes = [...b.corrections, ...k.corrections];
          if (fixes.length) {
            console.info(`[normalizer] corrected ${fixes.length} brand spelling(s): ${fixes.map((c) => `${c.from}->${c.to}`).join(', ')}`);
          }
        }

        // Subtle coaching only: a single hint at most — the polish itself is
        // the product; we never pile instructions on the user.
        let gaps = (parsed.gaps ?? []).map((g) => g.trim()).filter(Boolean);
        if (isAward) {
          // Awards capture title/issuer/date in structured fields, so the model
          // must not nudge for them. The prompt asks this, but models still
          // slip ("add the year"), so drop such gaps deterministically.
          gaps = gaps.filter((g) => !/\b(year|date|timeframe|time frame|when|month)\b/i.test(g));
        }
        parsed.gaps = gaps.slice(0, 1);
        return parsed;
      } catch (err) {
        // Preserve the attempt chain on failure too, so ai_call_log can show
        // which models were tried on a call that ultimately failed.
        if (usage && err instanceof GeminiError && err.attempts.length) {
          usage.provider = 'gemini';
          usage.attempts = err.attempts;
        }
        throw err;
      }
      // 3 attempts (not the default 2): a transient 0-token provider failure has
      // bitten twice in a row before, so one more retry inside the 30s budget
      // meaningfully raises the chance a save's polish lands.
    }, this.deadlineMs, 3);
  }
}
