// POST /api/admin/set-master-price
// Body: { userId, priceTaka: number | null, reason }
// Sets profiles.master_price_taka (migration 035): the master-resume price
// initiate_purchase charges this account. null = back to the default
// (৳50 for legacy accounts, ৳99 otherwise). Rows already pending keep the
// amount they were created with.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin, adminSupabase, requireReason, recordAuditAction } from '../_lib/adminAuth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  if (!requireAdmin(req, res)) return;
  const supabase = adminSupabase();
  if (!supabase) { res.status(503).json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured.' }); return; }

  const { userId, priceTaka } = (req.body ?? {}) as { userId?: string; priceTaka?: number | null };
  if (!userId || typeof userId !== 'string') { res.status(400).json({ error: 'userId required' }); return; }
  if (priceTaka !== null && !(Number.isInteger(priceTaka) && (priceTaka as number) >= 1 && (priceTaka as number) <= 100000)) {
    res.status(400).json({ error: 'priceTaka must be a whole number from 1 to 100000, or null for the default' });
    return;
  }
  const reason = requireReason(req.body, res);
  if (reason === null) return;

  const { data: before } = await supabase.from('profiles').select('master_price_taka, legacy_pricing').eq('id', userId).maybeSingle();

  const { data, error } = await supabase.rpc('admin_set_master_price', { p_user_id: userId, p_price: priceTaka });
  if (error) {
    const msg = error.message ?? '';
    if (msg.includes('user_not_found')) { res.status(404).json({ error: 'User not found' }); return; }
    console.error('[admin/set-master-price] failed:', msg);
    res.status(500).json({ error: 'Price update failed.' });
    return;
  }

  await recordAuditAction(supabase, {
    action: 'set_master_price',
    targetKind: 'user',
    targetId: userId,
    before: { master_price_taka: before?.master_price_taka ?? null, legacy_pricing: before?.legacy_pricing ?? null },
    after: { master_price_taka: priceTaka, effective_taka: data },
    reason,
  });
  res.status(200).json({ success: true, effectiveTaka: data });
}
