// POST /api/admin/deduct-credits
// Body: { userId, amount, reason }
// Negative balance allowed (paid endpoints already gate on > 0).

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin, adminSupabase, requireReason, recordAuditAction } from '../_lib/adminAuth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  if (!requireAdmin(req, res)) return;
  const supabase = adminSupabase();
  if (!supabase) { res.status(503).json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured.' }); return; }

  const { userId, amount } = (req.body ?? {}) as { userId?: string; amount?: number };
  if (!userId || typeof userId !== 'string') { res.status(400).json({ error: 'userId required' }); return; }
  if (!Number.isInteger(amount) || (amount as number) <= 0) { res.status(400).json({ error: 'amount must be positive integer' }); return; }
  const reason = requireReason(req.body, res);
  if (reason === null) return;

  const { data: before } = await supabase.from('profiles').select('toolkit_credits').eq('id', userId).maybeSingle();

  const { data, error } = await supabase.rpc('admin_deduct_credits', { p_user_id: userId, p_amount: amount });
  if (error) {
    const msg = error.message ?? '';
    if (msg.includes('user_not_found')) { res.status(404).json({ error: 'User not found' }); return; }
    console.error('[admin/deduct-credits] failed:', msg);
    res.status(500).json({ error: 'Deduct failed.' });
    return;
  }

  await recordAuditAction(supabase, {
    action: 'deduct_credits',
    targetKind: 'user',
    targetId: userId,
    before: { toolkit_credits: before?.toolkit_credits ?? null },
    after: { toolkit_credits: data, delta: -amount },
    reason,
  });
  res.status(200).json({ success: true, newBalance: data });
}
