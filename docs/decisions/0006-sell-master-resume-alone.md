# ADR-0006: Sell the master resume on its own for ৳50

- **Date:** 2026-10-24
- **Status:** Accepted. Amends ADR-0005, decision 2 and the "৳50 single credit" alternative.

## Context

ADR-0005 made the master resume the first pack's bonus. The prod funnel on 2026-10-24 showed zero real sales. The master-resume lock was the biggest single driver of purchase-sheet opens: people want a general CV now. But the only way to get one was ৳200, for a product they hadn't tried.

## Decision

1. Add a second package, **`master-resume`: 0 credits, ৳50**. It goes in `initiate_purchase` (migration 033). A completed purchase unlocks the master resume through the existing 032 trigger. The package is refused (`already_unlocked`) when the account is already unlocked.
2. The ৳200 pack is unchanged and still includes the master resume. Offers present it as "master resume + 5 kits", anchored against the ৳250 the parts add up to.
3. The offer is loud on purpose (owner, 2026-10-24). It appears as a priced Master tab, a dashboard banner with a preview of the user's own resume, an offer sheet with two one-tap choices, a plan picker in the bKash sheet, and a card on the free-kit gift panel. It is one tap from a finished profile to the bKash step.
4. No fake urgency, countdowns, or invented social proof. The buyer has to trust an unknown site with a manual bKash payment.

## Why not the alternatives

- **A ৳50 single credit (one kit).** The demand signal is for the general CV, not for a cheaper kit. A single kit would also undercut the pack's per-kit price.
- **Free master resume again.** That is what ADR-0005 replaced: users took it and never tried a kit.

## Consequences

- A purchase row can now have `credits_granted = 0`. Admin revenue sums `amount_taka` and is unaffected. "Credits sold" excludes these rows. Purchase history shows them as "Master resume".
- Someone who pays ৳50 and later buys a pack does not get the master resume twice. The unlock is a one-time stamp.
- The bKash watcher is unaffected: it posts TrxID and amount, never a package.
