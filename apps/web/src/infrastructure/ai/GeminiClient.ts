// Infrastructure — direct Google Gemini client (OpenRouter exit, Phase 1).
//
// A single `@google/genai` adapter that replaces OpenRouterClient as the one
// transport for every AI workload. Business-logic-free: the optimizer, toolkit,
// extractor and normalizer all wrap THIS. Prompts, JSON schemas, fabrication
// guards and the deterministic post-pipeline are unchanged by the move.
//
// WHY WE LEFT OPENROUTER: Gemini calls ran on OpenRouter's *pooled* Google
// credentials, so ~30% failed with a shared-pool 429 that arrived as HTTP 200 +
// finish_reason='error' and which OpenRouter's own models[] fallback did not
// route around. Credits are not quota. Our own key = our own quota.
//
// ─── Empirically established 2026-08-04, do not "simplify" these away ───────
//
//  • GEMINI 2.5 IS UNREACHABLE. `gemini-2.5-flash` and `-flash-lite` return
//    HTTP 404 "no longer available to new users" on this account, including
//    versioned aliases. They still APPEAR in models.list — listing a model is
//    not proof you can call it. Everything here targets 3.x only.
//
//  • `thinkingBudget: 0` returns HTTP 400 INVALID_ARGUMENT on
//    gemini-3.5-flash-lite and gemini-3.6-flash (it works only on
//    gemini-3.1-flash-lite). `thinkingLevel: MINIMAL` is the only form that
//    works across all three, so it is the universal default here. Corollary:
//    a 400 can be MODEL-SPECIFIC, which is why classify() marks schema_invalid
//    as advance-to-next-model rather than fatal.
//
//  • Thinking tokens bill at the OUTPUT rate. gemini-3.6-flash defaults to
//    medium and spent 721 thought tokens against 147 visible output tokens on a
//    trivial task (~5x). MINIMAL zeroed it with no loss of quality. The
//    flash-lite models emit 0 thoughts in every config. Never omit
//    thinkingConfig on a 3.6-class model.
//
// ─── Structure ──────────────────────────────────────────────────────────────
//
// Two retry layers, mirroring the OpenRouter arrangement so generators port
// with a minimal diff:
//   1. THIS client walks a sequential model chain on TRANSPORT failure, inside
//      one shared wall-clock budget. It replaces OpenRouter's `models[]` array
//      (Google has no server-side fallback) and its per-request rotation.
//   2. The generators keep their existing deadline-bounded `withRetry` for
//      PARSE/VALIDATION failure, and rotate the chain start per attempt so a
//      retry does not re-hit whatever just failed.
//
// Every attempt is recorded in `attempts[]` so ai_call_log can answer "which
// model failed, and why" — the question the OpenRouter setup could not answer.
//
// Server-only: reads no env (the key is injected by aiFactory).
// NEVER expose GEMINI_API_KEY to the client bundle.

import { GoogleGenAI, ThinkingLevel, type Part } from '@google/genai';

// ── Model IDs ───────────────────────────────────────────────────────────────
// VERIFY with a real generateContent call (not models.list) before each release.
export const GEMINI_MODELS = {
  /** Google's documented replacement for gemini-2.5-flash, at identical price
   *  ($0.30/$2.50). Fastest of the three and emits 0 thought tokens. */
  FLASH_LITE_35: 'gemini-3.5-flash-lite',
  /** Cheaper ($0.25/$1.50), still frontier-class. Utility/high-volume paths. */
  FLASH_LITE_31: 'gemini-3.1-flash-lite',
  /** Premium ($1.50/$7.50). Only with thinkingLevel MINIMAL — see header. */
  FLASH_36: 'gemini-3.6-flash',
} as const;

// ── Error taxonomy ──────────────────────────────────────────────────────────
// Normalized so ai_call_log.error_code is groupable instead of free text.
export type GeminiErrorCode =
  | 'rate_limit'        // 429, per-minute throttle
  | 'quota_exhausted'   // 429, daily/billing quota gone
  | 'timeout'           // our own AbortController fired
  | 'schema_invalid'    // 400 — bad request, possibly model-specific
  | 'json_parse'        // valid HTTP, unparseable body (raised by callers)
  | 'guard_rejected'    // provider was fine; our own content guards refused it
                        // (fabrication / specificity / empty artifact). Never
                        // emitted by this client — set by api/_lib/aiTelemetry.
  | 'safety_blocked'    // finishReason/blockReason refused the content
  | 'truncated'         // finishReason MAX_TOKENS — output cut mid-JSON
  | 'empty_response'    // 200 with no candidate text
  | 'model_unavailable' // 404 — e.g. the gemini-2.5-* gating
  | 'auth'              // 401/403 — bad or unauthorized key
  | 'upstream_error'    // 500/503
  | 'unknown';

