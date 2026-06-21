// Infrastructure — OpenRouter low-level client (OpenRouter migration Phase 1).
//
// A single, dependency-free `fetch` adapter for all OpenRouter calls. It is
// deliberately provider-agnostic and business-logic-free: the resume optimizer
// and toolkit generators wrap THIS to talk to DeepSeek / Gemini / Llama through
// one API key. Every OpenRouter* generator imports it, and those are the live
// default whenever OPENROUTER_API_KEY is set (see aiFactory).
//
// Design notes (see docs/OPENROUTER_MIGRATION.md):
//   • OpenAI-compatible chat/completions shape.
//   • `models[]` fallback chain — OpenRouter tries them in order on one round
//     trip, so failover is native (no hand-rolled cooldown table).
//   • Surfaces the `usage` block + resolved `model` so callers can fill the
//     UsageSink that feeds cost telemetry (migration 013 / aiCost.ts).
//   • PII routing: pass `provider.data_collection: 'deny'` and/or `zdr: true`
//     plus a host allow-list (`provider.only`) on every call. Chinese *model* ≠
//     Chinese *infra* — routing controls where inference runs.
//   • `reasoning: { enabled: false }` for structured tasks — reasoning tokens
//     bill as output and would blow up cost on JSON generation/extraction.
//   • Timeout defaults to 55s, BELOW Vercel's 60s function cap, so our own
//     AbortController fires before the platform kills the function.
//
// Server-only: reads no env here (the key is injected by the caller via
// aiFactory). NEVER expose OPENROUTER_API_KEY to the client bundle.

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

// OpenRouter records these for attribution on its dashboard / rankings.
const HTTP_REFERER = 'https://topcandidate.app';
const X_TITLE = 'TOP CANDIDATE';

export interface OpenRouterUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export interface OpenRouterContentPart {
  type: 'text' | 'image_url' | 'file';
  text?: string;
  image_url?: { url: string };
  // base64 data URL, e.g. `data:application/pdf;base64,<...>` — used by the
  // multimodal resume extractor (Phase 5).
  file?: { filename: string; file_data: string };
  // Explicit-cache boundary marker; a no-op on providers that cache implicitly.
  cache_control?: { type: 'ephemeral' };
}

export interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | OpenRouterContentPart[];
}

// Subset of OpenRouter's provider-routing controls we actually use.
export interface OpenRouterProviderRouting {
  allow_fallbacks?: boolean;
  data_collection?: 'allow' | 'deny';
  // Allow-list of upstream providers (e.g. ['deepinfra','fireworks']).
  only?: string[];
  // Route only to Zero-Data-Retention endpoints.
  zdr?: boolean;
}

export interface OpenRouterRequest {
  model: string;            // primary model slug
  models?: string[];        // ordered fallback chain (incl. the primary)
  messages: OpenRouterMessage[];
  // `json_object` = valid JSON, no schema (cheap, but large outputs can truncate
  // or malform). `json_schema` = structured outputs — the provider enforces the
  // shape, eliminating truncation/malformation; use it for large/critical JSON.
  response_format?:
    | { type: 'json_object' }
    | { type: 'json_schema'; json_schema: { name: string; strict?: boolean; schema: Record<string, unknown> } };
  temperature?: number;
  max_tokens?: number;
  reasoning?: { enabled: boolean };
  provider?: OpenRouterProviderRouting;
  // File handling for multimodal inputs (resume extractor). `engine: 'native'`
  // lets a natively-multimodal model (Gemini) read the PDF directly instead of
  // OpenRouter's default OCR parser.
  plugins?: Array<{ id: string; pdf?: { engine?: 'native' | 'pdf-text' | 'mistral-ocr' } }>;
}

export interface OpenRouterResult {
  content: string;
  // The model OpenRouter actually served (may be a fallback). Feed to UsageSink.
  model?: string;
  usage?: OpenRouterUsage;
}

