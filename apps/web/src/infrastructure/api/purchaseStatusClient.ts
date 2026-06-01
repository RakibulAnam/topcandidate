// Client for /api/my-purchase-status and /api/dispute-purchase.
//
// Storage convention: when PurchaseModal records a pending purchase it writes
// to `localStorage[PENDING_PURCHASE_KEY]` and dispatches a custom DOM event
// so the navbar pill picks it up without a refresh.

import { supabase } from '../supabase/client';
import { ApiCallError } from '../ai/proxy/ProxyClients';

export const PENDING_PURCHASE_KEY = 'topcandidate.pendingPurchase';
export const PENDING_PURCHASE_EVENT = 'topcandidate:pending-purchase-changed';

export interface PendingPurchaseRecord {
  txnId: string;
  submittedAt: number; // epoch ms
}

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

export function readPendingPurchase(): PendingPurchaseRecord | null {
  try {
    const raw = localStorage.getItem(PENDING_PURCHASE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingPurchaseRecord;
    if (!parsed.txnId || typeof parsed.submittedAt !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writePendingPurchase(rec: PendingPurchaseRecord): void {
  localStorage.setItem(PENDING_PURCHASE_KEY, JSON.stringify(rec));
  window.dispatchEvent(new Event(PENDING_PURCHASE_EVENT));
}

export function clearPendingPurchase(): void {
  localStorage.removeItem(PENDING_PURCHASE_KEY);
  window.dispatchEvent(new Event(PENDING_PURCHASE_EVENT));
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
 */
export function subscribeToPurchase(txnId: string, onChange: () => void): () => void {
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
      .channel(`purchase:${txnId}`)
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
