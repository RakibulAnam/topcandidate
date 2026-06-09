// Infrastructure - Gemini AI LinkedIn Connection Note Generator

import { GoogleGenAI } from '@google/genai';
import { ResumeData } from '../../domain/entities/Resume.js';
import { ILinkedInMessageGenerator } from '../../domain/usecases/GenerateLinkedInMessageUseCase.js';
import {
  assertNoFabricatedTools,
  assertOutreachSpecificity,
  classifyFitMode,
} from './prompts/toolkitContext.js';
import {
  LINKEDIN_SYSTEM_INSTRUCTION,
  buildLinkedInUserPrompt,
} from './prompts/toolkitPrompts.js';

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
      contents: buildLinkedInUserPrompt(data, fit.mode),
      config: {
        temperature: fit.mode === 'stretch' ? 0.55 : 0.45,
        systemInstruction: LINKEDIN_SYSTEM_INSTRUCTION,
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

}
