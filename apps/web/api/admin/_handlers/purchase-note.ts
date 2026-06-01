// POST /api/admin/purchase-note
// Body: { purchaseId, note }
// Audit-only entry — does not mutate the purchase row. Useful for
// "checked with customer over WhatsApp, will resubmit tomorrow" style
// breadcrumbs.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin, adminSupabase, recordAuditAction } from '../_lib/adminAuth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  if (!requireAdmin(req, res)) return;
  const supabase = adminSupabase();
  if (!supabase) { res.status(503).json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured.' }); return; }

  const { purchaseId, note } = (req.body ?? {}) as { purchaseId?: string; note?: string };
  if (!purchaseId) { res.status(400).json({ error: 'purchaseId required' }); return; }
  if (!note || typeof note !== 'string' || note.trim().length === 0) {
    res.status(400).json({ error: 'note required' });
    return;
  }
  const trimmed = note.trim().slice(0, 2000);

  await recordAuditAction(supabase, {
    action: 'add_purchase_note',
    targetKind: 'purchase',
    targetId: purchaseId,
    before: null,
    after: { length: trimmed.length },
    reason: trimmed,
  });
  res.status(200).json({ success: true });
}
