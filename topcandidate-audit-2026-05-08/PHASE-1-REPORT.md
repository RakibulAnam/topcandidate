# Phase 1 — Static Project Audit

Audit date: 2026-05-08
Branch: `feat/coin-system` @ `6f1e3eb`
Scope: read-only repo audit. Five rubric scores (1–5, 5 = production-ready) with cited evidence.

> Scoring philosophy: 5 = ship now, 4 = ship with one polish, 3 = ship-blocking issues but fixable in a day, 2 = significant rework, 1 = not deployable.

---

## a. Privacy & data handling — **3 / 5**

**What's good**
- RLS enabled on every table. Policies are uniformly `auth.uid() = <user_col>` and cover SELECT / INSERT / UPDATE / DELETE per table. No table is left open. ([supabase/schema.sql:21–382](supabase/schema.sql))
- `purchases` correctly has no INSERT policy for users — writes go through `process_mock_purchase` RPC only. ([004_add_toolkit_credits.sql:50](supabase/migrations/004_add_toolkit_credits.sql))
- Client never holds AI provider keys. All Gemini/Groq calls go through Vercel Functions in `/api/*`, gated by `authenticate()` (Supabase JWT verifier). ([api/_lib/auth.ts:28–49](api/_lib/auth.ts))
- Per-user daily AI cap (20/day, rolling 24h) implemented via `ai_call_log` and `assertWithinLimit`. ([api/_lib/rateLimit.ts:32–54](api/_lib/rateLimit.ts))
- `delete_user()` RPC cascades cleanup across all profile sub-tables before deleting the auth user — no orphaned data. ([supabase/schema.sql:492–518](supabase/schema.sql))
- Resume snapshots stored in `generated_resumes.data jsonb` — kept on Supabase only, not on third-party AI provider servers (calls are stateless).

**What's broken**

🔴 **P0 — Toolkit credits self-grant via direct UPDATE.**
The migration comment claims "users cannot manipulate the credits column directly via RLS" ([004:14](supabase/migrations/004_add_toolkit_credits.sql)), but Postgres RLS only restricts ROWS, never COLUMNS. The policy `Users can update own profile … for update using (auth.uid() = id)` ([schema.sql:26–27](supabase/schema.sql)) lets any authenticated user run:

```js
await supabase.from('profiles').update({ toolkit_credits: 999999 }).eq('id', myUserId)
```

…and instantly grant themselves unlimited paid generations. There is no `revoke update (toolkit_credits) on profiles from authenticated;` anywhere in the schema or migrations (`grep -r "revoke" supabase/` returns zero hits). The author's intent was correct; the implementation does not match. **This is a P0 launch blocker** — the entire monetization layer is bypassable from any signed-in browser console.

Fix: drop the broad UPDATE policy; replace with `revoke update on profiles from authenticated; grant update (full_name, email, phone, location, linkedin, github, website, user_type, onboarding_complete, updated_at) on profiles to authenticated;` (or the equivalent column-level grant), then re-add the row-level USING clause.

🟠 **P1 — `delete_user()` and `handle_new_user()` lack `set search_path`.**
Both are `SECURITY DEFINER` ([schema.sql:387–397, 492–518](supabase/schema.sql)) but unlike the credit RPCs they don't lock `search_path`. A malicious schema object could shadow `public.profiles` / `public.experiences` and hijack the function's elevated rights. The credit RPCs do this correctly ([004:72](supabase/migrations/004_add_toolkit_credits.sql)) — these two are inconsistent.

🟠 **P1 — Mock purchase RPC is callable directly via JWT.**
`process_mock_purchase` is `SECURITY DEFINER` and its `EXECUTE` privilege is implicitly granted to the user role; a determined user can call it directly from the browser to grant themselves credits without going through `/api/purchase`. AGENTS.md §13 acknowledges this as known debt for the mock phase, so it's not a surprise — but **it must be revoked or replaced before any real-money flow ships**.

