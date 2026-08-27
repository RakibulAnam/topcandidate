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
// HEARTBEAT MODE (migration 028)
// ==============================
// The same endpoint, same secret, same signature scheme, accepts a liveness
// ping that carries no transaction:
//   Request:  { kind: 'heartbeat', deviceId: '<stable-id>', appVersion?, queueDepth? }
//   Response: { success: true, heartbeat: true }
// It exists so the customer-facing diagnosis (`diagnose_pending_purchase`, via
// /api/purchase-ops/verify-txn) can tell "we haven't seen your bKash SMS
// because your TrxID is wrong" from "...because the operator's phone is
// offline". Without it those are indistinguishable and we would end up
// accusing paying customers of typos during our own outages.
//
// Folded into this function rather than given its own file because the Vercel
// Hobby plan caps a deployment at 12 Serverless Functions and we are at that
// cap. Replay protection is unchanged: the v2 signature covers a timestamp, so
// each ping produces a distinct nonce.
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
//   `../../apps/mobile/WHAT_IT_DOES.md`) confirms it computes HMAC over the
//   string it then sends as the body — so verifying against the raw bytes
//   is the only sound approach. Canonical contract:
//   `../../docs/contracts/webhook-confirm-purchase.md`.
// - On success we call the `confirm_purchase` RPC under the service-role
//   key — that key bypasses RLS and is the only identity that can EXECUTE
//   `confirm_purchase` per migration 005.
// - The endpoint is intentionally NOT user-callable. End-user JWTs are
//   ignored; only the webhook signature gates entry.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import {
  readRawBody,
  verifyWebhook,
  webhookSecretConfigured,
  getServiceRoleClient,
} from './_lib/webhookAuth.js';

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

interface ConfirmBody {
  transactionId?: string;
  senderMsisdn?: string | null;
  amountTaka?: number;
  /** 'heartbeat' switches this endpoint into liveness-ping mode (migration 028). */
  kind?: string;
  deviceId?: string;
  appVersion?: string;
  queueDepth?: number;
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
  if (!webhookSecretConfigured()) {
    console.error('[confirm-purchase] BKASH_WEBHOOK_SECRET not configured');
    res.status(503).json({ error: 'Webhook is not configured on the server.' });
    return;
  }

  const rawBody = await readRawBody(req);
  const verification = await verifyWebhook(req, rawBody, getServiceRoleClient());
  if (!verification.ok) {
    console.warn(`[confirm-purchase] verification failed: ${verification.reason}`);
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

  // ── Heartbeat mode ───────────────────────────────────────────────────────
  // Deliberately placed after signature verification (an unsigned caller can
  // never write liveness) and before the transactionId validation below, whose
  // error string is contract-bound to the Flutter "Test webhook" button.
  if (body.kind === 'heartbeat') {
    const deviceId = typeof body.deviceId === 'string' ? body.deviceId.trim() : '';
    if (!deviceId) {
      res.status(400).json({ error: 'deviceId is required for a heartbeat.' });
      return;
    }
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: hbErr } = await admin.rpc('record_watcher_heartbeat', {
      p_device_id: deviceId.slice(0, 128),
      p_app_version: typeof body.appVersion === 'string' ? body.appVersion.slice(0, 40) : null,
      p_queue_depth:
        typeof body.queueDepth === 'number' && Number.isFinite(body.queueDepth)
          ? Math.max(0, Math.floor(body.queueDepth))
          : null,
    });
    if (hbErr) {
      // Never fail the watcher's loop over telemetry. It will ping again.
      console.warn('[confirm-purchase] record_watcher_heartbeat failed:', hbErr.message);
    }
    res.status(200).json({ success: true, heartbeat: true });
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
  const { amountTaka } = body;
  // Amount must be a positive integer Taka if provided. Watcher floors decimals.
  const observedAmount =
    typeof amountTaka === 'number' && Number.isFinite(amountTaka) && amountTaka > 0
      ? Math.floor(amountTaka)
      : null;

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // P0-A defense-in-depth (revenue leak, 2026-05-17): the DB-level confirm_purchase
  // (migration 007) compares observed vs expected and refuses under-payments,
  // but we ALSO check here so deployments that haven't applied 007 yet still
  // fail closed. If the row's amount_taka > observedAmount, return 409 underpaid
  // before the RPC. The watcher treats 409 as terminal `mismatch` and notifies
  // the operator, who recovers via /api/admin/confirm-purchase.
  if (observedAmount !== null) {
    const { data: pending } = await admin
      .from('purchases')
      .select('id, amount_taka, status')
      .eq('payment_reference', txn)
      .in('status', ['pending', 'underpaid'])
      .maybeSingle();
    if (pending && observedAmount < pending.amount_taka) {
      // Surface the underpayment to the DB layer so the row flips to
      // 'underpaid' and the audit row is written. Use a service-role update
      // here rather than letting confirm_purchase raise — keeps the response
      // shape consistent.
      await admin
        .from('purchases')
        .update({ status: 'underpaid', observed_amount_taka: observedAmount })
        .eq('id', pending.id);
      await admin.from('purchase_state_changes').insert({
        purchase_id: pending.id,
        from_status: pending.status,
        to_status: 'underpaid',
        actor: 'flutter',
        reason: `observed=${observedAmount} expected=${pending.amount_taka}`,
      });
      res.status(409).json({
        error: `Observed amount ${observedAmount} is less than required ${pending.amount_taka}.`,
        code: 'underpaid',
        expected: pending.amount_taka,
        observed: observedAmount,
      });
      return;
    }
  }

  const { data, error } = await admin.rpc('confirm_purchase', {
    p_transaction_id: txn,
    p_observed_sender_msisdn: senderMsisdn?.trim() || null,
    p_observed_amount_taka: observedAmount,
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
      // Genuine 404 — the SMS reached us before the customer submitted their
      // TrxID. Remember this HMAC-verified SMS so the next /api/purchase submit
      // can match it instantly (match-on-submit, migration 012) instead of the
      // customer waiting for the watcher's next retry. Best-effort; only when
      // we know the amount (record_inbound_payment requires a positive amount).
      if (observedAmount !== null) {
        const { error: recErr } = await admin.rpc('record_inbound_payment', {
          p_payment_reference: txn,
          p_sender_msisdn: senderMsisdn?.trim() || null,
          p_amount_taka: observedAmount,
        });
        if (recErr) {
          console.warn('[confirm-purchase] record_inbound_payment failed:', recErr.message);
        }
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
    if (msg.includes('underpaid')) {
      // confirm_purchase v2 (migration 007) raises this when observed <
      // expected. The watcher treats 409 as terminal so it stops retrying;
      // the operator recovers via the admin panel.
      res.status(409).json({
        error: 'Amount sent is less than required for this package.',
        code: 'underpaid',
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
