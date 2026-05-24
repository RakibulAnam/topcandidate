// GET /api/admin/orphans
//
// List orphan SMS rows (no matching pending purchase). The /admin Orphans
// tab uses this for the manual-match workflow.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin, adminSupabase } from './_lib/adminAuth.js';

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

  const { data, error } = await supabase
    .from('unmatched_inbound_sms')
    .select('id, payment_reference, sender_msisdn, amount_taka, raw_body, sms_timestamp, created_at')
    .is('matched_to_purchase_id', null)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) {
    console.error('[admin/orphans] query failed:', error.message);
    res.status(500).json({ error: 'Query failed.' });
    return;
  }

  // Also surface the current pending rows so the operator can match without
  // a second round-trip.
  const { data: pending } = await supabase
    .from('purchases')
    .select('id, user_id, payment_reference, amount_taka, observed_amount_taka, status, created_at')
    .in('status', ['pending', 'underpaid'])
    .order('created_at', { ascending: true })
    .limit(50);

  res.status(200).json({ rows: data ?? [], pending: pending ?? [] });
}
