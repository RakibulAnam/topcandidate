// Infrastructure — OpenRouter Interview Questions Generator (migration Phase 4).
//
// Single-artifact generator for the free per-item regenerate flow. On
// OpenRouterClient, reusing the shared prompt + the same guards as
// GeminiInterviewQuestionsGenerator. Bilingual EN/BN JSON output → Gemini 2.5
// Flash primary (heavy bilingual generation, like the toolkit). Not wired into
// aiFactory yet (cutover = Phase 6).

import {
  ResumeData,
  InterviewQuestion,
  InterviewQuestionCategory,
} from '../../domain/entities/Resume.js';
import { IInterviewQuestionsGenerator } from '../../domain/usecases/GenerateInterviewQuestionsUseCase.js';
import type { UsageSink } from './usage.js';
import { OpenRouterClient, withRetry } from './OpenRouterClient.js';
import { INTERVIEW_SYSTEM_INSTRUCTION, buildInterviewUserPrompt } from './prompts/toolkitPrompts.js';
import { classifyFitMode } from './prompts/toolkitContext.js';

const MODELS = ['google/gemini-2.5-flash', 'deepseek/deepseek-v3.2', 'meta-llama/llama-3.3-70b-instruct'];

const VALID_CATEGORIES: InterviewQuestionCategory[] = [
  'Behavioral',
  'Technical',
  'Role-specific',
  'Values & Culture',
  'Situational',
];

// Structured-output schema (mirrors the legacy Gemini responseSchema). Using
// json_schema instead of json_object makes the provider enforce the shape, so
// the large bilingual payload can't truncate or malform.
const INTERVIEW_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          category: { type: 'string' },
          whyAsked: { type: 'string' },
          answerStrategy: { type: 'string' },
          questionBn: { type: 'string' },
          whyAskedBn: { type: 'string' },
          answerStrategyBn: { type: 'string' },
        },
        required: ['question', 'category', 'whyAsked', 'answerStrategy', 'questionBn', 'whyAskedBn', 'answerStrategyBn'],
        additionalProperties: false,
      },
    },
  },
  required: ['questions'],
  additionalProperties: false,
};

export class OpenRouterInterviewQuestionsGenerator implements IInterviewQuestionsGenerator {
  private readonly client: OpenRouterClient;

  constructor(apiKey: string) {
    this.client = new OpenRouterClient(apiKey);
  }

  async generate(data: ResumeData, usage?: UsageSink): Promise<InterviewQuestion[]> {
    const fit = classifyFitMode(data);
    console.info(`[or-interview-gen] fit=${fit.mode} overlap=${fit.overlap.toFixed(2)} matched=${fit.matched}/${fit.jdVocabSize}`);
    // Retry once on transient malformed JSON / guard failure (json_object has
    // no schema enforcement). Free per-item path; a retry is cheap.
    return withRetry(async (remainingMs) => {
      const result = await this.client.chat(
        {
          model: MODELS[0],
          models: MODELS,
          messages: [
            { role: 'system', content: INTERVIEW_SYSTEM_INSTRUCTION },
            { role: 'user', content: buildInterviewUserPrompt(data, fit.mode) },
          ],
          response_format: { type: 'json_schema', json_schema: { name: 'interview_questions', strict: true, schema: INTERVIEW_SCHEMA } },
          temperature: fit.mode === 'stretch' ? 0.55 : 0.4,
          // Bilingual 6–8 Q is token-heavy (Bengali tokenizes denser); generous
          // ceiling so a schema-valid payload never truncates.
          max_tokens: 8000,
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

      const text = result.content;
      if (!text) throw new Error('No response from AI');

      const parsed = this.safeJsonParse(text);
      if (!parsed.questions || !Array.isArray(parsed.questions) || parsed.questions.length === 0) {
        throw new Error('Interview questions response was empty');
      }

      const questions = parsed.questions.map((q) => {
        const questionBn = (q.questionBn ?? '').trim();
        const whyAskedBn = (q.whyAskedBn ?? '').trim();
        const answerStrategyBn = (q.answerStrategyBn ?? '').trim();
        return {
          question: (q.question ?? '').trim(),
          category: this.normalizeCategory(q.category),
          whyAsked: (q.whyAsked ?? '').trim(),
          answerStrategy: (q.answerStrategy ?? '').trim(),
          ...(questionBn ? { questionBn } : {}),
          ...(whyAskedBn ? { whyAskedBn } : {}),
          ...(answerStrategyBn ? { answerStrategyBn } : {}),
        };
      });

      // NO fabrication / anchor-coverage hard-fail on interview prep (see the
      // toolkit generator): questions intentionally probe the JD — including tech
      // the candidate hasn't used — so they can rehearse. The prompt handles
      // honest answer coaching; we don't block the artifact.
      return questions;
      // 55s deadline (not 45s): the bilingual interview is slow (~25-30s/attempt),
      // and this single-artifact path runs ALONE on /api/toolkit-item (60s cap),
      // so it can afford a retry if an attempt malforms. json_schema makes most
      // attempts valid; the retry room covers the rest.
    }, 55_000);
  }

  private normalizeCategory(raw: unknown): InterviewQuestionCategory {
    const value = String(raw ?? '').trim();
    const match = VALID_CATEGORIES.find((c) => c.toLowerCase() === value.toLowerCase());
    return match ?? 'Role-specific';
  }

  private safeJsonParse(text: string): { questions?: Array<{
    question?: string; category?: string; whyAsked?: string; answerStrategy?: string;
    questionBn?: string; whyAskedBn?: string; answerStrategyBn?: string;
  }> } {
    try {
      return JSON.parse(text);
    } catch {
      const cleaned = text.replace(/```json/g, '').replace(/```/g, '').trim();
      return JSON.parse(cleaned);
    }
  }
}
