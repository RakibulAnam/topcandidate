// Infrastructure — OpenRouter LinkedIn Connection Note Generator (Phase 4).
//
// Single-artifact generator for the free per-item regenerate flow. On
// OpenRouterClient, reusing the shared prompt + the same guards + 280-char
// trim as GeminiLinkedInMessageGenerator. Plain text (no JSON). Not wired into
// aiFactory yet (cutover = Phase 6).

import { ResumeData } from '../../domain/entities/Resume.js';
import { ILinkedInMessageGenerator } from '../../domain/usecases/GenerateLinkedInMessageUseCase.js';
import type { UsageSink } from './usage.js';
import { OpenRouterClient } from './OpenRouterClient.js';
import { LINKEDIN_SYSTEM_INSTRUCTION, buildLinkedInUserPrompt, LINKEDIN_MAX } from './prompts/toolkitPrompts.js';
import { assertNoFabricatedTools, assertOutreachSpecificity, classifyFitMode } from './prompts/toolkitContext.js';

const MODELS = ['google/gemini-2.5-flash', 'deepseek/deepseek-v3.2', 'meta-llama/llama-3.3-70b-instruct'];

export class OpenRouterLinkedInMessageGenerator implements ILinkedInMessageGenerator {
  private readonly client: OpenRouterClient;

  constructor(apiKey: string) {
    this.client = new OpenRouterClient(apiKey);
  }

  async generate(data: ResumeData, usage?: UsageSink): Promise<string> {
    const fit = classifyFitMode(data);
    console.info(`[or-linkedin-gen] fit=${fit.mode} overlap=${fit.overlap.toFixed(2)} matched=${fit.matched}/${fit.jdVocabSize}`);
    const result = await this.client.chat(
      {
        model: MODELS[0],
        models: MODELS,
        messages: [
          { role: 'system', content: LINKEDIN_SYSTEM_INSTRUCTION },
          { role: 'user', content: buildLinkedInUserPrompt(data, fit.mode) },
        ],
        temperature: fit.mode === 'stretch' ? 0.55 : 0.45,
        max_tokens: 300,
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

    let cleaned = text.trim();
    cleaned = cleaned
      .replace(/^["'`]+/, '')
      .replace(/["'`]+$/, '')
      .replace(/^\*+/, '')
      .replace(/\*+$/, '')
      .trim();

    if (cleaned.length > LINKEDIN_MAX) {
      const slice = cleaned.slice(0, LINKEDIN_MAX);
      const lastPeriod = slice.lastIndexOf('.');
      const lastSpace = slice.lastIndexOf(' ');
      const cut = lastPeriod > LINKEDIN_MAX * 0.6 ? lastPeriod + 1 : lastSpace;
      cleaned = (cut > 0 ? slice.slice(0, cut) : slice).trim();
    }

    assertNoFabricatedTools(cleaned, data, { allowJD: fit.mode === 'stretch' });
    assertOutreachSpecificity(cleaned, data, 'either');

    return cleaned;
  }
}
