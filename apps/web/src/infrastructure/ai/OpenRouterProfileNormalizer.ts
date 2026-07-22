// Infrastructure — OpenRouter implementation of IProfileItemNormalizer
// ("polished profile").
//
// One cheap, deterministic (temp 0) call per profile item, run on profile
// SAVE — not per generation. Flash-Lite primary (same cost tier as the
// extractor), Flash fallback. Strict json_schema so the small payload can't
// malform. Deadline 20s: this runs in the background of a profile edit, so a
// slow attempt should die quickly rather than hold a function open.

import { NormalizedItemContent } from '../../domain/entities/Resume.js';
import {
  IProfileItemNormalizer,
  ProfileItemContext,
} from '../../domain/usecases/NormalizeProfileItemUseCase.js';
import type { UsageSink } from './usage.js';
import { OpenRouterClient, withRetry } from './OpenRouterClient.js';
import {
  NORMALIZER_SYSTEM_INSTRUCTION,
  buildNormalizerUserPrompt,
  NORMALIZER_SCHEMA,
} from './prompts/normalizerPrompts.js';

// VERIFY slugs at https://openrouter.ai/models before each release.
// Both primaries are Google models, so a Google-side outage or free-tier
// rate-limit fails BOTH on one round trip — the recurring 0-token error we saw.
// A non-Google last resort (Llama) lets OpenRouter route around Google entirely
// on the same request; it handles the strict json_schema fine (it's the
// optimizer's fallback too) and is only reached when both Gemini models fail.
const NORMALIZER_MODELS = [
  'google/gemini-2.5-flash-lite',
  'google/gemini-2.5-flash',
  'meta-llama/llama-3.3-70b-instruct',
];

export class OpenRouterProfileNormalizer implements IProfileItemNormalizer {
  private readonly client: OpenRouterClient;
  // 30s (was 20s) gives room for 3 attempts of the now-richer output before
  // giving up — still a background save, well under the 60s function cap.
  private readonly deadlineMs = 30_000;

  constructor(apiKey: string) {
    this.client = new OpenRouterClient(apiKey);
  }

  async normalize(
    text: string,
    context: ProfileItemContext,
    usage?: UsageSink,
  ): Promise<NormalizedItemContent> {
    return withRetry(async (remainingMs) => {
      const result = await this.client.chat(
        {
          model: NORMALIZER_MODELS[0],
          models: NORMALIZER_MODELS,
          messages: [
            { role: 'system', content: NORMALIZER_SYSTEM_INSTRUCTION },
            { role: 'user', content: buildNormalizerUserPrompt(text, context) },
          ],
          response_format: { type: 'json_schema', json_schema: { name: 'normalized_item', strict: true, schema: NORMALIZER_SCHEMA } },
          temperature: 0,
          // Headroom for a rich multi-project entry to serialize fully — the
          // prompt now scales bullets/skills to the input, so a dense native
          // entry can run ~1500-2000 completion tokens; 4000 keeps strict
          // json_schema output from truncating mid-object (which trips
          // JSON.parse → the no-bullets retry path). Runs once on profile SAVE
          // on cheap Flash-Lite, off the 2-call generation hot path.
          max_tokens: 4000,
          reasoning: { enabled: false },
          provider: { data_collection: 'deny', allow_fallbacks: true },
        },
        remainingMs,
      );

      if (usage) {
        usage.provider = 'openrouter';
        usage.model = result.model;
        usage.promptTokens = result.usage?.prompt_tokens;
        usage.completionTokens = result.usage?.completion_tokens;
      }

      const parsed = JSON.parse(result.content) as NormalizedItemContent;
      if (!Array.isArray(parsed.bullets) || parsed.bullets.length === 0) {
        throw new Error('Normalizer returned no bullets');
      }
      // Defensive trims — tiny payload, cheap to sanitize. Awards belong on a
      // resume as a single tight line, not a multi-bullet block.
      // Awards render as ONE tight resume line. For everything else the prompt
      // scales bullet/skill count to the input's richness (faithful expansion —
      // pre-trimming here is permanent loss); the 20-caps are defensive
      // anti-runaway ceilings, NOT targets — real single items never approach them.
      const isAward = context.kind === 'award';
      parsed.bullets = parsed.bullets.map(b => b.trim()).filter(Boolean).slice(0, isAward ? 1 : 20);
      parsed.skills = (parsed.skills ?? []).map(s => s.trim()).filter(Boolean).slice(0, 20);
      // Subtle coaching only: a single hint at most — the polish itself is
      // the product; we never pile instructions on the user.
      let gaps = (parsed.gaps ?? []).map(g => g.trim()).filter(Boolean);
      if (isAward) {
        // Awards capture title/issuer/date in structured fields, so the model
        // must not nudge for them. The prompt asks this, but models still slip
        // ("add the year/timeframe") — so drop such gaps deterministically.
        gaps = gaps.filter(g => !/\b(year|date|timeframe|time frame|when|month)\b/i.test(g));
      }
      parsed.gaps = gaps.slice(0, 1);
      return parsed;
      // 3 attempts (was the default 2): the transient 0-token provider failure
      // has bitten twice-in-a-row before, so one more retry within the 30s
      // budget meaningfully raises the chance a save's polish lands.
    }, this.deadlineMs, 3);
  }
}
