// POST /api/admin/parser-mark-reviewed
// Body: { ids: string[] }   — uuids of unmatched_inbound_sms rows
// Sets reviewed_at = now() so they drop off the parser-failures tab.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin, adminSupabase, recordAuditAction } from '../_lib/adminAuth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  if (!requireAdmin(req, res)) return;
  const supabase = adminSupabase();
  if (!supabase) { res.status(503).json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured.' }); return; }

  const { ids } = (req.body ?? {}) as { ids?: string[] };
  if (!Array.isArray(ids) || ids.length === 0) {
    res.status(400).json({ error: 'ids[] required' });
    return;
  }
  const safeIds = ids.filter(x => typeof x === 'string').slice(0, 200);

  const { error } = await supabase
    .from('unmatched_inbound_sms')
    .update({ reviewed_at: new Date().toISOString() })
    .in('id', safeIds);
  if (error) {
    console.error('[admin/parser-mark-reviewed] failed:', error.message);
    res.status(500).json({ error: 'Update failed.' });
    return;
  }

  for (const id of safeIds) {
    await recordAuditAction(supabase, {
      action: 'mark_parser_reviewed',
      targetKind: 'parser_failure',
      targetId: id,
      before: null,
      after: { reviewed_at: new Date().toISOString() },
      reason: 'operator reviewed',
    });
  }

  res.status(200).json({ success: true, count: safeIds.length });
}
