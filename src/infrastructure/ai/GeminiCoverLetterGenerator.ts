// Infrastructure - Gemini AI Cover Letter Generator

import { GoogleGenAI } from '@google/genai';
import { ResumeData } from '../../domain/entities/Resume.js';
import { ICoverLetterGenerator } from '../../domain/usecases/GenerateCoverLetterUseCase.js';
import {
  buildCandidateContext,
  assertNoFabricatedTools,
  classifyFitMode,
} from './prompts/toolkitContext.js';

export class GeminiCoverLetterGenerator implements ICoverLetterGenerator {
  private genAI: GoogleGenAI;

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error('Gemini API key is required');
    }
    this.genAI = new GoogleGenAI({ apiKey });
  }

  async generate(data: ResumeData): Promise<string> {
    const fit = classifyFitMode(data);
    console.info(`[cover-letter-gen] fit=${fit.mode} overlap=${fit.overlap.toFixed(2)} matched=${fit.matched}/${fit.jdVocabSize}`);
    const prompt = this.buildPrompt(data, fit.mode);

    try {
      const result = await this.genAI.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
          temperature: fit.mode === 'stretch' ? 0.55 : 0.4,
          systemInstruction: `You are a senior cover-letter writer specializing in applications that pass BOTH ATS keyword screening AND human hiring-manager review.

GROUND YOUR WRITING IN THE CANDIDATE'S EVIDENCE — the prompt provides the candidate's full profile (experience, projects, education, certifications, awards, publications, extracurriculars, languages, skills) FIRST, and the JD SECOND. Your job is to choose the most JD-relevant slices of the candidate's actual evidence and arrange them. The JD orders and filters; the candidate's own work is the source of truth.

SCOPE — You write ONLY the body paragraphs. The application renders the date, sender block, recipient block, "Dear Hiring Manager,", "Sincerely,", and signature separately. Do NOT include any of those.

FORMAT — Return 3–4 plain-text body paragraphs separated by a single blank line. No markdown, no bold, no bullets, no headings, no code fences.

LENGTH — 250–400 words total across all paragraphs. Tight, specific, confident. No filler.

TONE — Professional, direct, authentic. Where the candidate's own raw words (VOICE REFERENCE) carry a natural framing or phrasing, let it color your tone — but never lift facts that aren't also in the polished bullets. No clichés ("I am writing to express my interest", "team player", "think outside the box", "proven track record" as a standalone phrase). No hedging ("I believe I could maybe…"). No grandiosity.

ATS & KEYWORD DISCIPLINE — Mirror the job description's exact hard-skill and tool keywords verbatim (matching casing) — but ONLY when the candidate's evidence supports them. Never keyword-stuff; never invent experience.

HONESTY — Do not fabricate metrics, employers, outcomes, tools, or credentials. If the JD demands something the candidate doesn't have, redirect to an adjacent strength they do have, or omit the topic.`,
        },
      });

      const responseText = result.text;
      if (!responseText) {
        throw new Error('No response from AI');
      }

      const cleaned = this.cleanResponse(responseText.trim(), data);
      // Stretch mode lets the AI reference JD-named tools as growth targets,
      // so the fabrication guard must allow JD-text into the evidence corpus.
      // Match mode keeps the strict corpus.
      assertNoFabricatedTools(cleaned, data, { allowJD: fit.mode === 'stretch' });
      return cleaned;
    } catch (error) {
      console.error('Cover letter generation failed:', error);
      throw new Error(
        `Failed to generate cover letter: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Strip any structural elements the AI may have included despite instructions.
   * Removes: date lines, address blocks, greetings, closings, signature blocks, markdown.
   */
  private cleanResponse(text: string, data: ResumeData): string {
    // Remove markdown formatting
    let cleaned = text
      .replace(/\*\*/g, '')
      .replace(/\*/g, '')
      .replace(/^#{1,6}\s.*/gm, '')
      .replace(/```[\s\S]*?```/g, '');

    // Split into lines for filtering
    const lines = cleaned.split('\n');
    const filteredLines: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      const lower = trimmed.toLowerCase();

      // Skip empty lines (we'll re-add paragraph breaks later)
      if (!trimmed) {
        if (filteredLines.length > 0) filteredLines.push('');
        continue;
      }

      // Skip date-like lines (e.g. "April 2, 2026", "2026-04-02")
      if (/^\w+\s+\d{1,2},?\s+\d{4}$/.test(trimmed) || /^\d{4}-\d{2}-\d{2}$/.test(trimmed)) continue;

      // Skip address-like lines (short lines before the body, city/state patterns)
      if (/^[\w\s]+,\s*[A-Z]{2}\s+\d{5}/.test(trimmed)) continue;

      // Skip greeting / salutation lines
      if (/^dear\s/i.test(trimmed)) continue;
      if (/^to whom it may concern/i.test(trimmed)) continue;

      // Skip closing lines
      if (/^(sincerely|best regards|regards|respectfully|warm regards|yours truly|yours faithfully),?$/i.test(trimmed)) continue;

      // Skip lines that are just a person's name at the end (after closing)
      if (lower === data.personalInfo.fullName.toLowerCase()) continue;

      // Skip contact info lines (email, phone, LinkedIn URLs)
      if (/^[\w.+-]+@[\w.-]+\.\w+$/.test(trimmed)) continue;
      if (/^\+?[\d\s()-]{7,}$/.test(trimmed)) continue;
      if (/^https?:\/\/(www\.)?(linkedin|github)\.com/i.test(trimmed)) continue;

      // Skip "Hiring Manager" standalone line
      if (lower === 'hiring manager') continue;

      // Skip company name standalone line (if it matches exactly)
      if (data.targetJob.company && trimmed === data.targetJob.company) continue;

      // Skip "Re:" or "Subject:" lines
      if (/^(re:|subject:)/i.test(trimmed)) continue;

      filteredLines.push(line);
    }

    // Join and collapse excessive blank lines into double newlines (paragraph breaks)
    return filteredLines
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  private buildPrompt(data: ResumeData, mode: 'match' | 'stretch' = 'match'): string {
    const isStudent = data.userType === 'student';
    const candidateContext = buildCandidateContext(data);
    const stretchPreamble = mode === 'stretch' ? `
═══════════════════════════════════════════════
STRETCH MODE — CAREER SWITCH
═══════════════════════════════════════════════
This is a career-switch application: the candidate's evidence does NOT closely match the JD's field. Make the strongest HONEST case anyway:
- Lean on TRANSFERABLE SKILLS (analysis, structured thinking, stakeholder management, communication, learning velocity, domain rigor) — bridge them concretely to the JD.
- ACKNOWLEDGE the pivot in the opener: "Coming from <past field> into <target field>". Don't disguise it.
- JD-named tools / frameworks the candidate has NOT used may appear as GROWTH TARGETS or ramp areas — never as past experience. "I'd be excited to ramp on X" is honest; "I have X experience" is fabrication.
- Tone: confident-but-curious, eager-not-desperate.
- Never invent past employers, credentials, or metrics — that rule never relaxes.
` : '';

    return `
Write the 3–4 body paragraphs of a cover letter (no date, no addresses, no greeting, no closing, no signature — those are rendered separately).
${stretchPreamble}

═══════════════════════════════════════════════
CANDIDATE EVIDENCE (source of truth — use ONLY what's here)
═══════════════════════════════════════════════
${candidateContext}

═══════════════════════════════════════════════
TARGET ROLE (filter & ordering signal — NOT a content source)
═══════════════════════════════════════════════
Position: ${data.targetJob.title || 'N/A'}
Company: ${data.targetJob.company || 'N/A'}

Job Description:
${data.targetJob.description}

Mentally extract the JD's top 3–5 hard-skill / tool keywords and top 2 responsibility themes. For each, find the candidate-evidence item above that maps best. Then mirror those keywords verbatim in the candidate's own context — never use them where the candidate has no evidence.

═══════════════════════════════════════════════
PARAGRAPH STRUCTURE (3–4 paragraphs, 250–400 words total)
═══════════════════════════════════════════════
Paragraph 1 — HOOK (2–3 sentences):
  Open with a specific, concrete achievement or qualification from the candidate evidence that directly maps to the JD's top requirement. NO "I am writing to apply for…" opening. Name the role${data.targetJob.company ? ` and ${data.targetJob.company}` : ''} in the first or second sentence. Make the reader want to keep reading.

Paragraph 2 — EVIDENCE OF FIT (4–6 sentences):
  ${isStudent
    ? 'Connect 2–3 concrete project or coursework achievements (from the candidate evidence) to the JD\'s technical requirements. Reference specific technologies and methodologies from the JD that the candidate actually used. Show how academic work prepared you for the role\'s day-one responsibilities.'
    : 'Reference 2–3 concrete achievements from the candidate\'s actual work experience or projects (pulling real details and numbers that already appear above — never invent). Map each one explicitly to a JD requirement. Use the JD\'s exact keywords for tools/methodologies the candidate evidenced.'}

${isStudent
  ? `Paragraph 3 — BROADER VALUE (3–4 sentences): Highlight transferable skills from the candidate's certifications, awards, extracurriculars, or publications. Show initiative, learning velocity, and collaboration — anchored in real items from the evidence above.`
  : `Paragraph 3 — BROADER VALUE (3–4 sentences): Highlight leadership, cross-functional collaboration, certifications, awards, or domain expertise — drawing from real items in the candidate evidence — relevant to ${data.targetJob.company || 'the company'} and the role.`}

Paragraph 4 — CLOSE (2–3 sentences):
  Express specific interest in discussing how the candidate's background maps to the team's goals. One sentence thanking the reader. Forward-looking tone — no hedging, no "I look forward to hearing from you" boilerplate-only ending (you may use a fresher phrasing).

═══════════════════════════════════════════════
HARD CONSTRAINTS
═══════════════════════════════════════════════
- Return ONLY the body paragraphs, separated by ONE blank line each.
- No salutation. No closing. No signature. No date. No contact info.
- No markdown, no bullets, no headings, no code fences.
- 250–400 words total.
- ${mode === 'stretch'
  ? 'You may reference JD-named tools / frameworks the candidate has not used, but ONLY as growth targets / learning intent — never phrased as past experience. Never invent past employers, credentials, or metrics.'
  : 'Do NOT mention any tool / framework / cloud / company that does not appear in the CANDIDATE EVIDENCE block above (target company exempt — you may name it as the recipient).'}
- Mirror JD hard-skill keywords verbatim ONLY when truthful for this candidate.
- Avoid clichés: "I am writing to express my interest", "proven track record" (as standalone), "team player", "think outside the box", "hit the ground running".
`;
  }
}
