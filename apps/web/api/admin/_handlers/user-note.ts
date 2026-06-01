// POST /api/admin/user-note
// Body: { userId, note }
// Append-only note on profile_notes. No state change; still audited.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin, adminSupabase, recordAuditAction } from '../_lib/adminAuth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  if (!requireAdmin(req, res)) return;
  const supabase = adminSupabase();
  if (!supabase) { res.status(503).json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured.' }); return; }

  const { userId, note } = (req.body ?? {}) as { userId?: string; note?: string };
  if (!userId || typeof userId !== 'string') { res.status(400).json({ error: 'userId required' }); return; }
  if (!note || typeof note !== 'string' || note.trim().length === 0) {
    res.status(400).json({ error: 'note is required' });
    return;
  }
  const trimmed = note.trim().slice(0, 2000);

  const { data, error } = await supabase
    .from('profile_notes')
    .insert({ user_id: userId, note: trimmed })
    .select('id, created_at')
    .maybeSingle();
  if (error) {
    console.error('[admin/user-note] failed:', error.message);
    res.status(500).json({ error: 'Note insert failed.' });
    return;
  }

  await recordAuditAction(supabase, {
    action: 'add_user_note',
    targetKind: 'user',
    targetId: userId,
    before: null,
    after: { note_id: data?.id, length: trimmed.length },
    reason: trimmed,
  });
  res.status(200).json({ success: true, id: data?.id });
}
