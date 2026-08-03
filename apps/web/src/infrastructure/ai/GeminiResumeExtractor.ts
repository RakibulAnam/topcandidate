// Infrastructure — Gemini implementation of IResumeExtractor (multimodal).
// Direct-Google port of OpenRouterResumeExtractor.
//
// Shares EXTRACTOR_PROMPT and applies the SAME post-parse sanitization
// (regenerate ids, normalize dates to YYYY-MM) as every previous extractor.
// Uses `responseJsonSchema` (EXTRACTOR_SCHEMA) so the provider enforces the full
// shape — the prompt's EXTRACTOR_JSON_SHAPE is kept as redundant guidance.
//
// PORT NOTES (canonical template: GeminiProfileNormalizer.ts):
//   • Transport is GeminiClient. The model fallback chain is walked CLIENT-side
//     (Google has no server-side models[] equivalent), so `models` is an ordered
//     array and the client advances on transport failure.
//   • `thinkingLevel` defaults to MINIMAL inside the client. Do not pass
//     thinkingBudget:0 — it returns 400 on 3.5-flash-lite and 3.6-flash.
//   • Usage fields are camelCase now (`promptTokens`, not `prompt_tokens`) and
//     include `thoughtTokens` + `attempts`. `vite build` does NOT type-check
//     src/, so a typo here fails silently and cost telemetry degrades to a
//     4-chars/token estimate — worth the care.
//   • The catch block copies `err.attempts` into the sink so a FAILED call still
//     records which models were tried; otherwise failures log an empty chain.
//   • MULTIMODAL: Gemini reads a PDF natively via `inlineData`, so OpenRouter's
//     `plugins: [{ id: 'file-parser', pdf: { engine: 'native' } }]` block has no
//     equivalent and is dropped — there is nothing to configure.
//
// Model choice: 3.5-flash-lite leads (measured fastest, 0 thought tokens, native
// PDF, priced identically to the gemini-2.5-flash this project used to run);
// 3.1-flash-lite is the cheaper fallback. NOTE: unlike the OpenRouter chain there
// is no non-Google last resort, so a Google-wide outage fails this path.

import type { Part } from '@google/genai';
import { ExtractedProfileData, IResumeExtractor } from '../../domain/usecases/ExtractResumeUseCase.js';
import type { UsageSink } from './usage.js';
import { GeminiClient, GeminiError, GEMINI_MODELS, withRetry, rotateModels } from './GeminiClient.js';
import { EXTRACTOR_PROMPT, EXTRACTOR_JSON_SHAPE, EXTRACTOR_SCHEMA } from './prompts/extractorPrompts.js';

const EXTRACTOR_MODELS = [GEMINI_MODELS.FLASH_LITE_35, GEMINI_MODELS.FLASH_LITE_31];

export class GeminiResumeExtractor implements IResumeExtractor {
  private readonly client: GeminiClient;
  private readonly deadlineMs = 45_000;

  constructor(apiKey: string) {
    this.client = new GeminiClient(apiKey);
  }

  async extract(fileData: string, mimeType: string, usage?: UsageSink): Promise<ExtractedProfileData> {
    // Two input modes:
    //  • 'text/plain' → `fileData` is already-extracted resume text (the client
    //    pulled it out with pdf.js). Send it as a plain string prompt — tiny
    //    body, no body-size limit, no parser plugin needed.
    //  • anything else → `fileData` is base64 of the raw file; send it as an
    //    `inlineData` part and let natively-multimodal Gemini read it
    //    (scanned-PDF fallback path).
    const isText = mimeType === 'text/plain';
    const contents: string | Part[] = isText
      ? `Extract this resume into the schema. The resume text follows:\n\n${fileData}`
      : [
          { text: 'Extract this resume into the schema.' },
          { inlineData: { mimeType, data: fileData } },
        ];

    const parsed = await withRetry(async (remainingMs, attempt) => {
      // Lead each retry with the next model: a per-minute 429 is scoped
      // PerProjectPerModel, so rotating escapes the throttle immediately
      // instead of waiting out Google's advised ~53s window.
      const chain = rotateModels(EXTRACTOR_MODELS, attempt);
      try {
        const result = await this.client.generate(
          {
            models: chain,
            systemInstruction: `${EXTRACTOR_PROMPT}\n${EXTRACTOR_JSON_SHAPE}`,
            contents,
            // Strict structured outputs — the provider enforces the full schema,
            // so the large multi-section resume JSON can't truncate mid-output
            // (the old `json_object` mode silently dropped trailing sections like
            // education / certifications / awards). See extractorPrompts.ts.
            responseJsonSchema: EXTRACTOR_SCHEMA,
            temperature: 0,
            // Raised 4000 → 8000: a full multi-page resume's JSON (verbatim
            // rawDescription text + every section) exceeds 4000 tokens and used to
            // get cut off. Fits the 45s deadline below.
            maxOutputTokens: 8000,
          },
          remainingMs,
        );

        if (usage) {
          usage.provider = 'gemini';
          usage.model = result.model;
          usage.promptTokens = result.usage?.promptTokens;
          usage.completionTokens = result.usage?.completionTokens;
          usage.thoughtTokens = result.usage?.thoughtTokens;
          usage.attempts = result.attempts;
        }

        const text = result.text;
        if (!text) throw new Error('No response from AI');
        try {
          return JSON.parse(text) as ExtractedProfileData;
        } catch {
          const cleaned = text.replace(/```json/g, '').replace(/```/g, '').trim();
          return JSON.parse(cleaned) as ExtractedProfileData;
        }
      } catch (err) {
        // Preserve the attempt chain on failure too, so ai_call_log can show
        // which models were tried on a call that ultimately failed.
        if (usage && err instanceof GeminiError && err.attempts.length) {
          usage.provider = 'gemini';
          usage.attempts = err.attempts;
        }
        throw err;
      }
    }, this.deadlineMs);

    // Identical post-parse sanitization to the previous extractors: regenerate
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
      parsed.education = parsed.education.map((e) => {
        const startDate = sanitizeDate(e.startDate);
        const endDate = sanitizeDate(e.endDate);
        // Education is usually a single (graduation) date, not a range. If the
        // model produced only a start date, treat it as the end date — endDate
        // is the mandatory, meaningful one; startDate is optional.
        const single = !endDate && !!startDate;
        return {
          ...e,
          id: crypto.randomUUID(),
          startDate: single ? '' : startDate,
          endDate: single ? startDate : endDate,
        };
      });
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
