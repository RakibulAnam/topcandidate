// POST /api/admin/flag-user
// Body: { userId, flagged: boolean, reason }
// Sets / clears profiles.flagged_at.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin, adminSupabase, requireReason, recordAuditAction } from '../_lib/adminAuth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  if (!requireAdmin(req, res)) return;
  const supabase = adminSupabase();
  if (!supabase) { res.status(503).json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured.' }); return; }

  const { userId, flagged } = (req.body ?? {}) as { userId?: string; flagged?: boolean };
  if (!userId || typeof userId !== 'string') { res.status(400).json({ error: 'userId required' }); return; }
  if (typeof flagged !== 'boolean') { res.status(400).json({ error: 'flagged must be boolean' }); return; }
  const reason = requireReason(req.body, res);
  if (reason === null) return;

  const { data: before } = await supabase.from('profiles').select('flagged_at').eq('id', userId).maybeSingle();
  if (!before) { res.status(404).json({ error: 'User not found' }); return; }

  const flaggedAt = flagged ? new Date().toISOString() : null;
  const { error } = await supabase.from('profiles').update({ flagged_at: flaggedAt }).eq('id', userId);
  if (error) {
    console.error('[admin/flag-user] failed:', error.message);
    res.status(500).json({ error: 'Flag update failed.' });
    return;
  }

  await recordAuditAction(supabase, {
    action: flagged ? 'flag_user' : 'unflag_user',
    targetKind: 'user',
    targetId: userId,
    before: { flagged_at: before.flagged_at },
    after: { flagged_at: flaggedAt },
    reason,
  });
  res.status(200).json({ success: true, flaggedAt });
}
