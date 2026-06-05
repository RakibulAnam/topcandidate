// GET /api/admin/summary?range=day|week|month|all
//
// Business-overview metrics for the dashboard's top summary block:
//   - total users (+ new in the selected range)
//   - lifetime earnings + earnings in range (sum of completed amount_taka)
//   - transaction-failure breakdown in range
//   - disputes (open + opened in range)
//
// The operational tiles + action queue come from /api/admin/dashboard and
// /api/admin/action-queue respectively; this endpoint is purely the
// "how's the business doing" summary, re-scoped by the range filter.
//
// NOTE: lifetime earnings sums completed rows client-side here. At current
// volume that's trivial; if completed-purchase count grows large, move the
// aggregation into a Postgres RPC (SUM in the DB) to avoid pulling rows.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin, adminSupabase } from '../_lib/adminAuth.js';

type Range = 'day' | 'week' | 'month' | 'all';

const FAILURE_STATUSES = ['failed', 'expired', 'underpaid', 'msisdn_mismatch_review'] as const;

function sinceFor(range: Range): Date | null {
  if (range === 'all') return null;
  const now = Date.now();
  const ms = range === 'day' ? 24 * 3600_000 : range === 'week' ? 7 * 24 * 3600_000 : 30 * 24 * 3600_000;
  return new Date(now - ms);
}

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

  const rawRange = Array.isArray(req.query.range) ? req.query.range[0] : req.query.range;
  const range: Range = (['day', 'week', 'month', 'all'] as const).includes(rawRange as Range)
    ? (rawRange as Range)
    : 'month';
  const since = sinceFor(range);
  const sinceIso = since?.toISOString();

  // Completed rows (for lifetime + in-range earnings). Select only what we sum.
  const completedQ = supabase.from('purchases').select('amount_taka, created_at').eq('status', 'completed');
  // Failure rows in range (status + created_at; tally by status below).
  let failuresQ = supabase
    .from('purchases')
    .select('status, created_at')
    .in('status', FAILURE_STATUSES as unknown as string[]);
  if (sinceIso) failuresQ = failuresQ.gte('created_at', sinceIso);

  // Counts via head:true (no rows transferred).
  const totalUsersQ = supabase.from('profiles').select('id', { count: 'exact', head: true });
  let newUsersQ = supabase.from('profiles').select('id', { count: 'exact', head: true });
  if (sinceIso) newUsersQ = newUsersQ.gte('created_at', sinceIso);
  const openDisputesQ = supabase.from('purchase_disputes').select('id', { count: 'exact', head: true }).eq('status', 'open');
  let disputesInRangeQ = supabase.from('purchase_disputes').select('id', { count: 'exact', head: true });
  if (sinceIso) disputesInRangeQ = disputesInRangeQ.gte('created_at', sinceIso);

  const [completed, failures, totalUsers, newUsers, openDisputes, disputesInRange] = await Promise.all([
    completedQ, failuresQ, totalUsersQ, newUsersQ, openDisputesQ, disputesInRangeQ,
  ]);

  const firstErr = completed.error || failures.error || totalUsers.error || newUsers.error || openDisputes.error || disputesInRange.error;
  if (firstErr) {
    console.error('[admin/summary] query failed:', firstErr.message);
    res.status(500).json({ error: 'Summary query failed.' });
    return;
  }

  const completedRows = completed.data ?? [];
  const sinceMs = since?.getTime() ?? 0;
  let lifetimeEarningsTaka = 0;
  let earningsInRangeTaka = 0;
  let completedInRange = 0;
  for (const r of completedRows) {
    const amt = r.amount_taka ?? 0;
    lifetimeEarningsTaka += amt;
    if (!since || new Date(r.created_at).getTime() >= sinceMs) {
      earningsInRangeTaka += amt;
      completedInRange += 1;
    }
  }

  const failureBreakdown: Record<string, number> = { failed: 0, expired: 0, underpaid: 0, msisdn_mismatch_review: 0 };
  for (const r of failures.data ?? []) {
    if (r.status in failureBreakdown) failureBreakdown[r.status] += 1;
  }
  const failuresInRange = Object.values(failureBreakdown).reduce((a, b) => a + b, 0);

  res.status(200).json({
    range,
    totalUsers: totalUsers.count ?? 0,
    newUsersInRange: newUsers.count ?? 0,
    lifetimeEarningsTaka,
    earningsInRangeTaka,
    completedInRange,
    lifetimeCompletedCount: completedRows.length,
    failuresInRange,
    failureBreakdown,
    openDisputes: openDisputes.count ?? 0,
    disputesInRange: disputesInRange.count ?? 0,
  });
}
