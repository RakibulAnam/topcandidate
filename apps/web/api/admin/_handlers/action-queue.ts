// GET /api/admin/action-queue
//
// Unified "needs attention" feed for the dashboard. Combines:
//   - pending purchases older than 10 minutes
//   - all msisdn_mismatch_review rows
//   - all underpaid rows
//   - expired rows from the last 24h (FYI — auto-flipped)
//   - all open disputes
//   - all unreviewed orphan SMS (PARSE_FAIL_* excluded; those live on their own tab)
//
// Sorted by age desc; capped at 50.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin, adminSupabase } from '../_lib/adminAuth.js';

type QueueItem = {
  kind: 'pending' | 'mismatch' | 'underpaid' | 'expired' | 'dispute' | 'orphan';
  id: string;
  trxId: string | null;
  email: string | null;
  amountTaka: number | null;
  observedTaka: number | null;
  createdAt: string;
  extra?: Record<string, unknown>;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }
  if (!requireAdmin(req, res)) return;
  const supabase = adminSupabase();
  if (!supabase) { res.status(503).json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured.' }); return; }

  const tenMinAgo = new Date(Date.now() - 10 * 60_000).toISOString();
  const dayAgo = new Date(Date.now() - 24 * 3600_000).toISOString();

  const [pending, mismatch, underpaid, expired, disputes, orphans] = await Promise.all([
    supabase.from('purchases').select('id, user_id, payment_reference, amount_taka, observed_amount_taka, created_at').eq('status', 'pending').lte('created_at', tenMinAgo).order('created_at', { ascending: true }).limit(50),
    supabase.from('purchases').select('id, user_id, payment_reference, amount_taka, observed_amount_taka, created_at').eq('status', 'msisdn_mismatch_review').order('created_at', { ascending: true }).limit(50),
    supabase.from('purchases').select('id, user_id, payment_reference, amount_taka, observed_amount_taka, created_at').eq('status', 'underpaid').order('created_at', { ascending: true }).limit(50),
    supabase.from('purchases').select('id, user_id, payment_reference, amount_taka, observed_amount_taka, created_at').eq('status', 'expired').gte('created_at', dayAgo).order('created_at', { ascending: false }).limit(50),
    supabase.from('purchase_disputes').select('id, user_id, payment_reference, notes, created_at').eq('status', 'open').order('created_at', { ascending: true }).limit(50),
    supabase.from('unmatched_inbound_sms').select('id, payment_reference, sender_msisdn, amount_taka, created_at').is('matched_to_purchase_id', null).is('reviewed_at', null).not('payment_reference', 'like', 'PARSE_FAIL_%').order('created_at', { ascending: true }).limit(50),
  ]);

  // Look up emails for the user-bearing rows.
  const userIds = new Set<string>();
  for (const r of pending.data ?? []) userIds.add(r.user_id);
  for (const r of mismatch.data ?? []) userIds.add(r.user_id);
  for (const r of underpaid.data ?? []) userIds.add(r.user_id);
  for (const r of expired.data ?? []) userIds.add(r.user_id);
  for (const r of disputes.data ?? []) userIds.add(r.user_id);

  const { data: profiles } = userIds.size > 0
    ? await supabase.from('profiles').select('id, email').in('id', Array.from(userIds))
    : { data: [] };
  const emailById = new Map<string, string>();
  for (const p of profiles ?? []) emailById.set(p.id, p.email ?? '');

  const items: QueueItem[] = [];
  for (const r of pending.data ?? []) items.push({ kind: 'pending', id: r.id, trxId: r.payment_reference, email: emailById.get(r.user_id) ?? null, amountTaka: r.amount_taka, observedTaka: r.observed_amount_taka, createdAt: r.created_at });
  for (const r of mismatch.data ?? []) items.push({ kind: 'mismatch', id: r.id, trxId: r.payment_reference, email: emailById.get(r.user_id) ?? null, amountTaka: r.amount_taka, observedTaka: r.observed_amount_taka, createdAt: r.created_at });
  for (const r of underpaid.data ?? []) items.push({ kind: 'underpaid', id: r.id, trxId: r.payment_reference, email: emailById.get(r.user_id) ?? null, amountTaka: r.amount_taka, observedTaka: r.observed_amount_taka, createdAt: r.created_at });
  for (const r of expired.data ?? []) items.push({ kind: 'expired', id: r.id, trxId: r.payment_reference, email: emailById.get(r.user_id) ?? null, amountTaka: r.amount_taka, observedTaka: r.observed_amount_taka, createdAt: r.created_at });
  for (const r of disputes.data ?? []) items.push({ kind: 'dispute', id: r.id, trxId: r.payment_reference, email: emailById.get(r.user_id) ?? null, amountTaka: null, observedTaka: null, createdAt: r.created_at, extra: { notes: r.notes } });
  for (const r of orphans.data ?? []) items.push({ kind: 'orphan', id: r.id, trxId: r.payment_reference, email: null, amountTaka: r.amount_taka, observedTaka: null, createdAt: r.created_at, extra: { sender: r.sender_msisdn } });

  items.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)); // oldest first = most overdue first

  res.status(200).json({ items: items.slice(0, 50), total: items.length });
}
