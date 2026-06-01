// GET /api/admin/purchases?status=&q=&age=&page=
//
// status: comma-separated list. Default = all non-completed.
// q: TrxID substring OR customer email substring (joins on profiles).
// age: '24h' | '7d' | '30d' | 'all' (default 30d).

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin, adminSupabase } from '../_lib/adminAuth.js';

const ALL_STATUSES = ['pending', 'completed', 'failed', 'expired', 'underpaid', 'msisdn_mismatch_review', 'refunded'];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!requireAdmin(req, res)) return;
  const supabase = adminSupabase();
  if (!supabase) { res.status(503).json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured.' }); return; }

  const param = (name: string) => {
    const v = req.query[name];
    return Array.isArray(v) ? v[0] : v;
  };

  const statusParam = String(param('status') ?? '').trim();
  const statuses = statusParam.length > 0
    ? statusParam.split(',').map(s => s.trim()).filter(s => ALL_STATUSES.includes(s))
    : ALL_STATUSES.filter(s => s !== 'completed');

  const q = String(param('q') ?? '').trim();
  const age = String(param('age') ?? '30d').trim();
  const page = Math.max(0, Number(param('page') ?? 0));
  const pageSize = 50;

  let cutoff: string | null = null;
  if (age === '24h') cutoff = new Date(Date.now() - 24 * 3600_000).toISOString();
  else if (age === '7d') cutoff = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
  else if (age === '30d') cutoff = new Date(Date.now() - 30 * 24 * 3600_000).toISOString();

  let query = supabase
    .from('purchases')
    .select('id, user_id, payment_reference, amount_taka, observed_amount_taka, sender_msisdn, status, credits_granted, created_at', { count: 'exact' })
    .in('status', statuses)
    .order('created_at', { ascending: false });

  if (cutoff) query = query.gte('created_at', cutoff);
  if (q.length > 0) {
    const safe = q.replace(/[%_]/g, '');
    // Email substring search needs a profiles join — Supabase JS doesn't
    // expose joined-table .ilike() filters cleanly, so do a 2-step:
    // resolve matching user ids first, then OR with payment_reference ilike.
    const { data: ids } = await supabase
      .from('profiles')
      .select('id')
      .ilike('email', `%${safe}%`)
      .limit(50);
    const idList = (ids ?? []).map(r => r.id).join(',');
    if (idList) {
      query = query.or(`payment_reference.ilike.%${safe}%,user_id.in.(${idList})`);
    } else {
      query = query.ilike('payment_reference', `%${safe}%`);
    }
  }

  const { data, error, count } = await query.range(page * pageSize, page * pageSize + pageSize - 1);
  if (error) {
    console.error('[admin/purchases] query failed:', error.message);
    res.status(500).json({ error: `Supabase: ${error.message}`, code: error.code ?? null, hint: error.hint ?? null });
    return;
  }

  // Enrich with customer email (small list — N≤50 — single lookup).
  const userIds = Array.from(new Set((data ?? []).map(r => r.user_id)));
  const { data: profiles } = userIds.length > 0
    ? await supabase.from('profiles').select('id, email').in('id', userIds)
    : { data: [] };
  const emailById = new Map<string, string>();
  for (const p of profiles ?? []) emailById.set(p.id, p.email ?? '');

  const rows = (data ?? []).map(r => ({ ...r, email: emailById.get(r.user_id) ?? null }));

  res.status(200).json({ rows, total: count ?? 0, page, pageSize });
}
