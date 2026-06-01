// POST /api/orphan-inbound-sms
//
// HMAC-gated. The Flutter watcher POSTs here for SMS it couldn't match to a
// pending row after its 24h retry window expired. Operator reconciles via
// the /admin Orphans tab (case #2, #5).
//
// Request:  { transactionId, senderMsisdn?, amountTaka, rawBody, smsTimestamp }
//             smsTimestamp = ISO 8601, comes from the Android delivery time.
// Headers:  X-Bkash-Webhook-Signature: <hmac>
// Response: { success: true, id }

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import {
  readRawBody,
  verifyWebhook,
  webhookSecretConfigured,
  getServiceRoleClient,
} from './_lib/webhookAuth.js';

export const config = { api: { bodyParser: false } };

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

interface Body {
  transactionId?: string;
  senderMsisdn?: string | null;
  amountTaka?: number;
  rawBody?: string;
  smsTimestamp?: string;
}

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
  const verification = await verifyWebhook(req, raw, getServiceRoleClient());
  if (!verification.ok) {
    console.warn(`[orphan-inbound-sms] verification failed: ${verification.reason}`);
    res.status(401).json({ error: 'Invalid or missing signature.' });
    return;
  }

  let body: Body;
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    res.status(400).json({ error: 'Body must be valid JSON.' });
    return;
  }

  const txn = body.transactionId?.trim();
  const amount =
    typeof body.amountTaka === 'number' && Number.isFinite(body.amountTaka) && body.amountTaka > 0
      ? Math.floor(body.amountTaka)
      : null;
  const ts = body.smsTimestamp ? new Date(body.smsTimestamp) : null;
  if (!txn || txn.length < 6 || amount === null || !ts || Number.isNaN(ts.getTime())) {
    res.status(400).json({ error: 'transactionId, amountTaka and smsTimestamp are required.' });
    return;
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await admin.rpc('record_orphan_sms', {
    p_payment_reference: txn,
    p_sender_msisdn: body.senderMsisdn?.trim() || null,
    p_amount_taka: amount,
    p_raw_body: typeof body.rawBody === 'string' ? body.rawBody.slice(0, 2000) : null,
    p_sms_timestamp: ts.toISOString(),
  });

  if (error) {
    console.error('[orphan-inbound-sms] RPC failed:', error.message);
    res.status(500).json({ error: 'Could not record orphan SMS.' });
    return;
  }

  res.status(200).json({ success: true, id: data });
}
