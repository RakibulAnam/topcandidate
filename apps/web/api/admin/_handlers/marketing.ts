// GET /api/admin/marketing?range=day|week|month|all
//
// Acquisition mix, the activation funnel, per-channel ROAS, and the raw spend
// rows for the selected range. The funnel reads analytics_events, which may be
// EMPTY initially — every step zero-fills rather than erroring. Money is taka.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin, adminSupabase } from '../_lib/adminAuth.js';

type Range = 'day' | 'week' | 'month' | 'all';

const FUNNEL_STEPS = [
  'landing_viewed',
  'signup_completed',
  'profile_setup_completed',
  'resume_generation_completed',
  'purchase_modal_opened',
  'purchase_confirmed',
] as const;

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

  // Profiles in range (acquisition by utm_source; also maps source per user).
  let profilesQ = supabase.from('profiles').select('id, utm_source, created_at').limit(50000);
  if (sinceIso) profilesQ = profilesQ.gte('created_at', sinceIso);

  // Completed purchases in range (channel revenue, joined by user's utm_source).
  let purchasesQ = supabase.from('purchases').select('user_id, amount_taka, created_at').eq('status', 'completed').limit(20000);
  if (sinceIso) purchasesQ = purchasesQ.gte('created_at', sinceIso);

  // Funnel events in range.
  let eventsQ = supabase.from('analytics_events').select('event, user_id, anon_id, created_at').in('event', FUNNEL_STEPS as unknown as string[]).limit(100000);
  if (sinceIso) eventsQ = eventsQ.gte('created_at', sinceIso);

  // Spend rows in range.
  let spendQ = supabase.from('marketing_spend').select('id, spend_date, channel, campaign, amount_taka, clicks, impressions, notes, created_at').order('spend_date', { ascending: false }).limit(5000);
  // marketing_spend is dated by spend_date (a date col); filter on it when ranged.
  if (sinceIso) spendQ = spendQ.gte('spend_date', sinceIso.slice(0, 10));

  const [profilesRes, purchasesRes, eventsRes, spendRes] = await Promise.all([profilesQ, purchasesQ, eventsQ, spendQ]);

  // analytics_events may be empty/absent — tolerate. Others are core.
  const firstErr = profilesRes.error || purchasesRes.error || spendRes.error;
  if (firstErr) {
    console.error('[admin/marketing] query failed:', firstErr.message);
    res.status(500).json({ error: 'Marketing query failed.' });
    return;
  }
  if (eventsRes.error) {
    console.error('[admin/marketing] analytics_events read (tolerated, treating as empty):', eventsRes.error.message);
  }

  const profiles = profilesRes.data ?? [];

  // Acquisition: signups grouped by coalesce(utm_source, '(direct)').
  const acqMap: Record<string, number> = {};
  const sourceByUser: Record<string, string> = {};
  for (const p of profiles) {
    const src = p.utm_source ?? '(direct)';
    acqMap[src] = (acqMap[src] ?? 0) + 1;
    sourceByUser[p.id] = src;
  }
  const acquisition = Object.entries(acqMap)
    .map(([source, signups]) => ({ source, signups }))
    .sort((a, b) => b.signups - a.signups);

  // Funnel: distinct coalesce(user_id::text, anon_id) per event.
  const distinctByEvent: Record<string, Set<string>> = {};
  for (const step of FUNNEL_STEPS) distinctByEvent[step] = new Set();
  for (const e of eventsRes.data ?? []) {
    const key = e.user_id ?? e.anon_id;
    if (e.event && distinctByEvent[e.event] && key) distinctByEvent[e.event].add(String(key));
  }
  const funnel = FUNNEL_STEPS.map((step) => ({ step, count: distinctByEvent[step].size }));

  // Channels: per marketing_spend.channel — spend, signups (utm_source=channel),
  // revenue (completed purchases by users whose utm_source=channel), cac, roas.
  const spendRowsRaw = spendRes.data ?? [];
  const spendByChannel: Record<string, number> = {};
  for (const s of spendRowsRaw) {
    const ch = s.channel ?? '(unknown)';
    spendByChannel[ch] = (spendByChannel[ch] ?? 0) + (s.amount_taka ?? 0);
  }
  const signupsByChannel: Record<string, number> = {};
  for (const src of Object.values(sourceByUser)) {
    signupsByChannel[src] = (signupsByChannel[src] ?? 0) + 1;
  }
  const revenueByChannel: Record<string, number> = {};
  for (const r of purchasesRes.data ?? []) {
    if (!r.user_id) continue;
    const src = sourceByUser[r.user_id];
    if (!src) continue; // purchaser not signed up in range / unknown channel
    revenueByChannel[src] = (revenueByChannel[src] ?? 0) + (r.amount_taka ?? 0);
  }

  const channels = Object.keys(spendByChannel).map((channel) => {
    const spendTaka = spendByChannel[channel] ?? 0;
    const signups = signupsByChannel[channel] ?? 0;
    const revenueTaka = revenueByChannel[channel] ?? 0;
    const cacTaka = signups > 0 ? Math.round(spendTaka / signups) : 0;
    const roas = spendTaka > 0 ? +(revenueTaka / spendTaka).toFixed(2) : 0;
    return { channel, spendTaka, signups, revenueTaka, cacTaka, roas };
  }).sort((a, b) => b.spendTaka - a.spendTaka);

  const spendRows = spendRowsRaw
    .slice()
    .sort((a, b) => String(b.spend_date).localeCompare(String(a.spend_date)))
    .map((s) => ({
      id: s.id,
      spendDate: s.spend_date,
      channel: s.channel,
      campaign: s.campaign ?? null,
      amountTaka: s.amount_taka ?? 0,
      clicks: s.clicks ?? 0,
      impressions: s.impressions ?? 0,
      notes: s.notes ?? null,
    }));

  res.status(200).json({ range, acquisition, funnel, channels, spendRows });
}
