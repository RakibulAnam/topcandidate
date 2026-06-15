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
// Structured output: `json_schema` (strict) — the provider enforces the shape,
// same as the toolkit generator (2026-06-10 lesson: `json_object` truncates/
// malforms large structured payloads). We STILL embed the shape spec in the
// user prompt (`embedSchemaSpec: true`) because the schema can't express
// "echo back exactly these input IDs" — the spec text lists them, and
// validateOptimizedResponse() remains the final gate. Reasoning is disabled
// (reasoning tokens bill as output and would blow up cost on a structured task).

import { ResumeData, OptimizedResumeData } from '../../domain/entities/Resume.js';
import { IResumeOptimizer } from '../../domain/usecases/OptimizeResumeUseCase.js';
import type { UsageSink } from './usage.js';
import { OpenRouterClient, withRetry } from './OpenRouterClient.js';
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
} from './prompts/resumeOptimizerPrompts.js';

// Gemini 2.5 Flash is the PRIMARY here (NOT DeepSeek). Live prod testing
// (2026-06-10) showed DeepSeek V3.2 both (a) failed the optimizer's strict
// ID-preserving JSON ("ID mismatch in projects" — it rewrote input item IDs)
// and (b) timed out >45s on a real multi-experience resume → the optimizer
// took 61s and the /api/optimize function hit Vercel's 60s cap (504). Gemini
// Flash is fast and faithful to the schema. Llama 3.3 70B is the cheap English
// fallback. DeepSeek is intentionally dropped from the optimizer chain (it is
// still the toolkit's last-resort fallback). VERIFY slugs at
// https://openrouter.ai/models before each release.
const OPTIMIZER_MODELS = [
  'google/gemini-2.5-flash',
  'meta-llama/llama-3.3-70b-instruct',
];

// Structured-output schema (mirrors OptimizedResumeData). Strict mode requires
// every property listed in `required`, so the optional sections are required
//-as-empty-arrays — validateOptimizedResponse() still checks the counts and
// IDs against the input afterwards.
const REFINED_SECTION = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      refinedBullets: { type: 'array', items: { type: 'string' } },
    },
    required: ['id', 'refinedBullets'],
    additionalProperties: false,
  },
} as const;

const OPTIMIZER_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    skills: { type: 'array', items: { type: 'string' } },
    skillCategories: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          category: { type: 'string' },
          items: { type: 'array', items: { type: 'string' } },
        },
        required: ['category', 'items'],
        additionalProperties: false,
      },
    },
    experience: REFINED_SECTION,
    projects: REFINED_SECTION,
    extracurriculars: REFINED_SECTION,
  },
  required: ['summary', 'skills', 'skillCategories', 'experience', 'projects', 'extracurriculars'],
  additionalProperties: false,
};

export class OpenRouterResumeOptimizer implements IResumeOptimizer {
  private readonly client: OpenRouterClient;
  // Total wall-time budget across attempts (deadline-bounded — see withRetry).
  // Since the 2026-06-11 split, /api/optimize runs the optimizer ALONE in its
  // own function invocation (the toolkit lives on /api/toolkit), so the
  // optimizer gets most of Vercel's 60s window: 50s leaves room for auth +
  // credit RPC + telemetry overhead and buys a second attempt after a slow
  // first one.
  private readonly deadlineMs = 50_000;
  private readonly temperature = 0.3;

  constructor(apiKey: string) {
    this.client = new OpenRouterClient(apiKey);
  }

  async optimize(data: ResumeData, usage?: UsageSink): Promise<OptimizedResumeData> {
    const systemInstruction = buildSystemInstruction();
    // No schema enforcement on OpenRouter json_object → embed the shape spec.
    const userPrompt = buildUserPrompt(data, { embedSchemaSpec: true });

    try {
      return await withRetry(async (remainingMs) => {
        const result = await this.client.chat(
          {
            model: OPTIMIZER_MODELS[0],
            models: OPTIMIZER_MODELS,
            messages: [
              { role: 'system', content: systemInstruction },
              { role: 'user', content: userPrompt },
            ],
            response_format: { type: 'json_schema', json_schema: { name: 'optimized_resume', strict: true, schema: OPTIMIZER_SCHEMA } },
            temperature: this.temperature,
            max_tokens: 8000,
            reasoning: { enabled: false },
            provider: { data_collection: 'deny', allow_fallbacks: true },
          },
          remainingMs,
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
      }, this.deadlineMs);
    } catch (error) {
      throw this.buildFinalError(error);
    }
  }

  private buildFinalError(error: unknown): Error {
    if (error instanceof Error) return new Error(`Resume optimization failed: ${error.message}`);
    return new Error('Resume optimization failed due to unknown error');
  }
}
