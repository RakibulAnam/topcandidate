# ADR-0011: Both plans on every purchase sheet, the pack marked best value

- **Date:** 2026-11-25
- **Status:** Accepted. Reverses ADR-0009 §5's resume-preview exception.

## Context

ADR-0009 showed both plans on the bKash sheet, with one exception: the sheet opened from the dashboard resume preview showed only the ৳99 master resume, on the grounds that the tap had already been the choice. The first real buyer opened it from there three times. She never saw the pack, and she sent ৳200 plus the bKash fee (see ADR-0010). The two plans were also presented as equal cards, so nothing said that ৳199 buys the master resume and five full job kits.

## Decision

1. While the master resume is for sale (`masterOffer`), every open of the sheet shows both plans, the resume preview included. The opener still decides which plan is preselected: the resume preview preselects the master resume, and credit gates and "Buy generations" preselect the pack.
2. The pack is the card marked "Best value". It lists what it includes (the master resume, plus a tailored resume, cover letter, outreach email, LinkedIn note and interview prep for each of 5 jobs). It says what it costs on top of the resume alone, "Only ৳100 more", computed from this account's own prices.
3. On desktop the plan chooser replaces the price hero in the left panel, so the left side is what you buy and the right side is how you pay. On a phone the chooser heads the sheet.
4. With no master-resume offer (already unlocked, unknown price, or a profile that can't be built), the sheet sells the pack alone, as before.

## Consequences

- ~~৳200~~ ৳99 stays next to the master resume (owner, 2026-11-25).
- A buyer who wanted the resume now sees the pack first, which is the point. They are one tap away from the ৳99 option, and it stays preselected.
- No server change. `initiate_purchase` already accepts both packages from any surface.
