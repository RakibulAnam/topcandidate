// Infrastructure — Gemini implementation of IProfileItemNormalizer
// ("polished profile"). Direct-Google port of OpenRouterProfileNormalizer.
//
// One deterministic (temp 0) call per profile item, run on profile SAVE — not
// per generation, so it is off the 2-call paid hot path. Deadline 46s (see
// deadlineMs): this runs in the background of a profile edit, so a slow attempt
// should die rather than hold a function open past Vercel's 60s cap.
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
// Model choice: 3.6-flash leads HERE (and only here). This is the stage that
// turns whatever the user typed — Bangla, Banglish, résumé-speak — into fresh
// English facts, and every résumé and toolkit is composed from its output, so
// its writing quality is the product's ceiling. Measured 2026-10-26 on the
// owner's profile: 3.5-flash-lite kept 6+ consecutive words of the user's text
// in 40–60% of bullets even with an explicit rewrite rule and a notes-first
// schema; 3.6-flash kept them in ~7%. Its tendency to inflate while rewriting
// is held by the prompt's NO INFLATION rule plus repairInflation(). Cost is
// fine because this runs once per item save (~$0.01/item); the only
// generation-time use is the General Resume's rare fallback for items that
// were never polished (ResumeService.polishedBulletsFor). The flash-lites remain as
// fallbacks (rotated to on a throttle or timeout).
// NOTE: unlike the OpenRouter chain, there is no non-Google last resort — the
// Llama escape hatch is gone, so a Google-wide outage fails this path.

import { NormalizedItemContent } from '../../domain/entities/Resume.js';
import {
  IProfileItemNormalizer,
  ProfileItemContext,
} from '../../domain/usecases/NormalizeProfileItemUseCase.js';
import { resetUsageAttempt, type UsageSink } from './usage.js';
import { GeminiClient, GeminiError, GEMINI_MODELS, withRetry, rotateModels } from './GeminiClient.js';
import {
  NORMALIZER_SYSTEM_INSTRUCTION,
  buildNormalizerUserPrompt,
  NORMALIZER_SCHEMA,
  repairInflation,
  POLISH_RULES_VERSION,
} from './prompts/normalizerPrompts.js';

const NORMALIZER_MODELS = [GEMINI_MODELS.FLASH_36, GEMINI_MODELS.FLASH_LITE_35, GEMINI_MODELS.FLASH_LITE_31];

// The lead model's share of the 46s deadline (GeminiClient firstModelTimeoutMs).
// 24s: 3.6-flash answers a typical entry in ~7s (measured 2026-10-26), and a
// lead timeout must still leave a flash-lite ~20s for the notes-first output.
const LEAD_MODEL_MS = 24_000;

export class GeminiProfileNormalizer implements IProfileItemNormalizer {
  private readonly client: GeminiClient;
  // 46s since 3.6-flash leads with the notes-first output (~7s typical, a
  // rich entry longer — capped at LEAD_MODEL_MS), leaving the flash-lite
  // fallbacks room to finish. Still a background save, with headroom under the 60s function cap
  // for auth, the DB write and telemetry.
  private readonly deadlineMs = 46_000;

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
        const request = {
          models: chain,
            systemInstruction: NORMALIZER_SYSTEM_INSTRUCTION,
            contents: buildNormalizerUserPrompt(text, context),
            responseJsonSchema: NORMALIZER_SCHEMA as Record<string, unknown>,
            temperature: 0,
            // Headroom for a rich multi-project entry to serialize fully — a
            // dense native entry can run ~1500-2000 completion tokens; 4000
            // keeps strict schema output from truncating mid-object (which
            // trips JSON.parse → the no-bullets retry path).
            // 8000 since the scratch `notes` field (one note per fact) roughly
            // doubles a rich entry's output; 4000 truncated mid-object.
            maxOutputTokens: 8000,
          };
        // Lead model capped (GeminiClient firstModelTimeoutMs) so a slow
        // 3.6-flash still leaves the flash-lites time to answer.
        // Only the slow premium lead is capped; a rotated flash-lite lead
        // keeps the whole budget.
        const capLead = chain[0] === NORMALIZER_MODELS[0] ? { firstModelTimeoutMs: LEAD_MODEL_MS } : {};
        const result = await this.client.generate({ ...request, ...capLead }, remainingMs);

        if (usage) {
          usage.provider = 'gemini';
          usage.model = result.model;
          usage.promptTokens = result.usage?.promptTokens;
          usage.completionTokens = result.usage?.completionTokens;
          usage.thoughtTokens = result.usage?.thoughtTokens;
          usage.attempts = result.attempts;
        }

        const parsed = JSON.parse(result.text) as NormalizedItemContent & { notes?: unknown };
        // Scratch work (see NORMALIZER_SCHEMA) — never part of the stored item.
        delete parsed.notes;
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
        // The title counts as the user's own words: a "Solutions Architect" keeps
        // "Architected".
        parsed.bullets = repairInflation(parsed.bullets, `${context.title ?? ''} ${context.organization ?? ''} ${context.technologies ?? ''} ${text}`);
        parsed.skills = (parsed.skills ?? []).map((s) => s.trim()).filter(Boolean).slice(0, 20);

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
        // Stamped whichever model answered: the version names the RULES the
        // facts were written under, and every model in the chain got the same
        // prompt. Leaving a fallback's output unstamped would make the backfill
        // re-polish it forever on a day the lead model is throttled.
        parsed.rulesVersion = POLISH_RULES_VERSION;
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
      // bitten twice in a row before, so one more retry inside the 46s budget
      // meaningfully raises the chance a save's polish lands.
    }, this.deadlineMs, 3);
  }
}
