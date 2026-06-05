// GET /api/admin/customer-intelligence
//
// Customer segmentation + lists for the CRM-ish admin tab. No range filter —
// these are lifetime / current-state views. We fetch bounded row sets and
// segment in JS (supabase-js has no aggregate sugar).
//
// Segment defs:
//   paying          = distinct users with >=1 completed purchase
//   whales          = payers with >=2 completed purchases
//   dormantPayers   = payers whose lastActive < now-30d (a.k.a. atRisk list)
//   neverPurchased  = profiles with 0 completed purchases
//   negativeBalance = profiles.toolkit_credits < 0
//   fastBurners     = users with >=5 'optimize' calls in the last 7 days
//
// lastActive = greatest of profiles.last_active_at, max analytics_events.created_at,
//              and max ai_call_log.created_at for that user.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin, adminSupabase } from '../_lib/adminAuth.js';

const DAY_MS = 24 * 3600_000;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }
  if (!requireAdmin(req, res)) return;
  const supabase = adminSupabase();
  if (!supabase) { res.status(503).json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured.' }); return; }

  const now = Date.now();
  const thirtyAgoMs = now - 30 * DAY_MS;
  const sevenAgoIso = new Date(now - 7 * DAY_MS).toISOString();

  const [completedRes, profilesRes, resumesRes, optimizeRes, eventsRes, aiRes] = await Promise.all([
    // Completed purchases (for lifetime value + paying segments).
    supabase.from('purchases').select('user_id, amount_taka, credits_granted').eq('status', 'completed').limit(50000),
    // Profiles snapshot.
    supabase.from('profiles').select('id, email, toolkit_credits, last_active_at, created_at').limit(50000),
    // Generated resumes (for warm leads: has >=1 resume).
    supabase.from('generated_resumes').select('user_id, created_at').limit(50000),
    // 'optimize' calls in last 7d (fast burners).
    supabase.from('ai_call_log').select('user_id').eq('kind', 'optimize').gte('created_at', sevenAgoIso).limit(50000),
    // Recent activity signals (bounded — used to refine lastActive for at-risk payers).
    supabase.from('analytics_events').select('user_id, created_at').not('user_id', 'is', null).order('created_at', { ascending: false }).limit(50000),
    supabase.from('ai_call_log').select('user_id, created_at').order('created_at', { ascending: false }).limit(50000),
  ]);

  const firstErr = completedRes.error || profilesRes.error || resumesRes.error || optimizeRes.error || aiRes.error;
  // analytics_events may be empty/absent — tolerate its error rather than fail.
  if (firstErr) {
    console.error('[admin/customer-intelligence] query failed:', firstErr.message);
    res.status(500).json({ error: 'Customer intelligence query failed.' });
    return;
  }
  if (eventsRes.error) {
    console.error('[admin/customer-intelligence] analytics_events read (tolerated):', eventsRes.error.message);
  }

  // Lifetime value per user.
  const lifetime: Record<string, { taka: number; purchases: number; credits: number }> = {};
  for (const r of completedRes.data ?? []) {
    if (!r.user_id) continue;
    const e = (lifetime[r.user_id] ||= { taka: 0, purchases: 0, credits: 0 });
    e.taka += r.amount_taka ?? 0;
    e.purchases += 1;
    e.credits += r.credits_granted ?? 0;
  }
  const payerIds = Object.keys(lifetime);
  const whaleIds = payerIds.filter((id) => lifetime[id].purchases >= 2);

  // Profiles lookup.
  const profiles = profilesRes.data ?? [];
  const profileById: Record<string, { email: string | null; toolkit_credits: number | null; last_active_at: string | null }> = {};
  for (const p of profiles) {
    profileById[p.id] = { email: p.email ?? null, toolkit_credits: p.toolkit_credits ?? null, last_active_at: p.last_active_at ?? null };
  }

  // Resumes per user (warm leads).
  const resumeCount: Record<string, number> = {};
  const resumeFirstSeen: Record<string, string> = {}; // joined proxy: profile created_at used below
  for (const r of resumesRes.data ?? []) {
    if (!r.user_id) continue;
    resumeCount[r.user_id] = (resumeCount[r.user_id] ?? 0) + 1;
    if (!resumeFirstSeen[r.user_id]) resumeFirstSeen[r.user_id] = r.created_at;
  }

  // Fast burners: >=5 optimize calls in 7d.
  const optimizeCount: Record<string, number> = {};
  for (const r of optimizeRes.data ?? []) {
    if (!r.user_id) continue;
    optimizeCount[r.user_id] = (optimizeCount[r.user_id] ?? 0) + 1;
  }
  const fastBurners = Object.values(optimizeCount).filter((c) => c >= 5).length;

  // Max activity timestamp per user from events + ai log.
  const maxActivity: Record<string, number> = {};
  const bump = (uid: string | null, ts: string | null) => {
    if (!uid || !ts) return;
    const t = new Date(ts).getTime();
    if (!maxActivity[uid] || t > maxActivity[uid]) maxActivity[uid] = t;
  };
  for (const r of eventsRes.data ?? []) bump(r.user_id, r.created_at);
  for (const r of aiRes.data ?? []) bump(r.user_id, r.created_at);

  const lastActiveMs = (uid: string): number => {
    const fromProfile = profileById[uid]?.last_active_at ? new Date(profileById[uid].last_active_at as string).getTime() : 0;
    return Math.max(fromProfile, maxActivity[uid] ?? 0);
  };
  const lastActiveIso = (uid: string): string | null => {
    const ms = lastActiveMs(uid);
    return ms > 0 ? new Date(ms).toISOString() : null;
  };

  // Segments.
  const payingSet = new Set(payerIds);
  const negativeBalanceProfiles = profiles.filter((p) => (p.toolkit_credits ?? 0) < 0);
  const neverPurchased = profiles.filter((p) => !payingSet.has(p.id)).length;
  const dormantPayers = payerIds.filter((id) => lastActiveMs(id) < thirtyAgoMs).length;
  // warmLeads segment count: has >=1 resume AND not a payer.
  const warmLeadIds = Object.keys(resumeCount).filter((id) => !payingSet.has(id));

  const segments = {
    warmLeads: warmLeadIds.length,
    whales: whaleIds.length,
    dormantPayers,
    neverPurchased,
    negativeBalance: negativeBalanceProfiles.length,
    fastBurners,
  };

  // Top 20 customers by lifetime taka.
  const topCustomers = payerIds
    .map((id) => ({ userId: id, email: profileById[id]?.email ?? null, lifetimeTaka: lifetime[id].taka, purchases: lifetime[id].purchases, credits: lifetime[id].credits }))
    .sort((a, b) => b.lifetimeTaka - a.lifetimeTaka)
    .slice(0, 20);

  // 20 most-recent warm leads (by resume created_at proxy / profile created_at).
  const warmLeads = warmLeadIds
    .map((id) => ({
      userId: id,
      email: profileById[id]?.email ?? null,
      resumes: resumeCount[id],
      joined: resumeFirstSeen[id] ?? null,
      _sort: resumeFirstSeen[id] ? new Date(resumeFirstSeen[id]).getTime() : 0,
    }))
    .sort((a, b) => b._sort - a._sort)
    .slice(0, 20)
    .map(({ _sort, ...rest }) => rest);

  // At-risk: payers whose lastActive < now-30d, newest-inactive first.
  const atRisk = payerIds
    .filter((id) => lastActiveMs(id) < thirtyAgoMs)
    .map((id) => ({ userId: id, email: profileById[id]?.email ?? null, lifetimeTaka: lifetime[id].taka, lastActive: lastActiveIso(id), _sort: lastActiveMs(id) }))
    .sort((a, b) => b._sort - a._sort)
    .slice(0, 20)
    .map(({ _sort, ...rest }) => rest);

  const negativeBalanceUsers = negativeBalanceProfiles
    .map((p) => ({ userId: p.id, email: p.email ?? null, credits: p.toolkit_credits ?? 0 }))
    .sort((a, b) => a.credits - b.credits)
    .slice(0, 50);

  res.status(200).json({
    segments,
    topCustomers,
    warmLeads,
    atRisk,
    negativeBalanceUsers,
  });
}
