// Infrastructure — OpenRouter implementation of IResumeOptimizer (migration Phase 2).
//
// Drop-in replacement for the Groq+Gemini optimizer stack, built on
// OpenRouterClient. One key fronts a DeepSeek→Gemini→Llama fallback chain
// (OpenRouter tries them in order on a single round trip). Shares the SAME
// prompt module and the SAME deterministic post-pipeline as the Groq/Gemini
// optimizers (prompts/resumeOptimizerPrompts.ts) — only the transport changes.
//
// Not wired into aiFactory yet; the cutover (Phase 6) flips the live optimizer
// once every generator is ported and validated. Until then the live path stays
// Groq→Gemini.
//
// JSON mode caveat: OpenRouter `json_object` does NOT enforce a schema for
// DeepSeek/Llama, so we embed the shape spec in the user prompt
// (`embedSchemaSpec: true`) and validate the parsed payload ourselves — exactly
// what the Groq path does. Reasoning is disabled (reasoning tokens bill as
// output and would blow up cost on a structured task).

import { ResumeData, OptimizedResumeData } from '../../domain/entities/Resume.js';
import { IResumeOptimizer } from '../../domain/usecases/OptimizeResumeUseCase.js';
import type { UsageSink } from './usage.js';
import { OpenRouterClient } from './OpenRouterClient.js';
import {
  buildSystemInstruction,
  buildUserPrompt,
  validateOptimizedResponse,
  normalizeSkills,
  filterFabricatedSkills,
  reorderLeadBulletByJDFit,
  reorderProjectsByJDFit,
  enforceBulletDensity,
  stripBannedCliches,
  safeJsonParse,
  delay,
} from './prompts/resumeOptimizerPrompts.js';

// Primary → fallbacks. DeepSeek V3.2 is the cheap, structured, English-strong
// primary; Gemini 2.5 Flash is the quality net; Llama 3.3 70B is the cheap
// last resort. VERIFY these slugs at https://openrouter.ai/models before each
// release — OpenRouter slugs drift.
const OPTIMIZER_MODELS = [
  'deepseek/deepseek-v3.2',
  'google/gemini-2.5-flash',
  'meta-llama/llama-3.3-70b-instruct',
];

export class OpenRouterResumeOptimizer implements IResumeOptimizer {
  private readonly client: OpenRouterClient;
  private readonly maxRetries = 2;
  // Per-attempt ceiling. Kept under the 60s Vercel function cap; the toolkit
  // runs in parallel so this is one half of the hot path.
  private readonly timeoutMs = 45_000;
  private readonly temperature = 0.3;

  constructor(apiKey: string) {
    this.client = new OpenRouterClient(apiKey);
  }

  async optimize(data: ResumeData, usage?: UsageSink): Promise<OptimizedResumeData> {
    const systemInstruction = buildSystemInstruction();
    // No schema enforcement on OpenRouter json_object → embed the shape spec.
    const userPrompt = buildUserPrompt(data, { embedSchemaSpec: true });

    let attempt = 0;
    while (attempt < this.maxRetries) {
      try {
        const result = await this.client.chat(
          {
            model: OPTIMIZER_MODELS[0],
            models: OPTIMIZER_MODELS,
            messages: [
              { role: 'system', content: systemInstruction },
              { role: 'user', content: userPrompt },
            ],
            response_format: { type: 'json_object' },
            temperature: this.temperature,
            max_tokens: 8000,
            reasoning: { enabled: false },
            provider: { data_collection: 'deny', allow_fallbacks: true },
          },
          this.timeoutMs,
        );

        // Surface real token usage for cost telemetry (additive). The model is
        // whichever OpenRouter actually served (may be a fallback).
        if (usage) {
          usage.provider = 'openrouter';
          usage.model = result.model;
          usage.promptTokens = result.usage?.prompt_tokens;
          usage.completionTokens = result.usage?.completion_tokens;
        }

        // Identical post-pipeline to the Groq/Gemini optimizers.
        const parsed = safeJsonParse<OptimizedResumeData>(result.content);
        normalizeSkills(parsed);
        const fabResult = filterFabricatedSkills(parsed, data);
        if (fabResult.fabricated.length) {
          console.warn(`[openrouter] stripped ${fabResult.fabricated.length} fabricated skill(s):`, fabResult.fabricated.join(', '));
        }
        reorderLeadBulletByJDFit(parsed, data.targetJob.description);
        reorderProjectsByJDFit(parsed, data.targetJob.description);
        enforceBulletDensity(parsed, data.targetJob.description);
        stripBannedCliches(parsed);
        validateOptimizedResponse(data, parsed);

        return parsed;
      } catch (error) {
        attempt++;
        console.warn(`OpenRouter optimization attempt ${attempt} failed:`, error);
        if (attempt >= this.maxRetries) throw this.buildFinalError(error);
        await delay(Math.pow(2, attempt) * 1000);
      }
    }

    throw new Error('Unexpected OpenRouter optimization failure');
  }

  private buildFinalError(error: unknown): Error {
    if (error instanceof Error) return new Error(`Resume optimization failed: ${error.message}`);
    return new Error('Resume optimization failed due to unknown error');
  }
}
