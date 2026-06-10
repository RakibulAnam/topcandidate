// Infrastructure — Gemini AI Combined Toolkit Generator
//
// Produces cover letter + outreach email + LinkedIn note + interview questions
// in a single call with one unified response schema. This is the hot-path used
// on initial resume generation; the per-artifact generators are still wired
// individually for the single-item regenerate flow.

import { GoogleGenAI, Type } from '@google/genai';
import {
  ResumeData,
  GeneratedToolkit,
  InterviewQuestion,
  InterviewQuestionCategory,
  ToolkitErrors,
} from '../../domain/entities/Resume.js';
import { IToolkitGenerator } from '../../domain/usecases/GenerateToolkitUseCase.js';
import type { UsageSink } from './usage.js';
import {
  buildToolkitEvidenceCorpus,
  detectFabricatedTokens,
  ToolkitFabricationError,
  assertOutreachSpecificity,
  classifyFitMode,
} from './prompts/toolkitContext.js';
import {
  LINKEDIN_MAX,
  buildToolkitSystemInstruction,
  buildToolkitUserPrompt,
} from './prompts/toolkitPrompts.js';

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
  private genAI: GoogleGenAI;
  private readonly model = 'gemini-2.5-flash';

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error('Gemini API key is required');
    }
    this.genAI = new GoogleGenAI({ apiKey });
  }

  async generate(data: ResumeData, usage?: UsageSink): Promise<GeneratedToolkit> {
    const t0 = Date.now();
    // Classify the application before we hit the AI so the prompt + guard
    // behaviour can adapt. Match = strict (default). Stretch = career-switcher
    // framing — allow JD-named tools in output, soften specificity, coach
    // for transferable-skills + learning-posture language.
    const fit = classifyFitMode(data);
    console.info(`[toolkit-gen] start model=${this.model} jdLen=${data.targetJob.description.length} fit=${fit.mode} overlap=${fit.overlap.toFixed(2)} matched=${fit.matched}/${fit.jdVocabSize}`);
    const result = await this.genAI.models.generateContent({
      model: this.model,
      contents: buildToolkitUserPrompt(data, fit.mode),
      config: {
        temperature: fit.mode === 'stretch' ? 0.55 : 0.4,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            coverLetter: { type: Type.STRING },
            outreachEmail: {
              type: Type.OBJECT,
              properties: {
                subject: { type: Type.STRING },
                body: { type: Type.STRING },
              },
              required: ['subject', 'body'],
            },
            linkedInMessage: { type: Type.STRING },
            interviewQuestions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  question: { type: Type.STRING },
                  category: { type: Type.STRING },
                  whyAsked: { type: Type.STRING },
                  answerStrategy: { type: Type.STRING },
                  // Bengali (Bangla) translations — see system instruction
                  // for register & terminology rules. Authoritative copy is
                  // English; these are for the candidate's own rehearsal.
                  questionBn: { type: Type.STRING },
                  whyAskedBn: { type: Type.STRING },
                  answerStrategyBn: { type: Type.STRING },
                },
                required: ['question', 'category', 'whyAsked', 'answerStrategy', 'questionBn', 'whyAskedBn', 'answerStrategyBn'],
              },
            },
          },
          required: ['coverLetter', 'outreachEmail', 'linkedInMessage', 'interviewQuestions'],
        },
        systemInstruction: buildToolkitSystemInstruction(fit.mode),
      },
    });

    const tGemini = Date.now() - t0;

    // Capture token usage for cost telemetry before discarding the raw SDK
    // response (additive — does not affect the generated toolkit).
    if (usage) {
      usage.provider = 'gemini';
      usage.model = this.model;
      const um = (result as any)?.usageMetadata;
      usage.promptTokens = um?.promptTokenCount;
      usage.completionTokens = um?.candidatesTokenCount;
    }

    const text = result.text;
    if (!text) {
      console.error(`[toolkit-gen] empty AI response after ${tGemini}ms`);
      // A blank AI response is a hard failure — there's nothing per-artifact
      // to recover. Throw so the caller records the same error for every
      // toolkit slot and the user retries the whole bundle.
      throw new Error('No response from AI');
    }
    console.info(`[toolkit-gen] AI response in ${tGemini}ms textLen=${text.length}`);

    let parsed: RawToolkitResponse;
    try {
      parsed = this.safeJsonParse(text);
    } catch (parseErr) {
      const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
      console.error(`[toolkit-gen] JSON parse failed: ${msg} (textPrefix="${text.slice(0, 120).replace(/\s+/g, ' ')}")`);
      throw new Error(`Toolkit response was not valid JSON: ${msg}`);
    }

    // Validate each artifact in isolation so one weak slot doesn't take the
    // others down with it. Evidence corpus is built once and reused by every
    // per-artifact fabrication scan; the target company name is folded in so
    // outreach copy may reference the recipient without tripping the guard.
    const evidence = buildToolkitEvidenceCorpus(data);
    const baseEvidence = data.targetJob.company
      ? `${evidence} ${data.targetJob.company.toLowerCase()}`
      : evidence;

    // Interview prep ALWAYS gets JD-augmented evidence — even in match mode —
    // because the JD dictates what the interviewer probes. Basel III / IFRS 9
    // / KYC / SWIFT etc. legitimately appear in answer-strategy notes as
    // topics-to-brush-up-on; that's not fabrication.
    //
    // Stretch mode extends the same JD allowance to cover letter / outreach /
    // LinkedIn. Rationale: the candidate is making a career switch, the JD
    // describes the new field, and the AI may legitimately reference what the
    // JD asks for as a growth target or transferable-skill bridge. The
    // prompt (buildSystemInstruction with mode='stretch') tells the AI to
    // frame these references as aspirational / learning-posture, not as
    // claimed experience — the prompt does the framing, the guard just stops
    // blocking the necessary vocabulary.
    const jdText = (data.targetJob.description ?? '').toLowerCase();
    const pitchEvidence = fit.mode === 'stretch'
      ? `${baseEvidence} ${jdText}`
      : baseEvidence;

    // Outreach specificity stays strict in match mode (both target company
    // AND a candidate anchor), softens to "either" in stretch mode — a
    // career switcher's outreach often leans more on JD-anchored aspiration
    // than on a candidate proper-noun match.
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
      console.warn('[toolkit-gen] coverLetter validation failed:', errors.coverLetter);
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
      console.warn('[toolkit-gen] outreachEmail validation failed:', errors.outreachEmail);
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
      // LinkedIn always uses 'either' (280 chars rarely fits both anchors).
      assertOutreachSpecificity(linkedInMessage, data, 'either');
      out.linkedInMessage = linkedInMessage;
    } catch (err) {
      errors.linkedInMessage = this.errorMessage(err);
      console.warn('[toolkit-gen] linkedInMessage validation failed:', errors.linkedInMessage);
    }

    // ── Interview questions ─────────────────────────────────────────────────
    try {
      const questionsRaw = Array.isArray(parsed.interviewQuestions)
        ? parsed.interviewQuestions
        : [];
      const interviewQuestions: InterviewQuestion[] = questionsRaw
        .map((q) => {
          // Bengali fields are required by the prompt but tolerated as empty
          // here so the question still ships if Gemini occasionally skips a
          // translation (rare). The UI falls back to the English text when
          // BN is missing.
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

      // NO fabrication / anchor-coverage hard-fail on interview prep — questions
      // are meant to probe the JD (incl. tech the candidate hasn't used) so they
      // can rehearse. The prompt steers quality + honest answer coaching. (Kept
      // in sync with OpenRouterToolkitGenerator.)
      out.interviewQuestions = interviewQuestions;
    } catch (err) {
      errors.interviewQuestions = this.errorMessage(err);
      console.warn('[toolkit-gen] interviewQuestions validation failed:', errors.interviewQuestions);
    }

    const ok = {
      coverLetter: !!out.coverLetter,
      outreachEmail: !!out.outreachEmail,
      linkedInMessage: !!out.linkedInMessage,
      interviewQuestions: !!out.interviewQuestions && out.interviewQuestions.length > 0,
    };
    console.info(`[toolkit-gen] done total=${Date.now() - t0}ms slots=${JSON.stringify(ok)} errorKeys=${Object.keys(errors).join(',') || '(none)'}`);

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
