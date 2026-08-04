// Per-user daily AI-call cap, backed by Supabase. Stops a single user from
// burning the whole free quota (ours, or the providers') and stops a stolen
// JWT from racking up paid usage.
//
// Two operations:
//   - reserveCall(userId, jwt, kind, cap?): ATOMICALLY checks the daily caps
//     and claims a slot, returning the reserved ai_call_log row id. Throws
//     RateLimitError when over cap; returns null (fail-open) if the reservation
//     RPC is unavailable. Replaces the old read-then-write assertWithinLimit,
//     which could not enforce a cap under concurrency — see migration 024.
//   - logCall(userId, jwt, kind, meta?, reservationId?): records the outcome. With
//     a reservationId it FINALIZES the row reserveCall already inserted; without
//     one it inserts. Never both — inserting alongside a reservation would
//     double-count every call against the cap.
//
// Daily window = rolling 24h, not calendar-day, so a user can't drain the
// quota at 23:59 and again at 00:01.
//
// Caller pattern (audit C5): reserve → run AI → log at EVERY terminal point,
// success AND failure. All six AI endpoints (optimize, optimize-general, toolkit,
// toolkit-item, extract-resume, normalize-item) write exactly one ai_call_log row
// per attempt that gets past the gate, so failed/aborted calls still count
// toward the cap — a stolen or abusive JWT cannot spam-fail the providers to
// drain shared quota. The row also carries cost/telemetry (provider/model/
// tokens/cost/status/latency) when AI actually ran. Cheap input-validation
// rejections (400/413/415) before any provider call are intentionally NOT
// logged: they burn no AI quota, which is what the cap exists to protect.

import { userClient } from './auth.js';

export const DEFAULT_DAILY_CAP = 20;

export type CallKind = 'optimize' | 'optimize_general' | 'toolkit' | 'toolkit_item' | 'extract_resume' | 'normalize';

// Per-kind daily caps, enforced IN ADDITION to the overall cap. The free
// general-resume path has no credit gate, so its only cost control is this
// cap — 20/day of free optimizer calls per account is pure cost exposure
// (~$0.16/day per account) with no funnel benefit past the first few.
export const KIND_DAILY_CAPS: Partial<Record<CallKind, number>> = {
  optimize_general: 5,
  normalize: 40,
  // Per-item toolkit regeneration is FREE to the user and the most expensive
  // single call we make (~$0.0089 for the bilingual interview block — measured
  // 2026-08-04). Previously it was bounded only by the overall 20/day cap, so an
  // account with zero credits could still burn ~15 x $0.0089 = $0.13/day of our
  // money indefinitely, having paid nothing. Over a month that exceeds the entire
  // margin on a ৳200 pack — a bigger drain on profit than any model choice.
  //
  // 8/day is deliberately generous for legitimate use: it is two retries for each
  // of the four artifact types in a single day, and a guard failure is the only
  // reason to retry at all. Residual exposure is ~$0.07/day, bounded but not zero
  // — the cap is per-DAY, not per-generation, which is the shape the rate limiter
  // supports. Tighten if abuse shows up in v_ai_failures_daily.
  toolkit_item: 8,
};

// Kinds excluded from the OVERALL daily cap (they still hit their own
// per-kind cap above). 'normalize' fires on profile edits — a user polishing
// 10 experience entries must not starve their paid generations.
const EXCLUDED_FROM_OVERALL: ReadonlySet<string> = new Set(['normalize']);

// Optional cost/telemetry metadata recorded alongside each call. Every field
// is optional so existing callers (and partial-data paths) keep working — a
// missing field just lands as NULL in the corresponding ai_call_log column.
export interface CallMeta {
  provider?: string;
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  costUsd?: number;
  status?: 'success' | 'error';
  latencyMs?: number;
  // ── Failure diagnosis (migration 020) ────────────────────────────────────
  // Without these, `status: 'error'` was the whole story and we could not tell
  // a rate limit from a schema bug, or see which model in a fallback chain
  // actually broke. Kept as loose types on purpose: this module must not import
  // from src/infrastructure, and a stricter union here would force a migration
  // every time the taxonomy grows.
  /** Normalized failure class — GeminiErrorCode in GeminiClient.ts. */
  errorCode?: string;
  /** Raw provider message. Truncated on write; never user-facing. */
  errorMessage?: string;
  /** Per-model outcomes, oldest first: [{model, ok, code, ms}]. Serialized to
   *  jsonb, so the element shape is intentionally unconstrained here. */
  modelAttempts?: readonly unknown[];
  /** Gemini 3.x thinking tokens. Billed at the OUTPUT rate — must reach cost. */
  thoughtTokens?: number;
  /** Transport attempts for this logical call (chain walk + outer retries). */
  attemptCount?: number;
}

