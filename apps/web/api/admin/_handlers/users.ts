// GET /api/admin/users?q=&page=&pageSize=
//
// Search/list customer profiles. Substring search on email or id prefix.
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

  // Strict full-UUID v4 shape. Partial hex strings (e.g. "deadbeef")
  // previously slipped through and triggered Postgres "invalid input syntax
  // for type uuid" — that's the source of the "Query failed" the operator
  // saw. We only use id.eq when the value is a complete UUID.
  const FULL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  let query = supabase
    .from('profiles')
    .select('id, email, full_name, toolkit_credits, flagged_at, created_at', { count: 'exact' });

  if (q.length > 0) {
    const safe = q.replace(/[%_]/g, '');
    if (FULL_UUID.test(q)) {
      query = query.or(`id.eq.${q},email.ilike.%${safe}%`);
    } else {
      query = query.ilike('email', `%${safe}%`);
    }
  }

  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .range(page * pageSize, page * pageSize + pageSize - 1);

  if (error) {
    console.error('[admin/users] query failed:', error.message);
    // Admin endpoint — safe to surface the actual error. Operator needs it
    // to diagnose (column missing? RLS? migration not applied?).
    res.status(500).json({ error: `Supabase: ${error.message}`, code: error.code ?? null, hint: error.hint ?? null });
    return;
  }

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

  res.status(200).json({ rows: enriched, total: count ?? 0, page, pageSize });
}
