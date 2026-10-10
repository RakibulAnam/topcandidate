// GET /api/admin/users?q=&page=&pageSize=&stage=
//
// Search/list customer profiles (email, name, headline role/company, or full
// UUID) with their activation stage (v_admin_user_funnel,
// migration 031). `stage` filters to one
// funnel step. Also returns `funnel` — per-stage counts across ALL users (not the
// current search) for the funnel strip.
// Auth: Bearer session token (owner login). Read-only — no audit row written.
//
// Uses the pg_trgm GIN index from migration 009 for fast email substring
// search. UUID prefix match falls back to equality on full UUID input.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin, adminSupabase } from '../_lib/adminAuth.js';

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

  const q = String((Array.isArray(req.query.q) ? req.query.q[0] : req.query.q) ?? '').trim();
  const page = Math.max(0, Number((Array.isArray(req.query.page) ? req.query.page[0] : req.query.page) ?? 0));
  const pageSize = Math.min(100, Math.max(10, Number((Array.isArray(req.query.pageSize) ? req.query.pageSize[0] : req.query.pageSize) ?? 50)));

  const STAGES = ['signed_up', 'profile_started', 'profile_complete', 'general_resume', 'tailored', 'paid'] as const;
  const stageParam = String((Array.isArray(req.query.stage) ? req.query.stage[0] : req.query.stage) ?? '');
  const stage = (STAGES as readonly string[]).includes(stageParam) ? stageParam : null;

  // Strict full-UUID v4 shape. Partial hex strings (e.g. "deadbeef")
  // previously slipped through and triggered Postgres "invalid input syntax
  // for type uuid" — that's the source of the "Query failed" the operator
  // saw. We only use id.eq when the value is a complete UUID.
  const FULL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  let query = supabase
    .from('v_admin_user_funnel')
    .select('id, email, full_name, toolkit_credits, flagged_at, created_at, onboarding_complete, user_type, utm_source, signup_referrer, headline_role, headline_company, experience_count, education_count, skill_count, project_count, general_at, tailored_count, paid_count, last_active_at, stage', { count: 'exact' });

  if (stage) query = query.eq('stage', stage);

  if (q.length > 0) {
    const safe = q.replace(/[%_]/g, '');
    if (FULL_UUID.test(q)) {
      query = query.or(`id.eq.${q},email.ilike.%${safe}%`);
    } else {
      // Email, name, or headline job ("banker", "software engineer") — so the
      // operator can pull everyone in one line of work for a targeted email.
      // PostgREST or() syntax: strip characters that would break the filter.
      const term = safe.replace(/[,()*"\\]/g, ' ').trim();
      query = query.or(`email.ilike.%${term}%,full_name.ilike.%${term}%,headline_role.ilike.%${term}%,headline_company.ilike.%${term}%`);
    }
  }

  // Per-stage counts via head-only count queries (exact, and not subject to
  // PostgREST's max-rows cap the way fetching every row would be).
  const [{ data, error, count }, ...stageCounts] = await Promise.all([
    query.order('created_at', { ascending: false }).range(page * pageSize, page * pageSize + pageSize - 1),
    ...STAGES.map((s) => supabase.from('v_admin_user_funnel').select('id', { count: 'exact', head: true }).eq('stage', s)),
  ]);

  if (error) {
    console.error('[admin/users] query failed:', error.message);
    // Admin endpoint — safe to surface the actual error. Operator needs it
    // to diagnose (column missing? RLS? migration not applied?).
    const missingView = error.code === '42P01' || /v_admin_user_funnel/.test(error.message);
    res.status(500).json({
      error: missingView ? 'Users view missing — run supabase/migrations/031_admin_user_funnel.sql in the Supabase SQL editor.' : `Supabase: ${error.message}`,
      code: error.code ?? null,
      hint: error.hint ?? null,
    });
    return;
  }

  // Funnel strip: users who REACHED each step (a paid user also counts as
  // signed up, profile complete, …), so the numbers read as a funnel.
  const atStage: Record<string, number> = Object.fromEntries(STAGES.map((s, i) => [s, stageCounts[i].count ?? 0]));
  const reached: Record<string, number> = {};
  let running = 0;
  for (let i = STAGES.length - 1; i >= 0; i--) { running += atStage[STAGES[i]]; reached[STAGES[i]] = running; }

  // Enrich with the TRUE login email from auth.users (profiles.email is an
  // app-managed column that can drift from the real login). loginEmail is the
  // source of truth; emailMismatch flags rows where the two diverge.
  const rows = data ?? [];
  const emailMap = new Map<string, string>();
  if (rows.length > 0) {
    const { data: emails, error: emailErr } = await supabase.rpc('admin_auth_emails', { p_ids: rows.map((r) => r.id) });
    if (emailErr) console.warn('[admin/users] auth-email lookup failed:', emailErr.message);
    for (const e of (emails as { id: string; email: string }[] | null) ?? []) emailMap.set(e.id, e.email);
  }
  const enriched = rows.map((r) => {
    const loginEmail = emailMap.get(r.id) ?? null;
    return {
      ...r,
      loginEmail,
      emailMismatch: Boolean(loginEmail && r.email && loginEmail.toLowerCase() !== String(r.email).toLowerCase()),
    };
  });

  res.status(200).json({ rows: enriched, total: count ?? 0, page, pageSize, funnel: { reached, atStage } });
}
