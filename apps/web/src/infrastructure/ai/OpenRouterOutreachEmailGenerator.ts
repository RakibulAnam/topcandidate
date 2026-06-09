// Infrastructure — OpenRouter Outreach Email Generator (migration Phase 4).
//
// Single-artifact generator for the free per-item regenerate flow. On
// OpenRouterClient, reusing the shared prompt + the same fabrication +
// specificity guards as GeminiOutreachEmailGenerator. JSON mode (subject/body).
// Not wired into aiFactory yet (cutover = Phase 6).

import { ResumeData, OutreachEmail } from '../../domain/entities/Resume.js';
import { IOutreachEmailGenerator } from '../../domain/usecases/GenerateOutreachEmailUseCase.js';
import type { UsageSink } from './usage.js';
import { OpenRouterClient, withRetry } from './OpenRouterClient.js';
import { OUTREACH_SYSTEM_INSTRUCTION, buildOutreachUserPrompt } from './prompts/toolkitPrompts.js';
import { assertNoFabricatedTools, assertOutreachSpecificity, classifyFitMode } from './prompts/toolkitContext.js';

const MODELS = ['google/gemini-2.5-flash', 'deepseek/deepseek-v3.2', 'meta-llama/llama-3.3-70b-instruct'];

export class OpenRouterOutreachEmailGenerator implements IOutreachEmailGenerator {
  private readonly client: OpenRouterClient;

  constructor(apiKey: string) {
    this.client = new OpenRouterClient(apiKey);
  }

  async generate(data: ResumeData, usage?: UsageSink): Promise<OutreachEmail> {
    const fit = classifyFitMode(data);
    console.info(`[or-outreach-gen] fit=${fit.mode} overlap=${fit.overlap.toFixed(2)} matched=${fit.matched}/${fit.jdVocabSize}`);
    // Retry once on transient malformed JSON / guard failure (json_object has
    // no schema enforcement). Free per-item path; a retry is cheap.
    return withRetry(async () => {
      const result = await this.client.chat(
        {
          model: MODELS[0],
          models: MODELS,
          messages: [
            { role: 'system', content: OUTREACH_SYSTEM_INSTRUCTION },
            { role: 'user', content: buildOutreachUserPrompt(data, fit.mode) },
          ],
          response_format: { type: 'json_object' },
          temperature: fit.mode === 'stretch' ? 0.55 : 0.45,
          max_tokens: 900,
          reasoning: { enabled: false },
          provider: { data_collection: 'deny', allow_fallbacks: true },
        },
        45_000,
      );

      if (usage) {
        usage.provider = 'openrouter';
        usage.model = result.model;
        usage.promptTokens = result.usage?.prompt_tokens;
        usage.completionTokens = result.usage?.completion_tokens;
      }

      const text = result.content;
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
    });
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