export class RateLimitError extends Error {
  status = 429;
  constructor(public used: number, public cap: number, public scope: 'daily' | CallKind = 'daily') {
    super(
      scope === 'optimize_general'
        ? `Daily free-resume limit reached (${used}/${cap}). Try again in ~24 hours.`
        : `Daily limit reached (${used}/${cap}). Try again in ~24 hours.`
    );
  }
}

/**
 * Atomically check the daily caps AND claim a slot, returning the reserved
 * ai_call_log row id to hand to logCall().
 *
 * This replaces the read-then-write shape of assertWithinLimit for every AI
 * endpoint. That shape could not enforce a cap under concurrency: it SELECTed the
 * count, and the row was only INSERTed after the provider returned, so the window
 * between check and record was the whole provider latency — 5 to 30 seconds. With
 * 7 rows against a cap of 8, fifty concurrent requests all read 7, all passed, and
 * all ran AI: 57 calls against an 8/day cap. Migration 024's reserve_ai_call takes
 * a per-user advisory lock, counts, and inserts a 'pending' row in one
 * transaction, so request N+1 counts request N.
 *
 * FAILS OPEN, deliberately and only for infrastructure errors. A missing function
 * (code shipped before the migration) or a Supabase hiccup returns null and the
 * call proceeds — blocking every user's generation because telemetry is unwell is
 * far worse than briefly under-enforcing a cost cap. A genuine cap rejection is a
 * thrown RateLimitError and is never swallowed.
 *
 * @returns reservation id, or null when reservation was unavailable (fail-open).
 * @throws RateLimitError when the user is genuinely over a cap.
 */
export async function reserveCall(
  userId: string,
  jwt: string,
  kind: CallKind,
  cap: number = DEFAULT_DAILY_CAP,
): Promise<string | null> {
  const supabase = userClient(jwt);
  const { data, error } = await supabase.rpc('reserve_ai_call', {
    p_kind: kind,
    p_overall_cap: cap,
    p_kind_cap: KIND_DAILY_CAPS[kind] ?? 0,
    p_excluded_kinds: [...EXCLUDED_FROM_OVERALL],
  });

  if (error) {
    // 'rate_limited:<used>:<cap>:<scope>' — the only error we honour.
    const m = /rate_limited:(\d+):(\d+):(\w+)/.exec(error.message ?? '');
    if (m) {
      const [, used, capHit, scope] = m;
      throw new RateLimitError(Number(used), Number(capHit), scope === 'overall' ? undefined : (scope as CallKind));
    }
    console.warn(`[rateLimit] reserve_ai_call unavailable, proceeding without a reservation: ${error.message}`);
    return null;
  }
  return typeof data === 'string' ? data : null;
}

/**
 * Strip credential-shaped tokens from anything bound for ai_call_log. That table
 * has a "Users can view own" SELECT policy, so every column here is readable by
 * the user, and provider errors sometimes echo the request — including a key in a
 * URL. Applies to BOTH error_message and model_attempts[].message.
 */
function redactSecrets(text: string): string {
  return text
    .replace(/AIza[0-9A-Za-z_-]{10,}/g, 'AIza[REDACTED]')
    .replace(/\bkey=[\w.-]+/gi, 'key=[REDACTED]')
    .replace(/\bBearer\s+[\w.\-]{16,}/gi, 'Bearer [REDACTED]');
}

/**
 * Record the outcome of an AI call.
 *
 * With a `reservationId` from reserveCall, this FINALIZES that already-inserted
 * row — it must not insert a second one, or every call would be double-counted
 * against the cap. Without one (fail-open path, or a legacy caller), it inserts as
 * before.
 */
