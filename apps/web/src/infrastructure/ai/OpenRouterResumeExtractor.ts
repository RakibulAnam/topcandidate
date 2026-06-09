// Infrastructure — OpenRouter Resume Extractor (migration Phase 5, multimodal).
//
// Replaces GeminiResumeExtractor's @google/genai file upload with OpenRouter's
// universal `file` content part (base64 data URL). Gemini 2.5 Flash-Lite primary
// (native PDF, cheapest) → Gemini 2.5 Flash fallback. Shares EXTRACTOR_PROMPT
// and applies the SAME post-parse sanitization (regenerate ids, normalize dates
// to YYYY-MM) as the Gemini extractor. OpenRouter json_object doesn't enforce a
// schema, so the field shape is embedded in the prompt (EXTRACTOR_JSON_SHAPE).
//
// Not wired into aiFactory yet (cutover = Phase 6). KEEP the Gemini extractor as
// the live path until this is proven on real PDFs + DOCX.

import { ExtractedProfileData, IResumeExtractor } from '../../domain/usecases/ExtractResumeUseCase.js';
import type { UsageSink } from './usage.js';
import { OpenRouterClient, withRetry } from './OpenRouterClient.js';
import { EXTRACTOR_PROMPT, EXTRACTOR_JSON_SHAPE } from './prompts/extractorPrompts.js';

const EXTRACTOR_MODELS = ['google/gemini-2.5-flash-lite', 'google/gemini-2.5-flash'];

export class OpenRouterResumeExtractor implements IResumeExtractor {
  private readonly client: OpenRouterClient;

  constructor(apiKey: string) {
    this.client = new OpenRouterClient(apiKey);
  }

  async extract(fileData: string, mimeType: string, usage?: UsageSink): Promise<ExtractedProfileData> {
    const parsed = await withRetry(async () => {
      const result = await this.client.chat(
        {
          model: EXTRACTOR_MODELS[0],
          models: EXTRACTOR_MODELS,
          messages: [
            { role: 'system', content: `${EXTRACTOR_PROMPT}\n${EXTRACTOR_JSON_SHAPE}` },
            {
              role: 'user',
              content: [
                { type: 'text', text: 'Extract this resume into the schema.' },
                {
                  type: 'file',
                  file: {
                    filename: mimeType === 'application/pdf' ? 'resume.pdf' : 'resume',
                    file_data: `data:${mimeType};base64,${fileData}`,
                  },
                },
              ],
            },
          ],
          response_format: { type: 'json_object' },
          temperature: 0,
          max_tokens: 4000,
          reasoning: { enabled: false },
          provider: { data_collection: 'deny', allow_fallbacks: true },
          // Let natively-multimodal Gemini read the PDF directly (no extra OCR
          // pass / cost) rather than OpenRouter's default parser.
          plugins: [{ id: 'file-parser', pdf: { engine: 'native' } }],
        },
        50_000,
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
        return JSON.parse(text) as ExtractedProfileData;
      } catch {
        const cleaned = text.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(cleaned) as ExtractedProfileData;
      }
    });

    // Identical post-parse sanitization to GeminiResumeExtractor: regenerate
    // ids (the model's are throwaway) and force dates to YYYY-MM or ''.
    const sanitizeDate = (d?: string) => {
      if (!d || d === 'Present') return d || '';
      return /^\d{4}-\d{2}$/.test(d) ? d : '';
    };

    if (parsed.experience) {
      parsed.experience = parsed.experience.map((e) => ({ ...e, id: crypto.randomUUID(), startDate: sanitizeDate(e.startDate), endDate: sanitizeDate(e.endDate) }));
    }
    if (parsed.projects) {
      parsed.projects = parsed.projects.map((e) => ({ ...e, id: crypto.randomUUID() }));
    }
    if (parsed.education) {
      parsed.education = parsed.education.map((e) => ({ ...e, id: crypto.randomUUID(), startDate: sanitizeDate(e.startDate), endDate: sanitizeDate(e.endDate) }));
    }
    if (parsed.extracurriculars) {
      parsed.extracurriculars = parsed.extracurriculars.map((e) => ({ ...e, id: crypto.randomUUID(), startDate: sanitizeDate(e.startDate), endDate: sanitizeDate(e.endDate) }));
    }
    if (parsed.awards) {
      parsed.awards = parsed.awards.map((e) => ({ ...e, id: crypto.randomUUID(), date: sanitizeDate(e.date) }));
    }
    if (parsed.certifications) {
      parsed.certifications = parsed.certifications.map((e) => ({ ...e, id: crypto.randomUUID(), date: sanitizeDate(e.date) }));
    }
    if (parsed.affiliations) {
      parsed.affiliations = parsed.affiliations.map((e) => ({ ...e, id: crypto.randomUUID(), startDate: sanitizeDate(e.startDate), endDate: sanitizeDate(e.endDate) }));
    }
    if (parsed.publications) {
      parsed.publications = parsed.publications.map((e) => ({ ...e, id: crypto.randomUUID(), date: sanitizeDate(e.date) }));
    }

    return parsed;
  }
}
