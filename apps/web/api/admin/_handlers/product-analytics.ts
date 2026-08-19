// GET /api/admin/product-analytics?range=day|week|month|all
//
// Product + AI-cost telemetry: generation counts by kind, a 30-day generation
// sparkline, AI cost/error/latency rollups, credits sold-vs-consumed, a crude
// gross-margin estimate, and site traffic (sessions, entry/exit pages, bounce
// rate, and the signup-wall drop-off) derived from `page_view` events. Telemetry columns (cost_usd, latency_ms,
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

  // Traffic. page_view carries the screen in props and the URL in `path`;
  // signup_completed is fetched alongside it so the signup-wall drop-off can be
  // measured per session rather than guessed.
  let trafficQ = supabase.from('analytics_events')
    .select('session_id, event, path, props, created_at')
    .in('event', ['page_view', 'signup_completed'])
    .order('created_at', { ascending: true })
    .limit(50000);
  if (sinceIso) trafficQ = trafficQ.gte('created_at', sinceIso);

  const [aiRes, soldRes, trafficRes] = await Promise.all([aiQ, soldQ, trafficQ]);
  const firstErr = aiRes.error || soldRes.error;
  // Traffic is additive: a failure here must not blank the whole tab.
  if (trafficRes.error) console.error('[admin/product-analytics] traffic query failed (tolerated):', trafficRes.error.message);
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
    traffic: trafficBlock((trafficRes.data ?? []) as TrafficRow[]),
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

interface TrafficRow {
  session_id: string | null;
  event: string;
  path: string | null;
  props: Record<string, unknown> | null;
  created_at: string;
}

/**
 * Sessions, pages, and where people stop.
 *
 * The exit page is simply the LAST page_view of a session — no beforeunload or
 * pagehide handler, because mobile browsers drop those routinely and a missed
 * one would silently under-count the very screens we care about. The trade-off
 * is that a session still being browsed right now looks like it "exited" on its
 * current page, so exits only count sessions idle for 30+ minutes.
 *
 * Rows arrive oldest-first, so first/last per session fall out of iteration
 * order without sorting.
 */
function trafficBlock(rows: TrafficRow[]) {
  const IDLE_MS = 30 * 60_000;
  const now = Date.now();

  const label = (r: TrafficRow): string =>
    (typeof r.props?.screen === 'string' && r.props.screen) || r.path || '(unknown)';

  const views: Record<string, number> = {};
  const entry: Record<string, number> = {};
  const exit: Record<string, number> = {};
  const sessions = new Map<string, { first: string; last: string; lastAt: number; views: number; signedUp: boolean; sawLogin: boolean }>();

  for (const r of rows) {
    const key = r.session_id ?? '(none)';
    const s = sessions.get(key) ?? { first: '', last: '', lastAt: 0, views: 0, signedUp: false, sawLogin: false };

    if (r.event === 'signup_completed') {
      s.signedUp = true;
    } else {
      const name = label(r);
      views[name] = (views[name] ?? 0) + 1;
      s.views += 1;
      if (!s.first) s.first = name;
      s.last = name;
      s.lastAt = new Date(r.created_at).getTime();
      if (name === 'LOGIN' || name === '/login') s.sawLogin = true;
    }
    sessions.set(key, s);
  }

  let bounced = 0;
  let sawLogin = 0;
  let sawLoginAndSignedUp = 0;
  let endedSessions = 0;
  for (const s of sessions.values()) {
    if (s.views === 0) continue;
    if (s.first) entry[s.first] = (entry[s.first] ?? 0) + 1;
    if (s.views === 1) bounced += 1;
    if (now - s.lastAt > IDLE_MS) {
      endedSessions += 1;
      if (s.last) exit[s.last] = (exit[s.last] ?? 0) + 1;
    }
    if (s.sawLogin) {
      sawLogin += 1;
      if (s.signedUp) sawLoginAndSignedUp += 1;
    }
  }

  const top = (m: Record<string, number>) =>
    Object.entries(m).map(([page, count]) => ({ page, count })).sort((a, b) => b.count - a.count).slice(0, 8);

  const sessionCount = Array.from(sessions.values()).filter((s) => s.views > 0).length;
  const pageViews = Object.values(views).reduce((a, b) => a + b, 0);

  return {
    sessions: sessionCount,
    pageViews,
    viewsPerSession: sessionCount > 0 ? +(pageViews / sessionCount).toFixed(2) : 0,
    bounceRatePct: sessionCount > 0 ? +((bounced / sessionCount) * 100).toFixed(1) : 0,
    topPages: top(views),
    entryPages: top(entry),
    // Only sessions idle 30+ min — see the doc comment.
    exitPages: top(exit),
    endedSessions,
    signupWall: {
      sessionsReachedLogin: sawLogin,
      sessionsSignedUp: sawLoginAndSignedUp,
      abandonRatePct: sawLogin > 0 ? +(((sawLogin - sawLoginAndSignedUp) / sawLogin) * 100).toFixed(1) : 0,
    },
  };
}
