// POST /api/purchase
//
// User clicks "Buy" → enters bKash transaction ID after sending payment to
// the owner's bKash number → this endpoint records a PENDING purchase.
// Credits are NOT granted here. Confirmation happens out-of-band when the
// owner's Flutter app reads the bKash SMS and calls /api/confirm-purchase.
//
// Request:  { packageId: 'five-pack', transactionId: 'AB12CD34EF', senderMsisdn?: '01XXXXXXXXX' }
// Response: { success: true, purchaseId: '<uuid>', status: 'pending', message: '...' }
//
// 401 if not authenticated; 400 if packageId or transactionId is invalid;
// 409 if the transactionId has already been submitted; 429 if user has
// >= 5 pending purchases in the last 24h.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authenticate, userClient } from './_lib/auth.js';

interface PurchaseBody {
  packageId?: string;
  transactionId?: string;
  senderMsisdn?: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const auth = await authenticate(req, res);
  if (!auth) return;

  const { packageId, transactionId, senderMsisdn } = (req.body ?? {}) as PurchaseBody;

  if (!packageId || typeof packageId !== 'string') {
    res.status(400).json({ error: 'Missing packageId' });
    return;
  }
  if (!transactionId || typeof transactionId !== 'string' || transactionId.trim().length < 6) {
    res.status(400).json({
      error: 'A valid bKash transaction ID is required (at least 6 characters).',
      code: 'invalid_transaction_id',
    });
    return;
  }

  const supabase = userClient(auth.jwt);
  const { data: purchaseId, error } = await supabase.rpc('initiate_purchase', {
    p_package_id: packageId,
    p_transaction_id: transactionId.trim(),
    p_sender_msisdn: senderMsisdn?.trim() || null,
  });

  if (error) {
    // Map known error names to status codes; everything else is 500.
    const msg = error.message ?? '';
    if (msg.includes('unknown_package_id')) {
      res.status(400).json({ error: 'Unknown package.', code: 'unknown_package_id' });
      return;
    }
    if (msg.includes('invalid_transaction_id')) {
      res.status(400).json({
        error: 'A valid bKash transaction ID is required.',
        code: 'invalid_transaction_id',
      });
      return;
    }
    if (msg.includes('duplicate_transaction_id')) {
      res.status(409).json({
        error: 'That bKash transaction ID has already been submitted.',
        code: 'duplicate_transaction_id',
      });
      return;
    }
    if (msg.includes('too_many_pending')) {
      res.status(429).json({
        error: 'Too many pending purchases. Please wait for confirmation or contact support.',
        code: 'too_many_pending',
      });
      return;
    }
    console.error('[purchase] initiate_purchase RPC failed:', msg);
    res.status(500).json({ error: 'Purchase could not be recorded. Please try again.' });
    return;
  }

  res.status(200).json({
    success: true,
    purchaseId,
    status: 'pending',
    message: 'Payment recorded. We\'ll verify your bKash transaction and credit your account within a few minutes.',
  });
}
