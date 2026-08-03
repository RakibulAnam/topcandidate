// Infrastructure — Gemini implementation of IToolkitGenerator (combined toolkit).
// Direct-Google port of OpenRouterToolkitGenerator.
//
// Produces cover letter + outreach email + LinkedIn note + interview questions
// in ONE call. Shares the SAME prompts (toolkitPrompts.ts) and the SAME
// per-artifact guards (toolkitContext.ts) as every other toolkit path — only the
// transport changes. The per-artifact `errors`-map contract is preserved
// exactly: a weak slot records its reason while the others ship.
//
// Structured output: `responseJsonSchema` (TOOLKIT_SCHEMA, lifted to
// toolkitPrompts.ts) so Google enforces the shape — the largest field (the
// bilingual interview array) can't truncate or malform. We STILL parse
// defensively (tolerate missing Bn fields, strip code fences).
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
//   • Dropped with OpenRouter: reasoning:{enabled:false} (Gemini's equivalent is
//     thinkingLevel MINIMAL, set in the client), provider:{data_collection,
//     allow_fallbacks}, the single `model` field, `response_format`, `messages[]`.
//
// Model choice: 3.5-flash-lite leads — measured fastest, 0 thought tokens, and
// the cleanest Bengali of the three, which matters most here because the
// interview block is bilingual EN/BN. 3.6-flash sits SECOND rather than last
// despite being the premium tier ($1.50/$7.50): this is the revenue-generating
// paid path emitting ~6k tokens, so the first rescue should be the strongest
// model on long bilingual output, not the cheapest. 3.1-flash-lite is the
// last-resort cheap tail.
// NOTE: unlike the OpenRouter chain, there is no non-Google last resort — the
// Llama escape hatch is gone, so a Google-wide outage fails this path.

import {
  ResumeData,
  GeneratedToolkit,
  InterviewQuestion,
  InterviewQuestionCategory,
  ToolkitErrors,
} from '../../domain/entities/Resume.js';
import { IToolkitGenerator } from '../../domain/usecases/GenerateToolkitUseCase.js';
import type { UsageSink } from './usage.js';
import { GeminiClient, GeminiError, GEMINI_MODELS, withRetry, rotateModels } from './GeminiClient.js';
import {
  buildToolkitSystemInstruction,
  buildToolkitUserPrompt,
  LINKEDIN_MAX,
  TOOLKIT_SCHEMA,
} from './prompts/toolkitPrompts.js';
import {
  buildToolkitEvidenceCorpus,
  detectFabricatedTokens,
  ToolkitFabricationError,
  assertOutreachSpecificity,
  classifyFitMode,
  countAnchoredStrategies,
} from './prompts/toolkitContext.js';

const TOOLKIT_MODELS = [GEMINI_MODELS.FLASH_LITE_35, GEMINI_MODELS.FLASH_36, GEMINI_MODELS.FLASH_LITE_31];

const VALID_CATEGORIES: InterviewQuestionCategory[] = [
  'Behavioral',
  'Technical',
  'Role-specific',
  'Values & Culture',
  'Situational',
];

interface RawToolkitResponse {
  coverLetter?: string;
  outreachEmail?: { subject?: string; body?: string };
  linkedInMessage?: string;
  interviewQuestions?: Array<{
    question?: string;
    category?: string;
    whyAsked?: string;
    answerStrategy?: string;
    questionBn?: string;
    whyAskedBn?: string;
    answerStrategyBn?: string;
  }>;
}

export class GeminiToolkitGenerator implements IToolkitGenerator {
  private readonly client: GeminiClient;
  // Total wall-time budget across attempts (deadline-bounded — see withRetry).
  // Since the 2026-06-11 split, the toolkit runs on its OWN /api/toolkit
  // function invocation (the optimizer lives on /api/optimize), so it gets
  // most of Vercel's 60s window: 52s + auth/rate-limit/telemetry overhead
  // stays under the cap. One slow attempt may use the whole budget; a fast
  // parse-fail leaves room for one bounded retry.
  private readonly deadlineMs = 52_000;

  constructor(apiKey: string) {
    this.client = new GeminiClient(apiKey);
  }

