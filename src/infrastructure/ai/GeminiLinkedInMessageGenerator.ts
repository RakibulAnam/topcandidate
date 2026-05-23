// Infrastructure - Gemini AI LinkedIn Connection Note Generator

import { GoogleGenAI } from '@google/genai';
import { ResumeData } from '../../domain/entities/Resume.js';
import { ILinkedInMessageGenerator } from '../../domain/usecases/GenerateLinkedInMessageUseCase.js';
import {
  buildCandidateContext,
  assertNoFabricatedTools,
  assertOutreachSpecificity,
  classifyFitMode,
} from './prompts/toolkitContext.js';

// LinkedIn's connection-note hard limit is 300 characters; we aim for 280 to
// leave a buffer and because shorter notes get accepted more often.
const MAX_LENGTH = 280;

export class GeminiLinkedInMessageGenerator implements ILinkedInMessageGenerator {
  private genAI: GoogleGenAI;
  private readonly model = 'gemini-2.5-flash';

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error('Gemini API key is required');
    }
    this.genAI = new GoogleGenAI({ apiKey });
  }

  async generate(data: ResumeData): Promise<string> {
    const fit = classifyFitMode(data);
    console.info(`[linkedin-gen] fit=${fit.mode} overlap=${fit.overlap.toFixed(2)} matched=${fit.matched}/${fit.jdVocabSize}`);
    const result = await this.genAI.models.generateContent({
      model: this.model,
      contents: this.buildPrompt(data, fit.mode),
      config: {
        temperature: fit.mode === 'stretch' ? 0.55 : 0.45,
        systemInstruction: `You write short LinkedIn connection notes that earn the accept from a hiring manager or recruiter.

GROUND IN THE CANDIDATE — the prompt presents the candidate's full profile FIRST and the JD SECOND. Lead with the candidate's single strongest credential that maps to the role — drawn from a specific item in the evidence (a real company, role, project, certification, award, or school). Generic phrases like "my background" or "my experience" do NOT count.

FORMAT — Plain text only. No greeting like "Hi <Name>,". No signature. No emojis. No markdown. No quotes around the message. Return the note itself and nothing else.

LENGTH — HARD LIMIT ${MAX_LENGTH} characters including spaces. Shorter is better.

SHAPE — One paragraph, 2–3 sentences:
  1. One sentence naming the role / company + the candidate's single strongest credential that maps to it. The credential MUST be a real proper noun from the candidate evidence (company, role, project name, certification, award, or school).
  2. One sentence with a soft, specific reason to connect ("would love to learn how your team approaches X"). No asks for referrals. No "quick chat?" phrasing.

TONE — Direct, human, low-pressure. Never fawning. No clichés ("hope this finds you well", "great opportunity", "reaching out").

GROUNDING REQUIREMENT (enforced — failure triggers a retry): the note must reference EITHER the target company by name OR at least one candidate proper noun (company / role / project / certification / award / school). Within the 280-char budget you usually need both.

HONESTY — Do not invent employers, tools, or metrics. Use only what the provided candidate evidence supports.`,
      },
    });

    const text = result.text;
    if (!text) throw new Error('No response from AI');

    let cleaned = text.trim();
    // Strip accidental wrapping quotes or markdown.
    cleaned = cleaned
      .replace(/^["'`]+/, '')
      .replace(/["'`]+$/, '')
      .replace(/^\*+/, '')
      .replace(/\*+$/, '')
      .trim();

    if (cleaned.length > MAX_LENGTH) {
      // Safety trim — cut at the last sentence/word boundary before the cap.
      const slice = cleaned.slice(0, MAX_LENGTH);
      const lastPeriod = slice.lastIndexOf('.');
      const lastSpace = slice.lastIndexOf(' ');
      const cut = lastPeriod > MAX_LENGTH * 0.6 ? lastPeriod + 1 : lastSpace;
      cleaned = (cut > 0 ? slice.slice(0, cut) : slice).trim();
    }

    assertNoFabricatedTools(cleaned, data, { allowJD: fit.mode === 'stretch' });
    // LinkedIn always uses 'either' specificity regardless of mode (280 chars
    // rarely fits both anchors).
    assertOutreachSpecificity(cleaned, data, 'either');

    return cleaned;
  }

  private buildPrompt(data: ResumeData, mode: 'match' | 'stretch' = 'match'): string {
    // Voice reference is omitted — there isn't enough room in 280 chars to
    // benefit, and tone of a connection note is constrained anyway.
    const candidateContext = buildCandidateContext(data, { includeVoiceSignature: false });
    const stretchHint = mode === 'stretch'
      ? '\nSTRETCH MODE — the candidate is pivoting careers. The note may openly acknowledge the pivot ("Coming from <past field>, drawn to <target> because…") and frame interest as wanting to learn. Reference JD-named tools only as growth targets, never as past experience.\n'
      : '';

    return `
Write a LinkedIn connection note from this candidate to a hiring manager or recruiter at the target company.
${stretchHint}

═══════════════════════════════════════════════
CANDIDATE EVIDENCE
═══════════════════════════════════════════════
${candidateContext}

═══════════════════════════════════════════════
TARGET ROLE (filter — pick ONE keyword to mirror)
═══════════════════════════════════════════════
Role: ${data.targetJob.title || 'N/A'}
Company: ${data.targetJob.company || 'the target company'}

Job description excerpt:
${data.targetJob.description.slice(0, 800)}

═══════════════════════════════════════════════
HARD RULES
═══════════════════════════════════════════════
- ${MAX_LENGTH} character cap. Count spaces.
- No greeting. No signoff. No emojis. No quotes. No hashtags.
- Mirror at most ONE JD keyword.
- Reference at least one specific candidate proper noun OR the target company name (preferably both).
- Never invent employers, metrics, or tools.
`;
  }
}
