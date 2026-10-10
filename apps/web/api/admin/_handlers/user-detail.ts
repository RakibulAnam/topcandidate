// GET /api/admin/user-detail?id=<uuid>
//
// Returns one user's profile + activation funnel (v_admin_user_funnel, migration
// 031) + profile background (jobs, education, skills, projects) + recent purchases + recent generated resumes + recent product events +
// AI-usage counts + notes + audit log targeting this user. Single round-trip
// for the operator's User Detail screen.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin, adminSupabase } from '../_lib/adminAuth.js';

const toList = (v: unknown): string[] => {
  if (Array.isArray(v)) return v.map(String).map((s) => s.trim()).filter(Boolean);
  if (typeof v === 'string') return v.split(',').map((s) => s.trim()).filter(Boolean);
  return [];
};

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

  const id = String((Array.isArray(req.query.id) ? req.query.id[0] : req.query.id) ?? '').trim();
  if (!id) {
    res.status(400).json({ error: 'id is required' });
    return;
  }

  const since30d = new Date(Date.now() - 30 * 24 * 3600_000).toISOString();

  const [profile, purchases, resumes, aiCalls, notes, audit, funnel, events, experiences, educations, skills, projects] = await Promise.all([
    supabase.from('profiles').select('id, email, full_name, phone, location, linkedin, github, website, user_type, toolkit_credits, flagged_at, created_at').eq('id', id).maybeSingle(),
    supabase.from('purchases').select('id, payment_reference, amount_taka, observed_amount_taka, status, credits_granted, created_at').eq('user_id', id).order('created_at', { ascending: false }).limit(50),
    supabase.from('generated_resumes').select('id, title, company, job_title:data->targetJob->>title, created_at').eq('user_id', id).order('created_at', { ascending: false }).limit(20),
    supabase.from('ai_call_log').select('id', { count: 'exact', head: true }).eq('user_id', id).gte('created_at', since30d),
    supabase.from('profile_notes').select('id, note, created_at').eq('user_id', id).order('created_at', { ascending: false }).limit(50),
    supabase.from('admin_audit_log').select('id, action, target_kind, target_id, before_state, after_state, reason, created_at').eq('target_kind', 'user').eq('target_id', id).order('created_at', { ascending: false }).limit(50),
    // Tolerated if migration 031 isn't applied yet — the rest of the screen still works.
    supabase.from('v_admin_user_funnel').select('stage, onboarding_complete, user_type, location, utm_source, utm_medium, utm_campaign, signup_referrer, experience_count, education_count, skill_count, project_count, general_at, tailored_count, first_tailored_at, paid_count, first_paid_at, last_active_at').eq('id', id).maybeSingle(),
    supabase.from('analytics_events').select('id, event, props, path, created_at').eq('user_id', id).order('created_at', { ascending: false }).limit(50),
    // Profile overview ("who is this user") — titles and dates only, no long-form text.
    supabase.from('experiences').select('id, role, company, start_date, end_date, is_current').eq('user_id', id).limit(50),
    supabase.from('educations').select('id, degree, field, school, start_date, end_date').eq('user_id', id).limit(20),
    supabase.from('skills').select('name').eq('user_id', id).order('created_at', { ascending: true }).limit(100),
    supabase.from('projects').select('id, name, technologies').eq('user_id', id).limit(20),
  ]);
  if (funnel.error) console.warn('[admin/user-detail] funnel view read (tolerated):', funnel.error.message);
  if (events.error) console.warn('[admin/user-detail] analytics_events read (tolerated):', events.error.message);

  if (profile.error) {
    res.status(500).json({ error: `Supabase: ${profile.error.message}`, code: profile.error.code, hint: profile.error.hint });
    return;
  }
  if (!profile.data) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  // Lifetime paid sum (completed only)
  const lifetimePaid = (purchases.data ?? [])
    .filter((p) => p.status === 'completed')
    .reduce((sum, p) => sum + (p.amount_taka ?? 0), 0);

  // True login email from auth.users (profiles.email can drift).
  let loginEmail: string | null = null;
  const { data: emails } = await supabase.rpc('admin_auth_emails', { p_ids: [id] });
  if (Array.isArray(emails) && emails[0]) loginEmail = (emails[0] as { email: string }).email;
  const emailMismatch = Boolean(loginEmail && profile.data.email && loginEmail.toLowerCase() !== String(profile.data.email).toLowerCase());

  res.status(200).json({
    profile: profile.data,
    loginEmail,
    emailMismatch,
    lifetimePaid,
    purchases: purchases.data ?? [],
    resumes: resumes.data ?? [],
    aiCalls30d: aiCalls.count ?? 0,
    funnel: funnel.data ?? null,
    events: events.data ?? [],
    background: {
      experiences: experiences.data ?? [],
      educations: educations.data ?? [],
      skills: (skills.data ?? []).map((r) => r.name).filter((n): n is string => Boolean(n && n.trim())),
      // projects.technologies is plain TEXT in prod (schema.sql says text[]) —
      // normalize to string[] so the client gets one shape either way.
      projects: (projects.data ?? []).map((pr) => ({ ...pr, technologies: toList(pr.technologies) })),
    },
    notes: notes.data ?? [],
    audit: audit.data ?? [],
  });
}
