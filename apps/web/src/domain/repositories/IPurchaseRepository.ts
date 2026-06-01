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

export interface IPurchaseRepository {
  /**
   * List the current user's purchases, newest first. Defaults to the last
   * 20 rows — the dashboard renders a fixed-size table; pagination would
   * be added when we wire a dedicated "purchase history" page.
   */
  listMyPurchases(limit?: number): Promise<Purchase[]>;
}
