// Infrastructure — OpenRouter combined toolkit generator (migration Phase 3).
//
// Produces cover letter + outreach email + LinkedIn note + interview questions
// in ONE call, on OpenRouterClient. Shares the SAME prompts (toolkitPrompts.ts)
// and the SAME per-artifact guards (toolkitContext.ts) as the Gemini toolkit —
// only the transport changes. The per-artifact `errors`-map contract is
// preserved exactly: a weak slot records its reason while the others ship.
//
// Gemini 2.5 Flash is the primary here (NOT DeepSeek): the toolkit emits ~6k
// tokens of bilingual EN/BN content and DeepSeek V3.2 was too slow on that long
// a generation to fit Vercel's 60s function cap (timed out at 55s in live
// testing 2026-06-09). Gemini Flash is fast on long output and strong on
// Bengali. DeepSeek stays as a fallback. The optimizer (short output) keeps
// DeepSeek primary — see OpenRouterResumeOptimizer. Cost note: Gemini output is
// $2.50/M, so the toolkit costs more than the DeepSeek projection; acceptable —
// it's the revenue-generating paid path and latency/reliability win here.
//
// Structured output: strict `json_schema` (TOOLKIT_SCHEMA) so the provider
// enforces the shape — the largest field (the bilingual interview array) can't
// truncate or malform. We STILL parse defensively (tolerate missing Bn fields,
// strip code fences). Reasoning disabled; data_collection denied.
//
// LIVE via aiFactory whenever OPENROUTER_API_KEY is set (the default); the
// Gemini toolkit is the unset-key fallback.

import {
  ResumeData,
  GeneratedToolkit,
  InterviewQuestion,
  InterviewQuestionCategory,
  ToolkitErrors,
} from '../../domain/entities/Resume.js';
import { IToolkitGenerator } from '../../domain/usecases/GenerateToolkitUseCase.js';
import type { UsageSink } from './usage.js';
import { OpenRouterClient, withRetry } from './OpenRouterClient.js';
import {
  buildToolkitSystemInstruction,
  buildToolkitUserPrompt,
  LINKEDIN_MAX,
} from './prompts/toolkitPrompts.js';
import {
  buildToolkitEvidenceCorpus,
  detectFabricatedTokens,
  ToolkitFabricationError,
  assertOutreachSpecificity,
  classifyFitMode,
} from './prompts/toolkitContext.js';

// VERIFY slugs at https://openrouter.ai/models before each release.
const TOOLKIT_MODELS = [
  'google/gemini-2.5-flash',
  'deepseek/deepseek-v3.2',
  'meta-llama/llama-3.3-70b-instruct',
];

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

// Structured-output schema (mirrors the legacy Gemini responseSchema). Using
// json_schema instead of json_object makes the provider enforce the shape — the
// largest field (the bilingual interview array) can't truncate or malform.
const TOOLKIT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    coverLetter: { type: 'string' },
    outreachEmail: {
      type: 'object',
      properties: { subject: { type: 'string' }, body: { type: 'string' } },
      required: ['subject', 'body'],
      additionalProperties: false,
    },
    linkedInMessage: { type: 'string' },
    interviewQuestions: {
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
  required: ['coverLetter', 'outreachEmail', 'linkedInMessage', 'interviewQuestions'],
  additionalProperties: false,
};

export class OpenRouterToolkitGenerator implements IToolkitGenerator {
  private readonly client: OpenRouterClient;
  // Total wall-time budget across attempts (deadline-bounded — see withRetry).
  // Since the 2026-06-11 split, the toolkit runs on its OWN /api/toolkit
  // function invocation (the optimizer lives on /api/optimize), so it gets
  // most of Vercel's 60s window: 52s + auth/rate-limit/telemetry overhead
  // stays under the cap. One slow attempt may use the whole budget; a fast
  // parse-fail leaves room for one bounded retry.
  private readonly deadlineMs = 52_000;

  constructor(apiKey: string) {
    this.client = new OpenRouterClient(apiKey);
  }

  async generate(data: ResumeData, usage?: UsageSink): Promise<GeneratedToolkit> {
    const t0 = Date.now();
    const fit = classifyFitMode(data);
    console.info(`[or-toolkit-gen] start jdLen=${data.targetJob.description.length} fit=${fit.mode} overlap=${fit.overlap.toFixed(2)} matched=${fit.matched}/${fit.jdVocabSize}`);

    // Retry the AI call + parse on transient malformed JSON (json_schema
    // enforces shape but the round trip can still fail transiently). The
    // per-artifact validation below is NOT retried — a
    // weak single artifact is expected and lands in the errors map, not a regen.
    const parsed: RawToolkitResponse = await withRetry(async (remainingMs) => {
      const result = await this.client.chat(
        {
          model: TOOLKIT_MODELS[0],
          models: TOOLKIT_MODELS,
          messages: [
            { role: 'system', content: buildToolkitSystemInstruction(fit.mode) },
            { role: 'user', content: buildToolkitUserPrompt(data, fit.mode) },
          ],
          response_format: { type: 'json_schema', json_schema: { name: 'toolkit', strict: true, schema: TOOLKIT_SCHEMA } },
          temperature: fit.mode === 'stretch' ? 0.55 : 0.4,
          // Four artifacts in one payload, the bilingual interview block being the
          // largest; 6000 risked truncating the interview JSON. 8000 gives headroom
          // (ceiling only — normal payloads cost the same). Fits the 48s deadline.
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
      try {
        return this.safeJsonParse(text);
      } catch (parseErr) {
        const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
        console.warn(`[or-toolkit-gen] JSON parse failed (retrying if attempts remain): ${msg}`);
        throw new Error(`Toolkit response was not valid JSON: ${msg}`);
      }
    }, this.deadlineMs);
    console.info(`[or-toolkit-gen] parsed after ${Date.now() - t0}ms`);

    // Per-artifact validation — identical contract to GeminiToolkitGenerator.
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
      console.warn('[or-toolkit-gen] coverLetter validation failed:', errors.coverLetter);
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
      console.warn('[or-toolkit-gen] outreachEmail validation failed:', errors.outreachEmail);
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
      console.warn('[or-toolkit-gen] linkedInMessage validation failed:', errors.linkedInMessage);
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
      out.interviewQuestions = interviewQuestions;
    } catch (err) {
      errors.interviewQuestions = this.errorMessage(err);
      console.warn('[or-toolkit-gen] interviewQuestions validation failed:', errors.interviewQuestions);
    }

    const ok = {
      coverLetter: !!out.coverLetter,
      outreachEmail: !!out.outreachEmail,
      linkedInMessage: !!out.linkedInMessage,
      interviewQuestions: !!out.interviewQuestions && out.interviewQuestions.length > 0,
    };
    console.info(`[or-toolkit-gen] done total=${Date.now() - t0}ms slots=${JSON.stringify(ok)} errorKeys=${Object.keys(errors).join(',') || '(none)'}`);

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