/** Can a DIFFERENT model in the chain plausibly succeed where this one failed? */
const ADVANCE_TO_NEXT_MODEL: ReadonlySet<GeminiErrorCode> = new Set([
  'rate_limit',
  'quota_exhausted',
  'upstream_error',
  'model_unavailable',
  // Model-specific 400s are real — thinkingBudget:0 is accepted by
  // 3.1-flash-lite and rejected by 3.5-flash-lite. Try the next model, but the
  // message is logged so a genuine schema bug is still visible.
  'schema_invalid',
  'empty_response',
]);

/**
 * finishReason values that mean the model refused the content rather than
 * failed mechanically. Sourced from the SDK's FinishReason enum
 * (@google/genai FinishReason) — LANGUAGE is included because an unsupported
 * language is a content refusal, not a transport fault, and retrying it on
 * another model produces the same answer.
 */
const REFUSAL_FINISH_REASONS: ReadonlySet<string> = new Set([
  'SAFETY',
  'PROHIBITED_CONTENT',
  'BLOCKLIST',
  'SPII',
  'RECITATION',
  'LANGUAGE',
  'IMAGE_SAFETY',
  'IMAGE_PROHIBITED_CONTENT',
  'IMAGE_RECITATION',
]);

/**
 * Stop walking the model chain — a DIFFERENT model would fail identically.
 * `truncated` belongs here because maxOutputTokens is a per-request cap, so the
 * next model hits exactly the same wall.
 */
const STOP_CHAIN: ReadonlySet<GeminiErrorCode> = new Set([
  'auth',
  'safety_blocked',
  'truncated',
]);

/**
 * Refuse the OUTER withRetry as well — re-asking the SAME request cannot change
 * the outcome. Deliberately narrower than STOP_CHAIN.
 *
 * `truncated` is NOT here, and that distinction matters: under OpenRouter a
 * truncated body arrived as malformed JSON and therefore got a second attempt.
 * Treating truncation as fully fatal silently lowered the success rate of the
 * PAID optimizer path. Generation is non-deterministic, so a fresh attempt can
 * produce a response that fits the same cap — it is only pointless to try it on
 * a different model, which STOP_CHAIN already prevents.
 */
const NO_OUTER_RETRY: ReadonlySet<GeminiErrorCode> = new Set([
  'auth',
  'safety_blocked',
]);

export class GeminiError extends Error {
  constructor(
    public readonly code: GeminiErrorCode,
    public readonly status: number | undefined,
    message: string,
    /** Per-model outcomes, oldest first — feeds ai_call_log.model_attempts. */
    public readonly attempts: GeminiAttempt[] = [],
    /**
     * Google's own advised backoff from `google.rpc.RetryInfo`, in ms (a 429
     * carries e.g. "53s"). Honoured by withRetry only when it fits the
     * remaining budget — usually it does not, and advancing the model chain
     * beats sleeping inside a 60s function.
     */
    public readonly retryDelayMs?: number,
  ) {
    super(message);
    this.name = 'GeminiError';
  }
}

export class GeminiTimeoutError extends GeminiError {
  constructor(public readonly timeoutMs: number, attempts: GeminiAttempt[] = []) {
    super('timeout', undefined, `Gemini request timed out after ${timeoutMs}ms`, attempts);
    this.name = 'GeminiTimeoutError';
  }
}

/**
 * Google packs `ApiError.message` with `JSON.stringify(errorBody)`, so the
 * structured `google.rpc.*` details survive the SDK. Pull out the two fields
 * that matter. Verified against a real 429 captured 2026-08-04.
 */
