// GET /api/admin/audit-log?action=&targetKind=&from=&to=&page=
//
// Append-only operator action log. Filterable by action, target kind,
// date range. Page size 50.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin, adminSupabase } from '../_lib/adminAuth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }
  if (!requireAdmin(req, res)) return;
  const supabase = adminSupabase();
  if (!supabase) { res.status(503).json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured.' }); return; }

  const param = (name: string) => {
    const v = req.query[name];
    return Array.isArray(v) ? v[0] : v;
  };

  const action = String(param('action') ?? '').trim();
  const targetKind = String(param('targetKind') ?? '').trim();
  const from = String(param('from') ?? '').trim();
  const to = String(param('to') ?? '').trim();
  const page = Math.max(0, Number(param('page') ?? 0));
  const pageSize = 50;

  let query = supabase
    .from('admin_audit_log')
    .select('id, actor, action, target_kind, target_id, before_state, after_state, reason, created_at', { count: 'exact' })
    .order('created_at', { ascending: false });

  if (action) query = query.eq('action', action);
  if (targetKind) query = query.eq('target_kind', targetKind);
  if (from) query = query.gte('created_at', from);
  if (to) query = query.lte('created_at', to);

  const { data, error, count } = await query.range(page * pageSize, page * pageSize + pageSize - 1);
  if (error) {
    console.error('[admin/audit-log] failed:', error.message);
    res.status(500).json({ error: `Supabase: ${error.message}`, code: error.code ?? null, hint: error.hint ?? null });
    return;
  }

  res.status(200).json({ rows: data ?? [], total: count ?? 0, page, pageSize });
}
