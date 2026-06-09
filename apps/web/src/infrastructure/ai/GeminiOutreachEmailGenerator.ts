// Infrastructure - Gemini AI Outreach Email Generator

import { GoogleGenAI, Type } from '@google/genai';
import { ResumeData, OutreachEmail } from '../../domain/entities/Resume.js';
import { IOutreachEmailGenerator } from '../../domain/usecases/GenerateOutreachEmailUseCase.js';
import {
  assertNoFabricatedTools,
  assertOutreachSpecificity,
  classifyFitMode,
} from './prompts/toolkitContext.js';
import {
  OUTREACH_SYSTEM_INSTRUCTION,
  buildOutreachUserPrompt,
} from './prompts/toolkitPrompts.js';

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
      contents: buildOutreachUserPrompt(data, fit.mode),
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
        systemInstruction: OUTREACH_SYSTEM_INSTRUCTION,
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

}
