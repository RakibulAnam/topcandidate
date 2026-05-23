// Infrastructure — Gemini implementation of IResumeOptimizer.
//
// Thin wrapper around the Gemini SDK. All prompt text + validation lives in
// `prompts/resumeOptimizerPrompts.ts` so the Groq adapter stays in lockstep.
// Gemini's edge here is `responseSchema` — the SDK enforces shape server-side,
// which is stricter than OpenAI-compatible JSON mode.

import { GoogleGenAI, Type, Schema } from '@google/genai';
import { ResumeData, OptimizedResumeData } from '../../domain/entities/Resume.js';
import { IResumeOptimizer } from '../../domain/usecases/OptimizeResumeUseCase.js';
import {
  buildSystemInstruction,
  buildUserPrompt,
  validateOptimizedResponse,
  normalizeSkills,
  filterFabricatedSkills,
  reorderLeadBulletByJDFit,
  reorderProjectsByJDFit,
  enforceBulletDensity,
  stripBannedCliches,
  safeJsonParse,
  withTimeout,
  delay,
} from './prompts/resumeOptimizerPrompts.js';

export class GeminiResumeOptimizer implements IResumeOptimizer {
  private readonly genAI: GoogleGenAI;
  private readonly model: string;
  private readonly maxRetries = 3;
  // Bumped from 20s — Gemini-2.5-flash routinely takes 25–40s for the
  // optimizer's structured-JSON output once the prompt exceeds ~3k tokens.
  // 20s caused frequent first-attempt timeouts that were silently masked by
  // the retry loop.
  private readonly timeoutMs = 45000;
  private readonly temperature = 0.3;

  constructor(apiKey: string, modelOverride?: string) {
    if (!apiKey) {
      throw new Error('Gemini API key is required');
    }
    this.genAI = new GoogleGenAI({ apiKey });
    this.model = modelOverride ?? 'gemini-2.5-flash';
  }

  async optimize(data: ResumeData): Promise<OptimizedResumeData> {
    const schema = this.buildSchema(data);
    // Gemini doesn't need the schema spec embedded — it gets it via the
    // SDK's responseSchema field instead.
    const prompt = buildUserPrompt(data, { embedSchemaSpec: false });
    const systemInstruction = buildSystemInstruction();

    let attempt = 0;
    while (attempt < this.maxRetries) {
      try {
        const result = await withTimeout(
          this.genAI.models.generateContent({
            model: this.model,
            contents: prompt,
            config: {
              responseMimeType: 'application/json',
              responseSchema: schema,
              temperature: this.temperature,
              systemInstruction,
            },
          }),
          this.timeoutMs
        );

        const responseText = this.extractText(result);
        const parsed = safeJsonParse<OptimizedResumeData>(responseText);

        normalizeSkills(parsed);
        const fabResult = filterFabricatedSkills(parsed, data);
        if (fabResult.fabricated.length) {
          console.warn(`[gemini] stripped ${fabResult.fabricated.length} fabricated skill(s):`, fabResult.fabricated.join(', '));
        }
        reorderLeadBulletByJDFit(parsed, data.targetJob.description);
        reorderProjectsByJDFit(parsed, data.targetJob.description);
        enforceBulletDensity(parsed, data.targetJob.description);
        stripBannedCliches(parsed);
        validateOptimizedResponse(data, parsed);

        return parsed;
      } catch (error) {
        attempt++;
        console.warn(`Gemini optimization attempt ${attempt} failed:`, error);

        if (attempt >= this.maxRetries) {
          throw this.buildFinalError(error);
        }

        await delay(Math.pow(2, attempt) * 1000);
      }
    }

    throw new Error('Unexpected optimization failure');
  }

  // Gemini-specific: the SDK accepts a Schema object that the model is
  // *forced* to conform to. Strongest JSON-shape guarantee available.
  private buildSchema(data: ResumeData): Schema {
    const required: string[] = ['summary', 'skills'];
    if (data.experience.length > 0) required.push('experience');
    if (data.projects.length > 0) required.push('projects');
    if (data.extracurriculars && data.extracurriculars.length > 0) required.push('extracurriculars');

    return {
      type: Type.OBJECT,
      properties: {
        summary: { type: Type.STRING },
        skills: { type: Type.ARRAY, items: { type: Type.STRING } },
        skillCategories: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              category: { type: Type.STRING },
              items: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
            required: ['category', 'items'],
          },
        },
        experience: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              refinedBullets: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
            required: ['id', 'refinedBullets'],
          },
        },
        projects: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              refinedBullets: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
            required: ['id', 'refinedBullets'],
          },
        },
        extracurriculars: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              refinedBullets: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
            required: ['id', 'refinedBullets'],
          },
        },
      },
      required,
    };
  }

  private extractText(result: any): string {
    const text = result?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('No valid text response from AI');
    return text;
  }

  private buildFinalError(error: unknown): Error {
    if (error instanceof Error) return new Error(`Resume optimization failed: ${error.message}`);
    return new Error('Resume optimization failed due to unknown error');
  }
}