🟡 **P2 — `ai_call_log` insert is owned by the user.**
Users can self-INSERT log entries ([schema.sql:323–324](supabase/schema.sql)), which only hurts themselves (inflates their own cap). Acceptable, but worth noting that the cap is best-effort.

🟡 **P3 — Disposable-email block is bypassable** by Gmail aliases (`name+test@gmail.com`) — those aren't on the disposable list. Not a security issue, just churn risk for analytics. ([emailValidator.ts:75–104](src/application/validation/emailValidator.ts))

---

## b. AI prompt quality (industry generality) — **2 / 5**

The prompts are well-engineered for TECH roles, weak for the BD market spread the product targets.

**Tech-bias evidence**

🔴 **P1 — Optimizer system prompt examples are 80% tech.** ([resumeOptimizerPrompts.ts:22–82](src/infrastructure/ai/prompts/resumeOptimizerPrompts.ts))
The "Lift multi-word JD phrases verbatim" examples are *all* tech: `"design system", "distributed systems", "WCAG 2.2 AA", "Core Web Vitals", "Infrastructure as Code", "incident response", "on-call rotation", "feature flags", "stakeholder management"` (line 28). A model reading this will conclude the product is for engineers. There are zero examples for banking ("KYC", "AML", "credit underwriting"), FMCG ("primary sales", "secondary sales", "trade marketing"), pharma ("MR coverage", "Rx generation", "doctor call"), garments ("knit/woven", "FOB", "TNA", "buyer audit"), or NGO ("MEAL", "log frame", "donor reporting").

🔴 **P1 — Skill taxonomy is hard-coded tech.** ([resumeOptimizerPrompts.ts:43–52](src/infrastructure/ai/prompts/resumeOptimizerPrompts.ts))
Categories listed: Languages / Frameworks & Libraries / Tools & Platforms / Cloud & Infrastructure / Databases / Testing & Quality / Methodologies / Domain. Six of eight are tech-only. The "substitute fitting category names" line (`"Clinical Skills", "Research Methods", "Design Tools", "Legal Domains"`) is a fig leaf — for a banker the model has no anchor whatsoever. Expect categorized output for non-tech personas to be inconsistent or to fall back to flat skills.

🔴 **P0 — Anti-fabrication guard is asymmetric.** ([toolkitContext.ts:293–338](src/infrastructure/ai/prompts/toolkitContext.ts))
`TECH_TOKENS` lists 100+ tech tools (AWS, React, Stripe, etc.) but **zero** non-tech industry tools. The system happily catches "AWS" fabrication in an engineer's outreach email but will not catch a banker's invented "Bloomberg Terminal" / "Murex" / "Finacle" / "Avaloq", a pharma rep's invented "Veeva" / "IQVIA", a garments candidate's invented "WFX" / "TNA software", or a marketer's invented "Salesforce CRM"/"HubSpot" if none of those are TECH_TOKENS. The strongest guard in the system is effectively a no-op for 7 of the 10 personas this product targets. The fabrication risk for non-tech BD candidates is therefore higher than for tech — exactly the wrong cut. **Treat as P0 because fabrication is the named highest-severity finding in the audit brief.**

🟠 **P1 — Verb taxonomy in RULE 3 leans tech.** ([resumeOptimizerPrompts.ts:34–37](src/infrastructure/ai/prompts/resumeOptimizerPrompts.ts))
"Architected, Refactored, Migrated, Deployed, Shipped" are all engineering verbs. A territory sales manager doesn't "architect" or "refactor" — they "expanded coverage", "negotiated", "merchandised", "drove primary lift". The model will likely still pick reasonable verbs because the rule says strong-verb-only, but the *examples* will steer mid-quality outputs toward engineer-coded language.

🟠 **P1 — Voice signature only loops experience + projects.** ([toolkitContext.ts:178–195](src/infrastructure/ai/prompts/toolkitContext.ts))
Fresh graduates with extracurriculars but no work history will get an empty VOICE REFERENCE block, which weakens the toolkit's ability to mimic their tone. Easy fix: append extracurricular `description` excerpts.

