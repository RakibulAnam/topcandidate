// Detection-only signal: which accounts share a network origin (migration 027).
//
// Called from authenticate() on every authenticated API call. It never blocks,
// never throws, and never changes a response — if anything here fails the
// request proceeds exactly as before. See the migration header for why the
// signal is collected now rather than when abuse appears, and for the honest
// limits of what it catches.
//
// The raw IP never leaves this module: it is HMAC'd with a server secret and
// only the digest is stored.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createHmac } from 'crypto';
import type { VercelRequest } from '@vercel/node';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

// A dedicated salt is preferred — rotating it deliberately breaks correlation
// with older rows, which is the escape hatch if this table is ever considered
// too sensitive to keep. Falling back to the service-role key means the signal
// works on deploy with zero configuration; that key is already required for
// anything that writes here.
const SALT = process.env.IP_HASH_SALT || SERVICE_ROLE_KEY;

let cached: SupabaseClient | null = null;
function serviceClient(): SupabaseClient | null {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return null;
  cached ??= createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

/**
 * The caller's IP. Trustworthy on Vercel: the edge overwrites x-forwarded-for
 * and does not forward externally-supplied values.
 */
function clientIp(req: VercelRequest): string {
  const raw = req.headers['x-forwarded-for'] ?? req.headers['x-real-ip'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return (value ?? '').split(',')[0]?.trim() ?? '';
}

/** Truncated to 32 hex chars — collision-safe at our scale, and a smaller row. */
function hashIp(ip: string): string {
  return createHmac('sha256', SALT).update(ip).digest('hex').slice(0, 32);
}

/**
 * Record that `userId` was seen from this request's origin. Fire-and-await:
 * the endpoints this runs in front of are multi-second AI calls, so one indexed
 * upsert is noise, and awaiting means the write can't be dropped when the
 * serverless instance freezes after the response.
 */
export async function recordAccountIp(userId: string, req: VercelRequest): Promise<void> {
  try {
    if (!SALT) return; // no secret to key the HMAC with — collect nothing
    const ip = clientIp(req);
    if (!ip) return;
    const supabase = serviceClient();
    if (!supabase) return;
    const { error } = await supabase.rpc('record_account_ip', {
      p_user_id: userId,
      p_ip_hash: hashIp(ip),
    });
    // Migration not applied yet, table missing, database blip — all non-fatal.
    if (error) console.warn(`[signals] account ip not recorded: ${error.message}`);
  } catch (err) {
    console.warn('[signals] account ip not recorded:', err instanceof Error ? err.message : String(err));
  }
}
