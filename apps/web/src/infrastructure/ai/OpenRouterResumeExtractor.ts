// Infrastructure — OpenRouter Resume Extractor (migration Phase 5, multimodal).
//
// Replaces GeminiResumeExtractor's @google/genai file upload with OpenRouter's
// universal `file` content part (base64 data URL). Gemini 2.5 Flash-Lite primary
// (native PDF, cheapest) → Gemini 2.5 Flash fallback. Shares EXTRACTOR_PROMPT
// and applies the SAME post-parse sanitization (regenerate ids, normalize dates
// to YYYY-MM) as the Gemini extractor. Uses strict `json_schema`
// (EXTRACTOR_SCHEMA) so the provider enforces the full shape — the prompt's
// EXTRACTOR_JSON_SHAPE is kept as redundant guidance.
//
// This is the LIVE extractor whenever OPENROUTER_API_KEY is set (aiFactory). The
// GeminiResumeExtractor is the unset-key fallback path.

import { ExtractedProfileData, IResumeExtractor } from '../../domain/usecases/ExtractResumeUseCase.js';
import type { UsageSink } from './usage.js';
import { OpenRouterClient, withRetry } from './OpenRouterClient.js';
import { EXTRACTOR_PROMPT, EXTRACTOR_JSON_SHAPE, EXTRACTOR_SCHEMA } from './prompts/extractorPrompts.js';

const EXTRACTOR_MODELS = ['google/gemini-2.5-flash-lite', 'google/gemini-2.5-flash'];

export class OpenRouterResumeExtractor implements IResumeExtractor {
  private readonly client: OpenRouterClient;

  constructor(apiKey: string) {
    this.client = new OpenRouterClient(apiKey);
  }

  async extract(fileData: string, mimeType: string, usage?: UsageSink): Promise<ExtractedProfileData> {
    // Two input modes:
    //  • 'text/plain' → `fileData` is already-extracted resume text (the client
    //    pulled it out with pdf.js). Send it as a plain text message — tiny
    //    body, no body-size limit, no parser plugin needed.
    //  • anything else → `fileData` is base64 of the raw file; send it as a
    //    `file` part and let natively-multimodal Gemini read it (scanned-PDF
    //    fallback path).
    const isText = mimeType === 'text/plain';
    const parsed = await withRetry(async (remainingMs) => {
      const result = await this.client.chat(
        {
          model: EXTRACTOR_MODELS[0],
          models: EXTRACTOR_MODELS,
          messages: [
            { role: 'system', content: `${EXTRACTOR_PROMPT}\n${EXTRACTOR_JSON_SHAPE}` },
            isText
              ? {
                  role: 'user',
                  content: `Extract this resume into the schema. The resume text follows:\n\n${fileData}`,
                }
              : {
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
          // Strict structured outputs — the provider enforces the full schema,
          // so the large multi-section resume JSON can't truncate mid-output
          // (the old `json_object` mode silently dropped trailing sections like
          // education / certifications / awards). See extractorPrompts.ts.
          response_format: { type: 'json_schema', json_schema: { name: 'resume_extraction', strict: true, schema: EXTRACTOR_SCHEMA } },
          temperature: 0,
          // Raised 4000 → 8000: a full multi-page resume's JSON (verbatim
          // rawDescription text + every section) exceeds 4000 tokens and used to
          // get cut off. Fits the 45s deadline below.
          max_tokens: 8000,
          reasoning: { enabled: false },
          provider: { data_collection: 'deny', allow_fallbacks: true },
          // Only needed for the file path: let natively-multimodal Gemini read
          // the PDF directly (no extra OCR pass / cost) rather than OpenRouter's
          // default parser. The text path sends no file, so no plugin.
          ...(isText ? {} : { plugins: [{ id: 'file-parser' as const, pdf: { engine: 'native' as const } }] }),
        },
        remainingMs,
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
    }, 45_000);

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
