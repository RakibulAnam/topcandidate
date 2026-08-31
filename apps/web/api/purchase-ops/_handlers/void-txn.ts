// POST /api/purchase-ops/void-txn   { transactionId: 'AB12CD34EF' }
//
// "Edit & resubmit" after a mistyped bKash TrxID. Retires the caller's own
// PENDING purchase row so the corrected submit doesn't burn another slot in
// the 5-pending-per-24h cap enforced by `initiate_purchase`.
//
// Thin wrapper over the `void_pending_purchase` RPC (migration 028), which
// scopes the update to `user_id = auth.uid() and status = 'pending'` and
// writes the `purchase_state_changes` audit row. Auth required.
//
// The mistyped payment_reference stays taken (unique index) on the voided
// row — intentional: it keeps the audit trail, and the corrected ID differs.
//
// Response: { success: true }
// 401 missing/invalid auth; 400 bad body; 409 nothing voidable (absent,
// someone else's, or already settled — deliberately indistinguishable).

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authenticate, userClient } from '../../_lib/auth.js';

interface Body {
  transactionId?: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const auth = await authenticate(req, res);
  if (!auth) return;

  const { transactionId } = (req.body ?? {}) as Body;
  if (!transactionId || typeof transactionId !== 'string' || transactionId.trim().length < 6) {
    res.status(400).json({ error: 'transactionId is required (min 6 chars).' });
    return;
  }

  const supabase = userClient(auth.jwt);
  const { error } = await supabase.rpc('void_pending_purchase', {
    p_transaction_id: transactionId.trim(),
  });

  if (error) {
    const msg = error.message ?? '';
    if (msg.includes('no_voidable_purchase')) {
      res.status(409).json({
        error: 'That transaction is no longer pending.',
        code: 'no_voidable_purchase',
      });
      return;
    }
    console.error('[void-txn] void_pending_purchase RPC failed:', msg);
    res.status(500).json({ error: 'Could not cancel that submission. Please try again.' });
    return;
  }

  res.status(200).json({ success: true });
}
