# ADR-0009: One resume-preview offer at ৳99, no welcome credit for new accounts

- **Date:** 2026-10-27
- **Status:** Accepted. Amends ADR-0005 (retires the welcome credit) and ADR-0006 (price and surfaces).

## Context

After profile completion the dashboard stacked a welcome banner with four steps, a kit-ready banner and a two-choice master-resume offer. The owner found it overwhelming and tacky. Prod still showed no real sales.

## Decision

1. The dashboard makes one ask: the user's own master resume. Name, contact line and professional summary are legible. Every line after the summary is blurred a step further. The header reads "Your resume is ready" with ~~৳200~~ ৳99. A tap anywhere on the page opens the bKash sheet on the master-resume package.
2. `master-resume` costs ৳99 and `five-pack` costs ৳199 (migration 034, was ৳200). ৳100 and ৳200 also complete them, through the existing overpayment path.
3. The summary is real, not a template. In preview mode, `/api/optimize-general` runs the actual master build once and stores it in `master_previews`, where only the service role can read it. It returns only the summary. The paid build reuses the stored result while the profile hash matches, so the buyer gets exactly what they read.
4. No more welcome credit for new accounts. `claim_welcome_credit()` grants only to accounts that existed before migration 034, and credits already granted are kept. Landing and SEO copy that promised a free first application was changed to "free to sign up".
5. The two-choice offer sheet is removed. While the resume is locked, the bKash sheet shows both plans on every open: ~~৳500~~ ৳199 for the pack and ~~৳200~~ ৳99 for the resume alone. The exception is the resume preview, where the tap was already the choice.

6. **Existing accounts keep their deal** (owner, 2026-10-27). Every account that exists when 034 runs is flagged `profiles.legacy_pricing`. For those accounts the master resume stays ৳50, and the welcome credit is still granted, including to those who haven't finished their profile yet. They see the new preview, priced ৳50. The pack is ৳199 for everyone, which is cheaper than before, so nobody is worse off.

## Why not the alternatives

- **Template summary (no AI):** free, but it would not match the paid resume. Reading one summary and receiving another breaks trust.
- **Sending the full resume to the client and blurring it:** anyone could read it in devtools for free. Only the summary leaves the server.
- **Keeping the free kit alongside the preview:** two gifts compete for attention, which is the clutter this change removes.

## Consequences

- Each locked profile version costs one master build (≈ $0.003). This is bounded by the 5/day `optimize_general` cap. Cache hits cost nothing.
- ~~৳200~~ was the pack's old price, never the master resume's own, and ~~৳500~~ was never charged for the pack. The owner chose to show both anchors anyway (2026-10-27).
- The bKash watcher is unaffected: it never sees package ids or prices.
