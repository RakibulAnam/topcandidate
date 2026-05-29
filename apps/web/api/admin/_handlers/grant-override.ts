// POST /api/admin/grant-override
// Body: { purchaseId, reason }
// For underpaid / msisdn-mismatch / expired rows — flips to completed and
// grants the original credit pack.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin, adminSupabase, requireReason, recordAuditAction } from '../_lib/adminAuth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  if (!requireAdmin(req, res)) return;
  const supabase = adminSupabase();
  if (!supabase) { res.status(503).json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured.' }); return; }

  const { purchaseId } = (req.body ?? {}) as { purchaseId?: string };
  if (!purchaseId) { res.status(400).json({ error: 'purchaseId required' }); return; }
  const reason = requireReason(req.body, res);
  if (reason === null) return;

  const { data: before } = await supabase.from('purchases').select('status, observed_amount_taka, amount_taka').eq('id', purchaseId).maybeSingle();

  const { data, error } = await supabase.rpc('admin_grant_override', { p_purchase_id: purchaseId, p_reason: reason });
  if (error) {
    const msg = error.message ?? '';
    if (msg.includes('purchase_not_found')) { res.status(404).json({ error: 'Purchase not found' }); return; }
    if (msg.includes('not_grantable')) { res.status(409).json({ error: 'Cannot grant from this status.', code: 'not_grantable' }); return; }
    console.error('[admin/grant-override] failed:', msg);
    res.status(500).json({ error: 'Grant override failed.' });
    return;
  }

  const row = Array.isArray(data) ? data[0] : data;
  await recordAuditAction(supabase, {
    action: 'grant_override',
    targetKind: 'purchase',
    targetId: purchaseId,
    before: { status: before?.status ?? null, observed: before?.observed_amount_taka, expected: before?.amount_taka },
    after: { status: 'completed', credits_granted: row?.credits_granted, new_balance: row?.new_balance },
    reason,
  });
  res.status(200).json({ success: true, newBalance: row?.new_balance, creditsGranted: row?.credits_granted });
}
