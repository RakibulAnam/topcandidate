// Client for /api/my-purchase-status, /api/dispute-purchase, and the two
// purchase-ops verification actions (/api/purchase-ops/verify-txn, /void-txn).
//
// There is deliberately no localStorage here any more. "Is a payment in
// flight" is answered by the SERVER row via `openPurchaseStore`; a browser-
// local crumb was what let the pill's Dismiss delete a customer's only pointer
// to a still-pending purchase.

import { supabase } from '../supabase/client';
import { ApiCallError } from '../ai/proxy/ProxyClients';

export type PurchaseStatus =
  | 'pending'
  | 'completed'
  | 'underpaid'
  | 'msisdn_mismatch_review'
  | 'expired'
  | 'refunded'
  | 'failed';

export interface PurchaseStatusResponse {
  status: PurchaseStatus;
  amountTaka: number;
  observedAmountTaka: number | null;
  missing: number | null;
  message: string;
}

async function bearer(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new ApiCallError('Not authenticated.', 401);
  return token;
}

export async function fetchPurchaseStatus(txnId: string): Promise<PurchaseStatusResponse> {
  const token = await bearer();
  const res = await fetch(`/api/my-purchase-status?txnId=${encodeURIComponent(txnId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    let body: { error?: string } | null = null;
    try { body = await res.json(); } catch { /* leave null */ }
    throw new ApiCallError(body?.error ?? `status ${res.status}`, res.status);
  }
  return res.json() as Promise<PurchaseStatusResponse>;
}

/**
 * Subscribe to realtime changes on the caller's purchase row (migration 012
 * added `purchases` to the supabase_realtime publication). Invokes `onChange`
 * whenever the row changes so the caller can refetch the derived status. RLS
 * gates delivery to the user's own rows; we set the socket auth to the user's
 * JWT first. Returns an unsubscribe function.
 *
 * This replaces fixed-interval polling — the grant now reflects in the UI in
 * <1s with no time cap. Callers should still keep a slow fallback poll for the
 * rare dropped-socket case.
 *
 * `channelSuffix` keeps two concurrent subscribers to the SAME TrxID on
 * distinct Phoenix topics — the navbar pill and PurchaseModal's verification
 * panel are both live at once during a purchase, and two joins on one socket
 * for an identical topic can cost one of them its subscription.
 */
export function subscribeToPurchase(
  txnId: string,
  onChange: () => void,
  opts?: { channelSuffix?: string },
): () => void {
  let channel: ReturnType<typeof supabase.channel> | null = null;
  let cancelled = false;

  void (async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) supabase.realtime.setAuth(session.access_token);
    } catch {
      // Fall back to whatever auth the socket has; the fallback poll covers us.
    }
    if (cancelled) return;
    channel = supabase
      .channel(`purchase:${txnId}${opts?.channelSuffix ? `:${opts.channelSuffix}` : ''}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'purchases', filter: `payment_reference=eq.${txnId}` },
        () => onChange(),
      )
      .subscribe();
  })();

  return () => {
    cancelled = true;
    if (channel) void supabase.removeChannel(channel);
  };
}

/**
 * Why is a purchase still pending? Answered by `diagnose_pending_purchase`
 * (migration 028) — see api/purchase-ops/_handlers/verify-txn.ts.
 *
 * The distinction that matters: 'likely_typo' means we hold an unclaimed
 * verified payment that resembles what the customer typed (so telling them to
 * check their TrxID is fair), while 'awaiting_sms' / 'watcher_stale' mean the
 * delay is ours and blaming them would be wrong. The verdict is all we learn —
 * the payment itself is never described back to us (migration 029).
 */
export type PurchaseVerdict =
  | PurchaseStatus
  | 'likely_typo'
  | 'awaiting_sms'
  | 'watcher_stale'
  | 'nothing_found';

export interface PurchaseVerification {
  verdict: PurchaseVerdict;
  status: PurchaseStatus;
  amountTaka: number;
  observedAmountTaka: number | null;
  ageSeconds: number;
  /** Submissions by this user in the last 24h (pending + voided + expired). */
  attempts: number;
  // Deliberately no field describing the unclaimed payment we matched against.
  // Nothing at diagnosis time proves it belongs to the caller, so exposing its
  // amount or sender — even masked — leaks a stranger's data. See migration 029.
  watcher: {
    lastSeenAt: string | null;
    /** null = heartbeats not wired up yet, so liveness is unknown. */
    live: boolean | null;
  };
  message: string;
}

export async function verifyTxn(txnId: string): Promise<PurchaseVerification> {
  const token = await bearer();
  const res = await fetch(`/api/purchase-ops/verify-txn?txnId=${encodeURIComponent(txnId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    let body: { error?: string; code?: string } | null = null;
    try { body = await res.json(); } catch { /* leave null */ }
    throw new ApiCallError(body?.error ?? `verify ${res.status}`, res.status, body?.code);
  }
  return res.json() as Promise<PurchaseVerification>;
}

/**
 * Retire a mistyped pending purchase so a corrected resubmit doesn't consume
 * another of the customer's 5-per-24h pending slots.
 */
export async function voidTxn(txnId: string): Promise<void> {
  const token = await bearer();
  const res = await fetch('/api/purchase-ops/void-txn', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ transactionId: txnId }),
  });
  if (!res.ok) {
    let body: { error?: string; code?: string } | null = null;
    try { body = await res.json(); } catch { /* leave null */ }
    throw new ApiCallError(body?.error ?? `void ${res.status}`, res.status, body?.code);
  }
}

export async function filePurchaseDispute(transactionId: string, notes: string): Promise<{ disputeId: string }> {
  const token = await bearer();
  const res = await fetch('/api/dispute-purchase', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ transactionId, notes }),
  });
  if (!res.ok) {
    let body: { error?: string } | null = null;
    try { body = await res.json(); } catch { /* leave null */ }
    throw new ApiCallError(body?.error ?? `dispute ${res.status}`, res.status);
  }
  return res.json() as Promise<{ disputeId: string }>;
}
