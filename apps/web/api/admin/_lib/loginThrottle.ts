// Per-IP lockout + attempt logging for POST /api/admin/login (migration 026).
//
// Used ONLY by the login handler, and deliberately not part of adminAuth.ts:
// everything in there runs after requireAdmin(), while this runs before any
// credential has been verified. It builds its own service-role client for that
// reason, and calls exactly two RPCs — nothing here takes a caller-supplied
// table, column, or filter.
//
// Shape mirrors _lib/rateLimit.ts: reserve a slot first (begin), record the
// outcome after (finalize).
//
// FAIL-OPEN, on purpose. If the RPCs are missing or Supabase is unreachable,
// beginLoginAttempt logs a warning and allows the attempt. Failing closed would
// mean that deploying this code before running migration 026 locks the operator
// out of the panel that confirms real payments — a self-inflicted outage worse
// than the window it protects. Same call the AI rate limiter makes.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { VercelRequest } from '@vercel/node';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

function client(): SupabaseClient | null {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * The caller's IP. Safe to key a lockout on: Vercel overwrites
 * `x-forwarded-for` at the edge and does not forward externally-supplied
 * values, so a client cannot choose its own bucket (trusted-proxy forwarding is
 * an Enterprise-only setting we don't have). Falls back to 'unknown', which is
 * a single shared bucket — acceptable, since on Vercel the header is always set.
 */
export function clientIp(req: VercelRequest): string {
  const raw = req.headers['x-forwarded-for'] ?? req.headers['x-real-ip'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  const first = (value ?? '').split(',')[0]?.trim();
  return first || 'unknown';
}

export interface LoginAttempt {
  /** Row id to pass to finalizeLoginAttempt, or null when throttling is unavailable. */
  id: number | null;
  allowed: boolean;
  retryAfterSec: number;
  /** Failures counted for this IP in the current window (0 when unavailable). */
  recentFailures: number;
}

/**
 * Reserve an attempt for this IP, or refuse it. MUST be called before
 * verifyCredentials so the reserved row counts against concurrent siblings.
 */
export async function beginLoginAttempt(
  ip: string,
  username: string,
  userAgent: string | undefined
): Promise<LoginAttempt> {
  const supabase = client();
  if (!supabase) {
    console.warn('[admin/login] throttle unavailable (no service-role key) — allowing attempt');
    return { id: null, allowed: true, retryAfterSec: 0, recentFailures: 0 };
  }
  const { data, error } = await supabase.rpc('begin_admin_login_attempt', {
    p_ip: ip,
    p_username: username,
    p_user_agent: userAgent ?? null,
  });
  if (error) {
    console.warn(`[admin/login] throttle unavailable, allowing attempt: ${error.message}`);
    return { id: null, allowed: true, retryAfterSec: 0, recentFailures: 0 };
  }
  // The function RETURNS TABLE, so supabase-js hands back an array of one row.
  const row = (Array.isArray(data) ? data[0] : data) as
    | { attempt_id?: number; allowed?: boolean; retry_after_sec?: number; recent_failures?: number }
    | null;
  return {
    id: typeof row?.attempt_id === 'number' ? row.attempt_id : null,
    allowed: row?.allowed !== false,
    retryAfterSec: Math.max(0, Number(row?.retry_after_sec ?? 0)),
    recentFailures: Math.max(0, Number(row?.recent_failures ?? 0)),
  };
}

/** Flip a reserved attempt to success/failure. Never throws. */
export async function finalizeLoginAttempt(id: number | null, success: boolean): Promise<void> {
  if (id === null) return;
  const supabase = client();
  if (!supabase) return;
  const { error } = await supabase.rpc('finalize_admin_login_attempt', {
    p_attempt_id: id,
    p_success: success,
  });
  if (error) console.warn(`[admin/login] could not finalize attempt ${id}: ${error.message}`);
}
