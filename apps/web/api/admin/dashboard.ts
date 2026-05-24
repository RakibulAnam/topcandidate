// GET /api/admin/dashboard
//
// Counts the operator wants to see at a glance: pending / completed today /
// disputed / expired. The /admin SPA polls this every ~30s.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin, adminSupabase } from './_lib/adminAuth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!requireAdmin(req, res)) return;

  const supabase = adminSupabase();
  if (!supabase) {
    res.status(503).json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured.' });
    return;
  }

  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);

  const [pending, completedToday, openDisputes, expired24h, orphans, oldestPending] =
    await Promise.all([
      supabase.from('purchases').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase
        .from('purchases')
        .select('amount_taka', { count: 'exact' })
        .eq('status', 'completed')
        .gte('created_at', startOfDay.toISOString()),
      supabase.from('purchase_disputes').select('id', { count: 'exact', head: true }).eq('status', 'open'),
      supabase
        .from('purchases')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'expired')
        .gte('created_at', new Date(Date.now() - 24 * 3600_000).toISOString()),
      supabase
        .from('unmatched_inbound_sms')
        .select('id', { count: 'exact', head: true })
        .is('matched_to_purchase_id', null),
      supabase
        .from('purchases')
        .select('created_at')
        .eq('status', 'pending')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle(),
    ]);

  const completedAmount = (completedToday.data ?? []).reduce(
    (sum, r) => sum + (r.amount_taka ?? 0),
    0
  );

  res.status(200).json({
    pending: pending.count ?? 0,
    completedToday: completedToday.count ?? 0,
    completedTodayTaka: completedAmount,
    openDisputes: openDisputes.count ?? 0,
    expired24h: expired24h.count ?? 0,
    orphanSms: orphans.count ?? 0,
    oldestPendingCreatedAt: oldestPending.data?.created_at ?? null,
  });
}