function parseGoogleErrorDetails(raw: string): { quotaId?: string; retryDelayMs?: number } {
  try {
    const body = JSON.parse(raw) as {
      error?: { details?: Array<Record<string, unknown>> };
    };
    const details = body.error?.details ?? [];
    let quotaId: string | undefined;
    let retryDelayMs: number | undefined;
    for (const d of details) {
      const type = String(d['@type'] ?? '');
      if (type.endsWith('QuotaFailure')) {
        const violations = d.violations as Array<{ quotaId?: string }> | undefined;
        quotaId = violations?.[0]?.quotaId;
      } else if (type.endsWith('RetryInfo')) {
        // Shaped like "53s" (occasionally "1.5s").
        const m = /^([\d.]+)s$/.exec(String(d.retryDelay ?? ''));
        if (m) retryDelayMs = Math.round(Number(m[1]) * 1000);
      }
    }
    return { quotaId, retryDelayMs };
  } catch {
    return {};
  }
}

/**
 * Map a thrown SDK error, or a non-error 200 response, onto a normalized code.
 * Exported so endpoints can classify failures that surface outside the client
 * (a guard rejection, a JSON.parse blow-up) into the same taxonomy.
 */
export function classifyGeminiError(
  err: unknown,
): { code: GeminiErrorCode; status?: number; retryDelayMs?: number } {
  if (err instanceof GeminiError) {
    return { code: err.code, status: err.status, retryDelayMs: err.retryDelayMs };
  }
  if (err instanceof Error && err.name === 'AbortError') return { code: 'timeout' };

  const status: number | undefined =
    typeof (err as { status?: unknown })?.status === 'number'
      ? (err as { status: number }).status
      : undefined;
  const raw = err instanceof Error ? err.message : String(err);
  const msg = raw.toLowerCase();
  const { quotaId, retryDelayMs } = parseGoogleErrorDetails(raw);

  if (status === 429 || msg.includes('resource_exhausted')) {
    // Google reuses 429 for BOTH a per-minute throttle and an exhausted daily
    // quota, and — critically — the human-readable message is byte-identical
    // for the two: "You exceeded your current quota, please check your plan and
    // billing details." Matching on that prose ('quota' + 'exceeded') therefore
    // labels every RPM throttle as quota_exhausted. That was a real bug here,
    // and it is the same one still live in MultiProviderResumeOptimizer.
    //
    // The only reliable discriminator is the structured quotaId, e.g.
    //   GenerateRequestsPerMinutePerProjectPerModel-FreeTier   (per minute)
    //   GenerateRequestsPerDayPerProjectPerModel-FreeTier      (per day)
    // Note the slug has no spaces, so a 'per day' substring test cannot match
    // it even in principle. Prose is only a last resort when details are absent.
    const id = (quotaId ?? '').toLowerCase();
    let code: GeminiErrorCode;
    if (id) {
      code = /perday|daily/.test(id) ? 'quota_exhausted' : 'rate_limit';
    } else {
      code = /per\s?day|daily|exhaust/.test(msg) ? 'quota_exhausted' : 'rate_limit';
    }
    return { code, status, retryDelayMs };
  }
  // Auth MUST be tested before the generic 400 branch. Google returns
  // 400 INVALID_ARGUMENT — not 401 — for a bad/revoked API key (verified
  // 2026-08-04). Classifying that as schema_invalid was a real bug: it is an
  // advance-to-next-model code, so a rotated key burned the whole chain on
  // every call instead of failing fast on the first.
  if (
    status === 401 || status === 403 ||
    msg.includes('permission_denied') || msg.includes('unauthenticated') ||
    msg.includes('api key not valid') || msg.includes('api key expired') ||
    msg.includes('api_key_invalid')
  ) {
    return { code: 'auth', status };
  }
  if (status === 400 || msg.includes('invalid_argument')) return { code: 'schema_invalid', status };
  if (status === 404 || msg.includes('not_found')) return { code: 'model_unavailable', status };
  if (status === 503 || status === 500 || msg.includes('unavailable') || msg.includes('internal')) {
    return { code: 'upstream_error', status };
  }
  return { code: 'unknown', status };
}

// ── Request / response shapes ───────────────────────────────────────────────

export interface GeminiUsage {
  promptTokens?: number;
  completionTokens?: number;
  /** Billed at the OUTPUT rate. Must reach aiCost or 3.x cost is understated. */
  thoughtTokens?: number;
  totalTokens?: number;
}

export interface GeminiAttempt {
  model: string;
  ok: boolean;
  ms: number;
  code?: GeminiErrorCode;
  status?: number;
  /** Truncated provider message — enough to debug, small enough to store. */
  message?: string;
}

