// POST /api/admin/match-orphan
//
// Operator manually links an orphan SMS (one the watcher couldn't match)
// to a pending purchase row. Implements case #13. Internally calls
// apply_purchase_topup so the amount aggregates and the audit log is
// consistent with multi-SMS flows (case #14).
//
// Request:  { smsId, purchaseId, reason }
// Headers:  X-Admin-Key

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin, adminSupabase, requireReason } from './_lib/adminAuth.js';

interface Body {
  smsId?: string;
  purchaseId?: string;
  reason?: string;
}

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

  const { smsId, purchaseId } = (req.body ?? {}) as Body;
  if (!smsId || !purchaseId) {
    res.status(400).json({ error: 'smsId and purchaseId are required.' });
    return;
  }
  const reason = requireReason(req.body, res);
  if (reason === null) return;

  const { data: sms, error: smsErr } = await supabase
    .from('unmatched_inbound_sms')
    .select('id, payment_reference, sender_msisdn, amount_taka, matched_to_purchase_id')
    .eq('id', smsId)
    .maybeSingle();
  if (smsErr || !sms) {
    res.status(404).json({ error: 'Orphan SMS not found.' });
    return;
  }
  if (sms.matched_to_purchase_id) {
    res.status(409).json({ error: 'This SMS has already been matched.', code: 'already_matched' });
    return;
  }

  const { data, error } = await supabase.rpc('apply_purchase_topup', {
    p_purchase_id: purchaseId,
    p_payment_ref: sms.payment_reference,
    p_sender_msisdn: sms.sender_msisdn,
    p_amount_taka: sms.amount_taka,
    p_actor: 'operator',
    p_reason: `match-orphan smsId=${smsId} ${reason}`,
  });

  if (error) {
    const msg = error.message ?? '';
    if (msg.includes('purchase_not_found')) {
      res.status(404).json({ error: 'Target purchase not found.', code: 'purchase_not_found' });
      return;
    }
    if (msg.includes('purchase_not_topup_eligible')) {
      res.status(409).json({
        error: 'Target purchase is not in a state that accepts top-ups.',
        code: 'purchase_not_topup_eligible',
      });
      return;
    }
    console.error('[admin/match-orphan] RPC failed:', msg);
    res.status(500).json({ error: 'Match failed. See server logs.' });
    return;
  }

  // Mark the SMS as matched so it disappears from the orphan list.
  await supabase
    .from('unmatched_inbound_sms')
    .update({ matched_to_purchase_id: purchaseId })
    .eq('id', smsId);

  const row = Array.isArray(data) ? data[0] : data;
  res.status(200).json({
    success: true,
    status: row?.status_out,
    observedTotal: row?.observed_total,
    newBalance: row?.new_balance,
  });
}
