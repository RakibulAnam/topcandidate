// POST /api/admin/mark-test-purchase
// Body: { purchaseId, isTest: boolean, reason }
// Sets / clears purchases.is_test (migration 035). A test purchase still works
// for the user (credits, master-resume unlock); it is only left out of the
// admin revenue and paying-user analytics.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin, adminSupabase, requireReason, recordAuditAction } from '../_lib/adminAuth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  if (!requireAdmin(req, res)) return;
  const supabase = adminSupabase();
  if (!supabase) { res.status(503).json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured.' }); return; }

  const { purchaseId, isTest } = (req.body ?? {}) as { purchaseId?: string; isTest?: boolean };
  if (!purchaseId || typeof purchaseId !== 'string') { res.status(400).json({ error: 'purchaseId required' }); return; }
  if (typeof isTest !== 'boolean') { res.status(400).json({ error: 'isTest must be boolean' }); return; }
  const reason = requireReason(req.body, res);
  if (reason === null) return;

  const { data: before } = await supabase.from('purchases').select('is_test').eq('id', purchaseId).maybeSingle();

  const { data, error } = await supabase.rpc('admin_set_purchase_test', { p_purchase_id: purchaseId, p_is_test: isTest });
  if (error) {
    const msg = error.message ?? '';
    if (msg.includes('purchase_not_found')) { res.status(404).json({ error: 'Purchase not found' }); return; }
    console.error('[admin/mark-test-purchase] failed:', msg);
    res.status(500).json({ error: 'Update failed.' });
    return;
  }

  await recordAuditAction(supabase, {
    action: isTest ? 'mark_test_purchase' : 'unmark_test_purchase',
    targetKind: 'purchase',
    targetId: purchaseId,
    before: { is_test: before?.is_test ?? null },
    after: { is_test: data },
    reason,
  });
  res.status(200).json({ success: true, isTest: data });
}
