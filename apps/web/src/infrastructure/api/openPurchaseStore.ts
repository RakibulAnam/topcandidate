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
// There is no localStorage fallback, deliberately. `current` stays undefined
// until the first read lands, so the pill appears a few hundred ms late on a
// cold load. Seeding it from a browser crumb would buy back that flash by
// reintroducing exactly the thing this replaced: a local guess that can
// outlive, contradict, or be deleted independently of the payment itself.
import { purchaseRepository } from '../config/dependencies';
import type { Purchase } from '../../domain/repositories/IPurchaseRepository';
import type { PurchaseVerdict } from './purchaseStatusClient';

/** undefined = not resolved yet, null = nothing open. The distinction matters:
 *  rendering "no payment in flight" before the read lands is the same class of
 *  lie as a dashboard banner that jumps position once data arrives. */
export type OpenPurchaseState = Purchase | null | undefined;

let current: OpenPurchaseState = undefined;
let inFlight: Promise<void> | null = null;
const listeners = new Set<(v: OpenPurchaseState) => void>();

// The last DIAGNOSIS for the open purchase, keyed by TrxID.
//
// A verdict is not a row status — there is no column for `nothing_found`, and
// there should not be, because it is a judgement about the world at a moment
// (did the watcher see anything?) rather than a fact about the purchase. But
// the pill has to know it: without it, a payment diagnosed as never-arrived
// eighty minutes ago is indistinguishable from one submitted five seconds ago,
// and the pill spins on both. It spun on both, next to a modal that had
// already said "we haven't received this payment yet" — two surfaces on one
// screen, disagreeing about whether anyone was still working.
//
// Cached here so the modal's diagnosis is free for the pill to reuse, and so a
// pill that has to fetch its own does it once per purchase rather than once
// per poll.
let verdictTxn: string | null = null;
let verdictValue: PurchaseVerdict | null = null;
// Verdicts need their OWN subscription. Re-emitting on the purchase channel
// does not work: the value is the same object reference, so React bails out of
// the re-render and the pill keeps rendering the verdict it read on mount —
// which is exactly the "modal has diagnosed, pill still spinning" split this
// whole change exists to close.
const verdictListeners = new Set<() => void>();

const emit = () => { listeners.forEach((l) => l(current)); };
const emitVerdict = () => { verdictListeners.forEach((l) => l()); };

export function getOpenPurchaseSnapshot(): OpenPurchaseState {
  return current;
}

/** The cached verdict, but only if it belongs to `txnId` — a verdict from a
 *  superseded transaction is worse than none. */
export function getOpenPurchaseVerdict(txnId: string): PurchaseVerdict | null {
  return verdictTxn === txnId ? verdictValue : null;
}

export function setOpenPurchaseVerdict(txnId: string, verdict: PurchaseVerdict): void {
  if (verdictTxn === txnId && verdictValue === verdict) return;
  verdictTxn = txnId;
  verdictValue = verdict;
  emitVerdict();
}

export function subscribeOpenPurchaseVerdict(fn: () => void): () => void {
  verdictListeners.add(fn);
  return () => { verdictListeners.delete(fn); };
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
    .then((row) => {
      // A different purchase (or none) invalidates the diagnosis we hold.
      const ref = row?.paymentReference ?? null;
      if (ref !== verdictTxn) { verdictTxn = ref; verdictValue = null; emitVerdict(); }
      current = row;
      emit();
    })
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
  verdictTxn = null;
  verdictValue = null;
  emit();
  emitVerdict();
}
