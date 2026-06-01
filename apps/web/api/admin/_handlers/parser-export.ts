// GET /api/admin/parser-export
//
// Returns reviewed parser failures as JSON for the Flutter watcher's parser
// test corpus. The mobile maintainer drops this into the Dart project as
// new test fixtures.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin, adminSupabase } from '../_lib/adminAuth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }
  if (!requireAdmin(req, res)) return;
  const supabase = adminSupabase();
  if (!supabase) { res.status(503).json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured.' }); return; }

  const { data, error } = await supabase
    .from('unmatched_inbound_sms')
    .select('id, raw_body, sender_msisdn, sms_timestamp, reviewed_at')
    .like('payment_reference', 'PARSE_FAIL_%')
    .not('reviewed_at', 'is', null)
    .order('sms_timestamp', { ascending: false })
    .limit(500);

  if (error) {
    console.error('[admin/parser-export] failed:', error.message);
    res.status(500).json({ error: 'Query failed.' });
    return;
  }

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="parser-corpus-${new Date().toISOString().slice(0, 10)}.json"`);
  res.status(200).send(JSON.stringify({ exportedAt: new Date().toISOString(), count: (data ?? []).length, items: data ?? [] }, null, 2));
}
