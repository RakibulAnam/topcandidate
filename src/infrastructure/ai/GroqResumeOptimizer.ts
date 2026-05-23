// Infrastructure — Groq implementation of IResumeOptimizer.
//
// Uses Groq's OpenAI-compatible Chat Completions endpoint (/openai/v1/chat/completions)
// via plain `fetch` so we don't bundle an extra SDK. JSON mode is requested via
// `response_format: { type: "json_object" }` — Groq guarantees valid JSON but
// not a particular shape, so the JSON shape spec lives in the prompt text and
// we validate the parsed payload ourselves (same validators as the Gemini path).
//
// Free-tier sweet spot (May 2026): 1,000 RPD on llama-3.3-70b-versatile, 30 RPM,
// ~5–8s latency per call. Massive upgrade over Gemini 2.5 Flash's 20 RPD ceiling.

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

interface GroqChatResponse {
  choices?: Array<{
    message?: { content?: string };
    finish_reason?: string;
  }>;
  error?: { message?: string; code?: string };
}

export class GroqResumeOptimizer implements IResumeOptimizer {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly endpoint = 'https://api.groq.com/openai/v1/chat/completions';
  private readonly maxRetries = 3;
  // Groq is fast (~300 TPS); 30s is generous. Kept higher than typical to
  // tolerate first-call cold paths.
  private readonly timeoutMs = 30000;
  private readonly temperature = 0.3;

  constructor(apiKey: string, modelOverride?: string) {
    if (!apiKey) {
      throw new Error('Groq API key is required');
    }
    this.apiKey = apiKey;
    // llama-3.3-70b-versatile is the recommended free-tier model for
    // instruction-heavy tasks. 128K context, JSON mode supported.
    this.model = modelOverride ?? 'llama-3.3-70b-versatile';
  }

  async optimize(data: ResumeData): Promise<OptimizedResumeData> {
    const systemInstruction = buildSystemInstruction();
    // Groq's JSON mode does NOT enforce a schema — only that the output is
    // valid JSON. Embed the shape spec in the user prompt.
    const userPrompt = buildUserPrompt(data, { embedSchemaSpec: true });

    let attempt = 0;
    while (attempt < this.maxRetries) {
      try {
        const response = await withTimeout(
          fetch(this.endpoint, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${this.apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: this.model,
              messages: [
                { role: 'system', content: systemInstruction },
                { role: 'user', content: userPrompt },
              ],
              response_format: { type: 'json_object' },
              temperature: this.temperature,
            }),
          }),
          this.timeoutMs
        );

        if (!response.ok) {
          const errorBody = await response.text().catch(() => '');
          throw new Error(`Groq HTTP ${response.status}: ${errorBody.slice(0, 200)}`);
        }

        const result = (await response.json()) as GroqChatResponse;
        if (result.error) {
          throw new Error(`Groq API error: ${result.error.message || 'unknown'}`);
        }
        const text = result.choices?.[0]?.message?.content;
        if (!text) throw new Error('No content in Groq response');

        const parsed = safeJsonParse<OptimizedResumeData>(text);
        normalizeSkills(parsed);
        const fabResult = filterFabricatedSkills(parsed, data);
        if (fabResult.fabricated.length) {
          console.warn(`[groq] stripped ${fabResult.fabricated.length} fabricated skill(s):`, fabResult.fabricated.join(', '));
        }
        reorderLeadBulletByJDFit(parsed, data.targetJob.description);
        reorderProjectsByJDFit(parsed, data.targetJob.description);
        enforceBulletDensity(parsed, data.targetJob.description);
        stripBannedCliches(parsed);
        validateOptimizedResponse(data, parsed);

        return parsed;
      } catch (error) {
        attempt++;
        console.warn(`Groq optimization attempt ${attempt} failed:`, error);
        if (attempt >= this.maxRetries) throw this.buildFinalError(error);
        await delay(Math.pow(2, attempt) * 1000);
      }
    }

    throw new Error('Unexpected Groq optimization failure');
  }

  private buildFinalError(error: unknown): Error {
    if (error instanceof Error) return new Error(`Resume optimization failed: ${error.message}`);
    return new Error('Resume optimization failed due to unknown error');
  }
}
