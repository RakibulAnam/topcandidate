// Verifies a Supabase JWT from the Authorization header and returns the
// userId. Used by every /api/* endpoint to ensure only authenticated users
// can call AI providers (so we don't burn quota on unauthenticated abuse).

import { createClient } from '@supabase/supabase-js';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '';
// Anon key is fine for verifying user JWTs (getUser does not need elevated privileges).
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? '';

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('[auth] Missing Supabase env vars (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)');
}

// Singleton — Vercel functions warm-start across invocations and reuse this.
const adminClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export interface AuthContext {
  userId: string;
  jwt: string;
}

/**
 * Verify the bearer token. On success returns AuthContext; on failure writes
 * 401 to res and returns null. Callers should bail when null is returned.
 */
export async function authenticate(
  req: VercelRequest,
  res: VercelResponse
): Promise<AuthContext | null> {
  const header = req.headers.authorization || req.headers.Authorization;
  const token = typeof header === 'string' && header.startsWith('Bearer ')
    ? header.slice('Bearer '.length).trim()
    : null;

  if (!token) {
    res.status(401).json({ error: 'Missing Authorization bearer token' });
    return null;
  }

  const { data, error } = await adminClient.auth.getUser(token);
  if (error || !data?.user) {
    res.status(401).json({ error: 'Invalid or expired token' });
    return null;
  }

  return { userId: data.user.id, jwt: token };
}

/**
 * Build a Supabase client that carries the user's JWT — RLS policies see
 * `auth.uid() = <userId>` so we can write to user-owned tables (like
 * ai_call_log) under that user's identity, no service role needed.
 */
export function userClient(jwt: string) {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
