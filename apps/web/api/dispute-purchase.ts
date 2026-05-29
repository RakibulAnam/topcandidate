// POST /api/dispute-purchase
//
// Customer-facing. Captures "I sent the money but never got credits" reports.
// Inserts a row into purchase_disputes for operator review. Auth required.
// Implements case #10.
//
// Request:  { transactionId, notes }
// Response: { success: true, disputeId }

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authenticate, userClient } from './_lib/auth.js';

interface Body {
  transactionId?: string;
  notes?: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const auth = await authenticate(req, res);
  if (!auth) return;

  const { transactionId, notes } = (req.body ?? {}) as Body;
  if (!transactionId || typeof transactionId !== 'string' || transactionId.trim().length < 6) {
    res.status(400).json({ error: 'transactionId is required (min 6 chars).' });
    return;
  }
  if (!notes || typeof notes !== 'string' || notes.trim().length < 10) {
    res.status(400).json({ error: 'Please describe the issue (min 10 chars).' });
    return;
  }
  if (notes.trim().length > 2000) {
    res.status(400).json({ error: 'Description too long (max 2,000 chars).' });
    return;
  }

  const supabase = userClient(auth.jwt);

  // Per-user 24h rate limit (audit M6). Anti-spam guard. RLS scopes the
  // count to auth.uid() so this is per-caller automatically.
  const dayAgoIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: recent } = await supabase
    .from('purchase_disputes')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', dayAgoIso);
  if ((recent ?? 0) >= 3) {
    res.status(429).json({
      error: 'You have filed several disputes recently. Please wait — our team is reviewing them. Contact support if urgent.',
      code: 'too_many_disputes',
    });
    return;
  }

  const { data, error } = await supabase.rpc('record_purchase_dispute', {
    p_transaction_id: transactionId.trim(),
    p_notes: notes.trim(),
  });

  if (error) {
    console.error('[dispute-purchase] RPC failed:', error.message);
    res.status(500).json({ error: 'Could not record dispute.' });
    return;
  }

  res.status(200).json({ success: true, disputeId: data });
}
