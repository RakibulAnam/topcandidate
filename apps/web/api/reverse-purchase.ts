// POST /api/reverse-purchase
//
// HMAC-gated. The Flutter watcher classifies a bKash reversal SMS and posts
// here. Implements case #7. The endpoint flips the matching completed row
// to 'refunded' and decrements credits (may go negative — see case #8;
// /api/optimize already blocks on balance ≤ 0).
//
// Request:  { transactionId, reason? }
// Headers:  X-Bkash-Webhook-Signature

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import {
  readRawBody,
  verifyBkashSignature,
  webhookSecretConfigured,
  getSignatureHeader,
} from './_lib/webhookAuth.js';

export const config = { api: { bodyParser: false } };

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !webhookSecretConfigured()) {
    res.status(503).json({ error: 'Webhook is not configured on the server.' });
    return;
  }

  const raw = await readRawBody(req);
  if (!verifyBkashSignature(raw, getSignatureHeader(req))) {
    res.status(401).json({ error: 'Invalid or missing signature.' });
    return;
  }

  let body: { transactionId?: string; reason?: string };
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    res.status(400).json({ error: 'Body must be valid JSON.' });
    return;
  }

  const txn = body.transactionId?.trim();
  if (!txn || txn.length < 6) {
    res.status(400).json({ error: 'transactionId is required (min 6 chars).' });
    return;
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await admin.rpc('record_purchase_reversal', {
    p_transaction_id: txn,
    p_reason: body.reason ?? null,
  });

  if (error) {
    const msg = error.message ?? '';
    if (msg.includes('no_completed_purchase')) {
      res.status(404).json({ error: 'No completed purchase matches that TrxID.', code: 'no_completed_purchase' });
      return;
    }
    console.error('[reverse-purchase] RPC failed:', msg);
    res.status(500).json({ error: 'Could not record reversal.' });
    return;
  }

  const row = Array.isArray(data) ? data[0] : data;
  res.status(200).json({ success: true, userId: row?.user_id, newBalance: row?.new_balance });
}
