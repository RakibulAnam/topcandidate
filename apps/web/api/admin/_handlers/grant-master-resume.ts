// POST /api/admin/grant-master-resume
// Body: { userId, reason }
// Stamps profiles.master_resume_unlocked_at by hand (migration 035) — the same
// unlock a completed purchase gives. No-op when already unlocked.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin, adminSupabase, requireReason, recordAuditAction } from '../_lib/adminAuth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  if (!requireAdmin(req, res)) return;
  const supabase = adminSupabase();
  if (!supabase) { res.status(503).json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured.' }); return; }

  const { userId } = (req.body ?? {}) as { userId?: string };
  if (!userId || typeof userId !== 'string') { res.status(400).json({ error: 'userId required' }); return; }
  const reason = requireReason(req.body, res);
  if (reason === null) return;

  const { data: before } = await supabase.from('profiles').select('master_resume_unlocked_at').eq('id', userId).maybeSingle();

  const { data, error } = await supabase.rpc('admin_grant_master_resume', { p_user_id: userId });
  if (error) {
    const msg = error.message ?? '';
    if (msg.includes('user_not_found')) { res.status(404).json({ error: 'User not found' }); return; }
    console.error('[admin/grant-master-resume] failed:', msg);
    res.status(500).json({ error: 'Grant failed.' });
    return;
  }

  await recordAuditAction(supabase, {
    action: 'grant_master_resume',
    targetKind: 'user',
    targetId: userId,
    before: { master_resume_unlocked_at: before?.master_resume_unlocked_at ?? null },
    after: { master_resume_unlocked_at: data },
    reason,
  });
  res.status(200).json({ success: true, unlockedAt: data });
}
