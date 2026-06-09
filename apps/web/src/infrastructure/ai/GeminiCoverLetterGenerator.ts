// Infrastructure - Gemini AI Cover Letter Generator

import { GoogleGenAI } from '@google/genai';
import { ResumeData } from '../../domain/entities/Resume.js';
import { ICoverLetterGenerator } from '../../domain/usecases/GenerateCoverLetterUseCase.js';
import {
  assertNoFabricatedTools,
  classifyFitMode,
} from './prompts/toolkitContext.js';
import {
  COVER_LETTER_SYSTEM_INSTRUCTION,
  buildCoverLetterUserPrompt,
} from './prompts/toolkitPrompts.js';

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
    const prompt = buildCoverLetterUserPrompt(data, fit.mode);

    try {
      const result = await this.genAI.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
          temperature: fit.mode === 'stretch' ? 0.55 : 0.4,
          systemInstruction: COVER_LETTER_SYSTEM_INSTRUCTION,
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

}
