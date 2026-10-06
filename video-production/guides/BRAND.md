# TopCandidate brand — for the frame

Source of truth is the product: `apps/web/src/index.css` (`@theme`), `apps/web/AGENTS.md`
(brand rules), `apps/web/src/presentation/i18n/locales/{en,bn}.ts` (copy). This file adapts it
for 9:16 video. Tokens: `shared/brand/tokens.css`; JS mirror: `scripts/lib/config.mjs` (`BRAND`).

## Positioning (non-negotiable)

- TOP CANDIDATE is a **job application toolkit** — "a complete application kit for every job".
  **Never** "AI resume builder/maker"; **no "AI" in any on-screen copy or spoken script we write.**
- Audience: students, fresh graduates and experienced professionals applying for jobs in
  Bangladesh (and Bangladeshis applying to remote roles).
- Name forms: **TOP CANDIDATE** (wordmark), Top Candidate (in captions), টপ ক্যান্ডিডেট. URL: **topcandidatebd.com**.

## Product facts you may show (all from the repo)

| Fact | Source |
|---|---|
| One paste → five deliverables: Tailored Resume · Cover Letter · Recruiter Email · LinkedIn Note · Interview Prep | en.ts 1338-1347 |
| BN: টেইলর-করা রিজিউমে · কভার লেটার · রিক্রুটার ইমেইল · LinkedIn নোট · ইন্টারভিউ প্রস্তুতি | bn.ts 1316-1324 |
| Cover letter 250–400 words · LinkedIn note < 280 chars · Interview prep 6–8 questions, EN + বাংলা | llms.txt / feature pages |
| Resume: ATS-ready, 5 templates (Classic, Modern, Serif, Compact, Executive), PDF + Word | TemplateRegistry.ts |
| "Three steps. About a minute." Paste the job post → We tailor everything → Download, send, prepare | en.ts |
| First resume free · ৳200 for 5 applications (≈৳40 each) · Pay with bKash · no card, no subscription | en.ts 1376-1416 |
| Price compare: CV writer in Dhaka ৳2,000–3,500 · Subscription ৳800+/mo · TOP CANDIDATE ৳200 | en.ts 1364-1372 |
| Banglish input gets turned into English bullet points; platform in English & বাংলা, resumes in English | llms.txt |

Anything else (success rates, user counts, "gets you hired") — **don't claim it.** Landing
testimonials are unverified; don't quote them as real.

Ready-made copy: hero "Become the candidate recruiters *can't ignore*." · CTA "Stop sending the
same resume everywhere." / "সব জায়গায় একই রিজিউমে পাঠানো বন্ধ করুন।" · buttons "Start free" /
"ফ্রিতে শুরু করুন", "Build my application" · pricing "The price of an *evening snack*. The work of a weekend."

## Color

| Token | Hex | Use in video |
|---|---|---|
| Ink 700 | `#0F1B2D` | text on light, dark plates, caption stroke |
| Ink 800 | `#09121F` | stage background |
| Stone 50 | `#FAFAF7` | cards, end card, light plates |
| Stone 100/200 | `#F2F1EB` / `#E5E2D8` | secondary fills, borders |
| Orange 500 | `#E8743B` | highlight box, logo bar, sticker — **≈10% of pixels max** |
| Orange 600 | `#C95D27` | orange display text on stone (contrast) |
| CTA surface | `#17243A` | dark toolkit card |

Rules: **no gradients, no blue/indigo/purple washes, no neon.** Orange is a highlighter, not a
background. The 5 toolkit chip tints (amber/coral/green/blue-grey/lavender at 14–16% alpha) are
allowed only on the dark toolkit card, exactly as the dashboard does.

## Type

- **Instrument Sans** 600/700 — captions, UI, stickers.
- **Source Serif 4** 600 (+ italic) — display headlines, wordmark, end card. Italic orange-600 for the accent phrase, like the site hero.
- **Hind Siliguri** 600/700 — Bangla-script captions/UI; **Tiro Bangla** — Bangla display.
- Eyebrows: 24 px uppercase, 0.22em tracking, orange-600.

## Logo

`shared/logos/logo-mark.svg` (copied from `apps/web/public`): ink "C" arc + ink stem + orange "T"
bar. Never redraw, recolor (except ink→stone on dark), or put on a filled tile. Wordmark =
mark + "TOP" (ink) "CANDIDATE" (orange 500), Source Serif 4 semibold. The `logo` and `cta`
components draw it on with a stroke animation.

## Frame & safe zones (1080×1920)

Platform UI covers: top 220 px, bottom 400 px, right 140 px. Captions sit at y≈1180
(face usually 400–1000). Cards go top (y 220–900) so the speaker's mouth stays visible, or
full-frame with a stone plate for product moments.

## Look & feel

Modern, sharp, internet-native, human, Bangladeshi, slightly provocative — professional without
being corporate. Cards are real product UI language (rounded 36 px, soft ink shadows, stone
surfaces). Avoid generic SaaS ad tropes, 3D, glow, glitch-for-its-own-sake, every-word animation.
