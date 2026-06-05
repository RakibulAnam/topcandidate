// Shared session-token verification for /api/admin/* endpoints + a service-role
// Supabase client factory. Every admin endpoint MUST call requireAdmin() at
// the top and bail when it returns false (the helper writes the 401/503 itself).
//
// AUTH MODEL (owner login — replaces the old "paste ADMIN_API_KEY" gate)
// ----------------------------------------------------------------------
// Single owner. The owner logs in at POST /api/admin/login with
// ADMIN_USERNAME + password; the server mints a short-lived HMAC-signed
// session token (see _lib/session.ts). The /admin SPA keeps it in
// sessionStorage (dropped when the tab closes) and sends it as
// `Authorization: Bearer <token>` on every call. requireAdmin verifies the
// signature + expiry. There is no role/permission abstraction — a valid token
// can do anything; no token (or expired) can do nothing.
//
// ADMIN_API_KEY is REPURPOSED as the token-signing secret — it is no longer a
// credential the operator types. Rotating it invalidates all live sessions.
//
// Separate from BKASH_WEBHOOK_SECRET on purpose (different blast radius —
// the bKash secret is shared with the Flutter app on the operator's phone).

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { verifySessionToken } from './session.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

/**
 * Verify the `Authorization: Bearer <token>` session token. Returns true if
 * authorised; otherwise writes 401 (missing/invalid/expired) or 503 (server
 * missing the signing secret) to res and returns false.
 */
export function requireAdmin(req: VercelRequest, res: VercelResponse): boolean {
  if (!process.env.ADMIN_API_KEY) {
    console.error('[admin] ADMIN_API_KEY (token-signing secret) not configured on server');
    res.status(503).json({ error: 'Admin endpoints are not configured on the server.' });
    return false;
  }
  const header = req.headers['authorization'];
  const raw = Array.isArray(header) ? header[0] : header;
  const token = raw && raw.startsWith('Bearer ') ? raw.slice(7).trim() : null;
  const nowSec = Math.floor(Date.now() / 1000);
  if (!token || !verifySessionToken(token, nowSec)) {
    res.status(401).json({ error: 'unauthorized' });
    return false;
  }
  return true;
}

/**
 * Build a Supabase client with the service-role key. RLS-bypassing — use only
 * after requireAdmin() has passed.
 */
export function adminSupabase(): SupabaseClient | null {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Append a free-form audit entry to purchase_state_changes. The RPCs in
 * migration 007 already log their own transitions; this helper is for
 * endpoints that do non-state-change actions (e.g. dispute resolution).
 */
export async function logStateChange(
  supabase: SupabaseClient,
  purchaseId: string,
  fromStatus: string | null,
  toStatus: string,
  reason: string | null
): Promise<void> {
  await supabase.from('purchase_state_changes').insert({
    purchase_id: purchaseId,
    from_status: fromStatus,
    to_status: toStatus,
    actor: 'operator',
    reason,
  });
}

/**
 * Read a non-empty `reason` from the body. Returns null + writes 400 when
 * missing. All write actions require a reason for the audit log.
 */
export function requireReason(
  body: unknown,
  res: VercelResponse,
  optional = false
): string | null {
  const reason = (body as { reason?: unknown } | null)?.reason;
  if (typeof reason !== 'string' || reason.trim().length === 0) {
    if (optional) return '';
    res.status(400).json({ error: 'reason is required' });
    return null;
  }
  return reason.trim();
}

/**
 * Surface a Supabase error to the admin client. Includes the underlying
 * message, code, and hint so the operator can diagnose schema / RLS /
 * migration issues without having to dig through server logs.
 *
 * Safe to expose: the admin key has already authenticated; nothing here
 * leaks customer PII (Supabase error messages are about SQL state, not
 * row contents).
 */
export function sendSupabaseError(
  res: VercelResponse,
  error: { message?: string; code?: string | null; hint?: string | null },
  context: string,
  status = 500
): void {
  console.error(`[admin/${context}] ${error.message ?? 'unknown error'}`);
  res.status(status).json({
    error: error.message ?? 'Database error.',
    code: error.code ?? null,
    hint: error.hint ?? null,
    context,
  });
}

/**
 * Write an entry to admin_audit_log via record_admin_action RPC. Called
 * AFTER the underlying action's RPC succeeds. Not in the same transaction
 * as the action — see migration 009 header for the trade-off rationale.
 *
 * `before` / `after` are JSON snapshots of the affected row. For actions
 * with no row diff (e.g. note-add), use null for both.
 *
 * Audit failures are logged but never break the caller — the action
 * already succeeded. Missing audit rows surface as gaps in the audit-log
 * tab UI, cross-checkable against purchase_state_changes for purchase rows.
 */
export async function recordAuditAction(
  supabase: SupabaseClient,
  params: {
    action: string;
    targetKind: 'user' | 'purchase' | 'dispute' | 'orphan_sms' | 'parser_failure' | 'system';
    targetId: string | null;
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
    reason: string | null;
  }
): Promise<void> {
  const { error } = await supabase.rpc('record_admin_action', {
    p_action: params.action,
    p_target_kind: params.targetKind,
    p_target_id: params.targetId,
    p_before: params.before,
    p_after: params.after,
    p_reason: params.reason,
  });
  if (error) {
    console.error('[admin] audit write failed (action proceeded):', params.action, error.message);
  }
}
