// What this account is charged, for display. The server (initiate_purchase)
// is the authority; these mirror it from the same account status read.
//
// Master resume: ৳99 since migration 034, but accounts that existed before it
// (profiles.legacy_pricing) keep the ৳50 they were offered.
// Pack: ৳199 since 034, ৳200 before it. `newPricing` = 034 is live (the
// legacy_pricing column exists), so the site can deploy before or after the
// migration and still show exactly what the server will charge.
import type { useT } from './i18n/LocaleContext';

type T = ReturnType<typeof useT>;

export const masterPriceTaka = (legacyPricing: boolean | null | undefined): number =>
  legacyPricing ? 50 : 99;

/** "৳99" / "৳50", in the current locale's digits. */
export const masterPriceLabel = (t: T, legacyPricing: boolean | null | undefined): string =>
  t(legacyPricing ? 'purchaseModal.masterPriceLegacy' : 'purchaseModal.masterPrice');

/** Unknown (status read failed) shows ৳200: correct before 034, and after it
 *  a ৳200 payment for a ৳199 row still completes (overpayment path). Showing
 *  ৳199 to someone the server charges ৳200 would land them on "underpaid". */
export const packPriceTaka = (newPricing: boolean | null | undefined): number =>
  newPricing === true ? 199 : 200;

/** "৳199" / "৳200", in the current locale's digits. */
export const packPriceLabel = (t: T, newPricing: boolean | null | undefined): string =>
  t(newPricing === true ? 'purchaseModal.packPrice' : 'purchaseModal.packPriceOld');
