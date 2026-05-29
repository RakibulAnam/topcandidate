// POST /api/admin/expire-purchase
// Body: { purchaseId, reason }

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

  const { data: before } = await supabase.from('purchases').select('status').eq('id', purchaseId).maybeSingle();
  const { error } = await supabase.rpc('admin_expire_purchase', { p_purchase_id: purchaseId, p_reason: reason });
  if (error) {
    const msg = error.message ?? '';
    if (msg.includes('purchase_not_found')) { res.status(404).json({ error: 'Purchase not found' }); return; }
    if (msg.includes('not_expirable')) { res.status(409).json({ error: 'Cannot expire from this status.', code: 'not_expirable' }); return; }
    console.error('[admin/expire-purchase] failed:', msg);
    res.status(500).json({ error: 'Expire failed.' });
    return;
  }

  await recordAuditAction(supabase, {
    action: 'expire_purchase',
    targetKind: 'purchase',
    targetId: purchaseId,
    before: { status: before?.status ?? null },
    after: { status: 'expired' },
    reason,
  });
  res.status(200).json({ success: true });
}