  async generate(data: ResumeData, usage?: UsageSink): Promise<GeneratedToolkit> {
    const t0 = Date.now();
    const fit = classifyFitMode(data);
    console.info(`[gemini-toolkit-gen] start jdLen=${data.targetJob.description.length} fit=${fit.mode} overlap=${fit.overlap.toFixed(2)} matched=${fit.matched}/${fit.jdVocabSize}`);

    // Retry the AI call + parse on transient malformed JSON (responseJsonSchema
    // enforces shape but the round trip can still fail transiently). The
    // per-artifact validation below is NOT retried — a
    // weak single artifact is expected and lands in the errors map, not a regen.
    const parsed: RawToolkitResponse = await withRetry(async (remainingMs, attempt) => {
      // Lead each retry with the next model: a per-minute 429 is scoped
      // PerProjectPerModel, so rotating escapes the throttle immediately
      // instead of waiting out Google's advised ~53s window.
      const chain = rotateModels(TOOLKIT_MODELS, attempt);
      try {
        const result = await this.client.generate(
          {
            models: chain,
            systemInstruction: buildToolkitSystemInstruction(fit.mode),
            contents: buildToolkitUserPrompt(data, fit.mode),
            responseJsonSchema: TOOLKIT_SCHEMA,
            temperature: fit.mode === 'stretch' ? 0.55 : 0.4,
            // Four artifacts in one payload, the bilingual interview block being the
            // largest; 6000 risked truncating the interview JSON. 8000 gives headroom
            // (ceiling only — normal payloads cost the same). Fits the 48s deadline.
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
        try {
          return this.safeJsonParse(text);
        } catch (parseErr) {
          const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
          console.warn(`[gemini-toolkit-gen] JSON parse failed (retrying if attempts remain): ${msg}`);
          throw new Error(`Toolkit response was not valid JSON: ${msg}`);
        }
      } catch (err) {
        // Preserve the attempt chain on failure too, so ai_call_log can show
        // which models were tried on a call that ultimately failed.
        if (usage && err instanceof GeminiError && err.attempts.length) {
          usage.provider = 'gemini';
          usage.attempts = err.attempts;
        }
        throw err;
      }
    }, this.deadlineMs);
    console.info(`[gemini-toolkit-gen] parsed after ${Date.now() - t0}ms`);

    // Per-artifact validation — identical contract to OpenRouterToolkitGenerator.
    const evidence = buildToolkitEvidenceCorpus(data);
    const baseEvidence = data.targetJob.company
      ? `${evidence} ${data.targetJob.company.toLowerCase()}`
      : evidence;
    const jdText = (data.targetJob.description ?? '').toLowerCase();
    const pitchEvidence = fit.mode === 'stretch'
      ? `${baseEvidence} ${jdText}`
      : baseEvidence;
    const outreachSpecificityMode: 'both' | 'either' = fit.mode === 'stretch' ? 'either' : 'both';

    const errors: ToolkitErrors = {};
    const out: GeneratedToolkit = { errors };

    // ── Cover letter ────────────────────────────────────────────────────────
    try {
      const coverLetter = (parsed.coverLetter ?? '').trim();
      if (!coverLetter) throw new Error('Cover letter is empty');
      const fabricated = detectFabricatedTokens(coverLetter, pitchEvidence);
      if (fabricated.length > 0) throw new ToolkitFabricationError(fabricated);
      out.coverLetter = coverLetter;
    } catch (err) {
      errors.coverLetter = this.errorMessage(err);
      console.warn('[gemini-toolkit-gen] coverLetter validation failed:', errors.coverLetter);
    }

    // ── Outreach email ──────────────────────────────────────────────────────
    try {
      const subject = (parsed.outreachEmail?.subject ?? '').trim();
      const body = (parsed.outreachEmail?.body ?? '').trim();
      if (!subject || !body) throw new Error('Outreach email is empty');
      const fabricated = detectFabricatedTokens(`${subject}\n${body}`, pitchEvidence);
      if (fabricated.length > 0) throw new ToolkitFabricationError(fabricated);
      assertOutreachSpecificity(`${subject}\n${body}`, data, outreachSpecificityMode);
      out.outreachEmail = { subject, body };
    } catch (err) {
      errors.outreachEmail = this.errorMessage(err);
      console.warn('[gemini-toolkit-gen] outreachEmail validation failed:', errors.outreachEmail);
    }

    // ── LinkedIn message ────────────────────────────────────────────────────
    try {
      let linkedInMessage = (parsed.linkedInMessage ?? '').trim();
      linkedInMessage = linkedInMessage
        .replace(/^["'`]+/, '')
        .replace(/["'`]+$/, '')
        .replace(/^\*+/, '')
        .replace(/\*+$/, '')
        .trim();
      if (!linkedInMessage) throw new Error('LinkedIn note is empty');
      if (linkedInMessage.length > LINKEDIN_MAX) {
        const slice = linkedInMessage.slice(0, LINKEDIN_MAX);
        const lastPeriod = slice.lastIndexOf('.');
        const lastSpace = slice.lastIndexOf(' ');
        const cut = lastPeriod > LINKEDIN_MAX * 0.6 ? lastPeriod + 1 : lastSpace;
        linkedInMessage = (cut > 0 ? slice.slice(0, cut) : slice).trim();
      }
      const fabricated = detectFabricatedTokens(linkedInMessage, pitchEvidence);
      if (fabricated.length > 0) throw new ToolkitFabricationError(fabricated);
      assertOutreachSpecificity(linkedInMessage, data, 'either');
      out.linkedInMessage = linkedInMessage;
    } catch (err) {
      errors.linkedInMessage = this.errorMessage(err);
      console.warn('[gemini-toolkit-gen] linkedInMessage validation failed:', errors.linkedInMessage);
    }

    // ── Interview questions ─────────────────────────────────────────────────
    try {
      const questionsRaw = Array.isArray(parsed.interviewQuestions)
        ? parsed.interviewQuestions
        : [];
      const interviewQuestions: InterviewQuestion[] = questionsRaw
        .map((q) => {
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
        })
        .filter((q) => q.question && q.whyAsked && q.answerStrategy);
      if (interviewQuestions.length === 0) throw new Error('No interview questions');

      // NO fabrication / anchor-coverage hard-fail on interview prep. Interview
      // questions are meant to probe what THIS JD demands — including tools the
      // candidate hasn't used yet — so they can rehearse. Blocking a question
      // because a tech isn't on the résumé defeats the purpose. The prompt steers
      // quality (draw from JD + résumé; anchor answers in real experience where it
      // exists; coach honest preparation for gaps; never fake experience). Empty
      // output is still a failure (handled by the length check above).
      // Telemetry only (never throws): watch whether prompt-steered anchoring
      // actually holds now that the hard gate is retired.
      const anchored = countAnchoredStrategies(interviewQuestions.map(q => q.answerStrategy), data);
      console.info(`[gemini-toolkit-gen] interview anchor coverage ${anchored}/${interviewQuestions.length}`);
      out.interviewQuestions = interviewQuestions;
    } catch (err) {
      errors.interviewQuestions = this.errorMessage(err);
      console.warn('[gemini-toolkit-gen] interviewQuestions validation failed:', errors.interviewQuestions);
    }

    const ok = {
      coverLetter: !!out.coverLetter,
      outreachEmail: !!out.outreachEmail,
      linkedInMessage: !!out.linkedInMessage,
      interviewQuestions: !!out.interviewQuestions && out.interviewQuestions.length > 0,
    };
    console.info(`[gemini-toolkit-gen] done total=${Date.now() - t0}ms slots=${JSON.stringify(ok)} errorKeys=${Object.keys(errors).join(',') || '(none)'}`);

    return out;
  }

  private errorMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    if (typeof err === 'string') return err;
    return 'Validation failed';
  }

  private normalizeCategory(raw: unknown): InterviewQuestionCategory {
    const value = String(raw ?? '').trim();
    const match = VALID_CATEGORIES.find(
      (c) => c.toLowerCase() === value.toLowerCase(),
    );
    return match ?? 'Role-specific';
  }

  private safeJsonParse(text: string): RawToolkitResponse {
    try {
      return JSON.parse(text);
    } catch {
      const cleaned = text.replace(/```json/g, '').replace(/```/g, '').trim();
      return JSON.parse(cleaned);
    }
  }
}
