// Shared X-Admin-Key verification for /api/admin/* endpoints + a service-role
// Supabase client factory. Every admin endpoint MUST call requireAdmin() at
// the top and bail when it returns false (the helper writes the 401/503 itself).
//
// AUTH MODEL
// ----------
// Single operator. The operator generates ADMIN_API_KEY (≥32 random bytes,
// `openssl rand -hex 32`), pastes it into the /admin SPA, which stores it in
// localStorage and includes it on every call as the X-Admin-Key header.
// We timing-safe-compare against process.env.ADMIN_API_KEY. There is no
// role/permission abstraction — if the key matches you can do anything; if
// it doesn't, you can do nothing. Rotation = change the env var and reload.
//
// Separate from BKASH_WEBHOOK_SECRET on purpose (different blast radius —
// the bKash secret is shared with the Flutter app on the operator's phone;
// the admin key is operator-only).

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { timingSafeEqual } from 'crypto';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const ADMIN_API_KEY = process.env.ADMIN_API_KEY ?? '';

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

/**
 * Verify the X-Admin-Key header. Returns true if authorised; otherwise writes
 * 401 (bad/missing key) or 503 (server misconfigured) to res and returns false.
 */
export function requireAdmin(req: VercelRequest, res: VercelResponse): boolean {
  if (!ADMIN_API_KEY) {
    console.error('[admin] ADMIN_API_KEY not configured on server');
    res.status(503).json({ error: 'Admin endpoints are not configured on the server.' });
    return false;
  }
  const header = req.headers['x-admin-key'];
  const key = Array.isArray(header) ? header[0] : header;
  if (!key || !safeEqual(String(key), ADMIN_API_KEY)) {
    res.status(401).json({ error: 'bad admin key' });
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
