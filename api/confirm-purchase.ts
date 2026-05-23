// POST /api/confirm-purchase
//
// Webhook called by the owner's Flutter SMS-watcher app when it detects a
// matching bKash transaction SMS on the owner's phone. The watcher extracts
// the transaction ID, the sender's bKash phone number, and the amount from
// the SMS, then POSTs them here. This endpoint authenticates the webhook
// via HMAC, then calls the `confirm_purchase` SECURITY DEFINER RPC using
// the Supabase service-role key (which bypasses the RLS column lockdown
// added in migration 005 + the EXECUTE revoke on the RPC).
//
// Request:  { transactionId: 'AB12CD34EF', senderMsisdn?: '01XXXXXXXXX', amountTaka?: 200 }
// Headers:  X-Bkash-Webhook-Signature: <hmac-sha256(rawBody, BKASH_WEBHOOK_SECRET) hex>
// Response: { success: true, userId: '<uuid>', creditsGranted: 5, newBalance: N }
//           OR for an already-confirmed replay:
//           { success: true, alreadyConfirmed: true, userId, creditsGranted }
//
// 401 if signature missing or invalid; 400 if body shape is wrong;
// 404 if no matching purchase row exists at all; 409 if msisdn doesn't match;
// 503 if SUPABASE_SERVICE_ROLE_KEY is not configured.
//
// SECURITY MODEL
// ==============
// - The Flutter app holds BKASH_WEBHOOK_SECRET (a random 32-byte string).
//   The same secret is set as a Vercel env var on the server.
// - The watcher computes HMAC-SHA256(rawBody, secret) and sends it in the
//   X-Bkash-Webhook-Signature header. We verify with timing-safe compare.
// - We disable Vercel's auto-JSON-parser and HMAC the exact UTF-8 bytes the
//   client sent. This eliminates any byte-exactness drift between Flutter's
//   `jsonEncode` and Node's `JSON.stringify` (insertion order, charset,
//   whitespace). The Flutter watcher's audit (see
//   `companion-app/WHAT_IT_DOES.md`) confirms it computes HMAC over the
//   string it then sends as the body — so verifying against the raw bytes
//   is the only sound approach.
// - On success we call the `confirm_purchase` RPC under the service-role
//   key — that key bypasses RLS and is the only identity that can EXECUTE
//   `confirm_purchase` per migration 005.
// - The endpoint is intentionally NOT user-callable. End-user JWTs are
//   ignored; only the webhook signature gates entry.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { createHmac, timingSafeEqual } from 'crypto';

// Vercel default behavior parses the JSON body before our handler runs,
// which loses the original byte sequence. We need the raw bytes to verify
// the HMAC, so disable auto-parse for this route.
export const config = {
  api: {
    bodyParser: false,
  },
};

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const BKASH_WEBHOOK_SECRET = process.env.BKASH_WEBHOOK_SECRET ?? '';

interface ConfirmBody {
  transactionId?: string;
  senderMsisdn?: string | null;
  amountTaka?: number;
}

