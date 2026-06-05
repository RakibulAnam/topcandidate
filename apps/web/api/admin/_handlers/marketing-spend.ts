// POST   /api/admin/marketing-spend  — insert a marketing_spend row
//   Body: { spendDate, channel, campaign?, amountTaka, clicks?, impressions?, notes?, reason }
// DELETE /api/admin/marketing-spend?id=<uuid>&reason=<text> — delete a row
//
// Both mutate spend data and are audited via recordAuditAction. POST reads its
// reason from the body (requireReason); DELETE reads it from the query string.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin, adminSupabase, requireReason, recordAuditAction } from '../_lib/adminAuth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireAdmin(req, res)) return;
  const supabase = adminSupabase();
  if (!supabase) { res.status(503).json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured.' }); return; }

  if (req.method === 'POST') {
    const body = (req.body ?? {}) as {
      spendDate?: string; channel?: string; campaign?: string;
      amountTaka?: number; clicks?: number; impressions?: number; notes?: string;
    };
    const reason = requireReason(req.body, res);
    if (reason === null) return;

    if (typeof body.spendDate !== 'string' || body.spendDate.trim().length === 0) {
      res.status(400).json({ error: 'spendDate required' }); return;
    }
    if (typeof body.channel !== 'string' || body.channel.trim().length === 0) {
      res.status(400).json({ error: 'channel required' }); return;
    }
    if (!Number.isInteger(body.amountTaka) || (body.amountTaka as number) < 0) {
      res.status(400).json({ error: 'amountTaka must be a non-negative integer' }); return;
    }

    const row = {
      spend_date: body.spendDate,
      channel: body.channel.trim(),
      campaign: typeof body.campaign === 'string' && body.campaign.trim() ? body.campaign.trim() : null,
      amount_taka: body.amountTaka,
      clicks: Number.isInteger(body.clicks) ? body.clicks : null,
      impressions: Number.isInteger(body.impressions) ? body.impressions : null,
      notes: typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null,
    };

    const { data, error } = await supabase.from('marketing_spend').insert(row).select().maybeSingle();
    if (error) {
      console.error('[admin/marketing-spend insert] failed:', error.message);
      res.status(500).json({ error: 'Insert failed.' });
      return;
    }

    await recordAuditAction(supabase, {
      action: 'marketing_spend_add',
      targetKind: 'system',
      targetId: null,
      before: null,
      after: data as Record<string, unknown> | null,
      reason,
    });
    res.status(200).json({ success: true, row: data });
    return;
  }

  if (req.method === 'DELETE') {
    const rawId = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
    if (!rawId) { res.status(400).json({ error: 'id required' }); return; }
    const rawReason = Array.isArray(req.query.reason) ? req.query.reason[0] : req.query.reason;
    const reason = typeof rawReason === 'string' ? rawReason.trim() : '';
    if (!reason) { res.status(400).json({ error: 'reason is required' }); return; }

    const { data: before } = await supabase.from('marketing_spend').select('*').eq('id', rawId).maybeSingle();
    if (!before) { res.status(404).json({ error: 'Spend row not found' }); return; }

    const { error } = await supabase.from('marketing_spend').delete().eq('id', rawId);
    if (error) {
      console.error('[admin/marketing-spend delete] failed:', error.message);
      res.status(500).json({ error: 'Delete failed.' });
      return;
    }

    await recordAuditAction(supabase, {
      action: 'marketing_spend_delete',
      targetKind: 'system',
      targetId: null,
      before: before as Record<string, unknown> | null,
      after: null,
      reason,
    });
    res.status(200).json({ success: true });
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
}
