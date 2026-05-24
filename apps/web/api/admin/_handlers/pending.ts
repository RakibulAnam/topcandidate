// GET /api/admin/pending?olderThanMin=10
//
// List rows in non-terminal states. Default returns pending/underpaid/
// msisdn_mismatch_review rows older than `olderThanMin` minutes (default 10).
// Used by the /admin Pending tab.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin, adminSupabase } from '../_lib/adminAuth.js';

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

  const minRaw = req.query.olderThanMin;
  const min = Number(Array.isArray(minRaw) ? minRaw[0] : minRaw);
  const minutes = Number.isFinite(min) && min >= 0 ? min : 10;
  const cutoff = new Date(Date.now() - minutes * 60_000).toISOString();

  const { data, error } = await supabase
    .from('purchases')
    .select('id, user_id, payment_reference, sender_msisdn, amount_taka, observed_amount_taka, status, created_at')
    .in('status', ['pending', 'underpaid', 'msisdn_mismatch_review'])
    .lte('created_at', cutoff)
    .order('created_at', { ascending: true })
    .limit(200);

  if (error) {
    console.error('[admin/pending] query failed:', error.message);
    res.status(500).json({ error: 'Query failed.' });
    return;
  }

  res.status(200).json({ rows: data ?? [] });
}
