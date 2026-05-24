// GET /api/my-purchase-status?txnId=<bkash TrxID>
//
// Customer-facing. Looks up the caller's purchase row and returns a derived
// state for the VerifyingPurchasePill in the navbar. Auth required.
//
// Response: { status, amountTaka, observedAmountTaka?, expected?, missing?, message }
//
// Possible status values:
//   'pending'                — submitted, waiting for SMS
//   'completed'              — credits granted
//   'underpaid'              — observed < expected; missing = amount still owed
//   'msisdn_mismatch_review' — operator review
//   'expired'                — TTL expired (24h, no payment seen)
//   'refunded'               — operator/Flutter flipped it back
//   'failed'                 — explicit failure
//
// 401 missing/invalid auth; 400 missing txnId; 404 no row for this user.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authenticate, userClient } from './_lib/auth.js';

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
  const { data, error } = await supabase
    .from('purchases')
    .select('status, amount_taka, observed_amount_taka, credits_granted, created_at')
    .eq('payment_reference', txn)
    .maybeSingle();

  if (error) {
    console.error('[my-purchase-status] query failed:', error.message);
    res.status(500).json({ error: 'Query failed.' });
    return;
  }
  if (!data) {
    res.status(404).json({ error: 'No purchase found for that TrxID.' });
    return;
  }

  const expected = data.amount_taka;
  const observed = data.observed_amount_taka;
  const missing = data.status === 'underpaid' && observed != null ? expected - observed : null;

  let message: string;
  switch (data.status) {
    case 'pending':
      message = 'Verifying your bKash payment…';
      break;
    case 'completed':
      message = `${data.credits_granted} credits added.`;
      break;
    case 'underpaid':
      message =
        missing != null && missing > 0
          ? `We received ৳${observed} but the pack costs ৳${expected}. Send the missing ৳${missing} referencing this TrxID, or contact support.`
          : `Underpaid — contact support.`;
      break;
    case 'msisdn_mismatch_review':
      message = 'Your payment is under review (sender phone didn’t match). Contact support if this delays.';
      break;
    case 'expired':
      message = 'We never saw a bKash payment for this TrxID within 24h. If you paid, contact support.';
      break;
    case 'refunded':
      message = 'This purchase was refunded.';
      break;
    case 'failed':
      message = 'This purchase failed. Contact support.';
      break;
    default:
      message = '';
  }

  res.status(200).json({
    status: data.status,
    amountTaka: expected,
    observedAmountTaka: observed,
    missing,
    message,
  });
}
