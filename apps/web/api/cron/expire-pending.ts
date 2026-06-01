// GET /api/cron/expire-pending
//
// Calls expire_stale_pending_purchases() — flips pending rows older than 24h
// to 'expired' and writes audit rows. Idempotent.
//
// Auth: CRON_SECRET in the `Authorization: Bearer <secret>` header.
// Vercel Cron sends this header automatically when CRON_SECRET is set as an
// env var. Manual triggers must also use the header — query-string secrets
// leak via browser history, referer headers, and server access logs, so the
// `?secret=` fallback was removed (2026-05-30 audit, C4).
//
// Cadence: NOT scheduled by Vercel in this repo — vercel.json has no `crons`
// block. Run on a schedule via Supabase pg_cron (supabase/migrations/
// 007_optional_pg_cron.sql) or trigger manually from the admin Settings tab.
// To use Vercel Cron, add a `crons` entry to vercel.json (Hobby allows 1/day).

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { timingSafeEqual } from 'crypto';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CRON_SECRET = process.env.CRON_SECRET ?? '';

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!CRON_SECRET) {
    res.status(503).json({ error: 'CRON_SECRET not configured.' });
    return;
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    res.status(503).json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured.' });
    return;
  }

  const header = req.headers.authorization;
  const bearer = typeof header === 'string' && header.startsWith('Bearer ')
    ? header.slice('Bearer '.length).trim()
    : null;
  if (!bearer || !safeEqual(bearer, CRON_SECRET)) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await admin.rpc('expire_stale_pending_purchases');
  if (error) {
    console.error('[cron/expire-pending] RPC failed:', error.message);
    res.status(500).json({ error: 'Cron expiry failed.' });
    return;
  }

  console.info(`[cron/expire-pending] expired=${data ?? 0}`);
  res.status(200).json({ expired: data ?? 0 });
}
