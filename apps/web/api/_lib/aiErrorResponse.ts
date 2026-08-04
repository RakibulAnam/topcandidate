// Turns an internal AI failure into a response that is SAFE to hand a browser.
//
// Why this exists: every AI endpoint's catch block used to do
//   res.status(502).json({ error: err.message })
// and `err.message` on this path is raw provider output. @google/genai builds
// ApiError.message as JSON.stringify(errorBody); GeminiClient slices it to 300
// chars and prefixes the model name; the generators rethrow it unchanged. So a
// throttled user was shown, verbatim in a toast:
//
//   gemini-3.5-flash-lite: {"error":{"code":429,"message":"You exceeded your
//   current quota ...","status":"RESOURCE_EXHAUSTED","details":[...]}}
//
// That is three problems at once. It names our provider and model, it echoes
// whatever the provider chose to put in the string back to an untrusted client
// (the telemetry path redacts key-shaped tokens for exactly this reason —
// redactSecrets in rateLimit.ts — and the HTTP path did not), and as UX it is
// meaningless to the person reading it.
//
// The fix is not to write nicer English here. It is to send a STABLE CODE and
// let the client localize — the app is bilingual, so any prose the server
// invents is English text shown to a Bengali user. `error` stays populated as a
// last-resort fallback for a client that doesn't recognize the code.
//
// The full untruncated detail still goes to ai_call_log.error_message and the
// function logs. Nothing is lost for debugging; it just stops being public.

import { classifyGeminiError } from '../../src/infrastructure/ai/GeminiClient.js';
import { isGuardError } from './aiTelemetry.js';

/** Codes the client is expected to branch on. Keep in sync with `apiErrorCode` handling in BuilderScreen. */
export type PublicAiErrorCode =
  | 'rate_limited'      // our own daily cap (HTTP 429)
  | 'provider_busy'     // provider throttled or out of quota
  | 'provider_timeout'
  | 'provider_down'     // auth / billing / model unavailable — a config or outage problem
  | 'bad_output'        // parse / schema / truncation / empty
  | 'blocked'           // safety filter
  | 'guard_rejected'    // our own quality guards refused the content
  | 'generation_failed';

export function publicAiErrorCode(err: unknown): PublicAiErrorCode {
  if (isGuardError(err)) return 'guard_rejected';
  const { code } = classifyGeminiError(err);
  switch (code) {
    case 'rate_limit':
    case 'quota_exhausted':
      return 'provider_busy';
    case 'timeout':
      return 'provider_timeout';
    case 'auth':
    case 'billing_required':
    case 'model_unavailable':
    case 'upstream_error':
      return 'provider_down';
    case 'json_parse':
    case 'schema_invalid':
    case 'truncated':
    case 'empty_response':
      return 'bad_output';
    case 'safety_blocked':
      return 'blocked';
    default:
      return 'generation_failed';
  }
}

/**
 * English fallback text. Deliberately generic: the client localizes off `code`,
 * so this is only what a stale client or a direct API consumer sees. It must
 * never interpolate provider output.
 */
const FALLBACK: Record<PublicAiErrorCode, string> = {
  rate_limited: 'Daily limit reached. Please try again later.',
  provider_busy: 'Our AI service is busy right now. Please try again in a minute.',
  provider_timeout: 'The AI service took too long to respond. Please try again.',
  provider_down: 'The AI service is temporarily unavailable. Please try again shortly.',
  bad_output: 'The AI returned an incomplete response. Please try again.',
  blocked: 'The AI declined to process this content.',
  guard_rejected: "We couldn't produce a version we're confident in. Please try again.",
  generation_failed: 'Generation failed. Please try again.',
};

/** `{ error, code }` safe to send as a JSON body. Never contains provider text. */
export function publicAiError(err: unknown): { error: string; code: PublicAiErrorCode } {
  const code = publicAiErrorCode(err);
  return { error: FALLBACK[code], code };
}