**What's good**
- Two-call hot path (optimizer + combined toolkit) is the right architecture for free-tier RPM. ([ResumeService.ts:91–94](src/application/services/ResumeService.ts))
- Specificity guards (`assertOutreachSpecificity`, `assertInterviewAnchorCoverage`) are well-designed and are *not* tech-coded — they only check for proper-noun anchors, which works for any field. ([toolkitContext.ts:438–502](src/infrastructure/ai/prompts/toolkitContext.ts))
- SKILL HONESTY rule + `filterFabricatedSkills` + alias dictionary is solid and field-agnostic. ([resumeOptimizerPrompts.ts:297–363](src/infrastructure/ai/prompts/resumeOptimizerPrompts.ts))
- Seniority bucketing tunes verb intensity correctly. ([resumeOptimizerPrompts.ts:547–554](src/infrastructure/ai/prompts/resumeOptimizerPrompts.ts))
- Bullet-density trimming and lead-bullet promotion are smart and field-agnostic.

---

## c. ATS export correctness (Preview = PDF = Word) — **4 / 5**

Verified via deep read of all three exporters.

**What's right**
- All three are single-column. PDF uses jsPDF text APIs (no `<table>`), Word uses native `Paragraph`/`TextRun` (no layout tables), Preview is a flat flow. ✓
- Page width identical: `PAGE_WIDTH_PT = 595.28` in both Preview ([Preview.tsx:75](src/presentation/components/Preview.tsx)) and PDF ([PdfResumeExporter.ts:21](src/infrastructure/export/PdfResumeExporter.ts)).
- Font sizing uses the same `template.sizeBody` / `template.sizeHeading` pulled from `TemplateRegistry` in all three. Word converts via `pt(points) = Math.round(points * 2)` (half-points), preserving the same visual size. ✓ CLAUDE.md hard rule #7 is honored.
- All bullet text colored black (`#000` / `setDrawColor(20)` / `'000000'`), no rogue indigo in resume body.
- `skillCategories` rendered consistently across all three: bold category name + comma-separated items. ([Preview 637–646](src/presentation/components/Preview.tsx) / [Pdf 213–220](src/infrastructure/export/PdfResumeExporter.ts) / [Word 491–513](src/infrastructure/export/WordResumeExporter.ts))
- Lucide icons in Preview are confined to UI chrome (sidebar, buttons), not embedded in the resume body. ✓
- `exportCoverLetterToWord` and `exportCoverLetterToPDF` exist on both underlying exporters, routed through `CompositeResumeExporter`. ([CompositeResumeExporter.ts:19–29](src/infrastructure/export/CompositeResumeExporter.ts))

**What needs polish**
- 🟡 **P2 — Preview uses `<ul><li>` with `listStyleType: 'disc'`** ([Preview.tsx:251–261](src/presentation/components/Preview.tsx)). Some ATS strip list elements. Not an issue for the *exported* PDF/Word (those use `•` and native docx bullets), but inconsistent with the "what you see is what you download" promise — the Preview's bullet glyph might render differently from the PDF's. Low-impact but worth aligning to text bullets.
- 🟡 **P2 — Toolkit artifacts (outreach, LinkedIn, interview Qs) have no export method.** Copy-to-clipboard only. Users who want to archive their full application package as files cannot. Pre-launch this is a gap, not a blocker.

---

## d. Cultural / market fit (Bangladesh) — **2 / 5**

**What hurts conversion**

