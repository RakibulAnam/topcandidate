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
import {
  buildCandidateContext,
  buildToolkitEvidenceCorpus,
  detectFabricatedTokens,
  ToolkitFabricationError,
  assertOutreachSpecificity,
  assertInterviewAnchorCoverage,
  classifyFitMode,
  type FitMode,
} from './prompts/toolkitContext.js';

const LINKEDIN_MAX = 280;

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

  async generate(data: ResumeData): Promise<GeneratedToolkit> {
    const t0 = Date.now();
    // Classify the application before we hit the AI so the prompt + guard
    // behaviour can adapt. Match = strict (default). Stretch = career-switcher
    // framing — allow JD-named tools in output, soften specificity, coach
    // for transferable-skills + learning-posture language.
    const fit = classifyFitMode(data);
    console.info(`[toolkit-gen] start model=${this.model} jdLen=${data.targetJob.description.length} fit=${fit.mode} overlap=${fit.overlap.toFixed(2)} matched=${fit.matched}/${fit.jdVocabSize}`);
    const result = await this.genAI.models.generateContent({
      model: this.model,
      contents: this.buildPrompt(data, fit.mode),
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
        systemInstruction: this.buildSystemInstruction(fit.mode),
      },
    });

    const tGemini = Date.now() - t0;
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
    const interviewEvidence = `${baseEvidence} ${jdText}`;

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

      const allInterviewText = interviewQuestions
        .map(q => `${q.question}\n${q.whyAsked}\n${q.answerStrategy}`)
        .join('\n');
      const fabricated = detectFabricatedTokens(allInterviewText, interviewEvidence);
      if (fabricated.length > 0) throw new ToolkitFabricationError(fabricated);

      // Stretch candidates can't always anchor strategies in candidate proper
      // nouns — half the answers will be about how to bridge from past
      // experience to the new field. Skip the anchor-coverage assertion in
      // stretch mode; the prompt already coaches the AI to weave transferable
      // skills into answers, which is the real signal we want here.
      if (fit.mode !== 'stretch') {
        assertInterviewAnchorCoverage(
          interviewQuestions.map(q => q.answerStrategy),
          data,
        );
      }
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

  private buildSystemInstruction(mode: FitMode = 'match'): string {
    const stretchBlock = mode === 'stretch' ? this.stretchSystemBlock() : '';
    return `You are producing the complete application toolkit that ships alongside a candidate's tailored resume. Four artifacts in ONE JSON payload — no extras, no commentary.

${stretchBlock}GROUND EVERYTHING IN THE CANDIDATE — the prompt presents the candidate's full profile (experience, projects, education, certifications, awards, publications, extracurriculars, languages, skills) FIRST and the JD SECOND. The candidate's actual evidence is the source of truth; the JD is the filter and ordering signal. ${mode === 'stretch' ? 'In STRETCH mode (see above) you may reference JD-named tools / regulators / frameworks as GROWTH TARGETS or transferable-skill bridges — never as claimed experience. Default honesty rule still applies to employers, credentials, and metrics: never invent them.' : 'Every mention of a tool, employer, project, or credential must already exist somewhere in the candidate evidence — except the target company name itself, which you may reference as the recipient.'}

OUTPUT FORMAT — Valid JSON matching the schema. No markdown, no code fences, no extra fields. Every field required and non-empty.

VOICE — Where the candidate's own raw words (VOICE REFERENCE block) carry a natural framing or phrasing, let it color tone — but never lift facts that aren't also in the polished bullets.

Each artifact has its own rules. Follow them in isolation — treat them as four separate deliverables that happen to ship in one response.

═══════════════════════════════════════════════
ARTIFACT 1 — COVER LETTER (string, coverLetter)
═══════════════════════════════════════════════
LENGTH — 250–400 words of body text. No date line, no address block, no "Dear <Name>," greeting, no signoff — the app renders those around the body.

TONE — Professional, specific, confident, first person active voice. No clichés ("I am writing to express interest", "dynamic self-starter", "passion for excellence"). No hedging.

SHAPE — 3–4 short paragraphs:
  1. Opening that names the role + ${mode === 'stretch' ? 'the candidate\'s strongest transferable credential and explicitly acknowledges this is a pivot ("Coming from <past field> into <target field>", "After <N> years in <past>, I\'m moving toward <target>"). Use a real candidate proper noun (company / project / cert).' : 'the candidate\'s strongest credential mapped to it (drawn from the evidence — a real company, project, certification, or award; no "I am applying for…").'}
  2. ${mode === 'stretch' ? 'One paragraph that bridges 2–3 transferable skills from candidate evidence to JD requirements, in concrete terms. Mirror 1–2 JD keywords. Optionally one sentence on self-directed learning (a recent course, side project, or self-study) ONLY if such an item exists in candidate evidence — never invent one.' : 'One or two paragraphs of concrete evidence — specific projects, outcomes, tools — drawn from the candidate evidence and mirroring JD keywords where truthful.'}
  3. Closing that ties the candidate's trajectory to what the role would let them do next. ${mode === 'stretch' ? 'Soft confidence about the pivot; eager but not desperate. Acknowledge willingness to ramp on JD-specific tools without claiming them.' : 'Soft, confident, not fawning.'}

HONESTY — ${mode === 'stretch' ? 'Never invent employers, credentials, or past-tense metrics. JD-named tools/frameworks may appear as GROWTH TARGETS or aspirations only — never phrased as past experience.' : 'Do not invent employers, metrics, tools, or credentials. Use only what\'s in the candidate evidence above.'}

═══════════════════════════════════════════════
ARTIFACT 2 — OUTREACH EMAIL (object, outreachEmail)
═══════════════════════════════════════════════
SUBJECT — ≤ 60 characters, specific to the role, no "Re:" / "Fwd:" prefixes, no emojis.

BODY — 110–170 words, 3 short paragraphs, no greeting, no signoff:
  1. One sentence naming the role + ${mode === 'stretch' ? 'the candidate\'s strongest transferable credential framed as a bridge ("Coming from <past field>, drawn to <target field> because…"). Use a real candidate proper noun.' : 'the one most relevant credential (a real proper noun from the candidate evidence — company, project, certification, award).'}
  2. ${mode === 'stretch' ? '2–3 sentences mapping transferable skills from candidate evidence to JD priorities. Mirror 1–2 JD keywords verbatim if truthful. JD-named tools may appear as growth targets — never claimed as past experience.' : '2–3 sentences of concrete evidence drawn from the candidate evidence, tied to the JD (mirror 1–2 JD keywords verbatim where truthful).'}
  3. A soft specific ask ("Would a 15-minute chat next week be useful?" / "Happy to share a short write-up of <X candidate-evidenced topic> if helpful.") — never generic "let me know".

GROUNDING (enforced — failure surfaces a retry button): ${mode === 'stretch' ? 'body MUST mention the target company by name OR reference at least one candidate proper noun (either is fine in stretch mode — one anchor is enough).' : 'body MUST mention the target company by name AND reference at least one candidate proper noun (the candidate\'s own company / role / project / cert / award / school).'}

TONE — Direct, respectful of reader's time, warm but not fawning. No clichés ("hope this finds you well", "quick question", "synergies"). No hedging.

HONESTY — ${mode === 'stretch' ? 'Never invent employers, credentials, or past-tense metrics. JD-named tools may appear as growth targets, never as past experience.' : 'Use only what the provided candidate evidence supports.'}

═══════════════════════════════════════════════
ARTIFACT 3 — LINKEDIN CONNECTION NOTE (string, linkedInMessage)
═══════════════════════════════════════════════
LENGTH — HARD LIMIT ${LINKEDIN_MAX} characters. Count spaces. Shorter is better.

FORMAT — Plain text, one paragraph (2–3 sentences). No greeting, no signoff, no emojis, no markdown, no quotes around the message.

SHAPE —
  1. One sentence naming the role / company + the candidate's single strongest credential that maps to it (a real proper noun from the candidate evidence).
  2. One sentence with a soft specific reason to connect ("would love to learn how your team approaches X"). No referral asks. No "quick chat?" phrasing.

GROUNDING (enforced): the note must reference EITHER the target company by name OR at least one candidate proper noun. Within 280 chars you usually need both.

TONE — Direct, human, low-pressure. Mirror at most ONE JD keyword. Never invent employers, tools, or metrics.

═══════════════════════════════════════════════
ARTIFACT 4 — INTERVIEW QUESTIONS (array, interviewQuestions)
═══════════════════════════════════════════════
COUNT — 6–8 questions. Span these categories where relevant to the JD: "Behavioral", "Technical", "Role-specific", "Values & Culture", "Situational".

QUESTION — Specific to THIS JD and THIS candidate's background. Banned: "Tell me about yourself." Write exactly as spoken.

WHY ASKED — 2–3 sentences naming the signal the interviewer is scoring.

ANSWER STRATEGY — 3–5 sentences with explicit structure (STAR, trade-off framing, brief-then-deep). ${mode === 'stretch' ? 'For questions about candidate experience the AI cannot anchor in target-field proper nouns, structure the answer around a TRANSFERABLE-SKILL BRIDGE: name a real candidate item (company, project, school) where the underlying skill was exercised, then explicitly map it to how the same skill applies in the target role. For questions about JD-specific tools/frameworks the candidate has not yet used, coach an honest "here is how I would approach learning / applying X" answer; never coach a fake-it answer.' : 'MUST reference at least one named item from the candidate evidence — by name (the company, the role, the project, the certification, the school). Do NOT write "your X project" or "your relevant experience"; name it. Flag common failure modes to avoid.'}

GROUNDING ${mode === 'stretch' ? '(advisory)' : '(enforced)'} — ${mode === 'stretch' ? 'aim for transferable-skill bridges anchored in real candidate items where possible; for pure JD-knowledge questions an honest learning-posture answer is acceptable.' : 'the majority of answer strategies must contain a literal candidate proper noun — vague hooks like "your relevant project" count as ungrounded.'}

HONESTY — Never invent employers, tools, or metrics in answer-strategy hooks.${mode === 'stretch' ? ' Never coach the candidate to claim experience with JD-named tools they have not used; coach honest preparation instead.' : ''}

BILINGUAL PREP (REQUIRED) — for EACH question, also produce the Bengali (Bangla / বাংলা) version in fields questionBn, whyAskedBn, answerStrategyBn. The English version is authoritative; the Bengali version is for the candidate's own rehearsal because BD interviews routinely switch into Bangla on behavioural / cultural questions even at MNCs.
  • Register: professional, interview-realistic Bangla as an actual Bangladeshi recruiter or hiring manager would speak it. NOT a literal word-for-word translation — naturalise idioms.
  • Proper nouns: keep employer names, product names, certifications, and English-canonical industry terms (Basel III, IFRS 9, KYC, SWIFT, NPL, ECL, CFA, BBA, MBA, SME, CV, KPI, ROI) in English / Roman script inline. Bangla speakers in professional contexts read these as English tokens; translating them into Bengali script is confusing and unnatural.
  • Banking / finance terminology stays bilingual-natural: "credit analysis" → "ক্রেডিট অ্যানালাইসিস", "interest rate" → "সুদের হার", "loan portfolio" → "লোন পোর্টফোলিও". Use whichever form a real BD banker would say out loud.
  • Numbers, dates, and currency stay as written (5 crore taka stays "5 crore taka" or "৫ কোটি টাকা" — pick whichever reads naturally for that sentence).
  • Length parity: Bengali version should be roughly the same depth as English — not a one-sentence summary. The candidate needs a full prep brief in either language.
  • Category labels (Behavioral / Technical / Role-specific / Values & Culture / Situational) stay in English — they are categorisation tokens, not narrative copy.`;
  }

  private stretchSystemBlock(): string {
    return `STRETCH MODE — CAREER SWITCH FRAMING
This application is a stretch: the candidate's evidence does NOT closely match the JD's
field. They may be pivoting industries, jumping seniority, or moving from a related but
different function. Your job is to make the strongest HONEST case for them anyway.

What this changes:
- Lean on TRANSFERABLE SKILLS (analysis, structured thinking, stakeholder management,
  customer empathy, communication, leadership, learning velocity, domain rigor) and bridge
  them to JD requirements with concrete examples from the candidate's actual evidence.
- ACKNOWLEDGE the pivot openly in the cover letter / outreach opener — recruiters
  respect honesty over disguise. "Coming from X, drawn to Y because…" beats hiding it.
- JD-named tools / regulators / frameworks the candidate has NOT used may be referenced
  as GROWTH TARGETS, aspirational learning, or "ramp areas" — NEVER as claimed past
  experience. The distinction is critical: "I'd be excited to ramp on Murex" is honest;
  "I have Murex experience" is fabrication.
- If candidate evidence contains a course, certification, side project, or extracurricular
  that bridges toward the JD field, lead with it. Do NOT invent one.
- Tone: confident-but-curious. Eager to learn, not desperate. Frame the gap as
  intentional career direction, not as a deficit.

What this does NOT change:
- Never invent past employers, credentials, metrics, or claimed tool experience.
- Cover letter still 250–400 words; outreach still 110–170; LinkedIn still ≤ ${LINKEDIN_MAX} chars.
- Every artifact still ships in the same JSON schema.

`;
  }

  private buildPrompt(data: ResumeData, mode: FitMode = 'match'): string {
    const candidateContext = buildCandidateContext(data);
    const modeBlock = mode === 'stretch'
      ? `\nFIT MODE: STRETCH — the candidate is making a career switch. Follow the STRETCH MODE rules from the system instruction: transferable-skill bridges, honest pivot framing, JD tools as growth targets only.\n`
      : `\nFIT MODE: MATCH — the candidate's evidence aligns with the JD field. Use standard same-field framing.\n`;

    return `
Produce the full application toolkit — cover letter, outreach email, LinkedIn note, and 6–8 interview questions — for this candidate against this role.
${modeBlock}
═══════════════════════════════════════════════
CANDIDATE EVIDENCE (source of truth — every artifact must hook into named items from below)
═══════════════════════════════════════════════
${candidateContext}

═══════════════════════════════════════════════
TARGET ROLE${mode === 'stretch' ? ' (this is a STRETCH application — the JD field differs from the candidate\'s experience)' : ' (filter & ordering signal — NOT a content source)'}
═══════════════════════════════════════════════
Title: ${data.targetJob.title || 'N/A'}
Company: ${data.targetJob.company || 'the hiring company'}

Job Description:
${data.targetJob.description}

═══════════════════════════════════════════════
RULES
═══════════════════════════════════════════════
- Strict JSON matching the schema. Every field non-empty.
- Each artifact follows its own rules from the system instruction.
- ${mode === 'stretch'
  ? `Never invent employers, credentials, or past-tense metrics. JD-named tools / frameworks the candidate has NOT used may be mentioned as growth targets / learning intent only — never as claimed past experience. The target company "${data.targetJob.company || ''}" may be addressed by name.`
  : `Never invent employers, metrics, or tools — every tool / framework / cloud / employer mentioned must already appear in the CANDIDATE EVIDENCE above (the target company "${data.targetJob.company || ''}" is exempt — you may name it as the recipient).`}
- ${mode === 'stretch'
  ? 'Outreach email and LinkedIn note must reference EITHER the target company by name OR at least one candidate proper noun (one is enough in stretch mode).'
  : 'Outreach email and LinkedIn note must reference at least one specific candidate proper noun (real company, role, project, certification, award, or school).'}
- ${mode === 'stretch'
  ? 'Interview answerStrategies should use transferable-skill bridges where direct experience is absent. For tools the candidate has not used, coach an honest learning-posture answer — never a fake-it answer.'
  : 'Interview answerStrategies must name candidate items literally — no "your relevant X" placeholders.'}
- Every interview question must include BOTH English and Bengali versions (questionBn, whyAskedBn, answerStrategyBn). Bengali is for the candidate's rehearsal — natural professional register, keep English-canonical industry terms (Basel III, IFRS 9, KYC, NPL, ECL, CFA, KPI, ROI, etc.) and proper nouns in English / Roman script inline. Do NOT translate the category label.
- Mirror JD keywords verbatim where truthful for this candidate.
`;
  }
}
