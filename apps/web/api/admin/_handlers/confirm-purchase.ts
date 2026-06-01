// POST /api/admin/confirm-purchase
//
// P0-B recovery path (2026-05-17 incident: watcher crashed mid-transaction,
// pending row sat indefinitely, only recovery was raw curl with the bKash
// webhook secret). This endpoint is the operator's safety net for every
// future watcher failure, parser drift, sender-ID change, or carrier oddity.
//
// Request:  { transactionId, observedMsisdn?, overrideMsisdnCheck?, overrideAmountCheck?, reason }
// Headers:  X-Admin-Key: <ADMIN_API_KEY>
// Response: { success: true, userId, creditsGranted, newBalance }
//
// 401 bad/missing admin key; 400 missing fields; 404 no matching row;
// 503 server not configured.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin, adminSupabase, requireReason, recordAuditAction } from '../_lib/adminAuth.js';

interface Body {
  transactionId?: string;
  observedMsisdn?: string;
  overrideMsisdnCheck?: boolean;
  overrideAmountCheck?: boolean;
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

  const { transactionId, overrideMsisdnCheck, overrideAmountCheck } = (req.body ?? {}) as Body;
  if (!transactionId || typeof transactionId !== 'string' || transactionId.trim().length < 6) {
    res.status(400).json({ error: 'transactionId is required (min 6 chars).' });
    return;
  }
  const reason = requireReason(req.body, res);
  if (reason === null) return;

  // Snapshot the purchase row before the RPC for the audit diff.
  const { data: before } = await supabase
    .from('purchases')
    .select('id, status, observed_amount_taka, amount_taka, user_id')
    .eq('payment_reference', transactionId.trim())
    .maybeSingle();

  const { data, error } = await supabase.rpc('operator_confirm_purchase', {
    p_transaction_id: transactionId.trim(),
    p_override_msisdn_check: !!overrideMsisdnCheck,
    p_override_amount_check: !!overrideAmountCheck,
    p_reason: reason,
  });

  if (error) {
    const msg = error.message ?? '';
    if (msg.includes('no_pending_purchase')) {
      res.status(404).json({ error: 'No matching purchase row.', code: 'no_pending_purchase' });
      return;
    }
    console.error('[admin/confirm-purchase] RPC failed:', msg);
    res.status(500).json({ error: 'Confirm failed. See server logs.' });
    return;
  }

  const row = Array.isArray(data) ? data[0] : data;
  await recordAuditAction(supabase, {
    action: 'confirm_purchase',
    targetKind: 'purchase',
    targetId: before?.id ?? null,
    before: before ? { status: before.status, observed_amount_taka: before.observed_amount_taka } : null,
    after: { status: 'completed', credits_granted: row?.credits_granted, override_msisdn: !!overrideMsisdnCheck, override_amount: !!overrideAmountCheck },
    reason,
  });
  res.status(200).json({
    success: true,
    userId: row?.user_id,
    creditsGranted: row?.credits_granted,
    newBalance: row?.new_balance,
  });
}
