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

  const [ai24hRes, ai7dRes, ai30dRes, pendingRes, oldestPendingRes, orphanRes, expired24hRes, confirmRes, reversalRes, loginAttemptsRes,
         browserRes, ipSignalRes, freeCallsRes, payersRes] =
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
      // Admin login attempts, 24h (migration 026). One fetch, rolled up below —
      // cheaper than five counts, and the table is pruned to 90 days.
      supabase.from('admin_login_attempts').select('ip, outcome, created_at').gte('created_at', iso24h).order('created_at', { ascending: false }).limit(5000),
      // Abuse signals. One browser (anon_id, localStorage) seen on several
      // accounts, and one network origin (migration 027) seen on several
      // accounts — the two cheap tells for someone farming free generations
      // with throwaway emails.
      supabase.from('analytics_events').select('anon_id, user_id').not('user_id', 'is', null).not('anon_id', 'is', null).limit(50000),
      supabase.from('account_ip_signals').select('ip_hash, user_id').limit(50000),
      // Free-tier spend by accounts that have never completed a purchase — the
      // number that decides whether any of this is worth acting on.
      supabase.from('ai_call_log').select('user_id, cost_usd').in('kind', ['optimize_general', 'normalize', 'extract_resume']).gte('created_at', iso30d).limit(50000),
      supabase.from('purchases').select('user_id').eq('status', 'completed').limit(50000),
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
  logIfErr('loginAttempts', loginAttemptsRes.error);
  logIfErr('browserSignals', browserRes.error);
  logIfErr('ipSignals', ipSignalRes.error);
  logIfErr('freeCalls', freeCallsRes.error);
  logIfErr('payers', payersRes.error);

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

  // --- Admin access (24h) ---
  // `locked` mirrors the ladder's first rung: 5+ failures from one IP inside the
  // 15-minute window. It's a read-only estimate for the operator's benefit — the
  // authoritative decision is made by begin_admin_login_attempt at login time.
  const attempts = (loginAttemptsRes.data ?? []) as { ip: string; outcome: string; created_at: string }[];
  const window15mAgo = now - 15 * 60_000;
  const failuresByIp: Record<string, number> = {};
  const recentFailuresByIp: Record<string, number> = {};
  let failures24h = 0;
  let blocked24h = 0;
  let lastFailureAt: string | null = null;
  let lastSuccessAt: string | null = null;
  for (const a of attempts) {
    const isFailure = a.outcome === 'failure' || a.outcome === 'blocked';
    if (a.outcome === 'failure') failures24h += 1;
    if (a.outcome === 'blocked') blocked24h += 1;
    if (isFailure) {
      failuresByIp[a.ip] = (failuresByIp[a.ip] ?? 0) + 1;
      if (new Date(a.created_at).getTime() >= window15mAgo) {
        recentFailuresByIp[a.ip] = (recentFailuresByIp[a.ip] ?? 0) + 1;
      }
      // Rows arrive newest-first, so the first one wins.
      if (!lastFailureAt) lastFailureAt = a.created_at;
    }
    if (a.outcome === 'success' && !lastSuccessAt) lastSuccessAt = a.created_at;
  }
  const topIps24h = Object.entries(failuresByIp)
    .map(([ip, failures]) => ({ ip, failures }))
    .sort((a, b) => b.failures - a.failures)
    .slice(0, 5);

  // --- Abuse signals ---
  // Counting DISTINCT accounts per browser / per origin. Sharing is normal in
  // small numbers (a family laptop, an office network, a user who re-registers),
  // so the operator sees the distribution rather than a verdict.
  const distinctBy = (rows: { key: string; user: string }[]) => {
    const map: Record<string, Set<string>> = {};
    for (const r of rows) (map[r.key] ||= new Set()).add(r.user);
    return Object.entries(map)
      .map(([key, users]) => ({ key, accounts: users.size }))
      .filter((r) => r.accounts > 1)
      .sort((a, b) => b.accounts - a.accounts);
  };

  const byBrowser = distinctBy(((browserRes.data ?? []) as { anon_id: string; user_id: string }[])
    .map((r) => ({ key: r.anon_id, user: r.user_id })));
  const byOrigin = distinctBy(((ipSignalRes.data ?? []) as { ip_hash: string; user_id: string }[])
    .map((r) => ({ key: r.ip_hash, user: r.user_id })));

  const payers = new Set(((payersRes.data ?? []) as { user_id: string }[]).map((r) => r.user_id));
  let freeSpendNonPayersUsd = 0;
  let freeCallsNonPayers = 0;
  const nonPayerIds = new Set<string>();
  for (const r of (freeCallsRes.data ?? []) as { user_id: string; cost_usd: number | null }[]) {
    if (payers.has(r.user_id)) continue;
    freeCallsNonPayers += 1;
    nonPayerIds.add(r.user_id);
    freeSpendNonPayersUsd += typeof r.cost_usd === 'number' ? r.cost_usd : Number(r.cost_usd) || 0;
  }

  res.status(200).json({
    abuseSignals: {
      // Top few only — the operator wants "is anything unusual", not a dump.
      multiAccountBrowsers: byBrowser.length,
      topBrowsers: byBrowser.slice(0, 5).map((r) => ({ id: r.key.slice(0, 8), accounts: r.accounts })),
      multiAccountOrigins: byOrigin.length,
      topOrigins: byOrigin.slice(0, 5).map((r) => ({ id: r.key.slice(0, 8), accounts: r.accounts })),
      freeCallsNonPayers30d: freeCallsNonPayers,
      freeSpendNonPayersUsd30d: +freeSpendNonPayersUsd.toFixed(4),
      nonPayingAccountsGenerating30d: nonPayerIds.size,
    },
    adminAccess: {
      failures24h,
      blocked24h,
      distinctFailingIps24h: Object.keys(failuresByIp).length,
      lockedIpsNow: Object.values(recentFailuresByIp).filter((n) => n >= 5).length,
      lastFailureAt,
      lastSuccessAt,
      topIps24h,
      // Which credential store is actually in force. The hash is preferred; the
      // plaintext env var still authenticates when no hash is configured, and
      // the operator should be able to see which one they're on.
      credentialStore: process.env.ADMIN_PASSWORD_HASH ? 'hash' : process.env.ADMIN_PASSWORD ? 'plaintext' : 'none',
      sessionTtlHours: 12,
    },
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
      // Either-or by design — see adminAccess.credentialStore above for WHICH of
      // the two is in force. A single `ADMIN_PASSWORD` line here read as "set"
      // whichever one was present, which hid a plaintext-only setup.
      'ADMIN_PASSWORD_HASH|ADMIN_PASSWORD': Boolean(process.env.ADMIN_PASSWORD_HASH || process.env.ADMIN_PASSWORD),
      ADMIN_API_KEY: Boolean(process.env.ADMIN_API_KEY),
      BKASH_WEBHOOK_SECRET: Boolean(process.env.BKASH_WEBHOOK_SECRET),
      SUPABASE_SERVICE_ROLE_KEY: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      CRON_SECRET: Boolean(process.env.CRON_SECRET),
      // GEMINI_API_KEY is the ONLY AI key now — GROQ_API_KEY was dropped with the
      // OpenRouter exit. Reporting a key nothing reads would show a permanent
      // red-looking `false` in the health panel and imply a misconfiguration.
      GEMINI_API_KEY: Boolean(process.env.GEMINI_API_KEY),
    },
    serverTimeUtc: new Date().toISOString(),
  });
}
