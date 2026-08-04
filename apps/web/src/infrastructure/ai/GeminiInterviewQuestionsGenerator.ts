// Infrastructure — Gemini implementation of IInterviewQuestionsGenerator.
// Direct-Google port of OpenRouterInterviewQuestionsGenerator.
//
// Single-artifact generator for the free per-item regenerate flow
// (/api/toolkit-item), reusing the shared interview prompt + the same guard
// posture as the combined toolkit generator. Bilingual EN/BN JSON output, so it
// is the heaviest single-artifact payload here (Bengali tokenizes denser).
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
//   • INTERVIEW_SCHEMA moved to prompts/toolkitPrompts.ts (shared, not
//     redeclared here) and is passed as `responseJsonSchema` — the provider
//     enforces the shape, so the large bilingual payload can't truncate or
//     malform. safeJsonParse stays as defence in depth.
//
// Model choice: 3.5-flash-lite leads — measured fastest, 0 thought tokens, and
// priced identically to the gemini-2.5-flash this path used to run. 3.6-flash is
// second because the bilingual generation is the quality-sensitive part.
// 3.1-flash-lite is the cheap last resort.
// NOTE: unlike the OpenRouter chain, there is no non-Google last resort — the
// Llama escape hatch is gone, so a Google-wide outage fails this path.

import {
  ResumeData,
  InterviewQuestion,
  InterviewQuestionCategory,
} from '../../domain/entities/Resume.js';
import { IInterviewQuestionsGenerator, InterviewPrep } from '../../domain/usecases/GenerateInterviewQuestionsUseCase.js';
import { resetUsageAttempt, type UsageSink } from './usage.js';
import { GeminiClient, GeminiError, GEMINI_MODELS, withRetry, rotateModels } from './GeminiClient.js';
import {
  INTERVIEW_SYSTEM_INSTRUCTION,
  buildInterviewUserPrompt,
  INTERVIEW_SCHEMA,
} from './prompts/toolkitPrompts.js';
import { classifyFitMode } from './prompts/toolkitContext.js';
import { sanitizePrepTopics } from './GeminiToolkitGenerator.js';

const MODELS = [GEMINI_MODELS.FLASH_LITE_35, GEMINI_MODELS.FLASH_36, GEMINI_MODELS.FLASH_LITE_31];

const VALID_CATEGORIES: InterviewQuestionCategory[] = [
  'Behavioral',
  'Technical',
  'Role-specific',
  'Values & Culture',
  'Situational',
];

export class GeminiInterviewQuestionsGenerator implements IInterviewQuestionsGenerator {
  private readonly client: GeminiClient;

  constructor(apiKey: string) {
    this.client = new GeminiClient(apiKey);
  }

  async generate(data: ResumeData, usage?: UsageSink): Promise<InterviewPrep> {
    const fit = classifyFitMode(data);
    console.info(`[gemini-interview-gen] fit=${fit.mode} overlap=${fit.overlap.toFixed(2)} matched=${fit.matched}/${fit.jdVocabSize}`);
    // Retry once on transient malformed JSON / guard failure (the schema
    // enforces shape but the round trip can still fail transiently). Free
    // per-item path; a retry is cheap.
    return withRetry(async (remainingMs, attempt) => {
      // Lead each retry with the next model: a per-minute 429 is scoped
      // PerProjectPerModel, so rotating escapes the throttle immediately
      // instead of waiting out Google's advised ~53s window.
      const chain = rotateModels(MODELS, attempt);
      // Clear last attempt's token fields so a failure row can't inherit them —
      // see resetUsageAttempt.
      resetUsageAttempt(usage);
      try {
        const result = await this.client.generate(
          {
            models: chain,
            systemInstruction: INTERVIEW_SYSTEM_INSTRUCTION,
            contents: buildInterviewUserPrompt(data, fit.mode),
            responseJsonSchema: INTERVIEW_SCHEMA,
            temperature: fit.mode === 'stretch' ? 0.55 : 0.4,
            // Bilingual 6–8 Q is token-heavy (Bengali tokenizes denser); generous
            // ceiling so a schema-valid payload never truncates.
            maxOutputTokens: 8000,
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
        //
        // Study topics ride along so a regenerate refreshes the WHOLE Preparation
        // Guide. Sanitizer is shared with the bundle, and an empty list is fine —
        // the section degrades to questions only rather than failing.
        return { questions, prepTopics: sanitizePrepTopics(parsed.prepTopics) };
      } catch (err) {
        // Preserve the attempt chain on failure too, so ai_call_log can show
        // which models were tried on a call that ultimately failed.
        if (usage && err instanceof GeminiError && err.attempts.length) {
          usage.provider = 'gemini';
          usage.attempts = err.attempts;
        }
        throw err;
      }
      // 55s deadline (not 45s): the bilingual interview is slow (~25-30s/attempt),
      // and this single-artifact path runs ALONE on /api/toolkit-item (60s cap),
      // so it can afford a retry if an attempt malforms. The enforced schema makes
      // most attempts valid; the retry room covers the rest.
    }, 55_000);
  }

  private normalizeCategory(raw: unknown): InterviewQuestionCategory {
    const value = String(raw ?? '').trim();
    const match = VALID_CATEGORIES.find((c) => c.toLowerCase() === value.toLowerCase());
    return match ?? 'Role-specific';
  }

  private safeJsonParse(text: string): {
    questions?: Array<{
      question?: string; category?: string; whyAsked?: string; answerStrategy?: string;
      questionBn?: string; whyAskedBn?: string; answerStrategyBn?: string;
    }>;
    prepTopics?: Array<{
      topic?: string; whyItMatters?: string; howToPrepare?: string;
      topicBn?: string; whyItMattersBn?: string; howToPrepareBn?: string;
    }>;
  } {
    try {
      return JSON.parse(text);
    } catch {
      const cleaned = text.replace(/```json/g, '').replace(/```/g, '').trim();
      return JSON.parse(cleaned);
    }
  }
}
