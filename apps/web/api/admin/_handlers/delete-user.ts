// POST /api/admin/delete-user
// Body: { userId, confirmEmail, reason }
// Permanently deletes an account and everything it owns, including the login
// (admin_delete_user, migration 035). Meant for test accounts: the RPC refuses
// while the account has a completed purchase not marked as test, so mark those
// first. `confirmEmail` must equal the account's login email — a guard against
// deleting the wrong user from a stale screen.
//
// The audit entry is written after a successful delete and carries the
// deleted account's identity in `before` (the rows themselves are gone).

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin, adminSupabase, requireReason, recordAuditAction } from '../_lib/adminAuth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  if (!requireAdmin(req, res)) return;
  const supabase = adminSupabase();
  if (!supabase) { res.status(503).json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured.' }); return; }

  const { userId, confirmEmail } = (req.body ?? {}) as { userId?: string; confirmEmail?: string };
  if (!userId || typeof userId !== 'string') { res.status(400).json({ error: 'userId required' }); return; }
  if (!confirmEmail || typeof confirmEmail !== 'string') { res.status(400).json({ error: 'confirmEmail required' }); return; }
  const reason = requireReason(req.body, res);
  if (reason === null) return;

  const { data: profile } = await supabase
    .from('profiles')
    .select('email, full_name, toolkit_credits, created_at')
    .eq('id', userId)
    .maybeSingle();
  const { data: emails } = await supabase.rpc('admin_auth_emails', { p_ids: [userId] });
  const loginEmail = Array.isArray(emails) && emails[0] ? (emails[0] as { email: string }).email : null;
  if (!profile && !loginEmail) { res.status(404).json({ error: 'User not found' }); return; }

  const expected = (loginEmail ?? profile?.email ?? '').trim().toLowerCase();
  if (!expected || confirmEmail.trim().toLowerCase() !== expected) {
    res.status(400).json({ error: 'Typed email does not match this account.' });
    return;
  }

  const { error } = await supabase.rpc('admin_delete_user', { p_user_id: userId });
  if (error) {
    const msg = error.message ?? '';
    if (msg.includes('has_real_purchases')) {
      res.status(409).json({ error: error.hint ?? 'This account has real completed purchases. Mark them as test first.', code: 'has_real_purchases' });
      return;
    }
    if (msg.includes('user_not_found')) { res.status(404).json({ error: 'User not found' }); return; }
    console.error('[admin/delete-user] failed:', msg);
    res.status(500).json({ error: `Delete failed: ${msg}` });
    return;
  }

  await recordAuditAction(supabase, {
    action: 'delete_user',
    targetKind: 'user',
    targetId: userId,
    before: { login_email: loginEmail, email: profile?.email ?? null, full_name: profile?.full_name ?? null, toolkit_credits: profile?.toolkit_credits ?? null, created_at: profile?.created_at ?? null },
    after: null,
    reason,
  });
  res.status(200).json({ success: true });
}
