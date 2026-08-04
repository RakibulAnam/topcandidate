// Infrastructure — Gemini LinkedIn Connection Note Generator.
// Direct-Google port of OpenRouterLinkedInMessageGenerator.
//
// Single-artifact generator for the free per-item regenerate flow, reusing the
// shared prompt + the same guards + 280-char trim as the combined toolkit
// generator. Plain text (no JSON), so there is no responseJsonSchema here.
//
// PORT NOTES (canonical template: GeminiProfileNormalizer.ts):
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
//   • No outer `withRetry`: one short 300-token artifact on a per-item retry the
//     user drives themselves. The client's own chain walk is the retry, inside a
//     single 30s budget.
//
// Model choice: 3.5-flash-lite leads (fastest measured, 0 thought tokens, priced
// identically to the gemini-2.5-flash this file used to call). 3.6-flash sits
// second because the artifact is ≤280 chars — a premium rescue on a 300-token
// output is cheap — with 3.1-flash-lite as the last, cheapest resort.
// NOTE: unlike the OpenRouter chain, there is no non-Google last resort — the
// Llama escape hatch is gone, so a Google-wide outage fails this path.

import { ResumeData } from '../../domain/entities/Resume.js';
import { ILinkedInMessageGenerator } from '../../domain/usecases/GenerateLinkedInMessageUseCase.js';
import type { UsageSink } from './usage.js';
import { GeminiClient, GeminiError, GEMINI_MODELS } from './GeminiClient.js';
import { LINKEDIN_SYSTEM_INSTRUCTION, buildLinkedInUserPrompt, trimToLinkedInLimit } from './prompts/toolkitPrompts.js';
import { assertNoFabricatedTools, assertOutreachSpecificity, classifyFitMode } from './prompts/toolkitContext.js';

const MODELS = [GEMINI_MODELS.FLASH_LITE_35, GEMINI_MODELS.FLASH_36, GEMINI_MODELS.FLASH_LITE_31];

export class GeminiLinkedInMessageGenerator implements ILinkedInMessageGenerator {
  private readonly client: GeminiClient;

  constructor(apiKey: string) {
    this.client = new GeminiClient(apiKey);
  }

  async generate(data: ResumeData, usage?: UsageSink): Promise<string> {
    const fit = classifyFitMode(data);
    console.info(`[gemini-linkedin-gen] fit=${fit.mode} overlap=${fit.overlap.toFixed(2)} matched=${fit.matched}/${fit.jdVocabSize}`);
    try {
      const result = await this.client.generate(
        {
          models: MODELS,
          systemInstruction: LINKEDIN_SYSTEM_INSTRUCTION,
          contents: buildLinkedInUserPrompt(data, fit.mode),
          temperature: fit.mode === 'stretch' ? 0.55 : 0.45,
          maxOutputTokens: 300,
        },
        30_000,
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

      let cleaned = text.trim();
      cleaned = cleaned
        .replace(/^["'`]+/, '')
        .replace(/["'`]+$/, '')
        .replace(/^\*+/, '')
        .replace(/\*+$/, '')
        .trim();

      cleaned = trimToLinkedInLimit(cleaned);

      assertNoFabricatedTools(cleaned, data, { allowJD: fit.mode === 'stretch' });
      assertOutreachSpecificity(cleaned, data, 'either');

      return cleaned;
    } catch (err) {
      // Preserve the attempt chain on failure too, so ai_call_log can show
      // which models were tried on a call that ultimately failed.
      if (usage && err instanceof GeminiError && err.attempts.length) {
        usage.provider = 'gemini';
        usage.attempts = err.attempts;
      }
      throw err;
    }
  }
}
