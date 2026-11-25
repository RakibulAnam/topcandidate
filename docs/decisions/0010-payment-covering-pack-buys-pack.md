# ADR-0010: A payment that covers the pack buys the pack

- **Date:** 2026-11-25
- **Status:** Accepted. Amends ADR-0009 §2 (the overpayment path for the master resume).

## Context

The first real customer sale on 2026-11-22 went wrong. The customer opened the bKash sheet from the dashboard resume preview. That sheet sells only the master resume, ~~৳200~~ ৳99. She sent ৳203.70, which is ৳200 plus the 1.85% bKash cash-out fee. The watcher read the SMS correctly (৳203). Match-on-submit then settled the purchase exactly as it had been submitted: a ৳99 master-resume row with 0 credits, and the ৳104 surplus parked in `purchase_overpayments` as `pending`. Nothing alerts anyone to a pending overpayment.

The admin panel showed "Lifetime paid ৳99" because it summed the package price, not the money received.

The root cause is that the package is fixed when the customer submits the TrxID. At that point nobody knows how much was actually sent. The amount is only known when the purchase settles.

## Decision

1. When a master-resume purchase (0 credits) settles with a verified amount of at least the pack price (৳199), it is settled as the pack: 5 credits and a ৳199 price. The pack's first-purchase bonus also unlocks the master resume, so the customer loses nothing. Anything above ৳199 is still logged to `purchase_overpayments`.
2. All three settle paths apply the rule: match-on-submit (`initiate_purchase`), the watcher webhook (`confirm_purchase`), and an operator-matched top-up (`apply_purchase_topup`). `operator_confirm_purchase` has no observed amount to judge, so it doesn't apply the rule. Migration 036 makes the change and backfills the one affected purchase.
3. The purchase sheet confirms an upgraded payment as credits ("You got the full pack!"), not as "Master resume unlocked".
4. The admin panel reports money received: the observed bKash amount across completed, non-test purchases. It also shows the package bought and the latest purchase, in the Users list and on User Detail.

## Why not the alternatives

- **Keep surplus as a manual refund-or-credit decision:** that is the path that failed. The overpayment was never flagged to anyone, and the customer saw only the smaller product.
- **Ask the customer which product they meant:** they have already paid, and the amount answers the question. A ৳199+ payment is the pack price.
- **Remove the struck-through ৳200 anchor:** it is the likely reason she sent ৳200, but the owner chose the anchor on purpose (ADR-0009). Removing it is a separate decision. With this rule in place, a payment of ৳200 now gets the customer the better product, not the worse one.

## Consequences

- A ৳99 buyer who sends between ৳99 and ৳198 still gets only the master resume, with the surplus logged as before.
- The pack's price and credit count (৳199, 5) are now hard-coded in four places in SQL: the three settle paths and `initiate_purchase`'s package table. Change them together.
- The bKash watcher is unaffected. The request and the response codes are unchanged, and an upgraded confirmation reports `creditsGranted: 5`.
