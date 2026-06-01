// POST /api/admin/orphan-mark-ignored
// Body: { smsId, reason }
// Marks an orphan SMS reviewed (drops off the list) without matching it
// to a purchase — used for personal SMS that snuck through.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin, adminSupabase, requireReason, recordAuditAction } from '../_lib/adminAuth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  if (!requireAdmin(req, res)) return;
  const supabase = adminSupabase();
  if (!supabase) { res.status(503).json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured.' }); return; }

  const { smsId } = (req.body ?? {}) as { smsId?: string };
  if (!smsId) { res.status(400).json({ error: 'smsId required' }); return; }
  const reason = requireReason(req.body, res);
  if (reason === null) return;

  const { error } = await supabase
    .from('unmatched_inbound_sms')
    .update({ reviewed_at: new Date().toISOString() })
    .eq('id', smsId);
  if (error) {
    console.error('[admin/orphan-mark-ignored] failed:', error.message);
    res.status(500).json({ error: 'Update failed.' });
    return;
  }

  await recordAuditAction(supabase, {
    action: 'orphan_marked_ignored',
    targetKind: 'orphan_sms',
    targetId: smsId,
    before: null,
    after: { reviewed_at: new Date().toISOString() },
    reason,
  });
  res.status(200).json({ success: true });
}
