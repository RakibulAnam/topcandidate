// GET /api/admin/resume-detail?id=<uuid>
//
// One generated resume with its full content (the resume JSON in `data` and
// the job toolkit in `toolkit`), for the read-only viewer on the admin User
// Detail screen. Read-only — no audit row written, same as user-detail.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin, adminSupabase } from '../_lib/adminAuth.js';

const FULL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  if (!FULL_UUID.test(id)) {
    res.status(400).json({ error: 'id must be a resume UUID' });
    return;
  }

  const { data, error } = await supabase
    .from('generated_resumes')
    .select('id, user_id, title, company, generation_type, data, toolkit, created_at, updated_at')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    res.status(500).json({ error: `Supabase: ${error.message}`, code: error.code, hint: error.hint });
    return;
  }
  if (!data) {
    res.status(404).json({ error: 'Resume not found' });
    return;
  }
  res.status(200).json({ resume: data });
}