async function readRawBody(req: VercelRequest): Promise<string> {
  // Preferred path: bodyParser was disabled (via `config` above), so the
  // request stream is fresh and we can HMAC the exact bytes the watcher
  // sent. This is the only way to be truly byte-exact across any future
  // change on either end.
  //
  // Fallback path: in some environments (notably `vercel dev` on
  // @vercel/node v5) the auto-parser may consume the stream before our
  // handler runs, leaving `req.body` populated and the stream exhausted.
  // In that case we re-serialize the parsed body. For Flutter's
  // `jsonEncode(map)` payloads — three string/number/null fields in a
  // fixed key order — Node's `JSON.parse → JSON.stringify` round-trip is
  // byte-equivalent (insertion order is preserved by both ends), so the
  // HMAC still verifies correctly. The Flutter agent's audit of
  // `lib/dispatch/webhook_client.dart` confirms this.
  if (typeof req.body === 'string') return req.body;
  if (req.body && typeof req.body === 'object') return JSON.stringify(req.body);
  const chunks: Buffer[] = [];
  for await (const chunk of req as AsyncIterable<Buffer | string>) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function verifySignature(rawBody: string, providedHex: string | undefined): boolean {
  if (!providedHex || !BKASH_WEBHOOK_SECRET) return false;
  const expected = createHmac('sha256', BKASH_WEBHOOK_SECRET).update(rawBody, 'utf8').digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(providedHex, 'hex');
  } catch {
    return false;
  }
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[confirm-purchase] SUPABASE_SERVICE_ROLE_KEY not configured');
    res.status(503).json({ error: 'Webhook is not configured on the server.' });
    return;
  }
  if (!BKASH_WEBHOOK_SECRET) {
    console.error('[confirm-purchase] BKASH_WEBHOOK_SECRET not configured');
    res.status(503).json({ error: 'Webhook is not configured on the server.' });
    return;
  }

  const rawBody = await readRawBody(req);
  const sigHeader = req.headers['x-bkash-webhook-signature'];
  const sig = Array.isArray(sigHeader) ? sigHeader[0] : sigHeader;

  if (!verifySignature(rawBody, sig)) {
    res.status(401).json({ error: 'Invalid or missing signature.' });
    return;
  }

  let body: ConfirmBody;
  try {
    body = rawBody ? (JSON.parse(rawBody) as ConfirmBody) : {};
  } catch {
    // Keep the literal token "transactionId" in this error string — the
    // Flutter Settings tab's "Test webhook" button regex-checks for it to
    // flash a green "URL and secret look correct" indicator.
    res.status(400).json({ error: 'transactionId is required (body must be valid JSON).' });
    return;
  }

  const { transactionId, senderMsisdn } = body;
  if (!transactionId || typeof transactionId !== 'string' || transactionId.trim().length < 6) {
    // Keep the literal token "transactionId" in this error string — the
    // Flutter Settings tab's "Test webhook" button regex-checks for it to
    // flash a green "URL and secret look correct" indicator.
    res.status(400).json({ error: 'transactionId is required (min 6 chars).' });
    return;
  }

  const txn = transactionId.trim();
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await admin.rpc('confirm_purchase', {
    p_transaction_id: txn,
    p_observed_sender_msisdn: senderMsisdn?.trim() || null,
  });

  if (error) {
    const msg = error.message ?? '';
    if (msg.includes('no_pending_purchase')) {
      // The RPC filters by `status = 'pending'`, so an already-completed
      // replay surfaces here too. Disambiguate: if a `completed` row exists
      // for this TrxID, return 200 so the watcher marks it done instead of
      // hammering this endpoint every 5 min for the next 24 h. If nothing
      // exists at all, return 404 so the watcher waits for the user to
      // submit on the web side.
      const { data: completed } = await admin
        .from('purchases')
        .select('user_id, credits_granted')
        .eq('payment_reference', txn)
        .eq('status', 'completed')
        .maybeSingle();
      if (completed) {
        res.status(200).json({
          success: true,
          alreadyConfirmed: true,
          userId: completed.user_id,
          creditsGranted: completed.credits_granted,
        });
        return;
      }
      res.status(404).json({
        error: 'No pending purchase matches that transaction ID.',
        code: 'no_pending_purchase',
      });
      return;
    }
    if (msg.includes('msisdn_mismatch')) {
      res.status(409).json({
        error: 'Sender phone number does not match the pending purchase.',
        code: 'msisdn_mismatch',
      });
      return;
    }
    console.error('[confirm-purchase] confirm_purchase RPC failed:', msg);
    res.status(500).json({ error: 'Could not confirm purchase. Please retry.' });
    return;
  }

  // The RPC returns a single row table { user_id, new_balance, credits_granted }.
  const row = Array.isArray(data) ? data[0] : data;
  res.status(200).json({
    success: true,
    userId: row?.user_id,
    creditsGranted: row?.credits_granted,
    newBalance: row?.new_balance,
  });
}