🔴 **P1 — Landing page is Silicon Valley-coded.** ([locales/en.ts:869–910](src/presentation/i18n/locales/en.ts), captured in [00-landing-page.png](screenshots/00-landing-page.png))
- Consultant cards reference "FAANG and growth-stage cos" and "series-B startups" — terms that mean nothing to the BD job market. The bn.ts translation literally keeps "FAANG" untranslated ([bn.ts:859](src/presentation/i18n/locales/bn.ts)).
- Testimonial author names are `Priya K.`, `Marcus T.`, `Lena R.` (en.ts:904–910) — Indian/Western names. A BRAC Bank candidate landing here doesn't see themselves in the testimonials. Replace with BD names: `সুমাইয়া আক্তার / Sumaiya A.`, `মেহেদী হাসান / Mehedi H.`, etc.
- Consultant prices are `$120–$160 / 60 min` (USD). BD users want BDT and a price band that reads as locally affordable (৳1,500–3,000 / hour). The mock-purchase pack itself is correctly priced in BDT (৳200) — the landing page is inconsistent.
- "Mock interviews with hiring managers" is prominently teased on the landing as if available, but AGENTS.md §13 lists it as deliberate non-goal for now. Bait-and-switch risk.

🟠 **P1 — Free vs. paid messaging is contradictory on the landing page.**
Hero says "Free to try / No credit card / Build my toolkit — free", but the actual tailored-toolkit flow is paid (gated by `toolkit_credits`). The free path is the General Resume only (optimizer-only, no toolkit). New users will hit a 402 + PurchaseModal on their first toolkit attempt — that's a worse first impression than a clearly-priced paywall.

🟠 **P2 — Banned gradient slipped into ProfileScreen.**
[ProfileScreen.tsx:206](src/presentation/ProfileScreen.tsx) uses `bg-gradient-to-r from-brand-50 to-brand-100/60`. CLAUDE.md hard rule #3 explicitly bans gradients. Self-violating own house style.

🟡 **P3 — BD CV conventions partially supported.**
- Languages section ✓ (en/bn proficiency capture in profile sub-table).
- References ✓ (named referees with phone+email; `references_list` table).
- Photo on CV ❌ — BD recruiters in conservative sectors (banks, pharma, garments) often expect a photo. Currently neither captured nor rendered. AGENTS.md §13 doesn't list this as known debt — it's an actual gap.
- Date of birth / NID ❌ — common in BD CVs; not captured.
- Expected salary ❌ — sometimes asked; not captured.
  
  These four are deliberate stances per the AGENTS.md spirit, but for the conservative end of the BD market they hurt conversion. At minimum, surface "BD CVs often include a photo / DOB / expected salary — we recommend leaving them off because they bias screening, but you can add them as a custom field" so users understand it's a choice, not an oversight.

🟡 **P2 — Locale parity gaps.** Per the parity check:
- 5 keys in `bn.ts` are full English strings: `sectionSummary` ('Professional Summary'), `sectionExperience`, `sectionProjects`, `sectionEducation`, `placeholderName` ('YOUR NAME'). These render in the resume *preview chrome* — Bengali users will see "Professional Summary" inside their Bengali UI. ([bn.ts:104–116](src/presentation/i18n/locales/bn.ts))
- `switchToEnglish: 'Switch to English'` is itself in English — minor irony. ([bn.ts:40](src/presentation/i18n/locales/bn.ts))
- Acceptable: TS type-imports `Dictionary` from `en.ts`, so missing/extra keys break the build. Structural parity confirmed; it's content gaps.

**What's right**
- Native Bengali script support, Hind Siliguri / Tiro Bangla font swaps via `html[data-locale="bn"]`. ([AGENTS.md §10](AGENTS.md))
- BD-specific profile sections (Languages, References) included.
- AI output stays English — correct call for BD recruiters; explicitly documented.
- Banglish dictionary in the gibberish detector rescues romanized Bengali brain-dumps.

---

## e. Failure handling — **4 / 5**

