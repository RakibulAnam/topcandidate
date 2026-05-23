// Per-user daily AI-call cap, backed by Supabase. Stops a single user from
// burning the whole free quota (ours, or the providers') and stops a stolen
// JWT from racking up paid usage.
//
// Two operations:
//   - assertWithinLimit(userId, kind, jwt): throws if user is over daily cap
//   - logCall(userId, kind, jwt): inserts a row marking the call
//
// Daily window = rolling 24h, not calendar-day, so a user can't drain the
// quota at 23:59 and again at 00:01.
//
// Caller pattern: assert → run AI → log on success. (We log on success, not
// before, so failed calls don't count against the user. Trade-off: a user
// can spam-fail forever without hitting the cap. Mitigation: provider-side
// rate limits on Groq/Gemini will cap them.)

import { userClient } from './auth.js';

export const DEFAULT_DAILY_CAP = 20;

export type CallKind = 'optimize' | 'toolkit_item' | 'extract_resume';

export class RateLimitError extends Error {
  status = 429;
  constructor(public used: number, public cap: number) {
    super(`Daily limit reached (${used}/${cap}). Try again in ~24 hours.`);
  }
}

const dayAgoIso = () => new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

export async function assertWithinLimit(
  userId: string,
  jwt: string,
  cap: number = DEFAULT_DAILY_CAP
): Promise<void> {
  const supabase = userClient(jwt);
  const { count, error } = await supabase
    .from('ai_call_log')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', dayAgoIso());

  if (error) {
    // Don't fail-open on the daily cap — but don't fail-closed either; if
    // Supabase is hiccuping we'd block all users. Log + allow.
    console.warn('[rateLimit] Could not check daily cap:', error.message);
    return;
  }

  if ((count ?? 0) >= cap) {
    throw new RateLimitError(count ?? 0, cap);
  }
}

export async function logCall(
  userId: string,
  jwt: string,
  kind: CallKind
): Promise<void> {
  const supabase = userClient(jwt);
  const { error } = await supabase
    .from('ai_call_log')
    .insert({ user_id: userId, kind });
  if (error) {
    // Logging failures are non-fatal — call already succeeded; we'd rather
    // give the user their resume than fail at the audit step.
    console.warn('[rateLimit] Failed to log AI call:', error.message);
  }
}