export interface GeminiRequest {
  /** Ordered fallback chain. Walked left to right on transport failure. */
  models: string[];
  systemInstruction?: string;
  /** Plain prompt, or parts for multimodal (the extractor's inline PDF). */
  contents: string | Part[];
  /** Full JSON Schema. Verified to accept nested object arrays + enums +
   *  additionalProperties:false, so existing schema constants port verbatim. */
  responseJsonSchema?: Record<string, unknown>;
  temperature?: number;
  maxOutputTokens?: number;
  /** Defaults to MINIMAL. Never omit on a 3.6-class model — see header. */
  thinkingLevel?: ThinkingLevel;
}

export interface GeminiResult {
  text: string;
  /** Model that actually served the response (`modelVersion`), which may be a
   *  fallback rather than models[0]. Feed to UsageSink. */
  model?: string;
  usage?: GeminiUsage;
  /** Includes the successful attempt, so a rescue is visible in telemetry
   *  rather than looking like a clean first-try success. */
  attempts: GeminiAttempt[];
}

/** Below this there is not enough budget left for a request to plausibly finish. */
const MIN_ATTEMPT_MS = 4_000;

export class GeminiClient {
  private readonly ai: GoogleGenAI;

  constructor(apiKey: string) {
    if (!apiKey) throw new Error('Gemini API key is required');
    // `vertexai` and `enterprise` are pinned false ON PURPOSE. Left unset, the
    // SDK reads GOOGLE_GENAI_USE_VERTEXAI / GOOGLE_GENAI_USE_ENTERPRISE from the
    // environment and silently switches to a backend that expects GCP ADC rather
    // than an API key — every call would then fail on auth for reasons invisible
    // in this file. Neither var is set in Vercel today; this makes it impossible
    // for adding one later to break the AI layer as a side effect.
    this.ai = new GoogleGenAI({ apiKey, vertexai: false, enterprise: false });
  }

  /**
   * Walk `req.models` until one succeeds or the budget runs out.
   *
   * @param timeoutMs TOTAL wall-clock budget shared across every model in the
   *   chain — not per attempt. Keep below Vercel's 60s function cap. A single
   *   slow attempt may consume the whole budget; a fast failure leaves room to
   *   try the next model.
   */
  async generate(req: GeminiRequest, timeoutMs = 50_000): Promise<GeminiResult> {
    const started = Date.now();
    const attempts: GeminiAttempt[] = [];
    let lastErr: GeminiError | undefined;

    for (const model of req.models) {
      const remaining = timeoutMs - (Date.now() - started);
      if (remaining < MIN_ATTEMPT_MS) break;

      const t0 = Date.now();
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), remaining);

