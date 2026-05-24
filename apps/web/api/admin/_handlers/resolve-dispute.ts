// POST /api/admin/resolve-dispute
//
// Operator resolves (or rejects) a customer-filed dispute. Implements §4
// of the prompt — closes case #10. Grants/refunds are out of scope here;
// the operator uses /api/admin/confirm-purchase or /api/admin/refund-purchase
// separately if action is needed.
//
// Request:  { disputeId, resolution: 'resolved' | 'rejected', operatorNote }
// Headers:  X-Admin-Key

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin, adminSupabase } from './_lib/adminAuth.js';

interface Body {
  disputeId?: string;
  resolution?: string;
  operatorNote?: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!requireAdmin(req, res)) return;

  const supabase = adminSupabase();
  if (!supabase) {
    res.status(503).json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured.' });
    return;
  }

  const { disputeId, resolution, operatorNote } = (req.body ?? {}) as Body;
  if (!disputeId || !resolution) {
    res.status(400).json({ error: 'disputeId and resolution are required.' });
    return;
  }
  if (resolution !== 'resolved' && resolution !== 'rejected') {
    res.status(400).json({ error: 'resolution must be "resolved" or "rejected".' });
    return;
  }
  if (!operatorNote || typeof operatorNote !== 'string' || operatorNote.trim().length === 0) {
    res.status(400).json({ error: 'operatorNote is required.' });
    return;
  }

  const { error } = await supabase.rpc('resolve_purchase_dispute', {
    p_dispute_id: disputeId,
    p_resolution: resolution,
    p_operator_note: operatorNote.trim(),
  });

  if (error) {
    console.error('[admin/resolve-dispute] RPC failed:', error.message);
    res.status(500).json({ error: 'Resolution failed. See server logs.' });
    return;
  }

  res.status(200).json({ success: true });
}