**What's right**
- Optimizer + toolkit run via `Promise.allSettled` so a toolkit RPM-blip doesn't kill the resume. ([api/optimize.ts:83–86](api/optimize.ts), [ResumeService.ts:91–94](src/application/services/ResumeService.ts))
- 🟢 **Refund logic is correct.** If the optimizer rejects after the credit was consumed, `refund_toolkit_credit()` is called. If only the toolkit fails, the credit is kept (user got a resume, retries are free). ([api/optimize.ts:88–101](api/optimize.ts))
- 🟢 **Atomic credit decrement.** `consume_toolkit_credit()` is a single `UPDATE ... WHERE toolkit_credits > 0 RETURNING ...` — Postgres row-locks serialize concurrent calls; race-safe. ([004:68–90](supabase/migrations/004_add_toolkit_credits.sql))
- 🟢 **Toolkit single-call architecture means a transient Gemini failure produces 4 cleanly-marked failed cards, each retryable individually for free.** ([ResumeService.ts:108–129](src/application/services/ResumeService.ts), [api/toolkit-item.ts](api/toolkit-item.ts))
- 🟢 `withRetry` wraps the toolkit call with one extra attempt + exponential backoff. ([ResumeService.ts:207–220](src/application/services/ResumeService.ts))
- 🟢 Provider router cools down a failing provider for 10min so quota-exhausted Groq doesn't keep eating retries. ([AGENTS.md §9](AGENTS.md))

**What's weak**

🟠 **P1 — Refund failure is silent.**
If `refund_toolkit_credit()` itself errors, only `console.error` runs ([api/optimize.ts:93–95](api/optimize.ts)). The user is silently charged for nothing. Should at minimum return a 502 with `code: 'refund_failed'` and surface a "we owe you a credit, support@" message in the UI — or better, write a queue row to retry.

🟠 **P1 — Rate-limit fail-open on Supabase hiccup.**
`assertWithinLimit` logs a warning and allows the call when Supabase errors ([rateLimit.ts:46–49](api/_lib/rateLimit.ts)). Documented trade-off, but a Supabase outage = unbounded AI provider spend. Worth a cap-of-last-resort (e.g. process-level Map).

🟡 **P2 — `logCall` failure is silent.** Already-charged user gets their resume; their daily-cap counter just doesn't tick. Acceptable trade-off but invisible to ops.

🟡 **P2 — Timeout cascade is generous.** Gemini optimizer 45s × 3 attempts = 135s, plus toolkit retry. Vercel `maxDuration: 60` on Hobby tier ([AGENTS.md §12](AGENTS.md)) means the function will be killed mid-retry on a slow generation, leaving the user with a credit consumed and no result. The refund logic *should* catch it via the `optimizedResult.status === 'rejected'` branch — but only if the function itself returns; if Vercel hard-kills, no refund runs. Worth verifying empirically (Phase 4).

---

## Phase 1 score recap

| # | Area | Score | One-line headline |
|---|---|---|---|
| a | Privacy & data handling | **3 / 5** | RLS solid; **toolkit_credits is directly UPDATEable from any signed-in browser** — P0 launch blocker |
| b | AI prompt quality (industry generality) | **2 / 5** | Tuned for tech; **fabrication guard is asymmetric** — non-tech personas have weaker honesty guarantees |
| c | ATS export correctness | **4 / 5** | Preview/PDF/Word in lockstep. Minor: Preview uses `<li>` while exporters use text bullets |
| d | Cultural / market fit (BD) | **2 / 5** | Landing is Silicon Valley-coded; FAANG/series-B framing; testimonial names not BD; gradient slipped into ProfileScreen |
| e | Failure handling | **4 / 5** | Refund + atomic decrement + allSettled all good; refund-failure path is silent |

**Phase 1 verdict:** the architecture is sound, the AI prompt engineering is thoughtful for tech roles, and the credit/refund logic is built right. The product is **not currently launchable in BD** because of (1) the toolkit_credits column-grant gap — bypasses monetization entirely; (2) the asymmetric fabrication guard — a banker's resume can hallucinate Murex/Finacle and ship; (3) the landing page being culturally off-target for the named market.

Proceed to Phase 2 (E2E happy path) and Phase 3 (multi-persona × multi-JD) to see whether the prompt-quality concerns materialize in actual generated output, and to empirically verify the toolkit_credits exploit.
