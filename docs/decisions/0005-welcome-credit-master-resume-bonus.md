# ADR-0005: One free tailored application instead of a free master resume

- **Date:** 2026-10-11
- **Status:** Accepted

## Context

New accounts got 0 credits and a free general ("master") resume once their profile was complete. That free resume substituted for the paid product instead of sampling it. Users took it and used it for every application, so they never saw a tailored kit. Prod data after the 2026-09-28 reset: every real user who finished their profile took the free resume, and none went on to a tailored application. Users in this market are very price-sensitive, and a free item that already does the job removes the reason to pay.

## Decision

1. **Every account gets one free credit**, which is one complete tailored application, once its profile is complete. It is granted by `claim_welcome_credit()` (SECURITY DEFINER, acts on `auth.uid()` only), at most once per account, guarded by `profiles.welcome_credit_at`.
2. **The master resume is the first pack's bonus.** `profiles.master_resume_unlocked_at` is stamped by a trigger on `purchases` when the first purchase becomes `completed`, so every completion path unlocks it without changing the purchase RPCs. `/api/optimize-general` returns `402 master_locked` until then. Existing master resumes are kept, but updating one needs a pack. Buying again never creates a second one, and a refund does not re-lock it.
3. The free credit is presented as a gift ("1 free", "Free — on us"). After it is spent, the UI shows one muted line pointing to the ৳200 pack. There are no modals and no banners.

Migration: `apps/web/supabase/migrations/032_welcome_credit_master_unlock.sql`. Its backfill gave non-payers who had a complete profile their credit and unlocked payers.

## Why not the alternatives

- **Keep the free master resume.** This is the status quo that was failing, as described above.
- **No free tier at all.** Asking for ৳200 from a site nobody has used yet means people pay before they have seen any value.
- **A ৳50 single credit.** This could lower the first-payment barrier, but it changes SQL-hardcoded pricing and was ruled out of scope for now.

## Consequences

- A fresh account plus a complete profile yields one kit, about $0.016 of AI. Multi-accounting is still only detected (System tab), not blocked.
- Unspent welcome credits count toward the admin "credit liability" figure at ৳40 each, even though nobody paid for them.
- The admin funnel's "General resume" stage now holds only accounts created before 032.
- Marketing copy everywhere says "first complete application free", never "first resume free". That includes the landing page, feature pages, `llms.txt`, the Terms of Service and the `video-production` brand copy.