export async function logCall(
  userId: string,
  jwt: string,
  kind: CallKind,
  meta?: CallMeta,
  reservationId?: string | null,
): Promise<void> {
  // Telemetry is additive and must NEVER break the request — wrap everything
  // (including building the row) in a try/catch and only ever warn.
  try {
    const supabase = userClient(jwt);
    const row: Record<string, unknown> = { user_id: userId, kind };
    if (meta) {
      // Only set columns we actually have values for; omitted → NULL.
      if (meta.provider !== undefined) row.provider = meta.provider;
      if (meta.model !== undefined) row.model = meta.model;
      if (meta.promptTokens !== undefined) row.prompt_tokens = meta.promptTokens;
      if (meta.completionTokens !== undefined) row.completion_tokens = meta.completionTokens;
      if (meta.costUsd !== undefined) row.cost_usd = meta.costUsd;
      if (meta.status !== undefined) row.status = meta.status;
      if (meta.latencyMs !== undefined) row.latency_ms = meta.latencyMs;
      // Bound the code too — it is a closed taxonomy, so anything long is a bug
      // upstream rather than data worth keeping.
      if (meta.errorCode !== undefined) row.error_code = meta.errorCode.slice(0, 64);
      // Provider messages can be long and can echo prompt fragments. Cap them:
      // this column is for diagnosis, not an archive, and résumé text must not
      // accumulate in a telemetry table.
      //
      // SECURITY: ai_call_log has a "Users can view own ai_call_log" SELECT
      // policy, so whatever lands here is readable by that user. Provider errors
      // sometimes echo the request (including a key in a URL), so redact
      // key-shaped tokens before insert — both Google's AIza… form and the
      // longer opaque form this project's key uses.
      if (meta.errorMessage !== undefined) {
        row.error_message = redactSecrets(meta.errorMessage).slice(0, 500);
      }
      if (meta.modelAttempts !== undefined) {
        // model_attempts[].message carries the SAME raw provider text as
        // error_message, in the SAME user-readable row — redacting only one of
        // them left the leak fully open via the other.
        row.model_attempts = meta.modelAttempts.map((a) =>
          a && typeof a === 'object' && typeof (a as { message?: unknown }).message === 'string'
            ? { ...(a as object), message: redactSecrets((a as { message: string }).message) }
            : a,
        );
      }
      if (meta.thoughtTokens !== undefined) row.thought_tokens = meta.thoughtTokens;
      if (meta.attemptCount !== undefined) row.attempt_count = meta.attemptCount;
    }
    if (reservationId) {
      // Finalize the row reserveCall already inserted. Column names, not CallMeta
      // camelCase — finalize_ai_call extracts these keys explicitly.
      const patch: Record<string, unknown> = {};
      const map: Record<string, string> = {
        provider: 'provider', model: 'model', prompt_tokens: 'prompt_tokens',
        completion_tokens: 'completion_tokens', thought_tokens: 'thought_tokens',
        cost_usd: 'cost_usd', status: 'status', latency_ms: 'latency_ms',
        error_code: 'error_code', error_message: 'error_message',
        model_attempts: 'model_attempts', attempt_count: 'attempt_count',
      };
      for (const key of Object.keys(map)) {
        if (row[key] !== undefined) patch[key] = row[key];
      }
      // A reserved row starts as 'pending'; if nothing set a status, the call
      // reached a terminal point without one, which is an error, not a success.
      if (patch.status === undefined) patch.status = 'error';
      const { error } = await supabase.rpc('finalize_ai_call', {
        p_id: reservationId,
        p_meta: patch,
      });
      if (error) {
        console.warn('[rateLimit] Failed to finalize AI call row:', error.message);
      }
      return;
    }

    const { error } = await supabase.from('ai_call_log').insert(row);
    if (error) {
      // Logging failures are non-fatal — call already succeeded; we'd rather
      // give the user their resume than fail at the audit step.
      console.warn('[rateLimit] Failed to log AI call:', error.message);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[rateLimit] Failed to log AI call (threw):', msg);
  }
}
