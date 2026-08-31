// Domain-facing contract for the user's purchase history.
//
// Customers see their own purchases on the dashboard via
// `PurchaseHistorySection`. Operators see all purchases via the admin
// dispatcher. Customer reads MUST go through this repository so the
// Clean Architecture layering stays intact (presentation never imports
// the Supabase client directly).
//
// RLS enforces the per-row scoping — `auth.uid() = user_id` — so the
// repository implementation passes no user id; the JWT in the active
// session is the authority.

export type PurchaseStatus =
  | 'pending'
  | 'completed'
  | 'failed'
  | 'expired'
  | 'underpaid'
  | 'msisdn_mismatch_review'
  | 'refunded';

export interface Purchase {
  id: string;
  paymentReference: string | null;
  amountTaka: number;
  observedAmountTaka: number | null;
  creditsGranted: number;
  status: PurchaseStatus;
  createdAt: string; // ISO 8601
}

/** Statuses a customer can still act on, so the UI must be able to resume
 *  into them. `pending` is in flight; `underpaid` and `msisdn_mismatch_review`
 *  are stalled but recoverable (top up, or talk to us). Everything else —
 *  completed, expired, failed, refunded — is over, and reopening the modal on
 *  one of those should give a clean form rather than resurrect it. */
export const OPEN_PURCHASE_STATUSES: PurchaseStatus[] = [
  'pending',
  'underpaid',
  'msisdn_mismatch_review',
];

/** A pending purchase stops being resumable after this long. It matches the
 *  server's own 24h expiry on pending rows — past it the row is dead to the
 *  matcher, so offering to resume it would be a lie. */
export const OPEN_PURCHASE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface IPurchaseRepository {
  /**
   * List the current user's purchases, newest first. Defaults to the last
   * 20 rows — the dashboard renders a fixed-size table; pagination would
   * be added when we wire a dedicated "purchase history" page.
   */
  listMyPurchases(limit?: number): Promise<Purchase[]>;

  /**
   * The user's most recent purchase they can still act on, or null.
   *
   * This is the source of truth for "is a payment in flight", replacing a
   * localStorage crumb that only the navbar pill could read and that the
   * pill's own Dismiss button deleted. Every surface — modal, pill, navbar —
   * resolves the same row from here, so closing a sheet or clearing a browser
   * can no longer strand a customer away from their own payment.
   */
  getOpenPurchase(): Promise<Purchase | null>;
}
