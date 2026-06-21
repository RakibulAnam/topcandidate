// Infrastructure — OpenRouter Cover Letter Generator (migration Phase 4).
//
// Single-artifact generator for the free per-item regenerate flow
// (/api/toolkit-item). On OpenRouterClient, reusing the shared prompt
// (toolkitPrompts.ts) and the same fabrication guard + response cleaning as
// GeminiCoverLetterGenerator. Gemini 2.5 Flash primary (see model rationale in
// OpenRouterToolkitGenerator / docs/OPENROUTER_MIGRATION.md). LIVE via aiFactory
// whenever OPENROUTER_API_KEY is set (the default); the Gemini sibling is the
// unset-key fallback.

import { ResumeData } from '../../domain/entities/Resume.js';
import { ICoverLetterGenerator } from '../../domain/usecases/GenerateCoverLetterUseCase.js';
import type { UsageSink } from './usage.js';
import { OpenRouterClient } from './OpenRouterClient.js';
import { COVER_LETTER_SYSTEM_INSTRUCTION, buildCoverLetterUserPrompt } from './prompts/toolkitPrompts.js';
import { assertNoFabricatedTools, classifyFitMode } from './prompts/toolkitContext.js';

const MODELS = ['google/gemini-2.5-flash', 'deepseek/deepseek-v3.2', 'meta-llama/llama-3.3-70b-instruct'];

export class OpenRouterCoverLetterGenerator implements ICoverLetterGenerator {
  private readonly client: OpenRouterClient;

  constructor(apiKey: string) {
    this.client = new OpenRouterClient(apiKey);
  }

  async generate(data: ResumeData, usage?: UsageSink): Promise<string> {
    const fit = classifyFitMode(data);
    console.info(`[or-cover-letter-gen] fit=${fit.mode} overlap=${fit.overlap.toFixed(2)} matched=${fit.matched}/${fit.jdVocabSize}`);
    try {
      const result = await this.client.chat(
        {
          model: MODELS[0],
          models: MODELS,
          messages: [
            { role: 'system', content: COVER_LETTER_SYSTEM_INSTRUCTION },
            { role: 'user', content: buildCoverLetterUserPrompt(data, fit.mode) },
          ],
          temperature: fit.mode === 'stretch' ? 0.55 : 0.4,
          max_tokens: 1500,
          reasoning: { enabled: false },
          provider: { data_collection: 'deny', allow_fallbacks: true },
        },
        30_000,
      );

      if (usage) {
        usage.provider = 'openrouter';
        usage.model = result.model;
        usage.promptTokens = result.usage?.prompt_tokens;
        usage.completionTokens = result.usage?.completion_tokens;
      }

      const responseText = result.content;
      if (!responseText) throw new Error('No response from AI');

      const cleaned = this.cleanResponse(responseText.trim(), data);
      assertNoFabricatedTools(cleaned, data, { allowJD: fit.mode === 'stretch' });
      return cleaned;
    } catch (error) {
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
