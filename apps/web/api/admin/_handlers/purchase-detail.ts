// GET /api/admin/purchase-detail?id=<purchase-uuid> OR ?trxId=<TrxID>
//
// Full lifecycle for one purchase: row + customer + state changes + top-ups
// + overpayments + linked orphan SMS + audit entries.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin, adminSupabase } from '../_lib/adminAuth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!requireAdmin(req, res)) return;
  const supabase = adminSupabase();
  if (!supabase) { res.status(503).json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured.' }); return; }

  const param = (name: string) => {
    const v = req.query[name];
    return Array.isArray(v) ? v[0] : v;
  };

  const id = String(param('id') ?? '').trim();
  const trxId = String(param('trxId') ?? '').trim();
  if (!id && !trxId) {
    res.status(400).json({ error: 'id or trxId required' });
    return;
  }

  const lookup = id
    ? supabase.from('purchases').select('*').eq('id', id).maybeSingle()
    : supabase.from('purchases').select('*').eq('payment_reference', trxId).maybeSingle();

  const { data: purchase, error: pErr } = await lookup;
  if (pErr || !purchase) {
    res.status(404).json({ error: 'Purchase not found' });
    return;
  }

  const [profile, stateChanges, topups, overpayments, orphan, audit] = await Promise.all([
    supabase.from('profiles').select('id, email, full_name, toolkit_credits, flagged_at').eq('id', purchase.user_id).maybeSingle(),
    supabase.from('purchase_state_changes').select('*').eq('purchase_id', purchase.id).order('created_at', { ascending: true }),
    supabase.from('purchase_topups').select('*').eq('purchase_id', purchase.id).order('created_at', { ascending: true }),
    supabase.from('purchase_overpayments').select('*').eq('purchase_id', purchase.id),
    supabase.from('unmatched_inbound_sms').select('*').eq('matched_to_purchase_id', purchase.id),
    supabase.from('admin_audit_log').select('*').eq('target_kind', 'purchase').eq('target_id', purchase.id).order('created_at', { ascending: false }).limit(50),
  ]);

  res.status(200).json({
    purchase,
    customer: profile.data,
    stateChanges: stateChanges.data ?? [],
    topups: topups.data ?? [],
    overpayments: overpayments.data ?? [],
    linkedSms: orphan.data ?? [],
    audit: audit.data ?? [],
  });
}
