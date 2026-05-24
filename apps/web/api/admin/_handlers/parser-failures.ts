// /api/admin/parser-failures
//
// Dual-mode endpoint:
//   - POST (HMAC-gated)  — Flutter watcher dumps an SMS it couldn't classify.
//                          Stored for operator review (case #19).
//   - GET  (Admin-key)   — operator lists recent parser failures.
//
// We piggyback on the existing unmatched_inbound_sms table with a sentinel
// payment_reference prefix (PARSE_FAIL_<sha8>) so we don't add a new table
// just for this — keeps the schema small. raw_body holds the SMS verbatim.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'crypto';
import {
  readRawBody,
  verifyBkashSignature,
  webhookSecretConfigured,
  getSignatureHeader,
} from '../_lib/webhookAuth.js';
import { requireAdmin, adminSupabase } from './_lib/adminAuth.js';

export const config = { api: { bodyParser: false } };

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'GET') {
    if (!requireAdmin(req, res)) return;
    const supabase = adminSupabase();
    if (!supabase) {
      res.status(503).json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured.' });
      return;
    }
    const { data, error } = await supabase
      .from('unmatched_inbound_sms')
      .select('id, payment_reference, sender_msisdn, raw_body, sms_timestamp, created_at')
      .like('payment_reference', 'PARSE_FAIL_%')
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) {
      console.error('[admin/parser-failures GET] failed:', error.message);
      res.status(500).json({ error: 'Query failed.' });
      return;
    }
    res.status(200).json({ rows: data ?? [] });
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // POST = HMAC-gated watcher dump.
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !webhookSecretConfigured()) {
    res.status(503).json({ error: 'Webhook is not configured on the server.' });
    return;
  }

  const raw = await readRawBody(req);
  if (!verifyBkashSignature(raw, getSignatureHeader(req))) {
    res.status(401).json({ error: 'Invalid or missing signature.' });
    return;
  }

  let body: { rawBody?: string; senderMsisdn?: string; smsTimestamp?: string; reason?: string };
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    res.status(400).json({ error: 'Body must be valid JSON.' });
    return;
  }
  if (!body.rawBody || typeof body.rawBody !== 'string') {
    res.status(400).json({ error: 'rawBody is required.' });
    return;
  }
  const ts = body.smsTimestamp ? new Date(body.smsTimestamp) : new Date();

  // Synthetic primary key: PARSE_FAIL_<8-char sha256> — stable for the same
  // body so the watcher's retry-on-network-failure doesn't double-insert.
  const sha = createHash('sha256').update(body.rawBody, 'utf8').digest('hex').slice(0, 8);
  const syntheticRef = `PARSE_FAIL_${sha}`;

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await admin.rpc('record_orphan_sms', {
    p_payment_reference: syntheticRef,
    p_sender_msisdn: body.senderMsisdn?.trim() || null,
    p_amount_taka: 0, // parser failure → unknown
    p_raw_body: body.rawBody.slice(0, 2000),
    p_sms_timestamp: ts.toISOString(),
  });

  if (error) {
    console.error('[admin/parser-failures POST] RPC failed:', error.message);
    res.status(500).json({ error: 'Could not record parser failure.' });
    return;
  }

  res.status(200).json({ success: true, id: data });
}
