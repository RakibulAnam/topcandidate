// POST /api/dev-mock-confirm
//
// ⚠️  DEVELOPMENT ONLY — DELETE THIS FILE BEFORE PRODUCTION SHIP. ⚠️
//
// This endpoint exists so the front-end can demonstrate the full bKash
// purchase flow (buy → pending → credits arrive) without the Flutter
// SMS-watcher app being built yet. It does what the production webhook
// (/api/confirm-purchase) will do, but is gated by the calling user's
// own JWT instead of an HMAC-signed request from the Flutter app.
//
// Once the Flutter app is shipped:
//   1. Delete this file.
//   2. Delete the auto-trigger in PurchaseModal.tsx (search for "mockConfirm").
//   3. Remove `VITE_BKASH_MOCK_AUTOCONFIRM` from .env / .env.example.
//
// Request:  { transactionId: 'AB12CD34EF' }
// Response: { success: true, creditsGranted: 5, newBalance: N }
//
// 401 if not authenticated; 403 if mock mode is disabled or no service
// role key is configured; 404 if the user has no matching pending purchase.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { authenticate, userClient } from './_lib/auth.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
// Server-side gate. We don't ship the mock-confirm path unless this is
// explicitly turned on. In production this MUST be false / unset and this
// file deleted entirely. The matching client flag is VITE_BKASH_MOCK_AUTOCONFIRM
// (read by PurchaseModal.tsx).
const MOCK_AUTOCONFIRM_ENABLED =
  process.env.BKASH_MOCK_AUTOCONFIRM === 'true' ||
  // Loose default: if mock is on the client side, accept on the server too
  // (saves an extra env var while still letting the prod build deny).
  process.env.VITE_BKASH_MOCK_AUTOCONFIRM === 'true';

interface Body {
  transactionId?: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  if (!MOCK_AUTOCONFIRM_ENABLED) {
    res.status(403).json({ error: 'Mock auto-confirm is disabled on this environment.' });
    return;
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    res.status(503).json({
      error: 'SUPABASE_SERVICE_ROLE_KEY is not configured. Set it in .env to enable mock auto-confirm.',
    });
    return;
  }

  const auth = await authenticate(req, res);
  if (!auth) return;

  const { transactionId } = (req.body ?? {}) as Body;
  if (!transactionId || typeof transactionId !== 'string' || transactionId.trim().length < 6) {
    res.status(400).json({ error: 'transactionId is required (min 6 chars).' });
    return;
  }
  const txn = transactionId.trim();

  // Safety check: only confirm a pending purchase that BELONGS to the
  // calling user. The user-scoped Supabase client + RLS take care of
  // this — the SELECT below will return zero rows if the txn ID's
  // purchase row belongs to someone else.
  const userSupa = userClient(auth.jwt);
  const { data: ownPending, error: ownErr } = await userSupa
    .from('purchases')
    .select('id, user_id, status, sender_msisdn')
    .eq('payment_reference', txn)
    .eq('status', 'pending')
    .maybeSingle();

  if (ownErr) {
    console.error('[dev-mock-confirm] pending lookup failed:', ownErr.message);
    res.status(500).json({ error: 'Could not verify pending purchase.' });
    return;
  }
  if (!ownPending) {
    res.status(404).json({ error: 'No pending purchase matches that transaction ID for your account.' });
    return;
  }

  // Now confirm via service-role (bypasses the RLS column lockdown +
  // the EXECUTE revoke on confirm_purchase). We pass the SAME msisdn the
  // user submitted so the inside-the-RPC mismatch check passes.
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await admin.rpc('confirm_purchase', {
    p_transaction_id: txn,
    p_observed_sender_msisdn: ownPending.sender_msisdn ?? null,
  });

  if (error) {
    console.error('[dev-mock-confirm] confirm_purchase RPC failed:', error.message);
    res.status(500).json({ error: error.message ?? 'Could not confirm purchase.' });
    return;
  }

  const row = Array.isArray(data) ? data[0] : data;
  res.status(200).json({
    success: true,
    creditsGranted: row?.credits_granted,
    newBalance: row?.new_balance,
  });
}
