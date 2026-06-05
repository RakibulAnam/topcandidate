// GET /api/admin/revenue-export?range=day|week|month|all
//
// CSV download of completed purchases in the selected range. Columns:
//   created_at, payment_reference, email, amount_taka, credits_granted
// email is joined from profiles. Follows parser-export.ts's attachment style.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin, adminSupabase } from '../_lib/adminAuth.js';

type Range = 'day' | 'week' | 'month' | 'all';

function sinceFor(range: Range): Date | null {
  if (range === 'all') return null;
  const now = Date.now();
  const ms = range === 'day' ? 24 * 3600_000 : range === 'week' ? 7 * 24 * 3600_000 : 30 * 24 * 3600_000;
  return new Date(now - ms);
}

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  // Quote when the value contains comma, quote, or newline; escape inner quotes.
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }
  if (!requireAdmin(req, res)) return;
  const supabase = adminSupabase();
  if (!supabase) { res.status(503).json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured.' }); return; }

  const raw = Array.isArray(req.query.range) ? req.query.range[0] : req.query.range;
  const range: Range = (['day', 'week', 'month', 'all'] as const).includes(raw as Range) ? (raw as Range) : 'month';
  const sinceIso = sinceFor(range)?.toISOString();

  let q = supabase
    .from('purchases')
    .select('created_at, payment_reference, amount_taka, credits_granted, user_id')
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(20000);
  if (sinceIso) q = q.gte('created_at', sinceIso);

  const { data, error } = await q;
  if (error) {
    console.error('[admin/revenue-export] failed:', error.message);
    res.status(500).json({ error: 'Query failed.' });
    return;
  }

  const rows = data ?? [];

  // Resolve emails in one bounded lookup (no SQL join sugar in supabase-js).
  const userIds = [...new Set(rows.map((r) => r.user_id).filter((id): id is string => !!id))];
  const emailById: Record<string, string> = {};
  if (userIds.length > 0) {
    const { data: profiles } = await supabase.from('profiles').select('id, email').in('id', userIds);
    for (const p of profiles ?? []) emailById[p.id] = p.email ?? '';
  }

  const header = ['created_at', 'payment_reference', 'email', 'amount_taka', 'credits_granted'];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push([
      csvCell(r.created_at),
      csvCell(r.payment_reference),
      csvCell(r.user_id ? emailById[r.user_id] ?? '' : ''),
      csvCell(r.amount_taka ?? 0),
      csvCell(r.credits_granted ?? 0),
    ].join(','));
  }

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="revenue-${range}.csv"`);
  res.status(200).send(lines.join('\n'));
}