      try {
        const res = await this.ai.models.generateContent({
          model,
          contents: req.contents,
          config: {
            ...(req.systemInstruction ? { systemInstruction: req.systemInstruction } : {}),
            ...(req.responseJsonSchema
              ? { responseMimeType: 'application/json', responseJsonSchema: req.responseJsonSchema }
              : {}),
            ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
            ...(req.maxOutputTokens !== undefined ? { maxOutputTokens: req.maxOutputTokens } : {}),
            // Always explicit. Omitting it on gemini-3.6-flash silently opts
            // into medium thinking, which bills ~5x the visible output.
            thinkingConfig: { thinkingLevel: req.thinkingLevel ?? ThinkingLevel.MINIMAL },
            abortSignal: ctrl.signal,
          },
        });

        const usage: GeminiUsage = {
          promptTokens: res.usageMetadata?.promptTokenCount,
          completionTokens: res.usageMetadata?.candidatesTokenCount,
          thoughtTokens: res.usageMetadata?.thoughtsTokenCount,
          totalTokens: res.usageMetadata?.totalTokenCount,
        };

        // A 200 is not automatically a success: the prompt can be refused, the
        // output truncated mid-JSON, or the candidate list empty. Each is a
        // distinct failure the old setup logged as a generic error.
        const failure = this.detectResponseFailure(res);
        if (failure) {
          attempts.push({ model, ok: false, ms: Date.now() - t0, code: failure.code, message: failure.message });
          lastErr = new GeminiError(failure.code, 200, `${model}: ${failure.message}`, attempts);
          if (STOP_CHAIN.has(failure.code)) throw lastErr;
          continue;
        }

        attempts.push({ model, ok: true, ms: Date.now() - t0 });
        return { text: res.text ?? '', model: res.modelVersion ?? model, usage, attempts };
      } catch (err) {
        if (err instanceof GeminiError) throw err; // already classified + fatal

        const { code, status, retryDelayMs } = classifyGeminiError(err);
        const message = (err instanceof Error ? err.message : String(err)).slice(0, 300);
        attempts.push({ model, ok: false, ms: Date.now() - t0, code, status, message });

        if (code === 'timeout') throw new GeminiTimeoutError(timeoutMs, attempts);
        lastErr = new GeminiError(code, status, `${model}: ${message}`, attempts, retryDelayMs);
        if (STOP_CHAIN.has(code)) throw lastErr;
        if (!ADVANCE_TO_NEXT_MODEL.has(code)) throw lastErr;
      } finally {
        clearTimeout(timer);
      }
    }

    if (lastErr) throw lastErr;
    // The chain ended without a single attempt, which only happens when the
    // caller's remaining budget was already below MIN_ATTEMPT_MS. That is a
    // budget exhaustion, so report it as a timeout rather than 'unknown' —
    // otherwise an over-tight deadline looks like a mystery provider fault.
    throw new GeminiTimeoutError(timeoutMs, attempts);
  }

  /** Failure modes that arrive as a successful HTTP 200. */
  private detectResponseFailure(res: {
    text?: string;
    candidates?: Array<{ finishReason?: string }>;
    promptFeedback?: { blockReason?: string };
  }): { code: GeminiErrorCode; message: string } | null {
    const blockReason = res.promptFeedback?.blockReason;
    if (blockReason) {
      return { code: 'safety_blocked', message: `prompt blocked upstream (${blockReason})` };
    }
    const finish = res.candidates?.[0]?.finishReason;
    if (finish === 'MAX_TOKENS') {
      return { code: 'truncated', message: 'output hit maxOutputTokens — JSON is incomplete' };
    }
    // Full refusal set from the SDK's FinishReason enum, not just the obvious
    // four. Anything left over (MALFORMED_FUNCTION_CALL, OTHER, NO_IMAGE,
    // UNEXPECTED_TOOL_CALL, …) falls through to empty_response below, which is
    // behaviourally right (advance + retry) — and the finishReason is carried in
    // the message so telemetry still names the real cause.
    if (REFUSAL_FINISH_REASONS.has(finish ?? '')) {
      return { code: 'safety_blocked', message: `generation refused (finishReason=${finish})` };
    }
    const text = res.text;
    if (typeof text !== 'string' || text.trim() === '') {
      return { code: 'empty_response', message: `no text content (finishReason=${finish ?? 'none'})` };
    }
    return null;
  }
}

/**
 * Deadline-bounded retry for PARSE/VALIDATION failures, above the client's own
 * model-chain walk. Identical contract to the OpenRouter version so generators
 * port unchanged: `fn` receives the remaining budget and MUST pass it through
 * as the client timeout, so a naive per-attempt timeout can never exceed
 * Vercel's 60s cap. A timeout is never retried — the budget is already gone.
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
      if (err instanceof GeminiTimeoutError) throw err;
      // Content refusals and truncation do not become valid on a re-ask.
      if (err instanceof GeminiError && NO_OUTER_RETRY.has(err.code)) throw err;
      if (i < attempts - 1) {
        const left = deadlineMs - (Date.now() - start);
        if (left < MIN_ATTEMPT_MS) break;
        // Google's RetryInfo tells us how long the quota window has left (a 429
        // typically says ~53s). We deliberately do NOT sleep that out: the
        // quotaId is scoped PerProjectPerModel, so the next attempt leads with a
        // different model via rotateModels and escapes the throttle immediately.
        // Sleeping a full window inside a 60s function would just burn the
        // budget and then fail. Honour the advised delay only when it is short
        // enough to be a genuine hint rather than a wait.
        const advised = err instanceof GeminiError ? err.retryDelayMs : undefined;
        const sleep = Math.min(advised && advised <= backoffMs * 4 ? advised : backoffMs, left - MIN_ATTEMPT_MS);
        if (sleep > 0) await new Promise((r) => setTimeout(r, sleep));
      }
    }
  }
  throw lastErr;
}

/**
 * Rotate the model chain by retry attempt, so an outer withRetry retry leads
 * with a different model than the one that just failed. Attempt 0 keeps the
 * intended primary.
 */
export function rotateModels(models: string[], attempt: number): string[] {
  if (models.length < 2 || attempt <= 0) return models;
  const k = attempt % models.length;
  return [...models.slice(k), ...models.slice(0, k)];
}
