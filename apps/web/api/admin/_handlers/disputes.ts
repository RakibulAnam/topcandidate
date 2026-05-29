// GET /api/admin/disputes?status=open
//
// List customer-filed disputes. Default is open. The /admin Disputes tab
// uses this.

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

  const statusRaw = req.query.status;
  const status = Array.isArray(statusRaw) ? statusRaw[0] : statusRaw;
  const allowed = ['open', 'resolved', 'rejected'];
  const filter = typeof status === 'string' && allowed.includes(status) ? status : 'open';

  const { data, error } = await supabase
    .from('purchase_disputes')
    .select('id, user_id, payment_reference, notes, status, operator_note, created_at, resolved_at')
    .eq('status', filter)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) {
    console.error('[admin/disputes] query failed:', error.message);
    res.status(500).json({ error: `Supabase: ${error.message}`, code: error.code ?? null, hint: error.hint ?? null });
    return;
  }

  res.status(200).json({ rows: data ?? [] });
}
