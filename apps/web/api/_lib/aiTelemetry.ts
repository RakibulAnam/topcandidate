// Builds the ai_call_log payload for one AI call, success or failure.
//
// Every AI endpoint used to hand-roll the same 8-field logCall object twice (once
// per terminal branch), which is why the failure branches all recorded
// `status: 'error'` and nothing else — there was no obvious place to put a reason.
// Migration 020 added the columns; this module is the single place that fills
// them, so a new endpoint gets full failure telemetry for free.
//
// Unlike aiCost.ts — which stays deliberately structural so it can be reasoned
// about without the AI layer — this module DOES import the Gemini classifier.
// That is the point: normalizing a provider error is exactly the coupling that
// belongs here rather than duplicated across six handlers. It also has a useful
// side effect: because the endpoints import this, GeminiClient finally lands
// inside the `tsconfig.api.json` program, so `npm run typecheck:api` (the same
// check Vercel runs on every deploy) actually covers it.

import { classifyGeminiError } from '../../src/infrastructure/ai/GeminiClient.js';
import type { UsageSink } from '../../src/infrastructure/ai/usage.js';
import { resolveCost } from './aiCost.js';
import type { CallMeta } from './rateLimit.js';

export interface TelemetryInput {
  usage: UsageSink;
  latencyMs: number;
  /** Present only on the failure path. */
  error?: unknown;
  /** Used to estimate prompt tokens when the provider reported none. */
  fallbackInputText?: string;
  /** Used to estimate completion tokens when the provider reported none. */
  fallbackOutputText?: string;
}

/**
 * Assemble a complete CallMeta. Pass the same UsageSink the generator filled;
 * on failure also pass the thrown error and the code/message/chain are derived.
 */
export function buildCallMeta(input: TelemetryInput): CallMeta {
  const { usage, latencyMs, error, fallbackInputText, fallbackOutputText } = input;
  const attempts = usage.attempts ?? [];

  // On a failure the generator never assigned usage.model (no attempt
  // succeeded), which would leave the row modelless and cost it at the generic
  // FALLBACK_PRICE. The attempt chain still knows what was tried, so bill the
  // failure against the LAST model attempted.
  const model = usage.model ?? (attempts.length ? attempts[attempts.length - 1].model : undefined);

  const cost = resolveCost(
    { ...usage, model },
    fallbackInputText,
    fallbackOutputText,
  );

  const meta: CallMeta = {
    provider: cost.provider,
    model: cost.model,
    promptTokens: cost.promptTokens,
    completionTokens: cost.completionTokens,
    costUsd: cost.costUsd,
    status: error === undefined ? 'success' : 'error',
    latencyMs,
  };

  // Only record when we actually have a number — leaving it NULL is honest,
  // whereas writing 0 would be indistinguishable from "measured, and it was 0",
  // which is the normal case at thinkingLevel MINIMAL.
  if (cost.thoughtTokens > 0 || usage.thoughtTokens !== undefined) {
    meta.thoughtTokens = cost.thoughtTokens;
  }
  if (attempts.length) {
    meta.attemptCount = attempts.length;
    // Bound what reaches jsonb: a pathological chain must not balloon the row.
    meta.modelAttempts = attempts.slice(0, 8).map((a) => ({
      model: a.model,
      ok: a.ok,
      ms: a.ms,
      ...(a.code ? { code: a.code } : {}),
      ...(a.status !== undefined ? { status: a.status } : {}),
      ...(a.message ? { message: a.message.slice(0, 200) } : {}),
    }));
  }

  if (error !== undefined) {
    // classifyGeminiError passes a GeminiError straight through and maps raw SDK
    // errors; anything genuinely unrecognized lands as 'unknown', which is a
    // real signal (it means a failure mode we have not seen yet) rather than a
    // silent hole. Guard rejections thrown by the prompt layer are not Gemini
    // errors, so they classify as 'unknown' too — see below.
    const { code } = classifyGeminiError(error);
    const raw = error instanceof Error ? error.message : String(error);
    // Our own content guards must never be confused with a provider fault — they
    // need a completely different response (regenerate vs retry vs give up).
    //
    // Classify on the ERROR CLASS, not the message. An earlier version matched
    // prose (/fabricat|not specific enough|.../) and silently missed every
    // ToolkitSpecificityError, because those read "output never names target
    // company ..." and "output is generic — ...". That is the same trap as
    // matching Google's 429 prose: the wording is not the contract, the type is.
    meta.errorCode = isGuardError(error) ? 'guard_rejected' : code;
    meta.errorMessage = raw;
  }

  return meta;
}

/**
 * True when the provider SUCCEEDED and our own quality guards refused the
 * content. Shared with aiErrorResponse.publicAiErrorCode so the telemetry code
 * and the HTTP code can never disagree about what a guard rejection is.
 *
 * Classify on the ERROR CLASS, not the message. An earlier version matched prose
 * (/fabricat|not specific enough|.../) and silently missed every
 * ToolkitSpecificityError, because those read "output never names target company
 * ..." and "output is generic — ...". That is the same trap as matching Google's
 * 429 prose: the wording is not the contract, the type is.
 */
export function isGuardError(error: unknown): boolean {
  const name = error instanceof Error ? error.name : '';
  if (
    name === 'ToolkitFabricationError' ||
    name === 'ToolkitSpecificityError' ||
    name === 'ToolkitAnchorError' ||
    /^Toolkit\w*Error$/.test(name) ||
    // Same class of guard on the optimizer (paid) path — a token stripped from
    // `skills` that survived in a bullet. Named differently because it is not a
    // toolkit artifact, so the /^Toolkit/ pattern above does not reach it.
    name === 'ResumeFabricationError'
  ) return true;
  // Plain-Error guards raised inline by the generators for an empty slot.
  const raw = error instanceof Error ? error.message : String(error ?? '');
  return /\bis empty\b|no interview questions/i.test(raw);
}
