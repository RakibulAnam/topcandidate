// GET /api/admin/system-health
//
// Operational health snapshot: AI cost/error/latency rollups (24h/7d/30d),
// payments pipeline health (pending backlog, orphans, confirmations), env-var
// presence flags, and server UTC time. Telemetry columns may be NULL — every
// numeric read coalesces to 0. Tables may be empty — counts default to 0.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin, adminSupabase } from '../_lib/adminAuth.js';

const HOUR_MS = 3600_000;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }
  if (!requireAdmin(req, res)) return;
  const supabase = adminSupabase();
  if (!supabase) { res.status(503).json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured.' }); return; }

  const now = Date.now();
  const iso24h = new Date(now - 24 * HOUR_MS).toISOString();
  const iso7d = new Date(now - 7 * 24 * HOUR_MS).toISOString();
  const iso30d = new Date(now - 30 * 24 * HOUR_MS).toISOString();

  const [ai24hRes, ai7dRes, ai30dRes, pendingRes, oldestPendingRes, orphanRes, expired24hRes, confirmRes, reversalRes] =
    await Promise.all([
      // AI calls in last 24h (full telemetry for rollups).
      supabase.from('ai_call_log').select('provider, cost_usd, status, latency_ms').gte('created_at', iso24h).limit(50000),
      // Cost only, 7d / 30d.
      supabase.from('ai_call_log').select('cost_usd').gte('created_at', iso7d).limit(100000),
      supabase.from('ai_call_log').select('cost_usd').gte('created_at', iso30d).limit(200000),
      // Payments pipeline.
      supabase.from('purchases').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('purchases').select('created_at').eq('status', 'pending').order('created_at', { ascending: true }).limit(1).maybeSingle(),
      supabase.from('unmatched_inbound_sms').select('id', { count: 'exact', head: true }).is('matched_to_purchase_id', null).not('payment_reference', 'like', 'PARSE_FAIL_%'),
      supabase.from('purchases').select('id', { count: 'exact', head: true }).eq('status', 'expired').gte('created_at', iso24h),
      supabase.from('purchase_state_changes').select('id', { count: 'exact', head: true }).eq('to_status', 'completed').gte('created_at', iso24h),
      supabase.from('purchase_state_changes').select('id', { count: 'exact', head: true }).eq('to_status', 'refunded').gte('created_at', iso7d),
    ]);

  // Tolerate per-query errors (empty/missing tables) — log and treat as zero.
  const logIfErr = (label: string, e: { message?: string } | null) => {
    if (e) console.error(`[admin/system-health] ${label} (tolerated):`, e.message);
  };
  logIfErr('ai24h', ai24hRes.error);
  logIfErr('ai7d', ai7dRes.error);
  logIfErr('ai30d', ai30dRes.error);
  logIfErr('pending', pendingRes.error);
  logIfErr('oldestPending', oldestPendingRes.error);
  logIfErr('orphan', orphanRes.error);
  logIfErr('expired24h', expired24hRes.error);
  logIfErr('confirm', confirmRes.error);
  logIfErr('reversal', reversalRes.error);

  // --- AI 24h rollups ---
  const ai24h = ai24hRes.data ?? [];
  let cost24h = 0;
  let errors24h = 0;
  let latSum = 0;
  let latCount = 0;
  const providerMap: Record<string, { calls: number; costUsd: number }> = {};
  for (const r of ai24h) {
    const cost = typeof r.cost_usd === 'number' ? r.cost_usd : Number(r.cost_usd) || 0;
    cost24h += cost;
    if (r.status && r.status !== 'ok' && r.status !== 'success' && r.status !== 'completed') errors24h += 1;
    const lat = typeof r.latency_ms === 'number' ? r.latency_ms : Number(r.latency_ms) || 0;
    if (lat > 0) { latSum += lat; latCount += 1; }
    const provider = r.provider ?? 'unknown';
    const pm = (providerMap[provider] ||= { calls: 0, costUsd: 0 });
    pm.calls += 1;
    pm.costUsd += cost;
  }
  const calls24h = ai24h.length;
  const errorRatePct24h = calls24h > 0 ? +((errors24h / calls24h) * 100).toFixed(2) : 0;
  const avgLatencyMs24h = latCount > 0 ? Math.round(latSum / latCount) : 0;
  const byProvider24h = Object.entries(providerMap)
    .map(([provider, v]) => ({ provider, calls: v.calls, costUsd: +v.costUsd.toFixed(4) }))
    .sort((a, b) => b.calls - a.calls);

  const sumCost = (rows: { cost_usd?: number | null }[] | null) =>
    +(rows ?? []).reduce((s, r) => s + (typeof r.cost_usd === 'number' ? r.cost_usd : Number(r.cost_usd) || 0), 0).toFixed(4);
  const costUsd7d = sumCost(ai7dRes.data);
  const costUsd30d = sumCost(ai30dRes.data);

  // --- Payments ---
  const oldestPendingAt = oldestPendingRes.data?.created_at ?? null;
  const oldestPendingMinutes = oldestPendingAt
    ? Math.max(0, Math.round((now - new Date(oldestPendingAt).getTime()) / 60000))
    : 0;

  res.status(200).json({
    ai: {
      calls24h,
      errorRatePct24h,
      avgLatencyMs24h,
      costUsd24h: +cost24h.toFixed(4),
      costUsd7d,
      costUsd30d,
      byProvider24h,
    },
    payments: {
      pending: pendingRes.count ?? 0,
      oldestPendingMinutes,
      orphanBacklog: orphanRes.count ?? 0,
      expired24h: expired24hRes.count ?? 0,
      confirmations24h: confirmRes.count ?? 0,
      reversals7d: reversalRes.count ?? 0,
    },
    env: {
      ADMIN_USERNAME: Boolean(process.env.ADMIN_USERNAME),
      ADMIN_PASSWORD: Boolean(process.env.ADMIN_PASSWORD_HASH || process.env.ADMIN_PASSWORD),
      ADMIN_API_KEY: Boolean(process.env.ADMIN_API_KEY),
      BKASH_WEBHOOK_SECRET: Boolean(process.env.BKASH_WEBHOOK_SECRET),
      SUPABASE_SERVICE_ROLE_KEY: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      CRON_SECRET: Boolean(process.env.CRON_SECRET),
      GEMINI_API_KEY: Boolean(process.env.GEMINI_API_KEY),
      GROQ_API_KEY: Boolean(process.env.GROQ_API_KEY),
    },
    serverTimeUtc: new Date().toISOString(),
  });
}
