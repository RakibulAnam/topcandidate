// Per-user daily AI-call cap, backed by Supabase. Stops a single user from
// burning the whole free quota (ours, or the providers') and stops a stolen
// JWT from racking up paid usage.
//
// Two operations:
//   - assertWithinLimit(userId, jwt, kind?): throws if user is over the daily
//     cap, or over the per-kind cap when KIND_DAILY_CAPS has an entry for kind
//   - logCall(userId, jwt, kind, meta?): inserts a row marking the call
//
// Daily window = rolling 24h, not calendar-day, so a user can't drain the
// quota at 23:59 and again at 00:01.
//
// Caller pattern (audit C5): assert → run AI → log at EVERY terminal point,
// success AND failure. All four AI endpoints (optimize, optimize-general,
// toolkit-item, extract-resume) write exactly one ai_call_log row per attempt
// that gets past the rate-limit gate, so failed/aborted calls still count
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

const dayAgoIso = () => new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

// Throws RateLimitError if the user is over the overall daily cap, or — when
// `kind` has an entry in KIND_DAILY_CAPS — over that kind's own cap. One
// query: the row set is small (≤ overall cap), so we count in JS rather than
// issuing two head-count round-trips.
export async function assertWithinLimit(
  userId: string,
  jwt: string,
  kind?: CallKind,
  cap: number = DEFAULT_DAILY_CAP
): Promise<void> {
  const supabase = userClient(jwt);
  // Row volume per user per day is small (overall cap + per-kind caps), so we
  // fetch kinds and count in JS — one round-trip covers both checks. The 200
  // ceiling is a sanity bound far above any legitimate day's rows.
  const { data, error } = await supabase
    .from('ai_call_log')
    .select('kind')
    .eq('user_id', userId)
    .gte('created_at', dayAgoIso())
    .limit(200);

  if (error) {
    // Don't fail-open on the daily cap — but don't fail-closed either; if
    // Supabase is hiccuping we'd block all users. Log + allow.
    console.warn('[rateLimit] Could not check daily cap:', error.message);
    return;
  }

  const rows = data ?? [];
  const overallUsed = rows.filter((r) => !EXCLUDED_FROM_OVERALL.has(r.kind as string)).length;
  if (overallUsed >= cap) {
    throw new RateLimitError(overallUsed, cap);
  }

  const kindCap = kind ? KIND_DAILY_CAPS[kind] : undefined;
  if (kind && kindCap !== undefined) {
    const kindUsed = rows.filter((r) => r.kind === kind).length;
    if (kindUsed >= kindCap) {
      throw new RateLimitError(kindUsed, kindCap, kind);
    }
  }
}

export async function logCall(
  userId: string,
  jwt: string,
  kind: CallKind,
  meta?: CallMeta
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
        row.error_message = meta.errorMessage
          .replace(/AIza[0-9A-Za-z_-]{10,}/g, 'AIza[REDACTED]')
          .replace(/\bkey=[\w.-]+/gi, 'key=[REDACTED]')
          .slice(0, 500);
      }
      if (meta.modelAttempts !== undefined) row.model_attempts = meta.modelAttempts;
      if (meta.thoughtTokens !== undefined) row.thought_tokens = meta.thoughtTokens;
      if (meta.attemptCount !== undefined) row.attempt_count = meta.attemptCount;
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
