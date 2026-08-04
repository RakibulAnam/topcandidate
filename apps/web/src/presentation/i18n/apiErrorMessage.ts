// Maps a server AI failure to a LOCALIZED, user-facing message.
//
// The server sends `{ error, code }` where `code` is stable and `error` is
// generic English (api/_lib/aiErrorResponse.ts). Prior to that, handlers returned
// the provider's raw message and the client showed it verbatim — so a throttled
// user got `gemini-3.5-flash-lite: {"error":{"code":429,...}}` in a toast, in
// English, regardless of their selected language.
//
// Branch on `code`, never on message text. Returns null when the error is not a
// recognized server AI failure, so the caller keeps its own handling (client
// timeout, offline, credit flow, and the client-side validation errors that
// legitimately carry a user-actionable message of their own).

import { ApiCallError } from '../../infrastructure/ai/proxy/ProxyClients.js';

type TFn = (key: never, vars?: Record<string, string | number>) => string;

export function apiErrorMessage(err: unknown, t: TFn): string | null {
  if (!(err instanceof ApiCallError)) return null;
  const k = (key: string, vars?: Record<string, string | number>) => t(key as never, vars);
  const { used, cap } = err;

  // Our own daily cap. `status` is the reliable signal — older server builds
  // send 429 with no code at all.
  if (err.status === 429 || err.code === 'rate_limited') {
    return used !== undefined && cap !== undefined
      ? k('apiError.rateLimited', { used, cap })
      : k('apiError.rateLimitedNoCount');
  }

  switch (err.code) {
    case 'provider_busy': return k('apiError.providerBusy');
    case 'provider_timeout': return k('apiError.providerTimeout');
    case 'provider_down': return k('apiError.providerDown');
    case 'bad_output': return k('apiError.badOutput');
    case 'blocked': return k('apiError.blocked');
    case 'guard_rejected': return k('apiError.guardRejected');
    case 'generation_failed': return k('apiError.generationFailed');
    default: return null;
  }
}

/**
 * True when retrying immediately cannot help — the daily cap is the only failure
 * here that a retry button makes actively worse, because every press is a
 * guaranteed rejection and the copy still says "try again".
 */
export function isRetryPointless(err: unknown): boolean {
  return err instanceof ApiCallError && (err.status === 429 || err.code === 'rate_limited');
}
