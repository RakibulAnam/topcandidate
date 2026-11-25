// What a customer has paid and bought, from their `purchases` rows. Shared by
// the Users list (one summary per row) and the User Detail header.
//
// Package: a row with credits is the pack (five-pack); a 0-credit row is the
// master-resume package (migration 033). A master-resume payment that covered
// the pack is settled as the pack (migration 036), so its row has credits too.
//
// Paid = money actually received: the observed bKash amount (the watcher's
// figure, top-ups included) when known, else the price on the row. Only
// completed, non-test purchases count — refunded, expired, voided and
// still-pending rows did not end with money we kept.

export interface PurchaseRowLike {
  status: string;
  is_test: boolean;
  amount_taka: number;
  observed_amount_taka: number | null;
  credits_granted: number;
  created_at: string;
}

export type PackageKind = 'five-pack' | 'master-resume';

export interface PurchaseSummary {
  /** Money received across completed, non-test purchases. */
  paidTaka: number;
  /** Completed, non-test packs / master resumes bought. */
  packs: number;
  masters: number;
  /** Most recent purchase of any outcome (voided TrxIDs skipped). */
  last: null | {
    created_at: string;
    status: string;
    package: PackageKind;
    priceTaka: number;
    receivedTaka: number | null;
    is_test: boolean;
  };
}

export const packageOf = (p: Pick<PurchaseRowLike, 'credits_granted'>): PackageKind =>
  p.credits_granted > 0 ? 'five-pack' : 'master-resume';

export const receivedTaka = (p: Pick<PurchaseRowLike, 'amount_taka' | 'observed_amount_taka'>): number =>
  p.observed_amount_taka ?? p.amount_taka;

/** `rows` in any order. */
export function summarizePurchases(rows: PurchaseRowLike[]): PurchaseSummary {
  const kept = rows.filter((p) => p.status === 'completed' && !p.is_test);
  // 'failed' is what a customer's own TrxID correction leaves behind.
  const latest = rows
    .filter((p) => p.status !== 'failed')
    .reduce<PurchaseRowLike | null>((a, p) => (!a || p.created_at > a.created_at ? p : a), null);
  return {
    paidTaka: kept.reduce((sum, p) => sum + receivedTaka(p), 0),
    packs: kept.filter((p) => packageOf(p) === 'five-pack').length,
    masters: kept.filter((p) => packageOf(p) === 'master-resume').length,
    last: latest && {
      created_at: latest.created_at,
      status: latest.status,
      package: packageOf(latest),
      priceTaka: latest.amount_taka,
      receivedTaka: latest.observed_amount_taka,
      is_test: latest.is_test,
    },
  };
}
