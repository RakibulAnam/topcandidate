// Infrastructure — Gemini implementation of IOutreachEmailGenerator
// (hiring-manager outreach email). Direct-Google port of
// OpenRouterOutreachEmailGenerator.
//
// Single-artifact generator for the FREE per-item regenerate flow, so it sits
// off the 2-call paid hot path. Reuses the shared outreach prompt and BOTH
// guards (fabrication + specificity) unchanged — this artifact is the one most
// prone to generic filler, so a bland email is rejected rather than shipped.
//
// PORT NOTES (canonical write-up lives in GeminiProfileNormalizer):
//   • Transport is GeminiClient. The model fallback chain is walked CLIENT-side
//     (Google has no server-side models[] equivalent), so `models` is an ordered
//     array and the client advances on transport failure.
//   • `thinkingLevel` is left at the client default (MINIMAL). Do not pass
//     thinkingBudget:0 — it returns 400 on 3.5-flash-lite and 3.6-flash.
//   • Usage fields are camelCase now (`promptTokens`, not `prompt_tokens`) and
//     include `thoughtTokens` + `attempts`. `vite build` does NOT type-check
//     src/, so a typo here fails silently and cost telemetry degrades to a
//     4-chars/token estimate.
//   • The catch block copies `err.attempts` into the sink so a FAILED call still
//     records which models were tried; otherwise failures log an empty chain.
//   • UPGRADE: this was the last generator still on OpenRouter's UNENFORCED
//     `json_object` mode, with the subject/body shape described only in prose.
//     OUTREACH_SCHEMA is now passed as responseJsonSchema, so the provider
//     enforces it. safeJsonParse is kept as defence in depth — a fenced ```json
//     wrapper is cheap to strip and cheaper than a wasted retry.
//
// Model choice: 3.5-flash-lite leads — measured fastest, 0 thought tokens, and
// priced identically to the gemini-2.5-flash this path used to run. 3.6-flash is
// second here (not last) because the rescue this artifact needs is usually a
// QUALITY one: the retry exists mostly for a guard rejection, not a transport
// fault. 3.1-flash-lite is the cheap last resort.
// NOTE: unlike the OpenRouter chain, there is no non-Google last resort — the
// Llama escape hatch is gone, so a Google-wide outage fails this path.

import { ResumeData, OutreachEmail } from '../../domain/entities/Resume.js';
import { IOutreachEmailGenerator } from '../../domain/usecases/GenerateOutreachEmailUseCase.js';
import type { UsageSink } from './usage.js';
import { GeminiClient, GeminiError, GEMINI_MODELS, withRetry, rotateModels } from './GeminiClient.js';
import {
  OUTREACH_SYSTEM_INSTRUCTION,
  buildOutreachUserPrompt,
  OUTREACH_SCHEMA,
} from './prompts/toolkitPrompts.js';
import { assertNoFabricatedTools, assertOutreachSpecificity, classifyFitMode } from './prompts/toolkitContext.js';

const MODELS = [GEMINI_MODELS.FLASH_LITE_35, GEMINI_MODELS.FLASH_36, GEMINI_MODELS.FLASH_LITE_31];

export class GeminiOutreachEmailGenerator implements IOutreachEmailGenerator {
  private readonly client: GeminiClient;

  constructor(apiKey: string) {
    this.client = new GeminiClient(apiKey);
  }

  async generate(data: ResumeData, usage?: UsageSink): Promise<OutreachEmail> {
    const fit = classifyFitMode(data);
    console.info(`[gemini-outreach-gen] fit=${fit.mode} overlap=${fit.overlap.toFixed(2)} matched=${fit.matched}/${fit.jdVocabSize}`);
    // Retry once on transient malformed JSON / guard failure. The schema now
    // enforces subject/body, but the specificity + fabrication guards can still
    // reject a valid-shaped email. Free per-item path; a retry is cheap.
    return withRetry(async (remainingMs, attempt) => {
      // Lead each retry with the next model: a per-minute 429 is scoped
      // PerProjectPerModel, so rotating escapes the throttle immediately
      // instead of waiting out Google's advised ~53s window.
      const chain = rotateModels(MODELS, attempt);
      try {
        const result = await this.client.generate(
          {
            models: chain,
            systemInstruction: OUTREACH_SYSTEM_INSTRUCTION,
            contents: buildOutreachUserPrompt(data, fit.mode),
            responseJsonSchema: OUTREACH_SCHEMA,
            temperature: fit.mode === 'stretch' ? 0.55 : 0.45,
            maxOutputTokens: 900,
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

        const text = result.text;
        if (!text) throw new Error('No response from AI');

        const parsed = this.safeJsonParse(text);
        if (!parsed.subject || !parsed.body) {
          throw new Error('Outreach email response missing required fields');
        }
        const subject = parsed.subject.trim();
        const body = parsed.body.trim();

        assertNoFabricatedTools(`${subject}\n${body}`, data, { allowJD: fit.mode === 'stretch' });
        assertOutreachSpecificity(`${subject}\n${body}`, data, fit.mode === 'stretch' ? 'either' : 'both');

        return { subject, body };
      } catch (err) {
        // Preserve the attempt chain on failure too, so ai_call_log can show
        // which models were tried on a call that ultimately failed.
        if (usage && err instanceof GeminiError && err.attempts.length) {
          usage.provider = 'gemini';
          usage.attempts = err.attempts;
        }
        throw err;
      }
      // 45s of the 60s function window, shared across the model chain and the
      // one retry — a single artifact on its own request, so it does not have to
      // fit alongside the optimizer.
    }, 45_000);
  }

  private safeJsonParse(text: string): { subject?: string; body?: string } {
    try {
      return JSON.parse(text);
    } catch {
      const cleaned = text.replace(/```json/g, '').replace(/```/g, '').trim();
      return JSON.parse(cleaned);
    }
  }
}
