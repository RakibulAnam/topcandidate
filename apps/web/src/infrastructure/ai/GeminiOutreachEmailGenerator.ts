// Infrastructure - Gemini AI Outreach Email Generator

import { GoogleGenAI, Type } from '@google/genai';
import { ResumeData, OutreachEmail } from '../../domain/entities/Resume.js';
import { IOutreachEmailGenerator } from '../../domain/usecases/GenerateOutreachEmailUseCase.js';
import {
  buildCandidateContext,
  assertNoFabricatedTools,
  assertOutreachSpecificity,
  classifyFitMode,
} from './prompts/toolkitContext.js';

export class GeminiOutreachEmailGenerator implements IOutreachEmailGenerator {
  private genAI: GoogleGenAI;
  private readonly model = 'gemini-2.5-flash';

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error('Gemini API key is required');
    }
    this.genAI = new GoogleGenAI({ apiKey });
  }

  async generate(data: ResumeData): Promise<OutreachEmail> {
    const fit = classifyFitMode(data);
    console.info(`[outreach-gen] fit=${fit.mode} overlap=${fit.overlap.toFixed(2)} matched=${fit.matched}/${fit.jdVocabSize}`);
    const result = await this.genAI.models.generateContent({
      model: this.model,
      contents: this.buildPrompt(data, fit.mode),
      config: {
        temperature: fit.mode === 'stretch' ? 0.55 : 0.45,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            subject: { type: Type.STRING },
            body: { type: Type.STRING },
          },
          required: ['subject', 'body'],
        },
        systemInstruction: `You write short, high-signal cold outreach emails that a hiring manager would actually read and reply to.

GROUND IN THE CANDIDATE — the prompt presents the candidate's full profile (experience, projects, education, certifications, awards, publications, extracurriculars, languages, skills) FIRST and the JD SECOND. Pick the single most JD-relevant slice of the candidate's actual evidence and lead with it. The email's job is to make a hiring manager curious about THIS specific person, not to summarize the JD.

SCOPE — You produce ONE email: a subject line and a body. The body is what the sender will paste into their email client. Do NOT include "Hi <Name>," greeting, do NOT include a signoff/signature — the app renders those or the sender adds them.

LENGTH — Body 110–170 words. Subject ≤ 60 characters.

TONE — Direct, specific, respectful of the reader's time. Warm but not fawning. Where the candidate's own raw words (VOICE REFERENCE) carry a natural framing, let it color your tone — but never lift facts that aren't also in the polished bullets. No clichés ("I hope this finds you well", "quick question", "synergies"). No hedging. First person, active voice.

SHAPE (body) — 3 short paragraphs:
  1. One sentence that names the role + the one most relevant credential / achievement / certification / award / project from the candidate evidence. No "I am writing to express interest".
  2. Two to three sentences of concrete evidence — specific projects, outcomes, or tools that already appear in the candidate evidence — tied to the JD. Mirror 1–2 JD keywords verbatim where truthful.
  3. A soft, specific ask — "Would a 15-minute chat next week be useful?" or "Happy to share a short write-up of <X candidate-evidenced topic> if helpful." Avoid generic "let me know".

GROUNDING REQUIREMENTS (enforced by the app — failure triggers a retry):
  • The body MUST mention the target company by name.
  • The body MUST reference at least one of the candidate's own proper nouns (their company, role, project name, certification, award, school, or extracurricular organization). Generic "my experience" / "my background" does NOT count.

HONESTY — Never invent companies, metrics, tools, or credentials. Use only what the provided candidate evidence supports.

OUTPUT — Return valid JSON with exactly { "subject": string, "body": string }. No markdown, no code fences, no extra fields.`,
      },
    });

    const text = result.text;
    if (!text) throw new Error('No response from AI');

    const parsed = JSON.parse(text) as OutreachEmail;
    if (!parsed.subject || !parsed.body) {
      throw new Error('Outreach email response missing required fields');
    }
    const subject = parsed.subject.trim();
    const body = parsed.body.trim();

    assertNoFabricatedTools(`${subject}\n${body}`, data, { allowJD: fit.mode === 'stretch' });
    assertOutreachSpecificity(`${subject}\n${body}`, data, fit.mode === 'stretch' ? 'either' : 'both');

    return { subject, body };
  }

  private buildPrompt(data: ResumeData, mode: 'match' | 'stretch' = 'match'): string {
    const candidateContext = buildCandidateContext(data);
    const stretchPreamble = mode === 'stretch' ? `
═══════════════════════════════════════════════
STRETCH MODE — CAREER SWITCH
═══════════════════════════════════════════════
The candidate's evidence does not closely match the JD's field. Frame the email as an honest pivot: lead with a transferable-skill bridge, acknowledge the career switch openly ("Coming from <past field>, drawn to <target>"), and reference JD-named tools as ramp areas — never as past experience. Never invent past employers, credentials, or metrics.
` : '';

    return `
Write the subject line and body for a cold outreach email from this candidate to the hiring manager for the role below.
${stretchPreamble}
═══════════════════════════════════════════════
CANDIDATE EVIDENCE (source of truth — use ONLY what's here)
═══════════════════════════════════════════════
${candidateContext}

═══════════════════════════════════════════════
TARGET ROLE (filter & ordering signal)
═══════════════════════════════════════════════
Title: ${data.targetJob.title || 'N/A'}
Company: ${data.targetJob.company || 'the hiring company'}

Job Description:
${data.targetJob.description}

═══════════════════════════════════════════════
RULES
═══════════════════════════════════════════════
- Subject: ≤ 60 chars, specific to the role${data.targetJob.title ? ` (${data.targetJob.title})` : ''}, no "Re:" / "Fwd:" prefixes, no emojis.
- Body: 110–170 words, 3 short paragraphs, no greeting, no signoff.
- ${mode === 'stretch'
  ? `Body MUST reference EITHER "${data.targetJob.company || 'the target company'}" by name OR at least one candidate proper noun. One anchor is enough in stretch mode.`
  : `Body MUST mention "${data.targetJob.company || 'the target company'}" by name AND reference at least one specific item from the CANDIDATE EVIDENCE above — by name (a real company / project / certification / award / school).`}
- ${mode === 'stretch'
  ? 'JD-named tools may appear as growth targets / ramp areas — never as past experience. Never invent past employers, credentials, or metrics.'
  : 'Do not mention any tool / framework / cloud / employer that isn\'t in the CANDIDATE EVIDENCE (the target company is exempt).'}
- Mirror 1–2 JD keywords verbatim where truthful.
`;
  }
}
