// GET /api/admin/user-detail?id=<uuid>
//
// Returns one user's profile + recent purchases + recent generated resumes
// + AI-usage counts + notes + audit log targeting this user. Single
// round-trip for the operator's User Detail screen.

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

  const id = String((Array.isArray(req.query.id) ? req.query.id[0] : req.query.id) ?? '').trim();
  if (!id) {
    res.status(400).json({ error: 'id is required' });
    return;
  }

  const since30d = new Date(Date.now() - 30 * 24 * 3600_000).toISOString();

  const [profile, purchases, resumes, aiCalls, notes, audit] = await Promise.all([
    supabase.from('profiles').select('id, email, full_name, phone, toolkit_credits, flagged_at, created_at').eq('id', id).maybeSingle(),
    supabase.from('purchases').select('id, payment_reference, amount_taka, observed_amount_taka, status, credits_granted, created_at').eq('user_id', id).order('created_at', { ascending: false }).limit(50),
    supabase.from('generated_resumes').select('id, title, company, created_at').eq('user_id', id).order('created_at', { ascending: false }).limit(20),
    supabase.from('ai_call_log').select('id', { count: 'exact', head: true }).eq('user_id', id).gte('created_at', since30d),
    supabase.from('profile_notes').select('id, note, created_at').eq('user_id', id).order('created_at', { ascending: false }).limit(50),
    supabase.from('admin_audit_log').select('id, action, target_kind, target_id, before_state, after_state, reason, created_at').eq('target_kind', 'user').eq('target_id', id).order('created_at', { ascending: false }).limit(50),
  ]);

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

  res.status(200).json({
    profile: profile.data,
    lifetimePaid,
    purchases: purchases.data ?? [],
    resumes: resumes.data ?? [],
    aiCalls30d: aiCalls.count ?? 0,
    notes: notes.data ?? [],
    audit: audit.data ?? [],
  });
}
