// GET /api/admin/product-analytics?range=day|week|month|all
//
// Product + AI-cost telemetry: generation counts by kind, a 30-day generation
// sparkline, AI cost/error/latency rollups, credits sold-vs-consumed, and a
// crude gross-margin estimate. Telemetry columns (cost_usd, latency_ms,
// provider, tokens) may be NULL on old rows — every read coalesces to 0.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin, adminSupabase } from '../_lib/adminAuth.js';

type Range = 'day' | 'week' | 'month' | 'all';

const BDT_PER_USD = 120; // approx BDT/USD — for margin display only

function sinceFor(range: Range): Date | null {
  if (range === 'all') return null;
  const now = Date.now();
  const ms = range === 'day' ? 24 * 3600_000 : range === 'week' ? 7 * 24 * 3600_000 : 30 * 24 * 3600_000;
  return new Date(now - ms);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }
  if (!requireAdmin(req, res)) return;
  const supabase = adminSupabase();
  if (!supabase) { res.status(503).json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured.' }); return; }

  const raw = Array.isArray(req.query.range) ? req.query.range[0] : req.query.range;
  const range: Range = (['day', 'week', 'month', 'all'] as const).includes(raw as Range) ? (raw as Range) : 'month';
  const sinceIso = sinceFor(range)?.toISOString();

  // AI call log in range — drives generation counts, cost, latency, error rate.
  let aiQ = supabase.from('ai_call_log').select('kind, provider, cost_usd, status, latency_ms, created_at').limit(50000);
  if (sinceIso) aiQ = aiQ.gte('created_at', sinceIso);

  // Completed purchases in range (credits sold + revenue for margin).
  let soldQ = supabase.from('purchases').select('credits_granted, amount_taka, created_at').eq('status', 'completed').limit(20000);
  if (sinceIso) soldQ = soldQ.gte('created_at', sinceIso);

  const [aiRes, soldRes] = await Promise.all([aiQ, soldQ]);
  const firstErr = aiRes.error || soldRes.error;
  if (firstErr) {
    console.error('[admin/product-analytics] query failed:', firstErr.message);
    res.status(500).json({ error: 'Product analytics query failed.' });
    return;
  }

  const ai = aiRes.data ?? [];

  // Generation counts by kind.
  const generations = { paidTailored: 0, freeGeneral: 0, toolkitItems: 0, extracts: 0 };
  // 30-day sparkline of optimize + optimize_general.
  const dayBuckets: Record<string, number> = {};
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 3600_000).toISOString().slice(0, 10);
    dayBuckets[d] = 0;
  }

  let totalCostUsd = 0;
  let callsWithCost = 0;
  let errorCount = 0;
  let latencySum = 0;
  let latencyCount = 0;
  let consumed = 0; // count of 'optimize' calls in range
  const providerMap: Record<string, { calls: number; costUsd: number }> = {};

  for (const r of ai) {
    const kind = r.kind ?? '';
    if (kind === 'optimize') { generations.paidTailored += 1; consumed += 1; }
    else if (kind === 'optimize_general') generations.freeGeneral += 1;
    else if (kind === 'toolkit_item') generations.toolkitItems += 1;
    else if (kind === 'extract_resume') generations.extracts += 1;

    if (kind === 'optimize' || kind === 'optimize_general') {
      const d = new Date(r.created_at).toISOString().slice(0, 10);
      if (dayBuckets[d] !== undefined) dayBuckets[d] += 1;
    }

    const cost = typeof r.cost_usd === 'number' ? r.cost_usd : Number(r.cost_usd) || 0;
    if (cost > 0) { totalCostUsd += cost; callsWithCost += 1; }

    if (r.status && r.status !== 'ok' && r.status !== 'success' && r.status !== 'completed') errorCount += 1;

    const lat = typeof r.latency_ms === 'number' ? r.latency_ms : Number(r.latency_ms) || 0;
    if (lat > 0) { latencySum += lat; latencyCount += 1; }

    const provider = r.provider ?? 'unknown';
    const pm = (providerMap[provider] ||= { calls: 0, costUsd: 0 });
    pm.calls += 1;
    pm.costUsd += cost;
  }

  const totalCalls = ai.length;
  const errorRatePct = totalCalls > 0 ? +((errorCount / totalCalls) * 100).toFixed(2) : 0;
  const avgLatencyMs = latencyCount > 0 ? Math.round(latencySum / latencyCount) : 0;
  const byProvider = Object.entries(providerMap)
    .map(([provider, v]) => ({ provider, calls: v.calls, costUsd: +v.costUsd.toFixed(4) }))
    .sort((a, b) => b.calls - a.calls);

  const dailyGenerations = Object.entries(dayBuckets).map(([day, value]) => ({ day, value }));

  let sold = 0;
  let revenueTaka = 0;
  for (const r of soldRes.data ?? []) {
    sold += r.credits_granted ?? 0;
    revenueTaka += r.amount_taka ?? 0;
  }

  res.status(200).json({
    range,
    generations,
    dailyGenerations,
    aiCost: {
      totalCostUsd: +totalCostUsd.toFixed(4),
      callsWithCost,
      errorRatePct,
      avgLatencyMs,
      byProvider,
    },
    creditsSoldVsConsumed: { sold, consumed },
    margin: marginBlock(totalCostUsd, revenueTaka),
  });
}

function marginBlock(totalCostUsd: number, revenueTaka: number) {
  const aiCostTaka = Math.round(totalCostUsd * BDT_PER_USD); // approx BDT/USD
  const grossMarginPct = revenueTaka > 0 ? +(((revenueTaka - aiCostTaka) / revenueTaka) * 100).toFixed(2) : 0;
  return { revenueTaka, aiCostTaka, grossMarginPct };
}