export class OpenRouterError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`OpenRouter ${status}: ${body.slice(0, 500)}`);
    this.name = 'OpenRouterError';
  }
}

// Thrown when our own AbortController fires (request exceeded `timeoutMs`).
// withRetry treats this specially: it does NOT retry a timeout, because a
// second full-timeout attempt would blow Vercel's 60s function cap.
export class OpenRouterTimeoutError extends Error {
  constructor(public readonly timeoutMs: number) {
    super(`OpenRouter request timed out after ${timeoutMs}ms`);
    this.name = 'OpenRouterTimeoutError';
  }
}

const MIN_ATTEMPT_MS = 4_000;

/**
 * Deadline-bounded retry. OpenRouter `json_object` mode does NOT enforce a
 * schema the way Gemini's native `responseSchema` does, so occasional malformed
 * JSON (and the optimizer's strict post-validation) makes a retry worthwhile —
 * BUT a naive per-attempt timeout × retries can exceed Vercel's 60s function
 * cap (this caused a prod 504 on /api/optimize). So:
 *
 *   • The TOTAL wall time across all attempts is hard-capped at `deadlineMs`.
 *   • `fn` receives `remainingMs` and MUST pass it as the `chat()` timeout, so a
 *     single slow attempt may use the whole budget (no false early timeout), yet
 *     a fast failure leaves time for one bounded retry.
 *   • A timeout (OpenRouterTimeoutError) is never retried — we're out of budget.
 *
 * Set each caller's `deadlineMs` so that callers running in parallel under one
 * function (optimizer ‖ toolkit on /api/optimize) still fit 60s with headroom.
 */
export async function withRetry<T>(
  fn: (remainingMs: number, attempt: number) => Promise<T>,
  deadlineMs: number,
  attempts = 2,
  backoffMs = 300,
): Promise<T> {
  const start = Date.now();
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    const remaining = deadlineMs - (Date.now() - start);
    if (remaining < MIN_ATTEMPT_MS) break;
    try {
      return await fn(remaining, i);
    } catch (err) {
      lastErr = err;
      if (err instanceof OpenRouterTimeoutError) throw err; // out of budget
      if (i < attempts - 1) {
        const left = deadlineMs - (Date.now() - start);
        if (left < MIN_ATTEMPT_MS) break;
        await new Promise((r) => setTimeout(r, Math.min(backoffMs, left - MIN_ATTEMPT_MS)));
      }
    }
  }
  throw lastErr;
}

export class OpenRouterClient {
  constructor(private readonly apiKey: string) {
    if (!apiKey) {
      throw new Error('OpenRouter API key is required');
    }
  }

  /**
   * Single chat/completions call. Returns the assistant message text plus the
   * resolved model and token usage. Throws OpenRouterError on a non-2xx
   * response (so callers can map 402/credit-exhausted), or a plain Error on
   * timeout / malformed response.
   *
   * @param timeoutMs aborts the request after this many ms. Default 55_000 —
   *   keep it < Vercel's 60s function cap.
   */
  async chat(req: OpenRouterRequest, timeoutMs = 55_000): Promise<OpenRouterResult> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': HTTP_REFERER,
          'X-Title': X_TITLE,
        },
        body: JSON.stringify(req),
        signal: ctrl.signal,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new OpenRouterError(res.status, body);
      }

      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: unknown } }>;
        model?: string;
        usage?: OpenRouterUsage;
        // OpenRouter surfaces upstream provider errors in the 200 body too.
        error?: { message?: string };
      };

      if (data.error?.message) {
        throw new Error(`OpenRouter upstream error: ${data.error.message}`);
      }

      const content = data.choices?.[0]?.message?.content;
      if (typeof content !== 'string') {
        throw new Error('OpenRouter returned no text content');
      }

      return { content, model: data.model, usage: data.usage };
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new OpenRouterTimeoutError(timeoutMs);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}
