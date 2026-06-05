// GET /api/admin/settings   — env health + last activity snapshot
// POST /api/admin/settings  — { op: 'run-expiry' } manual cron trigger
//
// Sensitive env values are NEVER returned — only "present" / "missing".

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin, adminSupabase, recordAuditAction } from '../_lib/adminAuth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireAdmin(req, res)) return;

  if (req.method === 'GET') {
    const supabase = adminSupabase();
    if (!supabase) { res.status(503).json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured.' }); return; }

    const [lastConfirm, recentActivity] = await Promise.all([
      supabase
        .from('purchase_state_changes')
        .select('created_at, actor')
        .eq('to_status', 'completed')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('purchase_state_changes')
        .select('id, purchase_id, from_status, to_status, actor, reason, created_at')
        .order('created_at', { ascending: false })
        .limit(5),
    ]);

    res.status(200).json({
      env: {
        ADMIN_API_KEY: Boolean(process.env.ADMIN_API_KEY), // token-signing secret
        ADMIN_USERNAME: Boolean(process.env.ADMIN_USERNAME),
        ADMIN_PASSWORD: Boolean(process.env.ADMIN_PASSWORD_HASH || process.env.ADMIN_PASSWORD),
        BKASH_WEBHOOK_SECRET: Boolean(process.env.BKASH_WEBHOOK_SECRET),
        SUPABASE_SERVICE_ROLE_KEY: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
        CRON_SECRET: Boolean(process.env.CRON_SECRET),
        GEMINI_API_KEY: Boolean(process.env.GEMINI_API_KEY),
        GROQ_API_KEY: Boolean(process.env.GROQ_API_KEY),
      },
      lastConfirmAt: lastConfirm.data?.created_at ?? null,
      lastConfirmActor: lastConfirm.data?.actor ?? null,
      recentActivity: recentActivity.data ?? [],
      serverTimeUtc: new Date().toISOString(),
    });
    return;
  }

  if (req.method === 'POST') {
    const supabase = adminSupabase();
    if (!supabase) { res.status(503).json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured.' }); return; }
    const op = (req.body as { op?: string } | null)?.op;
    if (op !== 'run-expiry') {
      res.status(400).json({ error: 'unknown op' });
      return;
    }
    const { data, error } = await supabase.rpc('expire_stale_pending_purchases');
    if (error) {
      console.error('[admin/settings run-expiry] failed:', error.message);
      res.status(500).json({ error: 'Run failed.' });
      return;
    }
    await recordAuditAction(supabase, {
      action: 'run_expiry_now',
      targetKind: 'system',
      targetId: null,
      before: null,
      after: { expired_count: data },
      reason: 'manual operator trigger',
    });
    res.status(200).json({ success: true, expiredCount: data });
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
}
