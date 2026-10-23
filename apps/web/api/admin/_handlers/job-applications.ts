// GET /api/admin/job-applications?range=week|month|all
//
// Which jobs people build kits for: one row per tailored kit (every
// generated_resumes row except the General/master resume), newest first, with
// the user, company and role. The page tallies top roles/companies itself, so
// its "hide this account" filter (kept in the admin's browser) applies to them.
//
// Company and role come from what the user typed on the start card
// (`data.targetJob.company/title`, mirrored in the `company` column). A user who
// pastes only the job post leaves both blank — the kit is then saved as
// "Resume - <date>" — so for those rows the role falls back to the first line
// of the pasted job post and `roleSource` says so. The admin page labels it.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin, adminSupabase } from '../_lib/adminAuth.js';

type Range = 'week' | 'month' | 'all';

// Must match ResumeService.GENERAL_RESUME_TITLE (the master resume's row title).
const GENERAL_RESUME_TITLE = 'General Resume';
const EXCERPT_CHARS = 600;

interface KitRow {
  id: string;
  user_id: string;
  title: string | null;
  company: string | null;
  created_at: string;
  job_company: string | null;
  job_title: string | null;
  job_description: string | null;
}

/** First meaningful line of a pasted job post, trimmed for display. */
function firstLine(jd: string): string {
  const line = jd.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length >= 3) ?? '';
  return line.length > 90 ? `${line.slice(0, 87)}…` : line;
}

const norm = (s: string) => s.trim().replace(/\s+/g, ' ');

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }
  if (!requireAdmin(req, res)) return;
  const supabase = adminSupabase();
  if (!supabase) { res.status(503).json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured.' }); return; }

  const raw = Array.isArray(req.query.range) ? req.query.range[0] : req.query.range;
  const range: Range = (['week', 'month', 'all'] as const).includes(raw as Range) ? (raw as Range) : 'all';
  const sinceIso = range === 'all' ? null : new Date(Date.now() - (range === 'week' ? 7 : 30) * 24 * 3600_000).toISOString();

  let q = supabase
    .from('generated_resumes')
    .select('id, user_id, title, company, created_at, job_company:data->targetJob->>company, job_title:data->targetJob->>title, job_description:data->targetJob->>description')
    .neq('title', GENERAL_RESUME_TITLE)
    .order('created_at', { ascending: false })
    .limit(2000);
  if (sinceIso) q = q.gte('created_at', sinceIso);

  const { data, error } = await q;
  if (error) {
    console.error('[admin/job-applications] query failed:', error.message);
    res.status(500).json({ error: 'Job applications query failed.' });
    return;
  }
  const rows = (data ?? []) as unknown as KitRow[];

  // Who built them, and whether they have ever paid.
  const userIds = [...new Set(rows.map((r) => r.user_id))];
  // Kit numbers are lifetime ("their 4th kit"), so they're counted over ALL of
  // each user's kits, not just the ones inside the selected range.
  const [profilesRes, paidRes, allKitsRes] = userIds.length
    ? await Promise.all([
        supabase.from('profiles').select('id, email, full_name').in('id', userIds),
        supabase.from('purchases').select('user_id').eq('status', 'completed').in('user_id', userIds),
        supabase.from('generated_resumes').select('id, user_id, created_at').in('user_id', userIds).neq('title', GENERAL_RESUME_TITLE).order('created_at', { ascending: true }).limit(20000),
      ])
    : [{ data: [], error: null }, { data: [], error: null }, { data: [], error: null }];
  if (profilesRes.error || paidRes.error || allKitsRes.error) {
    console.error('[admin/job-applications] lookup failed:', (profilesRes.error || paidRes.error || allKitsRes.error)?.message);
    res.status(500).json({ error: 'Job applications lookup failed.' });
    return;
  }
  const people = new Map((profilesRes.data ?? []).map((p: { id: string; email: string | null; full_name: string | null }) => [p.id, p]));
  const payers = new Set((paidRes.data ?? []).map((p: { user_id: string }) => p.user_id));

  // Kit number per user (1 = their first kit), counted oldest-first.
  const seen = new Map<string, number>();
  const kitNumber = new Map<string, number>();
  for (const r of (allKitsRes.data ?? []) as { id: string; user_id: string }[]) {
    const n = (seen.get(r.user_id) ?? 0) + 1;
    seen.set(r.user_id, n);
    kitNumber.set(r.id, n);
  }

  const kits = rows.map((r) => {
    const jd = r.job_description ?? '';
    const company = norm(r.job_company || r.company || '');
    const typedRole = norm(r.job_title || '');
    const role = typedRole || firstLine(jd);
    const person = people.get(r.user_id);
    return {
      id: r.id,
      createdAt: r.created_at,
      userId: r.user_id,
      email: person?.email ?? null,
      fullName: person?.full_name ?? null,
      company,
      role,
      roleSource: typedRole ? 'typed' : jd ? 'job_post' : 'none',
      jdExcerpt: jd.slice(0, EXCERPT_CHARS),
      jdLength: jd.length,
      kitNumber: kitNumber.get(r.id) ?? 1,
      userHasPaid: payers.has(r.user_id),
    };
  });

  res.status(200).json({ range, kits });
}
