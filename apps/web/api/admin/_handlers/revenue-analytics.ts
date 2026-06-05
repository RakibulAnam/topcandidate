// GET /api/admin/revenue-analytics?range=day|week|month|all
//
// Revenue dashboard: gross/net/refunds, order economics (AOV, ARPPU), status
// breakdown, a 30-day zero-filled revenue sparkline, and credit liability.
//
// Supabase JS has no SQL aggregate sugar, so we fetch bounded row sets and
// aggregate in JS (same approach as summary.ts). ৳40/credit (৳200 = 5 credits).

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin, adminSupabase } from '../_lib/adminAuth.js';

type Range = 'day' | 'week' | 'month' | 'all';

const TAKA_PER_CREDIT = 40;
const FAILURE_STATUSES = ['failed', 'expired', 'underpaid', 'msisdn_mismatch_review'] as const;

function sinceFor(range: Range): Date | null {
  if (range === 'all') return null;
  const now = Date.now();
  const ms = range === 'day' ? 24 * 3600_000 : range === 'week' ? 7 * 24 * 3600_000 : 30 * 24 * 3600_000;
  return new Date(now - ms);
}

function parseRange(req: VercelRequest): Range {
  const raw = Array.isArray(req.query.range) ? req.query.range[0] : req.query.range;
  return (['day', 'week', 'month', 'all'] as const).includes(raw as Range) ? (raw as Range) : 'month';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }
  if (!requireAdmin(req, res)) return;
  const supabase = adminSupabase();
  if (!supabase) { res.status(503).json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured.' }); return; }

  const range = parseRange(req);
  const since = sinceFor(range);
  const sinceIso = since?.toISOString();
  const sinceMs = since?.getTime() ?? 0;

  // All purchases in range (bounded) — we tally status/amounts/users in JS.
  let purchasesQ = supabase.from('purchases').select('user_id, amount_taka, credits_granted, status, created_at');
  if (sinceIso) purchasesQ = purchasesQ.gte('created_at', sinceIso);
  purchasesQ = purchasesQ.limit(20000);

  // Completed rows over the last 30 calendar days for the sparkline.
  const thirtyAgo = new Date(Date.now() - 30 * 24 * 3600_000).toISOString();
  const dailyQ = supabase
    .from('purchases')
    .select('amount_taka, created_at')
    .eq('status', 'completed')
    .gte('created_at', thirtyAgo)
    .limit(20000);

  // Credit liability view (single row).
  const liabilityQ = supabase
    .from('v_credit_liability')
    .select('outstanding_credits, negative_balance_users')
    .maybeSingle();

  const [purchases, daily, liability] = await Promise.all([purchasesQ, dailyQ, liabilityQ]);

  const firstErr = purchases.error || daily.error || liability.error;
  if (firstErr) {
    console.error('[admin/revenue-analytics] query failed:', firstErr.message);
    res.status(500).json({ error: 'Revenue analytics query failed.' });
    return;
  }

  const rows = purchases.data ?? [];
  let grossTaka = 0;
  let refundsTaka = 0;
  let creditsSold = 0;
  let orders = 0; // completed orders
  const payingUsers = new Set<string>();
  const statusMap: Record<string, { count: number; taka: number }> = {};
  let failureCount = 0;
  const totalInRange = rows.length;

  for (const r of rows) {
    const amt = r.amount_taka ?? 0;
    const status = r.status ?? 'unknown';
    if (!statusMap[status]) statusMap[status] = { count: 0, taka: 0 };
    statusMap[status].count += 1;
    statusMap[status].taka += amt;

    if (status === 'completed') {
      grossTaka += amt;
      creditsSold += r.credits_granted ?? 0;
      orders += 1;
      if (r.user_id) payingUsers.add(r.user_id);
    } else if (status === 'refunded') {
      refundsTaka += amt;
    }
    if ((FAILURE_STATUSES as readonly string[]).includes(status)) failureCount += 1;
  }

  const netTaka = grossTaka - refundsTaka;
  const aovTaka = orders > 0 ? Math.round(grossTaka / orders) : 0;
  const arppuTaka = payingUsers.size > 0 ? Math.round(grossTaka / payingUsers.size) : 0;
  const refundRatePct = grossTaka > 0 ? +((refundsTaka / grossTaka) * 100).toFixed(2) : 0;
  const failureRatePct = totalInRange > 0 ? +((failureCount / totalInRange) * 100).toFixed(2) : 0;

  const statusBreakdown = Object.entries(statusMap)
    .map(([status, v]) => ({ status, count: v.count, taka: v.taka }))
    .sort((a, b) => b.count - a.count);

  // 30-day zero-filled sparkline.
  const dayBuckets: Record<string, { revenue_taka: number; orders: number }> = {};
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 3600_000).toISOString().slice(0, 10);
    dayBuckets[d] = { revenue_taka: 0, orders: 0 };
  }
  for (const r of daily.data ?? []) {
    const d = new Date(r.created_at).toISOString().slice(0, 10);
    if (dayBuckets[d]) {
      dayBuckets[d].revenue_taka += r.amount_taka ?? 0;
      dayBuckets[d].orders += 1;
    }
  }
  const dailyRevenue = Object.entries(dayBuckets).map(([day, v]) => ({ day, revenue_taka: v.revenue_taka, orders: v.orders }));

  const outstandingCredits = liability.data?.outstanding_credits ?? 0;
  const negativeBalanceUsers = liability.data?.negative_balance_users ?? 0;

  res.status(200).json({
    range,
    totals: {
      grossTaka,
      refundsTaka,
      netTaka,
      orders,
      creditsSold,
      payingUsers: payingUsers.size,
      aovTaka,
      arppuTaka,
    },
    rates: { refundRatePct, failureRatePct },
    statusBreakdown,
    dailyRevenue,
    creditLiability: {
      outstandingCredits,
      liabilityTaka: outstandingCredits * TAKA_PER_CREDIT,
      negativeBalanceUsers,
    },
  });
}
