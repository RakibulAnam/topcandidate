// Infrastructure — Gemini implementation of ICoverLetterGenerator.
// Direct-Google port of OpenRouterCoverLetterGenerator.
//
// Single-artifact generator for the free per-item regenerate flow
// (/api/toolkit-item), reusing the shared prompt (toolkitPrompts.ts) and the same
// fabrication guard + response cleaning as the combined toolkit generator. Plain
// text out — no JSON schema, so there is no parse step and nothing a validation
// re-ask could repair. Deadline 30s: a single free regenerate should die rather
// than sit on a function slot.
//
// PORT NOTES (canonical pattern: GeminiProfileNormalizer):
//   • Transport is GeminiClient. The model fallback chain is now walked
//     CLIENT-side (Google has no server-side models[] equivalent), so `models`
//     is an ordered array and the client advances on transport failure. That
//     array IS the replacement for the only resilience this generator ever had.
//   • No outer withRetry, on purpose: the source had none either. With plain
//     text there is no parse/validation failure to retry around, so the chain
//     walk inside one 30s budget is the whole retry story. rotateModels is
//     likewise unused — without withRetry there is no attempt index to rotate.
//   • `thinkingLevel` defaults to MINIMAL inside the client. Do not pass
//     thinkingBudget:0 — it returns 400 on 3.5-flash-lite and 3.6-flash.
//   • Usage fields are camelCase now (`promptTokens`, not `prompt_tokens`) and
//     include `thoughtTokens` + `attempts`. `vite build` does NOT type-check
//     src/, so a typo here fails silently and cost telemetry degrades to a
//     4-chars/token estimate — worth the care.
//   • The catch copies `err.attempts` into the sink BEFORE wrapping the error in
//     the 'Failed to generate cover letter:' message, so a FAILED call still
//     records which models were tried; the wrap loses the GeminiError type.
//
// Model choice: 3.5-flash-lite leads — measured fastest, 0 thought tokens, and
// priced identically to the gemini-2.5-flash this path used to run. 3.6-flash
// sits second here rather than last: cover-letter prose is the artifact a user
// reads end to end, so the premium model is worth spending on a retry of it.
// 3.1-flash-lite is the cheap last resort. NOTE: unlike the OpenRouter chain,
// there is no non-Google escape hatch — the Llama tail is gone, so a Google-wide
// outage fails this path.

import { ResumeData } from '../../domain/entities/Resume.js';
import { ICoverLetterGenerator } from '../../domain/usecases/GenerateCoverLetterUseCase.js';
import type { UsageSink } from './usage.js';
import { GeminiClient, GeminiError, GEMINI_MODELS } from './GeminiClient.js';
import { COVER_LETTER_SYSTEM_INSTRUCTION, buildCoverLetterUserPrompt } from './prompts/toolkitPrompts.js';
import { assertNoFabricatedTools, classifyFitMode } from './prompts/toolkitContext.js';

const MODELS = [GEMINI_MODELS.FLASH_LITE_35, GEMINI_MODELS.FLASH_36, GEMINI_MODELS.FLASH_LITE_31];

export class GeminiCoverLetterGenerator implements ICoverLetterGenerator {
  private readonly client: GeminiClient;

  constructor(apiKey: string) {
    this.client = new GeminiClient(apiKey);
  }

  async generate(data: ResumeData, usage?: UsageSink): Promise<string> {
    const fit = classifyFitMode(data);
    console.info(`[gemini-cover-letter-gen] fit=${fit.mode} overlap=${fit.overlap.toFixed(2)} matched=${fit.matched}/${fit.jdVocabSize}`);
    try {
      const result = await this.client.generate(
        {
          models: MODELS,
          systemInstruction: COVER_LETTER_SYSTEM_INSTRUCTION,
          contents: buildCoverLetterUserPrompt(data, fit.mode),
          temperature: fit.mode === 'stretch' ? 0.55 : 0.4,
          maxOutputTokens: 1500,
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

      const responseText = result.text;
      if (!responseText) throw new Error('No response from AI');

      const cleaned = this.cleanResponse(responseText.trim(), data);
      assertNoFabricatedTools(cleaned, data, { allowJD: fit.mode === 'stretch' });
      return cleaned;
    } catch (error) {
      // Preserve the attempt chain on failure too, so ai_call_log can show
      // which models were tried on a call that ultimately failed.
      if (usage && error instanceof GeminiError && error.attempts.length) {
        usage.provider = 'gemini';
        usage.attempts = error.attempts;
      }
      console.error('Cover letter generation failed:', error);
      throw new Error(
        `Failed to generate cover letter: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Strip any structural elements the AI may have included despite instructions.
   * Removes: date lines, address blocks, greetings, closings, signature blocks, markdown.
   */
  private cleanResponse(text: string, data: ResumeData): string {
    let cleaned = text
      .replace(/\*\*/g, '')
      .replace(/\*/g, '')
      .replace(/^#{1,6}\s.*/gm, '')
      .replace(/```[\s\S]*?```/g, '');

    const lines = cleaned.split('\n');
    const filteredLines: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      const lower = trimmed.toLowerCase();

      if (!trimmed) {
        if (filteredLines.length > 0) filteredLines.push('');
        continue;
      }

      if (/^\w+\s+\d{1,2},?\s+\d{4}$/.test(trimmed) || /^\d{4}-\d{2}-\d{2}$/.test(trimmed)) continue;
      if (/^[\w\s]+,\s*[A-Z]{2}\s+\d{5}/.test(trimmed)) continue;
      if (/^dear\s/i.test(trimmed)) continue;
      if (/^to whom it may concern/i.test(trimmed)) continue;
      if (/^(sincerely|best regards|regards|respectfully|warm regards|yours truly|yours faithfully),?$/i.test(trimmed)) continue;
      if (lower === data.personalInfo.fullName.toLowerCase()) continue;
      if (/^[\w.+-]+@[\w.-]+\.\w+$/.test(trimmed)) continue;
      if (/^\+?[\d\s()-]{7,}$/.test(trimmed)) continue;
      if (/^https?:\/\/(www\.)?(linkedin|github)\.com/i.test(trimmed)) continue;
      if (lower === 'hiring manager') continue;
      if (data.targetJob.company && trimmed === data.targetJob.company) continue;
      if (/^(re:|subject:)/i.test(trimmed)) continue;

      filteredLines.push(line);
    }

    return filteredLines
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
}
