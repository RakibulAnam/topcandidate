// GET /api/purchase-ops/verify-txn?txnId=<bkash TrxID>
//
// Customer-facing diagnosis for "why is my purchase still pending?". Called by
// PurchaseModal when its in-modal verification window elapses without the
// purchase settling, so the modal can say something specific instead of
// closing behind a navbar spinner that turns for 24h.
//
// Thin wrapper over the `diagnose_pending_purchase` RPC (migration 028) —
// every decision lives in the DB so the ownership check (auth.uid()) and the
// privacy rules sit in one place. Auth required.
//
// Response: {
//   verdict, status, amountTaka, observedAmountTaka, ageSeconds, attempts,
//   near: { amountTaka, msisdnMasked, similar, msisdnMatch } | null,
//   watcher: { lastSeenAt, live } , message
// }
//
// verdict values:
//   'completed' | 'underpaid' | 'msisdn_mismatch_review' | 'expired'
//   | 'refunded' | 'failed'  — already settled; render that state
//   'likely_typo'   — an unclaimed verified payment resembles what they typed,
//                     or came from the number they gave us
//   'awaiting_sms'  — too early to conclude (or heartbeats not wired up yet)
//   'watcher_stale' — the operator's phone hasn't checked in; our problem
//   'nothing_found' — watcher live, grace period passed, nothing matches
//
// NOTE: the RPC deliberately never returns the payment_reference of an
// unclaimed payment — see the privacy/fraud note in migration 028. Don't add
// it here either.
//
// 401 missing/invalid auth; 400 missing txnId; 404 no such purchase for this
// caller (same response whether it's absent or someone else's).

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authenticate, userClient } from '../../_lib/auth.js';

interface DiagnoseRow {
  verdict: string;
  purchase_status: string;
  amount_taka: number;
  observed_amount: number | null;
  age_seconds: number;
  near_amount_taka: number | null;
  near_msisdn_masked: string | null;
  near_similar: boolean;
  near_msisdn_match: boolean;
  watcher_last_seen: string | null;
  watcher_live: boolean | null;
  attempts_24h: number;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const auth = await authenticate(req, res);
  if (!auth) return;

  const raw = req.query.txnId;
  const txn = (Array.isArray(raw) ? raw[0] : raw)?.toString().trim();
  if (!txn || txn.length < 6) {
    res.status(400).json({ error: 'txnId is required (min 6 chars).' });
    return;
  }

  const supabase = userClient(auth.jwt);
  const { data, error } = await supabase.rpc('diagnose_pending_purchase', {
    p_transaction_id: txn,
  });

  if (error) {
    const msg = error.message ?? '';
    if (msg.includes('purchase_not_found')) {
      res.status(404).json({ error: 'No purchase found for that TrxID.', code: 'purchase_not_found' });
      return;
    }
    if (msg.includes('invalid_transaction_id')) {
      res.status(400).json({ error: 'A valid bKash transaction ID is required.', code: 'invalid_transaction_id' });
      return;
    }
    console.error('[verify-txn] diagnose_pending_purchase RPC failed:', msg);
    res.status(500).json({ error: 'Verification check failed. Please try again.' });
    return;
  }

  const row = (Array.isArray(data) ? data[0] : data) as DiagnoseRow | undefined;
  if (!row) {
    res.status(404).json({ error: 'No purchase found for that TrxID.', code: 'purchase_not_found' });
    return;
  }

  const near =
    row.near_amount_taka != null
      ? {
          amountTaka: row.near_amount_taka,
          msisdnMasked: row.near_msisdn_masked,
          similar: row.near_similar,
          msisdnMatch: row.near_msisdn_match,
        }
      : null;

  res.status(200).json({
    verdict: row.verdict,
    status: row.purchase_status,
    amountTaka: row.amount_taka,
    observedAmountTaka: row.observed_amount,
    ageSeconds: row.age_seconds,
    attempts: row.attempts_24h,
    near,
    watcher: { lastSeenAt: row.watcher_last_seen, live: row.watcher_live },
    // Copy is localised client-side (en/bn); this is a non-localised fallback
    // for logs and any non-UI consumer.
    message: fallbackMessage(row),
  });
}

function fallbackMessage(row: DiagnoseRow): string {
  switch (row.verdict) {
    case 'likely_typo':
      return row.near_msisdn_match
        ? `We received ৳${row.near_amount_taka} from the number you gave us, but the TrxID doesn't match. Check the ID against your bKash SMS.`
        : `We received a ৳${row.near_amount_taka} payment that doesn't match the TrxID you entered. Check the ID against your bKash SMS.`;
    case 'awaiting_sms':
      return 'Recorded. Verifying the transaction — usually under a minute.';
    case 'watcher_stale':
      return 'Verification is running behind on our side. Your payment is recorded and will be credited.';
    case 'nothing_found':
      return "We haven't received a bKash payment for this TrxID yet.";
    default:
      return '';
  }
}
