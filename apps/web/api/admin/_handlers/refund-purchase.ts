// POST /api/admin/refund-purchase
//
// Operator manual refund (case #12). Flips a completed row to 'refunded' and
// decrements credits. Balance may go negative — paid endpoints already gate
// on balance > 0, which is the correct UX (case #8).
//
// Request:  { transactionId, reason }
// Headers:  X-Admin-Key

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin, adminSupabase, requireReason } from './_lib/adminAuth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!requireAdmin(req, res)) return;

  const supabase = adminSupabase();
  if (!supabase) {
    res.status(503).json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured.' });
    return;
  }

  const { transactionId } = (req.body ?? {}) as { transactionId?: string };
  if (!transactionId || typeof transactionId !== 'string' || transactionId.trim().length < 6) {
    res.status(400).json({ error: 'transactionId is required (min 6 chars).' });
    return;
  }
  const reason = requireReason(req.body, res);
  if (reason === null) return;

  const { data, error } = await supabase.rpc('operator_refund_purchase', {
    p_transaction_id: transactionId.trim(),
    p_reason: reason,
  });

  if (error) {
    const msg = error.message ?? '';
    if (msg.includes('not_refundable')) {
      res.status(404).json({ error: 'No completed purchase matches that TrxID.', code: 'not_refundable' });
      return;
    }
    console.error('[admin/refund-purchase] RPC failed:', msg);
    res.status(500).json({ error: 'Refund failed. See server logs.' });
    return;
  }

  const row = Array.isArray(data) ? data[0] : data;
  res.status(200).json({
    success: true,
    userId: row?.user_id,
    newBalance: row?.new_balance,
  });
}
