// The one place the app answers "does this user have a payment in flight?".
//
// Before this, that question had two half-answers and no whole one: the modal
// kept the phase/verdict in component state (destroyed on close), and the
// navbar pill read a localStorage crumb that its OWN Dismiss button deleted —
// without voiding the server row. A customer who paid, closed the sheet and
// dismissed the pill was left with a live pending purchase, no surface that
// could find it, and a Transaction ID the unique index still held, so
// re-entering the correct one came back "already submitted".
//
// The server row is the source of truth; this is the shared cache over it. A
// module-level store rather than React context because the pill mounts in TWO
// trees — inside `DashboardShell` and inside the plain `Navbar` the builder
// uses — and a context would leave the builder blind.
//
// No React in this file: `AuthContext` (infrastructure) has to reset it on
// sign-out, and infrastructure must not import from presentation. The hook
// wrapper lives in presentation/hooks/useOpenPurchase.ts.
//
// localStorage keeps exactly one job now: seeding the first paint so the pill
// does not blink in after the query returns. A hint, never the truth — the
// server's answer always overwrites it.
import { purchaseRepository } from '../config/dependencies';
import type { Purchase } from '../../domain/repositories/IPurchaseRepository';

/** undefined = not resolved yet, null = nothing open. The distinction matters:
 *  rendering "no payment in flight" before the read lands is the same class of
 *  lie as a dashboard banner that jumps position once data arrives. */
export type OpenPurchaseState = Purchase | null | undefined;

let current: OpenPurchaseState = undefined;
let inFlight: Promise<void> | null = null;
const listeners = new Set<(v: OpenPurchaseState) => void>();

const emit = () => { listeners.forEach((l) => l(current)); };

export function getOpenPurchaseSnapshot(): OpenPurchaseState {
  return current;
}

export function subscribeOpenPurchase(fn: (v: OpenPurchaseState) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function isOpenPurchaseLoading(): boolean {
  return inFlight !== null;
}

/** Re-read the open purchase from the server. Concurrent callers share one
 *  request — a purchase settling fires callbacks on both mounted pills and the
 *  modal at once, and three identical selects help nobody. */
export function refreshOpenPurchase(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = purchaseRepository
    .getOpenPurchase()
    .then((row) => { current = row; emit(); })
    .catch((err) => {
      // Keep the previous answer. Flipping to "nothing open" on a transient
      // read failure tells the customer their payment vanished, which is a
      // worse lie than showing a slightly stale one.
      console.warn('Could not read the open purchase', err);
    })
    .finally(() => { inFlight = null; });
  return inFlight;
}

/** Drop the cached answer. Called on sign-out so a shared browser cannot hand
 *  the next account the previous one's pending payment. */
export function resetOpenPurchase(): void {
  current = undefined;
  emit();
}
