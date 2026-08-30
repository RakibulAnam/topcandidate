# AGENTS.md — TOP CANDIDATE (web app)

> Single source of truth for AI agents (Claude Code, Cursor, Antigravity, etc.) working on the **web app**.
> Read the root [`../../AGENTS.md`](../../AGENTS.md) first for monorepo topology; this file is the web-specific guide.
> Updating this file is **part of every change** — see the maintenance protocol below.

---

## 0. Maintenance protocol (read first)

This document is load-bearing. It is what keeps future agents from burning tokens re-crawling the project.

**After any of the following changes, update this file in the same commit:**

| Change type | What to update |
| --- | --- |
| Add / remove a domain entity | §5 Data model, §6 Application flow (if affected) |
| Add / remove a use case | §4 Architecture (use case list), §5 Data model (if types change) |
| Add / remove an AI generator | §4 Architecture, §9 External services, §6 Application flow |
| Add / remove a screen | §7 Key files, §6 Application flow |
| Change the database schema | §8 Database, and add a migration under `supabase/migrations/` |
| Change brand tokens, fonts, or palette | §10 Brand & design |
| Add a new env var | §12 Env vars |
| Add a new runtime dependency | §2 Tech stack |
| Change feature surface (ship/kill) | §3 Product surface |
| Add a new user-facing string | Add to `src/presentation/i18n/locales/en.ts` AND `bn.ts`, then use via `useT()` (§11) |

Also update `CLAUDE.md` if the change introduces a new rule agents must follow (e.g. "always do X when editing Y").
If a feature ships, delete its entry from §13 "Known debt / non-goals" once it is no longer a non-goal.

**Never** let this file drift. An outdated AGENTS.md is worse than none — it makes future agents confidently wrong.

---

## 1. What this is

**TOP CANDIDATE** is a career toolkit. A user pastes a job description, and an AI toolchain produces a complete, role-tailored application package:

1. **ATS-friendly resume** — tailored bullets, summary, skills
2. **Cover letter** — 250–400 word body, no boilerplate
3. **Outreach email** — cold email to a hiring manager (subject + body)
4. **LinkedIn connection note** — ≤ 280 chars
5. **Interview question prep** — 6–8 role-specific questions with why-asked + answer-strategy notes

A future mock-interview marketplace is planned but **out of scope** until explicitly flagged.

---

## 2. Tech stack

- **React 19** + **TypeScript 5.8** + **Vite 6**
- **Tailwind CSS v4** (via `@tailwindcss/vite` — NOT the runtime CDN; migrated off `cdn.tailwindcss.com` on 2026-05-30, see the comment at the top of `src/index.css`). Brand tokens live in `src/index.css` under the `@theme` directive (no `tailwind.config.{js,ts}`); `index.html` only loads fonts.
- **Internationalisation** — DIY typed dictionary at `src/presentation/i18n/` (no library). Two locales: `en` (default) and `bn` (বাংলা / Bengali). Switch via `<LanguageToggle />` in the navbar / landing / login. Locale persists in `localStorage` (`topcandidate.locale`) and is applied to `<html data-locale>` for font-stack swapping. See §10 for fonts and §11 for the convention.
- **AI provider:** **direct Google Gemini**, one key (`GEMINI_API_KEY`), via `GeminiClient` (`@google/genai`). Optimizer / toolkit / single-artifact → `gemini-3.5-flash-lite` → `3.6-flash` → `3.1-flash-lite`; extractor / normalizer → `3.5-flash-lite` → `3.1-flash-lite`. The chain is walked CLIENT-side (Google has no server-side `models[]`) inside one deadline-bounded budget, so the parallel hot path fits Vercel's 60s cap. OpenRouter and Groq were removed 2026-08-04 — full map + the four API gotchas in §9
- **Server-side API proxy** — all AI calls go through Vercel Functions in `/api/*` (deployed automatically alongside the Vite app). Client holds NO provider keys. Auth via Supabase JWT bearer; per-user daily-cap rate limiting via the `ai_call_log` table. The client fetch helper (`ProxyClients.postJson`) aborts any `/api/*` call still pending at 90s (Vercel hard-kills functions at 60s, so a longer wait is a hung connection) and throws `ApiCallError` with `code: 'client_timeout'` / `'network_error'`; the builder surfaces these as retryable toasts.
- **Supabase** (`@supabase/supabase-js`) for auth + persistence
- **docx**, **jspdf**, **html2pdf.js** for export
- **pdfjs-dist** — client-side PDF **text** extraction for resume import (`presentation/utils/pdfText.ts`, dynamically imported so its ~1MB worker stays out of the initial bundle). The browser pulls the text out and sends only that (KB) to `/api/extract-resume`; scanned/image PDFs (no text layer) fall back to sending the base64 file. (Its transitive `dompurify` is pinned via `overrides` — see `package.json` `//audit`.)
- **Radix Popover**, **Lucide icons**, **Sonner** (toasts), **date-fns**
- **fuse.js** — fuzzy matching used inside our custom JD skill **extractor**
  at `src/presentation/utils/skillMatcher.ts`. The extractor (`extractSkillsFromJD`)
  runs four passes — known-skill match (regex + fuse), intro-phrase
  (`experience with X, Y`), section-aware bullet parsing
  (`Requirements:` / `Tech stack:`), and repeated-capitalized-phrase
  frequency. Scores + dedupes + canonicalises against the dictionary. Pure
  client-side, no Gemini call (would burn the 2-call budget).
- No import map / CDN module loading — everything (lucide-react, @google/genai, docx, etc.) is installed from npm and bundled by Vite. `index.html` carries only the font `<link>` and `<title>`.

Part of a polyglot monorepo at `topcandidate/` (web + Flutter mobile companion). No npm workspaces, no Turborepo — each app is independently built. See [`../../docs/decisions/0001-adopt-polyglot-monorepo.md`](../../docs/decisions/0001-adopt-polyglot-monorepo.md).

---

## 3. Product surface (currently shipped)

> **AI generator note:** the `Gemini*Generator.ts` files ARE the active implementation, built on `GeminiClient` and wired in `api/_lib/aiFactory.ts`. (They previously held a legacy `@google/genai` implementation and were replaced in place by the direct-Gemini port; there is no longer an `OpenRouter*` sibling set.) See §9 for the full provider map.

| Area | File entry point | Status |
| --- | --- | --- |
| Landing page | `src/presentation/LandingScreen.tsx` | shipped — BD-localized editorial redesign: centered hero with a rendered ATS resume mock, five-item toolkit list, value/pricing section (free first resume, ৳200/5 via bKash), 3-step how-it-works, BD testimonials, FAQ accordion. No announcement bar, no mock-interview section. No gradients, Saffron/Ink palette |
| Auth (email + password, **Google OAuth**) | `src/presentation/LoginScreen.tsx`, `src/presentation/auth/ContinueWithGoogleButton.tsx`, `src/infrastructure/auth/AuthContext.tsx` | shipped (Supabase Auth; Google via `signInWithGoogle` PKCE redirect — requires the Supabase Google provider configured) |
| Profile setup (master profile) | `src/presentation/ProfileSetupScreen.tsx` | shipped — one-time profile capture used to seed future resumes |
| Profile edit | `src/presentation/ProfileScreen.tsx` | shipped — view/edit saved master profile sections |
| Dashboard area — Home, All Toolkits, Purchase History (one shared shell) | `src/presentation/DashboardScreen.tsx` (Home), `ApplicationsScreen.tsx`, `PurchaseHistoryScreen.tsx`, `src/presentation/components/dashboard/{DashboardShell,ToolkitCard,CommandPalette}.tsx` | shipped — redesigned. **Home** = dated welcome hero + a dark inline "Start a new application" card (Company/Title/JD captured here → routes to the **Summary screen** `/new`), Master Resume banner, 6 recent toolkits, credits + help rows. **Routes** `/applications` + `/purchases` (`useBrowserNav`). **Global ⌘K** command palette over toolkits. Every `ToolkitCard` carries a kebab overflow menu whose only item is **Delete** (native `confirm()` → `ResumeService.deleteGeneratedResume` → the owning screen refetches; the Master Resume is unreachable from here and repository-protected anyway). The card is a wrapper `div` + body `<a>` + sibling menu, not one big `<a>`, so the button isn't nested in the anchor — **the 2026 redesign lost this menu by rebuilding the card as a single `<a>`; don't collapse it back.** `DashboardShell` owns the sticky top bar (⌘K search + credits pill + language + account menu), footer, the bottom tab bar, and the shared credits / master-resume / palette / `PurchaseModal` state via `useDashboardShell()`. **Navigation is one list — `DESTINATIONS` (Home, Applications, Master Resume, Purchases) — rendered twice:** header pills from `lg` up, and a **fixed bottom tab bar below `lg`** (icon + short label, `env(safe-area-inset-bottom)`, `aria-current` on the active tab, group capped at 520px). Below `lg` that bar is the ONLY route to these screens, so don't delete it: the pills were `sm:flex`-only until 2026-08-13, which left `/applications` **unreachable on a phone** unless the user had more than 6 toolkits (Home's "View all" was gated on that, and is no longer). The pills sit at `lg`, not `sm`, because four of them plus the search field overflow the 64px bar below ~1024px — that's why the search field is `w-44` until `xl` and truncates. Master Resume opens Preview, which is outside this shell, so that entry is never `active`. When the account has **no** master resume yet, that destination gets an attention treatment — saffron pill + dot in both the header pills and the bottom tab bar (`navLink({ attention })`) — and `DashboardScreen` promotes the Master Resume banner ABOVE the dark CTA card with a matching ring + dot. Both gate on `!loadingShell && !generalResume`, never on `!generalResume` alone: `generalResume` is null until the shell's fetch resolves, so dropping `loadingShell` makes EVERY load start in the "missing" layout and visibly jump when the data lands. Uses the scoped dashboard gradient exception (§10). |
| **Job discovery — "Roles you might be interested in"** (Home) | `src/presentation/components/dashboard/JobDiscovery.tsx`, `src/presentation/utils/jobSearch.ts` | shipped — Phase 0 (issue #39). Turns the master profile into up to **seven deep-linked job-board searches** (Bdjobs + LinkedIn + We Work Remotely) on seven angles: current title, the rung up, an adjacent role, the whole field near them, the same work at a bigger employer, **the global remote market**, and one skill. **Zero new infrastructure** — no AI call, no endpoint, no migration, nothing persisted. **Derived on every render, never stored**; LinkedIn recency is a *relative* window the board evaluates at request time (`f_TPR=r604800`), so a link cannot go stale and there is no TTL, cron, or cache. Deliberately **not** wired to the `sourceProfileHash` regenerate-nudge machinery — that exists because regenerating hits the AI. **Visible to anyone with a complete-enough profile regardless of credit balance**; the gate stays on generation, because finding a job is what creates demand for a credit. Copy promises the *search*, never an outcome. **Design — a dark board, deliberately NOT a card grid, placed BELOW the toolkits.** Two earlier passes failed in opposite directions and both are worth not repeating: a grid of white cards was indistinguishable from the toolkits directly above it, and a bare ruled index fixed that but read as the plainest thing on a page that opens with a dark hero card. So this is a *surface*, not a list — an ink `brand-700` panel that anchors the bottom of the page the way the CTA card anchors the top, settling the "is this a toolkit?" question by material alone. Tiles are `cta-surface` on `cta-border`, two-up from `sm`, each carrying a **muted per-angle tint** on the CTA card's chip formula (§10) and a **directional glyph that encodes meaning** — the step up is an arrow UP, the sideways role an arrow ACROSS, the local angle a pin, bigger employers a building. Hovering a tile lights up its OWN tint (CSS var `--tint`), since the colour is an identity rather than decoration. Read state is carried the way a visited link carries it: the tile desaturates to grey and dims, so no second control is needed to say it. Greys are picked against the TILE ground (`#23201A`), which is lighter than the panel — the values that pass 4.5:1 on `brand-700` do not pass on a tile. **There is no in-app "paste it here" hand-off** — it read as confusing next to a tile whose whole job is to leave the app; the conversion is measured from the click alone. `localStorage` holds only which tiles this browser opened, and **unopened tiles sort first** (the only honest freshness available). Bangla has no case, so eyebrows drop uppercase + tracking under `bn`. The **remote row is the one standout** — solid saffron tile with an ink glyph rather than a seventh muted hue, with `currentTitle` moved to a neutral stone tint to free the brand colour for it ("where you already are" is the least aspirational angle; the row that leaves the country is the most).

**Third source — We Work Remotely, gated on MEASURED inventory (2026-08-19).** Only five families carry a remote row: `software` ("Software Engineer"), `data` ("Analyst"), `design` ("Designer"), `marketing` ("Marketing Manager" — NOT the bare "Marketing", which is also this family's `industry`, so both tiles printed the same headline), `support` ("Customer Support") — each verified to return 26–49 live listings, with a gibberish control returning 0. Everyone else gets no remote row: Accountant returned 2, Copywriter 1, Civil Engineer 1, and HR / nursing / merchandising / supply chain **zero**. **Sales is excluded despite having the MOST inventory (57)** — remote sales is territory- and timezone-bound, so a Dhaka candidate mostly can't be hired into it; inventory is necessary, not sufficient. The remote row also sends the family's canonical **remote-market term, not the user's own title** — the one row where their wording is the wrong query, because "Android Developer" returns 0 on WWR where "Software Engineer" returns 49 for the same person. Everything in `RoleFamily.remote` is measured; don't add a family without counting first. Events: `job_search_link_clicked` (`angle`/`source`/`query`/`family`), `jd_pasted_after_search_click` (`angle`/`source`/`minutesSinceClick`). |
| Internationalisation (en + bn) | `src/presentation/i18n/` — `LocaleContext.tsx`, `LanguageToggle.tsx`, `locales/en.ts`, `locales/bn.ts` | shipped — full UI in English and Bengali; AI output stays English |
| New-application flow | `src/presentation/SummaryScreen.tsx` (`/new`) → `src/presentation/BuilderScreen.tsx` | shipped — **the 7-step wizard is retired**. Dashboard start card → **Summary** (pick sections → `visibleSections`; greyed "+ Add" for sections not in the profile) → `BuilderScreen` in `autoGenerate` mode fires the 2-call generation on mount and renders only **Generating → Preview** (or error + retry). Opening an existing resume → Preview directly. |
| Resume preview + templates | `src/presentation/components/Preview.tsx`, `src/presentation/templates/TemplateRegistry.ts` | shipped (**5 ATS-safe templates**: Classic, Modern, Serif, Compact, Executive). All are single-column, real-text, no tables/columns/images — parser-safe regardless of pick. They vary on real layout dimensions, not just type: font family, header alignment (left/center), an optional full-width **letterhead rule** (`headerRule`), **section-heading style** (`headingStyle`: full underline / rule-to-the-right / plain tracked caps), **name style** (`nameStyle`: bold title-case vs tracked uppercase — now honored in the PDF exporter too), and density. All three renderers (Preview, `PdfResumeExporter`, `WordResumeExporter`) read these from the shared registry; Word approximates rule-right as a full underline (a reflowable doc can't express a partial rule). The **template picker cards are name-only** (no descriptions — each name shown in its own typeface as a subtle cue; description survives as the hover `title`). **Navigation:** a single artifact nav (Resume · Cover Letter · Outreach · LinkedIn · Interview) — desktop = left sidebar, mobile = a horizontal pill rail under a slim app bar. The **template picker is a quiet, collapsible control** (desktop = a disclosure nested under the active Resume tab; mobile = a bottom sheet opened from the action dock) — NOT the front-and-center grid it used to be. **Mobile chrome:** slim app bar (back · title · `⋮` overflow for Edit/Regenerate/Word) + a bottom action dock (Template · Fit/100% · Download PDF) in the thumb zone; the dock shows only on the Resume/Cover-Letter tabs. The Fit/100% zoom is mobile-only (on desktop `fit` already renders at 100%). **Document:** the fixed-width pt sheet is wrapped in `ScaledDocument` — a `transform: scale()` fit-to-width view driven by `ResizeObserver`; the pt sheet itself is untouched (rule 7 — still PDF-identical). Contact line + project/publication/reference links render as real hyperlinks via the shared `templates/contactLinks.ts` (also used by both exporters); visible text is a **shortened, ATS-safe URL** (`prettyUrlLabel` strips the scheme, a leading `www.`, and a trailing slash → `linkedin.com/in/name`) with the full `https://…` URL as the link target — deliberately NOT a bare label like "LinkedIn", which would hide the destination from annotation-blind ATS parsers and on a printout. |
| Cover letter generation + viewer | `src/infrastructure/ai/GeminiCoverLetterGenerator.ts`, viewer inside `Preview.tsx` | shipped |
| **Outreach email** generation + viewer | `src/infrastructure/ai/GeminiOutreachEmailGenerator.ts`, `src/presentation/components/Builder/ToolkitViewers.tsx` | shipped |
| **LinkedIn note** generation + viewer | `src/infrastructure/ai/GeminiLinkedInMessageGenerator.ts`, `ToolkitViewers.tsx` | shipped |
| **Interview Q prep** generation + viewer | `src/infrastructure/ai/GeminiInterviewQuestionsGenerator.ts`, `ToolkitViewers.tsx` | shipped |
| General Resume (profile-based, regenerate-on-change) | `ResumeService.generateGeneralResume()` / `regenerateGeneralResume()` | shipped — **never hard-fails and never shows raw text**: `optimizeOrAssembleGeneral()` tries the optimizer and, on any error, falls back to per-item assembly (`assembleGeneralFallback`). For each experience/project/activity it uses the stored AI-normalized bullets; when those are missing it runs the per-item normalizer (`/api/normalize-item`, injected `IProfileItemNormalizer`) on the raw text on demand — polishing Banglish/free text into English bullets, retrying transient failures (up to 3×), and persisting the result via `saveXNormalized` so the profile carries it thereafter. If the AI is unavailable it emits **empty** bullets, never the raw input (tracks `general_resume_fallback_used`). Stamps `ResumeData.sourceProfileHash` (`application/validation/profileHash.ts` — hashes user-entered profile content, excludes AI-derived keys) at generation. `ProfileScreen` compares it against a **saved-profile snapshot** (not live edit state) to show a regenerate nudge + button only when the persisted profile changed. **No per-user regen cooldown** — the profile-change gate + the free-tier daily cap on `/api/optimize-general` are the controls. Preview renders **résumé-only** for the General Resume (`isGeneralResume` → no toolkit tabs) and has **no regenerate button** (regeneration lives only on the profile page). |
| Export (Word + PDF) for resume & cover letter | `src/infrastructure/export/` | shipped |
| Resume extract (from uploaded PDF/Word) | `GeminiResumeExtractor.ts`, prompt+schema in `prompts/extractorPrompts.ts`, in-browser text via `utils/pdfText.ts`, UI `components/profile/ResumeUploadStep.tsx` | shipped — extracts ALL sections incl. certifications / affiliations / publications via **strict `json_schema`** (`EXTRACTOR_SCHEMA`, `max_tokens` 8000) so trailing sections can't truncate. **Transport:** the client extracts PDF **text** with pdf.js and sends only that (`mimeType: 'text/plain'`, a few KB) — so text PDFs of any size work. Scanned/image PDFs (no text layer) fall back to base64 file-send, which IS bounded by Vercel's 4.5 MB body limit → that fallback caps at **3 MB raw**; the overall picker cap is 10 MB. The extractor branches on `mimeType`: text goes as a plain string, a raw file as an `inlineData` Part that Gemini reads natively (no parser plugin needed). Both branches verified against 3.x on 2026-08-04. |
| **Toolkit credits + bKash purchase** — paid tier gating tailored generations | `profiles.toolkit_credits`, `api/optimize.ts` (gate), `api/purchase.ts` (records a real pending row via `initiate_purchase`), `PurchaseModal.tsx` | shipped — `api/purchase.ts` inserts a real `pending` purchase; credits are granted out-of-band by the HMAC `confirm-purchase` webhook, not here |
| **Transaction state machine** — observable states for every bKash purchase outcome | `purchases.status`, migration 007, `confirm_purchase` v2 | shipped — `pending`/`completed`/`underpaid`/`msisdn_mismatch_review`/`expired`/`refunded`/`failed` |
| **Customer purchase status pill** — navbar widget that tracks a submitted purchase via Supabase Realtime (sub-second) + a 20s fallback poll, no time cap; shows a 3-step timeline (Submitted → Verifying → Credits added / Needs attention) and fires `onCredited` so the credits badge refreshes without a reload | `VerifyingPurchasePill.tsx`, `purchaseStatusClient.ts` (`subscribeToPurchase`) | shipped |
| **Purchase history (customer)** — read-only table on Dashboard | `PurchaseHistorySection.tsx` | shipped |
| **Customer dispute filing** | `/api/dispute-purchase`, dispute dialog inside `VerifyingPurchasePill` | shipped |
| **Operator admin SPA** — Dashboard (with action queue) / Users (search + detail + grant/deduct/flag/notes) / Purchases (filter + detail + confirm/refund/expire/reopen/grant-override/note) / Orphans / Disputes / Parser-failures (select + mark reviewed + JSON corpus export) / Audit log / Settings | `/admin`, `src/presentation/admin/AdminScreen.tsx` (shell) + `DashboardTab` / `UsersTab` / `PurchasesTab` / `OrphansTab` / `DisputesTab` / `ParserFailuresTab` / `AuditLogTab` / `SettingsTab` | shipped — owner login (username+password, sessionStorage token); Dashboard has a range-filtered business summary (earnings / users / failures / disputes); ⌘K palette jumps by TrxID / user UUID / tab name |
| **Mobile-callable webhooks** (HMAC) — orphan dump, reversal, parser failure | `/api/orphan-inbound-sms`, `/api/reverse-purchase`, `/api/admin/parser-failures` (POST) | shipped — Flutter watcher must be updated to call these |
| **Cron expiry** — flips pending rows > 24h old to `expired` | `/api/cron/expire-pending` (manual / Pro-tier Vercel Cron) + `007_optional_pg_cron.sql` (Supabase pg_cron, the default path on Hobby) | shipped — see §13 "Cron cadence" |

---

## 4. Architecture (Clean Architecture)

Four layers, dependencies flow inward.

```
 ┌────────────────── Presentation (React) ───────────────────┐
 │  LandingScreen · LoginScreen · DashboardScreen            │
 │  ProfileSetupScreen · BuilderScreen · Preview             │
 │  components/Builder/ToolkitViewers · components/FormSteps │
 └────────────────────────────┬──────────────────────────────┘
                              ▼
 ┌──────────────────── Application ──────────────────────────┐
 │  ResumeService       — orchestrates all use cases         │
 └────────────────────────────┬──────────────────────────────┘
                              ▼
 ┌───────────────────── Domain (pure) ───────────────────────┐
 │  Entities:  ResumeData · OptimizedResumeData · JobToolkit │
 │             GeneratedToolkit · OutreachEmail ·            │
 │             InterviewQuestion · ...                       │
 │  Use cases: Optimize · Export · CoverLetter               │
 │             OutreachEmail · LinkedInMessage               │
 │             InterviewQuestions · Toolkit (combined) ·     │
 │             ExtractResume                                 │
 │  Repos:     IProfileRepository · IResumeRepository        │
 │             IApplicationRepository                        │
 └────────────────────────────▲──────────────────────────────┘
                              │ implements
 ┌──────────────────── Infrastructure (CLIENT) ──────────────┐
 │  AI:       Proxy{ResumeOptimizer, ToolkitGenerator,       │
 │              CoverLetterGenerator, OutreachEmailGenerator,│
 │              LinkedInMessageGenerator,                    │
 │              InterviewQuestionsGenerator, ResumeExtractor}│
 │            ↓ POST + Supabase JWT to:                      │
 │  Export:   CompositeResumeExporter (Word + PDF)           │
 │  Auth:     AuthContext (Supabase Auth)                    │
 │  Persist:  Supabase{Profile,Resume,Application}Repository │
 │  Config:   dependencies.ts (DI container — NO AI keys)    │
 └───────────────────────────┬───────────────────────────────┘
                             │ HTTPS
 ┌───────────────────────────▼───────────────────────────────┐
 │           Vercel Functions  (server, /api/*)              │
 │  api/optimize          — runs optimizer + toolkit (2 AI), │
 │                          GATES on toolkit_credits         │
 │  api/optimize-general  — optimizer only (no toolkit, no   │
 │                          credit) — General Resume path    │
 │  api/toolkit-item      — single-item regenerate (free —   │
 │                          retry of an already-paid gen)    │
 │  api/extract-resume    — PDF/Word extract                 │
 │  api/purchase          — records a real 'pending' bKash    │
 │                          purchase (initiate_purchase RPC); │
 │                          grants NO credits (webhook does)  │
 │  api/_lib/auth         — Supabase JWT verifier            │
 │  api/_lib/rateLimit    — daily cap (ai_call_log)          │
 │  api/_lib/aiFactory    — gates on GEMINI_API_KEY:         │
 │    Gemini{ResumeOptimizer,ToolkitGenerator,CoverLetter,   │
 │    Outreach,LinkedIn,InterviewQ,ResumeExtractor,          │
 │    ProfileNormalizer} — all via GeminiClient              │
 │  api/_lib/aiTelemetry  — builds every ai_call_log row     │
 │  Shared: prompts/{resumeOptimizerPrompts,toolkitPrompts,  │
 │          toolkitContext,extractorPrompts,                 │
 │          normalizerPrompts}.ts + all 6 response schemas   │
 │  Key: process.env.GEMINI_API_KEY                          │
 │  (NEVER VITE_-prefixed — server-only, never bundled)      │
 └───────────────────────────────────────────────────────────┘
```

**Rules:**
- **Domain** depends on nothing. Pure types and interfaces.
- **Application** depends on domain only.
- **Infrastructure** implements domain interfaces. Can import SDKs (Supabase, Gemini).
- **Presentation** depends on application + domain. Can read infrastructure via `dependencies.ts` but should prefer going through `ResumeService`.

**AI call budget:** initial generation runs exactly TWO concurrent AI calls — optimizer + combined toolkit — since 2026-06-11 carried by TWO parallel HTTP requests (`/api/optimize` + `/api/toolkit`), each in its own Vercel 60s function window. (Both are `gemini-3.5-flash-lite`-primary.) Free-tier RPM history (the legacy 1-optimizer-plus-4-toolkit fan-out hit quota) is why it's capped at two AI calls. Per-item regeneration still hits the single-artifact generators (one call per retry).

**Toolkit validation is per-artifact.** `GeminiToolkitGenerator.generate()` validates each of the four artifacts (cover letter, outreach email, LinkedIn note, interview questions) in isolation and returns a `GeneratedToolkit` with optional fields plus an `errors` map. A validation failure on one artifact (empty payload, fabricated token, missing specificity anchor) records the reason in `errors[<item>]` while the other slots ship through cleanly. The old all-or-nothing throw is gone; never reintroduce it — it forced the user to manually regenerate every item when a single weak interview answer fell below the anchor threshold. The bundle runs on its own free `/api/toolkit` request (via `ResumeService.generateToolkitBundle`, which never throws — hard failures land in the errors map); only `/api/optimize` touches credits, so a toolkit retry can never double-charge. Per-item retries go through the free `/api/toolkit-item` endpoint via the Preview card buttons.

**One exception to "a failed slot just records its reason": `repairOutreach()`.** When the outreach email fails `assertOutreachSpecificity` — and ONLY that, never `ToolkitFabricationError` — the generator re-asks for that single artifact with the focused single-artifact prompt (`OUTREACH_SYSTEM_INSTRUCTION` + `buildOutreachUserPrompt`, ~20s budget) and runs the identical guards on the result, so a repair can only turn a failure into a pass. A fabrication failure must stay failed: re-rolling an invented tool is how you ship a lie on the second try. Note the honest history — this was built against a measurement contaminated by a bad test harness (the harness spread optimized output over the candidate, replacing `experience`/`projects` with `{id, refinedBullets}` stubs, which empties `buildCandidateAnchors` and makes the gate unsatisfiable). With a correct merge the primary call passes, and the repair has not been observed firing. It is kept as a net for thin or non-Latin-script profiles, not because a failure rate is known. **If you touch the toolkit test path, compose its input with `ResumeService.mergeOptimizedData`, never a spread** — a naive spread silently zeroes the anchor list and every specificity/anchor metric you then read is meaningless.

**Prompt rules that exist because a live run failed them** (don't relax without re-measuring): the toolkit prompt injects `buildAnchorDirective()` — the literal anchor strings the gate substring-matches — because describing the requirement in prose produced specific-sounding output that named nothing. Interview `answerStrategy` must contain a literal item name. `prepTopics` has a floor of 3. Nothing may open with a school for a candidate with work history, and provenance words (demo, learning, coursework, side project) survive into every artifact.

**Fit-mode dispatch (match vs. stretch).** `classifyFitMode(data)` in `toolkitContext.ts` runs a JD-vocab × candidate-evidence overlap heuristic before every toolkit call. Below 10% overlap (with JD vocab size ≥ 20) flips the toolkit into **stretch** mode — the career-switcher path. In stretch mode the prompt is rewritten to coach transferable-skill bridges and honest pivot framing, the fabrication guard accepts JD-named tools / regulators / frameworks as growth targets, outreach specificity softens from `'both'` to `'either'` (one anchor — candidate proper noun OR target company — is enough), and the outreach guard accepts JD-named growth targets. **Interview questions have NO fabrication or anchor-coverage guard in EITHER mode** (removed 2026-06-10): interview prep must probe what the JD demands, including tools the candidate has not used yet, so blocking a question because a tech is absent from the résumé defeats the purpose. `assertInterviewAnchorCoverage` still exists in `toolkitContext.ts` but has NO call sites; only `countAnchoredStrategies` runs, as `console.info` telemetry. Do not "restore" the guard — the prompt steers quality instead. Match mode keeps every original guard. **What never relaxes, in either mode:** never invent past employers, never invent credentials, never invent metrics, never coach a "claim experience you don't have" answer. JD-named tools in stretch mode must be framed as growth targets — the prompt enforces this; the guard's job is to stop blocking the vocabulary that legitimate growth-target framing requires. The same fit-mode dispatch runs in each per-item generator (`GeminiCoverLetterGenerator`, `GeminiOutreachEmailGenerator`, `GeminiLinkedInMessageGenerator`, `GeminiInterviewQuestionsGenerator`) so per-card retries stay consistent with the bundled call.

**Fabrication-dictionary categories.** The `FABRICATION_TOKEN_DICTIONARY` in `toolkitContext.ts` is intentionally restricted to **claimed-asset tokens** — vendor software (Murex, Finacle, Veeva), market-data terminals (Bloomberg, Refinitiv), certifications (CFA, FRM, ICAB), employers, and regulators. Things a candidate could fabricate to look more impressive. **Environmental regulations are NOT in the dictionary** (Basel III, IFRS 9, Basel IV, etc.) — every BD bank operates under those by definition, so saying so in a banking cover letter is descriptive, not boastful. The 2026-05-14 audit removed Basel III / IFRS 9 / Basel IV from `BANKING_TOKENS` after they kept tripping the cover letter for in-field banking candidates. When adding tokens in new industry dictionaries, apply the same test: *can a candidate fabricate this to look more impressive?* If yes (a tool, a cert, a credential), add it. If no (a regulation everyone in the industry already operates under), leave it out.

**Bilingual interview prep (English + Bangla).** Interview questions ship in both languages from the same AI call — fields `questionBn`, `whyAskedBn`, `answerStrategyBn` on `InterviewQuestion` (optional for back-compat with pre-2026-05-14 saved resumes). The English version is authoritative; Bangla is for the candidate's own rehearsal because BD interviews routinely swing into Bangla on behavioural / cultural questions even at MNCs. The combined toolkit schema and the single-artifact retry generator both require all six fields. Translation rules baked into the prompt: professional spoken Bangla (not literal word-by-word), English-canonical industry terms / employer names / regulatory frameworks / certifications kept in Roman script inline (Basel III, IFRS 9, KYC, NPL, ECL, CFA, BBA, KPI), category labels left in English. UI toggle in `InterviewPrepViewer` (English / বাংলা) defaults to English and persists via `localStorage['topcandidate.interviewPrepLang']`. Falls back to English per-field when a Bangla translation is missing. Other artifacts (cover letter / outreach / LinkedIn / resume itself) stay English-only — BD recruiters scan English, ATS systems are English-language, LinkedIn is English globally.

**Optimizer prompt + post-pipeline.** `prompts/resumeOptimizerPrompts.ts` holds the optimizer's prompt, `OPTIMIZER_SCHEMA`, and validation — keeping them out of the generator is what let the provider swap from Groq/OpenRouter to direct Gemini without touching a single rule. Beyond the system + user prompt, every optimizer response runs through this deterministic post-pipeline (in order):
1. `normalizeSkills` — dedupe flat `skills` and dedupe/clean `skillCategories` (drops empty buckets).
2. `filterFabricatedSkills` — blocks **named assets** the candidate never named; KEEPS **competency labels**. This distinction is the whole rule, and getting it wrong was measured as the single biggest quality defect in the product:
   - A **named asset** is a checkable fact — a product, library, brand, employer, certification ("SQLite", "Room", "Kubernetes", "Tally", "SAP", "CPA"). Claiming one the candidate never named is fabrication that collapses on the first interview question. **Blocked**, three ways: credential-shaped labels, `detectFabricatedTokens` (the shared proper-noun dictionary), and a structural fallback for single-token labels with no competency morphology — because that dictionary is tech-centric and blocks Kubernetes while sailing past Tally and SAP.
   - A **competency label** is the industry-standard NAME for work that was described ("Medication Administration", "Bank Reconciliation", "Lesson Planning", "REST API Integration"). **Kept.** Users write plain language or Banglish — "injection dei", "bank er statement er shathe khata milai" — and naming that in recruiter/ATS terms *is the product*.
   **Do not "restore" the old proof-of-label test.** It required the skill's own words to appear in the evidence, which is backwards: a skill is a conclusion drawn from described work, so demanding the conclusion's label in the premises means the optimizer can only echo vocabulary the user already used. Measured 2026-08-04 across five career fields, it deleted 13 skills from a mobile dev, 11 from a nurse, 9 from a teacher, 8 from a merchandiser, and **all 8 from an accountant — shipping a résumé with an empty skills section**. It made nothing more honest either: the bullets already stated the same work, so it only stripped the ATS keywords out of the section ATS weights most. After the split: 48 legitimate skills recovered, 0 deletions across those five fields, and 0 leaks against a JD demanding 20 named assets plus 4 certifications. Regression: `ai:selftest`.
   `skillEvidence` (schema) is the model's grounding quote for a label that is not verbatim — the candidate's own words, in their own language. It is **telemetry, not a gate**: gating on it lost 5 legitimate merchandiser skills to a missing array entry, since the model populates it inconsistently. Stripped from the response before it leaves the module; never persisted or rendered.
3. `reportFabricatedProse` — runs the toolkit's `detectFabricatedTokens` over the summary + every `refinedBullets` array and **only `console.warn`s**. It does not throw: the dictionary can false-positive on ordinary English (see `AMBIGUOUS_WITH_ENGLISH`), and killing a paid generation over one ambiguous word is worse for the user than shipping it.
4. `assertProseMatchesStrippedSkills` — **throws** (`ResumeFabricationError`) when a token step 2 DELETED from `skills` still appears in a bullet or the summary. That intersection is the confident signal: the same token flagged both in structured skills, where no prose makes it ambiguous, and in prose. It is also the only case that yields a self-contradicting document — the résumé simultaneously claiming and disclaiming the same tool. `withRetry` rotates model and retries; `api/optimize` refunds the credit if it never passes. **Bullets and the summary are otherwise UNGUARDED against invented metrics** (`43%`, `20M requests`) — no component anywhere checks numbers, and `detectFabricatedTokens` is a proper-noun dictionary that cannot see them. Prompt RULE 2 + temperature 0.3 are the only mitigation.
5. `dropBannedOpenerBullets` — deletes bullets opening with a RULE 3 instant-reject phrase ("Participated in", "Responsible for", "Worked on", …). Runs BEFORE the lead-bullet reorder so such a line can never be promoted into the recruiter's top slot, and never empties an item. **This exists because the rule was prompt-only and leaked**: measured 4/72 bullets across 6 optimizer runs, all the same "Participated in daily standup meetings…" line. Root cause was upstream — the normalizer emitted it and the optimizer is told to SELECT from normalizer bullets, so a weak opener one stage earlier passes straight through. Normalizer RULE 8 now forbids them too; this is the deterministic backstop. Bullets are DROPPED, not reworded: "Participated in X" → "Drove X" would silently upgrade attendance into ownership.
6. `reorderLeadBulletByJDFit` — **a rescue, not a policy** (narrowed 2026-08-11). Fires only when the model's lead bullet has ZERO JD-vocabulary overlap *and* another bullet scores ≥ 2; otherwise the model's order stands. It used to promote whichever bullet had the highest keyword count, which actively fought the composition rules: keyword density is not proof strength, and the line best proving "independent delivery" or "navigating legacy systems" often shares little vocabulary with the posting. Don't re-widen it — RULE 4 + `plan` are where ordering is decided now.
7. `reorderProjectsByJDFit` — same narrowing. Was a full re-sort of every project by aggregate JD overlap, which discarded the model's deliberate strongest-case-first order wholesale; now it only promotes a clearly-relevant project when the one in slot 0 has zero overlap. Experience is never reordered — recruiters read a career as a timeline and a shuffled one reads as concealment. `ResumeService.mergeOptimizedData` consumes the optimizer's output order for projects via `reorderProjectsByOptimizer`.
8. `enforceBulletDensity` — items whose JD-fit score is below the median across the resume's items get trimmed to 2 bullets. Items at/above median keep up to 5. Pure deletion — never adds bullets.
9. `stripBannedCliches` — regex sweep over the summary for banned opener clichés.
10. `validateOptimizedResponse` — id-presence + non-empty bullet check. Throws if violated (triggers an optimizer retry). Note the non-empty check applies to items saved with a BLANK description too (the dashboard's add-drawer marks description optional), so such an item can only pass if the model writes something for it — a known gap, tracked, not a blocker.

The user prompt also injects a `SENIORITY` line (Junior / Mid / Senior / Senior+) inferred from total months of experience + `userType`. Don't strip it — it tunes verb choice and ownership claims.

**The `plan` field — deliberation as output, because thinking is off.** `OPTIMIZER_SCHEMA`'s FIRST property is `plan` {`jdPriorities`, `proofMap`, `weakSpots`, `thesis`, `orderPlan`}, and TASK step 0 makes the model fill it before any résumé content. `takeOptimizerPlan()` logs the thesis / ordering / gaps and deletes the field in `GeminiResumeOptimizer` immediately after parse — it is never validated against, persisted, merged, or rendered.

Why it is a schema field and not an instruction: `GeminiClient` pins `thinkingLevel: MINIMAL` on every call (a real budget times out at 400s on the flash-lite models — see that file's header), so the previous `THINK FIRST (silently…)` block, **removed 2026-08-11**, was close to a no-op. The model went straight to `summary` and assembled the résumé field-by-field with no view of the whole case. Structured output is generated in property order, so putting the plan first is the one way to get genuine pre-writing deliberation under that constraint: the priorities and the evidence mapping are in the context window before the first bullet is written. **Keep `plan` first in both `properties` and `required`** — moving it below `summary` silently reverts the feature into post-hoc justification of a résumé that already exists. It also costs real output tokens on the paid hot-path call, so keep the fields terse.

Composition is governed by prompt **RULE 4** (the résumé is an argument, not an inventory): the purpose test every line must pass, lead-bullet selection by proof strength rather than metric size, chronological experience vs. strongest-case-first projects, and what to cut. RULE 5 applies the same ordering logic to the skills block. The toolkit prompt carries the parallel "decide the case before you write" / "lead with the strongest proof" pair, plus question ordering for interview prep.

**Preparation Guide (`prepTopics`) — the interview section is questions AND study topics.** The toolkit's fifth output is `prepTopics: PrepTopic[]` (3–5 items, bilingual), rendered with the questions under one "Preparation Guide" heading. **Topics are sourced from the GAP** — JD requirements the candidate's evidence does NOT support — never from what they already have, because a "revise your own work" list is filler. Each carries one concrete, finishable action ("deploy a two-service app to a local k3s cluster and practise describing a rollback", not "learn Kubernetes"); never a paid course, never a suggestion to claim experience they lack.

Why it exists, and the boundary that matters: it is the honest counterpart to the résumé, NOT a licence to inflate it. The résumé states what the candidate HAS done in the strongest true terms; this section names what they still need, so nothing in the room is a surprise. It is explicitly **not** cover for claiming a named asset they lack — a recruiter probes that in about 30 seconds, and the outcome is worse than not getting the interview because it burns the referral too. For genuinely absent JD skills the honest framing already exists in **stretch mode** ("I'd be excited to ramp on Murex" is honest; "I have Murex experience" is fabrication).

Plumbing notes: `prepTopics` is assigned OUTSIDE the interview try/catch, so a weak topics list never takes the questions down and vice versa; an empty list degrades to questions-only. `PREP_TOPICS_SCHEMA_ITEMS` and `PREP_TOPICS_BLOCK` are shared by `TOOLKIT_SCHEMA`/`INTERVIEW_SCHEMA` and both prompts so a per-item regenerate returns the same contract as the bundle — and both consts are declared ABOVE the schemas because module-level consts referenced from above hit the temporal dead zone. `IInterviewQuestionsGenerator.generate` now returns `InterviewPrep` (`{questions, prepTopics}`), not a bare array; `ProxyInterviewQuestionsGenerator` still accepts the old array shape for back-compat with an older deployment. `ResumeService` only overwrites saved topics when a regenerate actually produced some. Costs ~4s more on the toolkit call (13.6s → 17.9s measured), which its own invocation absorbs.

**Brand-name fidelity is a PROMPT rule, not a post-processing pass.** Normalizer RULE 1a and optimizer RULE 1a both say the same thing: proper nouns are copied character-for-character from the candidate's own text, never re-typed from memory; the only permitted change is casing the model is certain of. This replaces `prompts/brandFidelity.ts`, **deleted 2026-08-11** — do not reintroduce it or anything shaped like it.

The reason it was deleted, so nobody rebuilds it: it fuzzy-matched generated words against a hardcoded brand dictionary within a flat Levenshtein distance of 2, regardless of how short the key was. On a 4-character key that is half the string, so ordinary English got eaten. `distance("break","brac") = 2`, and a candidate who merely mentions BRAC anywhere got "independently **BRAC** down requirements" in their paid résumé — plus `branch`→BRAC, `black`→BRAC, `budget`→BUET, `socket`→Rocket, `probe`→Robi, `brand`/`plans`→PRAN. Its two guards could not help: the ≥5-character floor let `break` through at exactly 5, and the "don't touch words the candidate typed" check was blind by construction, because the pass runs on **model-generated** prose full of ordinary English the candidate never typed. The activation check was independently broken too — it stripped all separators before `includes()`, so "PHP, Ranorex" matched `pran` across the word boundary. The real lesson: edit-distance repair cannot tell a corrupted brand from a common word that happens to sit nearby, and a hand-maintained dictionary of local brands is unbounded work. The model gets this right when simply told to copy rather than re-spell.

The original failure it was built for (measured 2026-08-04: the normalizer rendered "bkash" as "bakesh" roughly 1 run in 10) is now the prompt's job. If it resurfaces, tighten RULE 1a — do not add a repair pass.

**Adding a new AI generator:** add an interface + use case in `domain/usecases/`, then a **provider implementation in `infrastructure/ai/`** — a `Gemini*Generator` built on `GeminiClient` (mirror an existing one; reuse the shared prompt in `prompts/` + `withRetry` + `rotateModels`, and put its response schema in `prompts/` too, never module-local). Wire it into `api/_lib/aiFactory.ts` (gated on `GEMINI_API_KEY`) and inject via `ResumeService`. For single-item ancillary output, call it from `regenerateToolkitItem()` — NOT from `optimizeResume()` (optimizer only) or `generateToolkitBundle()` (combined bundle only). To expand the initial toolkit, extend the toolkit generator's schema/prompt instead of adding a parallel call.

**Pre-flight content gates** live in `src/application/validation/` and run client-side before any AI call (in `ResumeService.optimizeResume`) and before signup (in `LoginScreen`). They are pure utilities — no SDK deps, no domain types — and exist to refuse work that would waste tokens or pollute the user pool. Two gates today:

- `gibberishDetector.ts` + `dictionaries.ts` — catches keyboard-mash on long free-form resume fields. Bengali Unicode passes through; romanized Banglish is rescued by a hand-curated word list. Conservative thresholds (errs toward letting borderline text through). Throws `GibberishContentError` with the offending field name; callers should pass `error.message` to `toast.error` rather than swallowing it.
- `emailValidator.ts` — signup gate using `validator.isEmail` for format, `disposable-email-domains` for known throwaways (lazy-imported, ~2 MB JSON kept out of the initial bundle), plus a local-part shape check. Async; only runs on signup, not login.

**Form-field email + phone validation.** Every email/phone field across `FormSteps` (PersonalInfoStep, ReferencesStep), `ReferenceSection` (master profile), and `ProfileScreen` flows through two shared UI primitives in `src/presentation/components/ui/`: `EmailInput` (synchronous `validator.isEmail` check — the disposable-list gate is reserved for signup only, to stay off the keystroke path) and `PhoneInput` (international country picker + `libphonenumber-js` validation — stores E.164 international format, defaults country to BD). Both export `isValidEmail` / `isValidPhone` helpers used by the form-submit validators in `BuilderScreen.validateStep()` and `ProfileSetupScreen.validateCurrentStep()`. Do NOT introduce raw `<input type="email">` or `type="tel">` inside the builder/profile flows — wire through these components so the per-field error UX stays consistent.

When adding a new AI entry point: add a corresponding `assertContentIsReal`-style gate at the top of the service method, listing the user-supplied free-form fields that feed the prompt. Skip short structured fields (names, dates, locations) — too noisy to score and not where waste comes from.

**Monetization & credit gate.** Tailored toolkit generation is the paid tier. The free tier is the General Resume (optimizer only, no toolkit). Splitting them is enforced at the endpoint layer:

- **`/api/optimize`** — paid path. Atomically calls `consume_toolkit_credit()` (a SECURITY DEFINER Postgres function with `search_path = public, pg_temp`) before running AI. If `toolkit_credits = 0`, returns **402** with `code: 'insufficient_credits'`. If the optimizer call itself fails, calls `refund_toolkit_credit()` so the user is not charged for an empty generation; if that refund RPC *also* fails, the 502 carries `code: 'refund_failed'` (the user was charged for nothing — the client shows a contact-support toast and the server logs `REFUND FAILED` for manual reconciliation via `credit_ledger`). Since 2026-06-11 this endpoint runs the optimizer ONLY; the response's `toolkit` field is a stale-client stub (errors map pointing at the per-item retry buttons).
- **`/api/toolkit`** — combined toolkit bundle (cover letter + outreach + LinkedIn note + interview prep) on its own function invocation, fired by the client in parallel with `/api/optimize`. Free (the optimizer's credit covers the generation, same economics as before the split); backstops are auth + the daily AI-call cap. Logs `ai_call_log` kind `'toolkit'` (migration 014). A hard toolkit failure no longer affects the optimizer request at all — the credit is **kept** because the user got their resume, and per-item retries are free.
- **`/api/optimize-general`** — free path. No credit check, no toolkit. Used exclusively by `ResumeService.generateGeneralResume()` and `regenerateGeneralResume()` via a separate `ProxyGeneralResumeOptimizer`. Backstops: the overall daily AI-call cap (20/day) **plus** a stricter per-kind cap (`KIND_DAILY_CAPS.optimize_general = 5/day` in `api/_lib/rateLimit.ts`) — the free path has no credit gate, so the per-kind cap is its only cost control.
- **`/api/normalize-item`** — "polished profile" normalization (migrations 015 + 016). Fired in the background whenever a profile item with a raw description is saved with changed text (hash-guarded): raw brain dump (English/Bangla/Banglish) → `{ bullets, skills, gaps }` stored in the item's `normalized` column beside the raw text (never replacing it). The normalizer does **FAITHFUL EXPANSION, not summarization** — it is the JD-agnostic evidence base, so it preserves EVERY distinct accomplishment/artifact/technology (bullet count scales to input richness — no fixed cap; the generator ceilings are defensive at 20 bullets / 20 skills, `max_tokens` 4000) and surfaces **grounded platform/domain expertise** (e.g. Swift + SwiftUI + an Objective-C→Swift migration ⇒ "Native iOS Development", with a strict "point to specific stated work" test) with ZERO fabrication. Per-JD *selection/compression* is the optimizer's job (it caps bullets at 3-5/role); pre-trimming at the normalizer is permanent loss. Covers all three description sources that feed generation: **experiences, projects, extracurriculars** — shared client machinery in `components/profile/polish.tsx` (`needsPolish` / `polishInBackground` / `PolishedPreview`), used by the three profile sections and `ProfileSetupScreen`. `gemini-3.5-flash-lite` → `3.1-flash-lite` chain, temp 0, strict `responseJsonSchema`, 30s deadline / 3 attempts (`GeminiProfileNormalizer`). Telemetry kind `'normalize'` is EXCLUDED from the overall daily cap (profile edits must not starve paid generations) and has its own 40/day per-kind cap. **Coaching is deliberately subtle:** at most ONE quiet "Tip:" line per item (enforced in prompt + a `slice(0,1)` in the generator), only for things the user alone can supply (almost always a missing number) — the app does the heavy lifting, never assigns homework. Downstream (2026-07 audit): the optimizer prompt sends `canonicalBullets` (with an explicit SELECT-within-budget contract) **plus `canonicalSkills`, certifications, and languages** for all three sections; the toolkit's candidate context is a **union** — refinedBullets PLUS deduped normalized.bullets (refined bullets are a JD-compressed subset and stale on reopened resumes, so they supplement, never shadow) → raw fallback, extracurriculars included, and its Skills line unions top-level + per-item normalized skills; the combined toolkit prompt has a THINK-FIRST JD→evidence mapping step; bullet-density trim requires an item to be relatively AND absolutely weak; the outreach `'both'` guard now truly enforces company (full name or ≥4-char head) AND ≥1 candidate anchor, with product nouns harvested from normalized bullets as valid anchors; BOTH fabrication-guard corpora (`buildEvidenceText` in resumeOptimizerPrompts, `buildToolkitEvidenceCorpus` in toolkitContext) include normalized bullets+skills so canonical-cased terms (e.g. "PostgreSQL" polished from "postgres diye") are never false-flagged. The optimizer also surfaces JD-relevant platform/domain terms (RULE 5 "PLATFORM/DOMAIN"), and `SKILL_ALIASES` maps `ios`/`android` to their stacks (Swift/SwiftUI/Objective-C, Kotlin/Compose) so a grounded domain term survives the substring fabrication filter even for items normalized before the normalizer learned to emit it (sourceHash-cached items keep old skills until re-saved). The endpoint 503s when `GEMINI_API_KEY` is unset and clients treat polish as unavailable — profile saves are never gated on it.
- **Guided Mode** (migration 018) — every description-bearing section (experience, project, extracurricular, award) offers a `Guided / Free write` toggle (Guided default). Guided shows a short bilingual questionnaire (`components/profile/guidedQuestions.ts` — warm question + always-visible example ANSWER, one required, rest optional/collapsed; designed for the BD market across ALL job fields, not just IT). Answers store in the row's `guided` JSONB (+`input_mode`/`guided_version`) AND assemble (`assembleGuided`) into the item's description column — so the normalizer/optimizer/fabrication-guards consume them exactly like a free brain dump (NO new AI path). The normalizer gets a guided-aware prompt clause (`ProfileItemContext.guided`) telling it the text is "Topic: answer" lines. Shared UI in `components/profile/GuidedModeField.tsx`. Switching guided→free seeds the free box with the assembled answers, and free→guided seeds the required question with the free text — so a mode switch never drops content. Awards gained `normalized` columns here (they had no polish before). The 5/section/day re-polish cap applies to guided edits too. Wired in BOTH the profile-screen sections AND onboarding (`FormSteps` experience/project/extracurricular/award steps); onboarding live-assembles answers into the description field so its existing validation/save/polish are unchanged.

  **`input_mode` default — important.** Brand-new (empty) items default to `'guided'`. But any item that ALREADY has free-text and no guided answers must be `'free'`: resume-imported items are marked `'free'` in `handleExtracted` (the extractor fills only the description, never `guided`), and migration **019** backfills legacy rows (migration 018's blanket `default 'guided'` had wrongly flipped them). Reason: a guided-defaulted item with existing text opens to an EMPTY guided form (hiding the text) and, worse, answering the questions overwrites the description on save. Never default an item with existing description text to `'guided'`.
- **Ongoing date ranges (affiliations + extracurriculars).** End Date is **optional** — an empty end means an ongoing membership/role. Do NOT mark it as an error (`MonthPicker isError={false}`; the label reads "End Date (Optional)") — flagging a validly-empty field is misleading per the subtle-UX rule. Anywhere a range is rendered with an empty end — the profile-card line in `AffiliationSection` and the affiliation line in all three resume renderers (`Preview.tsx` / `PdfResumeExporter` / `WordResumeExporter`) — show "– Present" rather than a dangling "2021-01 – ", and drop the parens entirely when there is no start date. (Experiences use their own `isCurrent` boolean for the same effect.)
- **No student/experienced selector — `userType` is DERIVED, and sections are optional.** The user no longer picks "Student vs Experienced Professional" (the `UserTypeStep` is gone from both wizards; `AppStep.USER_TYPE` / `SetupStep.USER_TYPE` are no longer in any visible-steps list). `userType` is computed via `inferUserType(experience)` in `Resume.ts` — `'experienced'` once there's ≥1 work experience, else `'student'` — and recomputed wherever ResumeData is assembled (`ResumeService.optimizeResume` + both general-resume paths, `App.prefillFromProfile`). It still tunes AI framing only (seniority bucket, cover-letter tone, default section emphasis); it never hides sections. Both wizards now show EVERY section to everyone, and **all item sections are optional/skippable** — validators only check the fields of items the user actually added (the old "≥1 experience/project/skill/education" gates were removed; skills is optional too). The forward button reads **"Skip"** when the current section is empty and **"Continue"/"Next"** once something's added (`ProfileSetupScreen` `showSkip`, `BuilderScreen` `showSkip` via `sectionItemCount`). `ProfileSetupScreen` also **weights each step visually** (`stepWeightOf`): personal info is `required`, education/experience `recommended`, everything else `optional`. Non-required steps get a tinted notice panel above the step card ("skip if it isn't you" / "worth filling in") and an outline rather than solid forward button, and `FormSteps`' `PanelHeader` optional flag renders as a saffron `SkipForward` chip instead of 10px grey caps. People scan shape and colour before they read text — the old quiet treatment left users unsure which sections they were allowed to skip. The ONLY hard content gate is **education-OR-experience**: `OptimizeResumeUseCase` throws if both are empty; `ProfileSetupScreen` shows a "no resume will be created" warning screen at finish (completes the profile, skips generation); `BuilderScreen.handleGenerate` blocks before any credit spend (gate runs before BOTH the optimizer AND the parallel toolkit bundle, so neither the tailored resume nor the toolkit is generated — including the from-scratch builder path). Proactive **banners** flag the empty state before the user tries: `ProfileScreen` shows an accent warning banner (and suppresses the general-resume CTA) when both are empty, and `BuilderScreen` shows a persistent banner on every step plus disables the Generate button (`canGenerateContent`). `getUserType`/`saveUserType` + the `profiles.user_type` column remain but are no longer read for behavior (note the legacy schema CHECK is `('student','professional')` while the app uses `'experienced'` — we simply stopped writing it).
- **Education dates are INVERTED from experiences: end is mandatory, start is OPTIONAL.** Resumes usually list education with a single graduation/completion date, not a range. `Education.startDate` is optional (`startDate?`); `endDate` is the required, meaningful field. Ongoing study is encoded as `endDate === 'Present'` (NOT a separate `isCurrent` boolean — education has none; the BuilderScreen validator's old `edu.isCurrent` ref was dead and was removed). The "Currently studying here" checkbox toggles `endDate` between `'Present'` and `''`, and lives in BOTH editors — `EducationSection` (profile page) and `EducationStep` (`FormSteps`, used by onboarding + builder). Validation: `BuilderScreen`, `ProfileSetupScreen`, and `EducationSection.handleSave` require only `endDate`; start is never flagged. All five render sites omit the leading dash when start is empty (show just the end date): the two editor summary lines (`EducationSection` card, `EducationStep` `dateRange()`) and the three resume renderers. `getEducations` orders by `end_date desc` (start may be empty). Extraction: `extractorPrompts` tells the model to put a lone date in `endDate`, and `GeminiResumeExtractor` deterministically moves a start-only date to `endDate` post-parse. No DB migration — `educations.start_date`/`end_date` are already nullable `text`.
- **`/api/purchase`** — initiates a bKash purchase. Calls `initiate_purchase(p_package_id, p_transaction_id, p_sender_msisdn)` (v3, migration 012) which records a row in `purchases` with `status = 'pending'`, then **match-on-submit**: if the operator's bKash SMS already landed (pay-first), the verified `inbound_payments` row settles the purchase synchronously and credits are granted in the same request. Returns `{ success, purchaseId, status, creditsGranted, newBalance, message }` where `status` may be `pending` | `completed` | `underpaid` | `msisdn_mismatch_review`. For submit-first ordering, `status` is `pending` and confirmation arrives out-of-band via the webhook below. Server-controlled package mapping (hardcoded in the SQL function) means users cannot fake the credit/amount values they're entitled to. Per-user 24h limit of 5 pending purchases (anti-spam).
- **`/api/confirm-purchase`** — webhook called by the owner's Flutter SMS-watcher app. Authenticated via HMAC-SHA256 of the request body (shared secret `BKASH_WEBHOOK_SECRET`). On success connects to Supabase using `SUPABASE_SERVICE_ROLE_KEY` and calls `confirm_purchase(p_transaction_id, p_observed_sender_msisdn)` which atomically flips the matching pending row to `'completed'` and grants credits. Optionally cross-checks the SMS-extracted sender msisdn against the user-claimed one; mismatch → 409. On a genuine 404 (no pending row yet — the SMS beat the customer's submit) it calls `record_inbound_payment` (when it knows the amount) so a later match-on-submit in `initiate_purchase` can settle instantly.
- Postage-stamp **race-safety**: `consume_toolkit_credit` is a single `UPDATE … WHERE toolkit_credits > 0 RETURNING …`. Postgres row-locks serialise concurrent calls; the second request with `toolkit_credits = 0` updates 0 rows and the function raises `insufficient_credits`. `confirm_purchase` uses `select … for update` for the same reason — duplicate webhook firings cannot double-grant.
- **Column-level lockdown**: `profiles` UPDATE is restricted via `revoke update on profiles from authenticated; grant update (full_name, email, phone, …) on profiles to authenticated;` — RLS only restricts ROWS, not columns, so without these grants any signed-in user could direct-UPDATE `toolkit_credits`. The credit balance is mutated only via the SECURITY DEFINER functions.
- Client UX: `BuilderScreen` and `DashboardScreen` both fetch the balance via `IProfileRepository.getToolkitCredits()` and show "X generations remaining". `PurchaseModal` is shared between them. The modal calls `onSuccess()` (no balance arg) when it closes so the caller can re-fetch / refresh state.
- **Purchase verification (migration 028).** The modal no longer closes the moment `/api/purchase` returns. It writes the pending-purchase handoff immediately (so closing the tab never loses tracking), then stays open: `completed` → green check; `underpaid` / `msisdn_mismatch_review` → the matching problem card, **never** a success toast; `pending` → a verification panel that watches the row over Supabase Realtime for 20s. If the window elapses it asks `/api/purchase-ops/verify-txn` **why**, and renders that verdict. `likely_typo` offers "Check and try again" (which voids the mistyped row via `void-txn` so the retry doesn't burn a pending slot); `awaiting_sms` / `watcher_stale` say the delay is ours and hand off to the navbar pill. After 3 attempts it stops asking the customer to re-check and shows the operator's WhatsApp / phone / Facebook / email plus a one-tap `dispute-purchase` so the request reaches the admin queue even if they never write in. The bKash number doubles as the support number (`VITE_BKASH_PAYMENT_NUMBER`).

**Adding a new paid feature?** If you ever monetise something else, do NOT introduce a generic "credits" abstraction — add a separate column (e.g. `interview_coach_credits`) and a sibling RPC. Reason: keeping each feature on its own integer is clearer for the user ("3 toolkit generations remaining") and avoids the "what else can I spend credits on?" UX trap.

**Adding a new package?** Edit the `case p_package_id` block in the `initiate_purchase` SQL function (in both `schema.sql` and a new migration). The package mapping is server-side authoritative — any new pricing must ship as a SQL change, not a client constant.

**Transaction state machine (migration 007).** Every purchase row now has a named state and a path forward:

```
pending ─────► completed             (happy path; observed >= expected; credits granted)
   │
   ├──────────► underpaid             (observed < expected; no credits; awaits top-up or admin)
   │              │
   │              └─► completed       (apply_purchase_topup sums multiple SMS; flips when reached)
   │
   ├──────────► msisdn_mismatch_review (claimed sender ≠ SMS sender; operator decides)
   │              │
   │              ├─► completed       (operator_confirm_purchase with override)
   │              └─► failed          (operator rejects)
   │
   ├──────────► expired               (cron flips after 24h with no SMS)
   │              │
   │              └─► completed       (operator can still confirm via admin path)
   │
   ├──────────► completed ─► refunded (bKash reversal SMS or operator_refund_purchase)
   │
   └──────────► failed                (terminal; explicit rejection)
```

Every transition writes to `purchase_state_changes` (actor + reason + from/to). Overpayments log to `purchase_overpayments`. Top-ups link via `purchase_topups`. The Flutter watcher dumps unmatchable SMS to `unmatched_inbound_sms` for operator reconciliation through the `/admin` SPA. The operator runbook is at [`ADMIN.md`](ADMIN.md).

**Operator surface (`/admin`)** is gated by an **owner login** (username + password → `POST /api/admin/login` → short-lived HMAC-signed session token sent as `Authorization: Bearer`). The token lives in **sessionStorage**, so closing the tab logs the owner out. Env: `ADMIN_USERNAME` + `ADMIN_PASSWORD_HASH` (scrypt; or `ADMIN_PASSWORD` plaintext fallback); `ADMIN_API_KEY` is repurposed as the token-signing secret (no longer pasted). Token mint/verify + credential check live in `api/admin/_lib/session.ts`; `requireAdmin()` (`_lib/adminAuth.ts`) verifies the bearer token.

**Free-tier abuse posture: measure, don't gate.** New accounts get `toolkit_credits = 0`, so tailored toolkits (the paid product) **cannot be farmed** — the only free generation is the Master Resume (`/api/optimize-general`, no credit gate, 5/day/account) plus `normalize` and `extract_resume`. Measured 2026-08-19 from `ai_call_log`: `optimize_general` averages **$0.00287/call**, so an account maxing every free cap every day costs about **$0.03–0.04/day (~4৳)** and gains nothing transferable. That is why there is no email-domain blocklist, no signup CAPTCHA, and no OTP: signup friction would cost more in lost conversions than the abuse costs in AI spend. What exists instead is **detection** — the System tab's "Abuse signals (30d)" panel shows free spend by never-paying accounts, accounts per browser (`analytics_events.anon_id`, a localStorage id), and accounts per hashed origin (migration 027). If those move, the first lever to pull is a **lifetime** free-generation cap for non-paying accounts in `api/_lib/rateLimit.ts` (`KIND_DAILY_CAPS`), which removes the incentive without touching identity; email normalisation, disposable-domain blocklists, and phone OTP come after that, in that order. Both browser and origin signals are tripwires, not walls — a scripted attacker talking to Supabase directly never touches our API and is not counted.

**Brute-force protection is a per-IP lockout in Postgres** (`api/admin/_lib/loginThrottle.ts` + migration 026), not the old `sleep(400)` — that only delayed one invocation, and Vercel runs invocations concurrently, so parallel guessing was unaffected. `login.ts` reserves an attempt row *before* verifying credentials, so concurrent siblings count against each other; the ladder is 5 failures → 60s, 10 → 15min, 20 → 60min, per IP, counted since that IP's last success. Keying on `x-forwarded-for` is sound here: Vercel overwrites it at the edge and does not forward external values (trusted-proxy forwarding is Enterprise-only). **Two deliberate limits, don't "fix" them without reading migration 026's header:** (1) there is no GLOBAL lock, because that would let anyone lock the owner out of the payment-recovery panel on demand — a distributed attack still needs an edge WAF rule and/or a second factor; (2) the throttle **fails open** when the RPC is unavailable, so deploying ahead of the migration can't brick the operator's only recovery surface. Every attempt (including refusals) lands in `admin_login_attempts` and surfaces in the System tab's **Admin access (24h)** panel — failures, refusals, IPs locked now, distinct failing IPs, last success, and which credential store is in force (`adminAccess.credentialStore`: `hash` | `plaintext` | `none`, since `ADMIN_PASSWORD` still authenticates when `ADMIN_PASSWORD_HASH` is unset). The SPA shell is `src/presentation/admin/AdminScreen.tsx`; tabs are individual files (`DashboardTab.tsx`, `UsersTab.tsx`, `PurchasesTab.tsx`, `OrphansTab.tsx`, `DisputesTab.tsx`, `ParserFailuresTab.tsx`, `AuditLogTab.tsx`, `SettingsTab.tsx`) with a single design-system primitives module in `ui.tsx` and a fetch wrapper in `adminApi.ts`. **Layout**: left sidebar with grouped sections (Overview / Operations / Records / System), top bar with breadcrumb + ⌘K trigger, mobile-friendly off-canvas drawer below `lg`. **No react-router** — selection state lives in the shell and detail subviews are rendered by their parent tab (back is `setSelected(null)`). App.tsx short-circuits at the outer `App` component when `window.location.pathname.startsWith('/admin')` so the panel mounts before `AuthProvider` (the operator doesn't sign in via Supabase). The admin SPA mounts its own `<Toaster />` for action feedback (separate from the customer-facing one in `App.tsx`).

**Analytics & BI (migration 013).** The admin panel has a full analytics surface backed by **first-party data only** — no third-party analytics SDK, no extra Vercel function. The client writes funnel events straight to Supabase `analytics_events` via `src/infrastructure/analytics/track.ts` (`track()` is fire-and-forget; `captureFirstTouch()` grabs UTM/referrer once; UTM is persisted to `profiles` at signup). Events emitted: `page_view` (every top-level screen change), `landing_viewed`, `signup_completed`, `signin_started/completed`, `profile_setup_completed`, `resume_generation_started/completed`, `general_resume_fallback_used`, `purchase_modal_opened`, `purchase_submitted`, `purchase_confirmed`/`purchase_pending`, `job_search_link_clicked` (props: `angle`, `source`, `query`), `jd_pasted_after_search_click` (props: `angle`, `source`, `minutesSinceClick`). The last pair is the job-discovery funnel: which of the six angles people actually click, and whether discovery drives generations — including for free users, which is the whole bet behind not gating it. The click marker is read-and-cleared, so one search click credits at most one generation. `family` is the diagnostic that says where the role taxonomy is failing — a `null` means that career fell through to the generic path.

**Job-discovery derivation guards (do not relax).** `jobSearch.ts` was measured against every real `experiences.role` in the database on 2026-08-19; before these guards, 10 of 16 users saw at least one nonsense query. (1) `normalizeTitle()` strips company LEVEL markers and parentheticals and expands a short abbreviation list — "Software Engineer II" (the most common title in the DB) and "SWE II" have no listings on any BD board, and the ladder was emitting "Senior Software Engineer II". (2) `isGibberish()` (reused from `application/validation/`) gates the whole section — placeholder profiles were rendering "Senior adasd" on the dashboard. (3) Family tokens are word-anchored, with a trailing `*` as the explicit opt-in to stem matching — an unanchored `admin` swallowed "Database Administrator" into the office-admin family. (4) `nextTitleOf()` returns **null** rather than invent a rung when no family matched: the old generic fallback produced "Head of Director" and "Executive Manager", which are not jobs. A missing row beats a fabricated one. (5) The skill angle never claims to be the user's *strongest* — `getSkills()` has no `ORDER BY`, so list position means nothing; it ranks on `normalized.skills` from the current role, which is the only real signal, and the copy says "one of your skills".

**Traffic + drop-off comes from `page_view`, with no exit handler.** The exit page of a session is simply its LAST `page_view` — `beforeunload`/`pagehide` are not used, because mobile browsers drop them routinely and a missed one would silently under-count the very screens being investigated. The trade-off: a session still being browsed looks like it exited on its current page, so `exitPages` only counts sessions idle 30+ minutes (`endedSessions`). `product-analytics` rolls this into a `traffic` block (sessions, page views, views/session, bounce rate, top/entry/exit pages) plus `signupWall` — of the sessions that reached the login screen, how many produced a `signup_completed`, which is the direct answer to "are people leaving when they hit the sign-up wall?" The firing effect in `App.tsx` is **ref-guarded and must stay that way**: StrictMode double-invokes mount effects, which logged every entry page twice, and since `npm run dev` writes to the PRODUCTION Supabase those duplicates land in real analytics. Be aware of that when developing — dev traffic is production data.

**Ad click ids are captured for a future Conversions API.** `captureFirstTouch()` stores `fbclid` and `ttclid` from the landing URL alongside the UTMs, and `track()` copies them into every event's `props` (there are no columns for them). `ttclid` in particular has NO automatic capture anywhere — no pixel is installed, so if this is removed, TikTok attribution is unrecoverable after the fact. Nothing is sent to Meta/TikTok yet; wiring server-side CAPI from `api/confirm-purchase.ts` is the intended next step, and would need a privacy-policy disclosure since it transmits hashed customer identifiers.

**Channel attribution is matched case-insensitively.** `marketing.ts` joins `marketing_spend.channel` to `profiles.utm_source` on a trimmed lowercase key, and lists channels that have signups even with no spend row entered. Before 2026-08-19 it was an exact string compare, so spend typed as `Facebook` never matched an ad link carrying `utm_source=facebook` — CAC and ROAS silently read 0 and the channel looked worthless. Canonical values to use in ad URLs and in the spend form: `facebook`, `tiktok`, `google`, `instagram`. RLS on `analytics_events` is insert-only (anon+authenticated); reads are service-role (admin) only. Supporting schema: `credit_ledger` (trigger-fed journal of every `toolkit_credits` change), `marketing_spend` (operator-entered ad spend), acquisition+activity columns on `profiles` (`utm_*`, `signup_referrer`, `last_active_at`), AI cost/telemetry columns on `ai_call_log` (`provider/model/prompt_tokens/completion_tokens/cost_usd/status/latency_ms`; `kind` now includes `optimize_general`), `generation_type` on `generated_resumes`, and read views `v_daily_revenue` / `v_daily_signups` / `v_daily_ai_usage` / `v_credit_liability`. AI cost is captured server-side in the AI endpoints via `logCall(..., meta)` using the approximate price table in `api/_lib/aiCost.ts`. Admin analytics tabs: **Revenue** (`RevenueTab`), **Product** (`ProductTab`), **Marketing** (`MarketingTab`), **Customers** (`CustomerIntelTab`), **System health** (`SystemTab`) — all using the dependency-free SVG chart primitives in `src/presentation/admin/charts.tsx`. Their endpoints: `revenue-analytics`, `revenue-export` (CSV), `product-analytics`, `marketing`, `marketing-spend` (POST/DELETE), `customer-intelligence`, `system-health`.

**Adding new admin endpoints**: ALL admin endpoints route through the single dispatcher at `api/admin/[action].ts` (we are at Vercel Hobby's 12-function cap; adding a top-level `api/admin/*.ts` file would blow it). Drop the handler at `api/admin/_handlers/<name>.ts`, register it in the `HANDLERS` map in `[action].ts`, then call from the client via `api.call('<name>', { method, body, query })`. URL convention is flat — never `/api/admin/users/:id/grant-credits`; instead `/api/admin/grant-credits` with `userId` in the body. Every endpoint gates via `requireAdmin(req, res)` from `_lib/adminAuth.ts`. Every write endpoint requires a non-empty `reason`, and ends with `await recordAuditAction(supabase, { action, targetKind, targetId, before, after, reason })` — that helper is the project's canonical way to record an operator action in `admin_audit_log`. The audit write is NOT in the same transaction as the underlying RPC; see migration 009 header for the rationale and how to verify nothing got lost (`purchase_state_changes` is the cross-check for purchase rows).

---

## 5. Data model (core types)

All defined in `src/domain/entities/Resume.ts`.

```ts
ResumeData {
  userType?: 'experienced' | 'student'  // DERIVED, never user-selected — see §5a

  targetJob: { title, company, description }
  personalInfo: { fullName, email, phone, location, linkedin?, github?, website? }
  summary: string                      // AI-generated
  experience: WorkExperience[]         // { id, company, role, dates, rawDescription, refinedBullets }
  projects: Project[]                  // { id, name, rawDescription, refinedBullets, technologies?, link? }
  education: Education[]
  skills: string[]                     // flat JD-ordered list (canonical, used by exporters)
  skillCategories?: SkillCategory[]    // AI-grouped view (Languages / Frameworks / Tools / …);
                                       //   regroups the flat list — never adds new skills.
  extracurriculars? | awards? | certifications? | affiliations? | publications?
  languages?: Language[]               // Bengali / English / etc. + proficiency
  references?: Reference[]             // 2–3 named referees w/ phone + email (BD-common)
  coverLetter?: string                 // AI-generated
  toolkit?: JobToolkit                 // AI-generated sibling artifacts
  visibleSections?: string[]           // user's section selection
  template?: 'ats-classic' | 'ats-modern' | 'ats-serif' | 'ats-compact' | 'ats-executive'
}

JobToolkit {
  outreachEmail?:      { subject: string, body: string }
  linkedInMessage?:    string              // ≤ 280 chars
  interviewQuestions?: InterviewQuestion[]
  prepTopics?: PrepTopic[]
  errors?:             Partial<Record<string, string>>
}

InterviewQuestion {
  question:       string
  category:       'Behavioral' | 'Technical' | 'Role-specific'
                | 'Values & Culture' | 'Situational'
  whyAsked:       string
  answerStrategy: string
  questionBn?:       string             // bilingual prep — Bangla mirror fields
  whyAskedBn?:       string             //   (optional for back-compat with
  answerStrategyBn?: string             //   pre-2026-05-14 saved resumes; see §4)
}

OptimizedResumeData {                    // what GeminiResumeOptimizer returns
  summary, skills, skillCategories?, experience[].refinedBullets,
  projects[].refinedBullets, extracurriculars[].refinedBullets,
  coverLetter?, toolkit?
}
```

**AppStep enum** (`src/domain/entities/AppStep.ts`) still exists, but since the wizard was retired the tailored flow only uses `PREVIEW` (post-generation) — the other steps are legacy. `ProfileSetupScreen` has its own separate wizard.
**Top-level screen routing** is driven by `useBrowserNav` (`src/presentation/hooks/useBrowserNav.ts`) — each transition pushes a `NavState` entry onto `window.history`, and the hook listens for `popstate` so browser back/forward buttons restore the previous screen. Use `navigate({ screen: 'LANDING' | 'LOGIN' | 'DASHBOARD' | 'APPLICATIONS' | 'PURCHASES' | 'PROFILE' | 'PROFILE_SETUP' | 'SUMMARY' | 'BUILDER' })` for every transition. Use `{ replace: true }` on auth-driven redirects (sign-in / sign-out / profile-setup → dashboard) so the back button doesn't bounce the user back through the auth flow. **BUILDER entries also carry `resumeId`** — stamped in by `handleOpenResume` (push) and by `BuilderScreen`'s `onGenerated` callback the moment a generation persists a new row (`replace`, so one Generate is still one Back). `App` restores from it on every arrival at `/builder`, ALWAYS refetching (the toolkit bundle is a second write that routinely lands after the user has navigated away, so an in-memory copy would restore empty toolkit tabs) and rendering a loader gated on a ref read DURING render, not on effect-set state, which would flash the idle panel for a frame. Without the id, Back-then-Forward and a reload remounted the builder at step `PERSONAL_INFO` with no resume id and showed the "Nothing is building right now" panel over a toolkit the user had already paid for.

**Deep links only work because the auth guard waits for `loading`.** `App.tsx`'s profile-completeness effect must not act while `useAuth().loading` is true — the session is still being restored from storage, so `user` is `null` but not meaningfully so, and the signed-out branch would bounce a URL the user is entitled to. Until 2026-08-13 it did exactly that: a cold load of `/purchases` went `LANDING` (replace) → session arrives → `LANDING` is unauthed → `DASHBOARD`, so every authed deep link silently landed on Home and only `/dashboard` looked correct. The effect's deps are `[userId, loading]` and it early-returns on `loading` for that reason — don't drop either. Verify any change here against all four cases: signed-in `/purchases`, signed-in `/applications`, signed-in `/profile`, and signed-out `/purchases` (which must still replace to `/`).

---

## 6. Application flow (happy path for a new tailored application)

**Paid vs. free.** The tailored Builder flow below consumes 1 toolkit credit (server-enforced in `/api/optimize`). The General Resume — built from the user's saved profile via `DashboardScreen` "Build my master resume" — is the free path: it goes through `/api/optimize-general` (optimizer only, no toolkit, no credit) and is bounded by the free-tier daily cap on that endpoint (`KIND_DAILY_CAPS.optimize_general`). There is no per-user regeneration cooldown — regeneration is offered only when the profile actually changed. See §4 for the credit-gate detail.

```
 User signs in ──► profileRepository.isProfileComplete() ──► ProfileSetupScreen (if incomplete)
                                                          └► DashboardScreen (if complete)

 DashboardScreen (Home) ──► dark "Start a new application" card: user pastes Company / Job Title / JD ──► SUMMARY
 SummaryScreen (/new) ──► tick which profile sections to include (→ visibleSections); sections NOT in the
                          profile show greyed "+ Add" (currently links to the Profile screen) ──► "Generate my application"
                  ──► (credits pill in the top bar) ──► PurchaseModal (bKash checkout) ──► /api/purchase (records pending; match-on-submit grants instantly if the bKash SMS already arrived)
                  ──► VerifyingPurchasePill tracks the row via Supabase Realtime + 20s fallback poll (no time cap)

 App.handleGenerateFromSummary ──► prefill ResumeData from profileRepository + apply the chosen visibleSections
   + the pasted targetJob ──► BuilderScreen(autoGenerate). The old 7-step wizard is RETIRED: generation fires
   on mount and the screen shows only a Generating state → Preview (or an error + retry). Opening an existing
   resume goes straight to Preview. The profile is the single source of truth (no divergent pre-gen copy).

 autoGenerate → handleGenerate() → resumeService.optimizeResume(data):
   0a. Client-side credit pre-check. If the locally-cached `toolkit_credits` is 0,
       open PurchaseModal and queue an auto-resume after success. Server still
       enforces the real check; this just avoids an obviously wasted round-trip.
   0b. assertContentIsReal(data) — pre-flight gibberish gate. Scans long free-form fields (job
       description, summary, experience/project/extracurricular brain-dumps). Throws
       GibberishContentError naming the offending field if any look like keyboard mashing.
       Bengali script + romanized Banglish (`ami`, `naam`, `bhalo`, ...) pass via the
       dictionary rescue layer in `application/validation/`. Goal: never spend AI tokens
       on `"asdfdsjurbgnasdkjn"`.
   0c. Server: /api/optimize calls consume_toolkit_credit() — atomic decrement.
       402 if balance was already 0 → BuilderScreen catches the ApiCallError(code:
       'insufficient_credits') and opens PurchaseModal. Refunded if step 1 (optimizer)
       rejects. Kept if optimizer succeeds (toolkit failures are retried free).
   1. Promise.allSettled([
        optimizeUseCase.execute(data),                       — tailors resume
        toolkitUseCase.execute(data),                        — one call for CL + outreach + LinkedIn + Qs
      ])                                                     — 2 Gemini calls total (RPM budget)
   2. Optimizer failure → throws (core artifact). Server refunds the credit.
      Toolkit failure → records same friendly error under all 4 toolkit keys so the user can retry
      any one individually (per-item retry uses the single-artifact generators, free).
   3. Return OptimizedResumeData with { coverLetter, toolkit }

 BuilderScreen merges the optimized data, autosaves to Supabase (generated_resumes), routes to PREVIEW step.

 Preview
   ├── Sidebar groups: Documents (Resume templates + Cover Letter) │ Outreach (Email, LinkedIn) │ Interview (Q prep)
   ├── Main area: resume/CL = paginated A4-in-pt render (mirrors PDF exporter)
   │              outreach email / LinkedIn note / interview prep = ToolkitViewers w/ copy-to-clipboard
   └── Top bar: Download Word / Download PDF (document tabs only). No Regenerate button — General Resume regeneration lives on the profile page.
```

---

## 7. Key files (annotated)

```
index.html                              Brand fonts (Google Fonts link) + <title>. Tailwind v4 + brand tokens (@theme) now live in src/index.css
src/index.css                           Tailwind v4 entry (@import "tailwindcss") + @theme brand tokens + global/mobile rules
metadata.json                           App name + description (used by platform)
package.json                            Name: "top-candidate"

src/index.tsx                           Vite entry → <App />
src/presentation/App.tsx                Auth + screen routing + initial data load + ResumeService boot
src/presentation/LandingScreen.tsx      BD-localized landing (centered hero + resume mock, pricing/value, FAQ; no mock interviews)
src/presentation/LoginScreen.tsx        Email/password auth
src/presentation/DashboardScreen.tsx    List of generated resumes + job applications
src/presentation/ProfileSetupScreen.tsx First-run profile capture
src/presentation/ProfileScreen.tsx      Edit/view saved master profile (sections: experience, education, skills, etc.)
src/presentation/BuilderScreen.tsx      Multi-step form + generate handler + loading UI
src/presentation/components/Preview.tsx Resume/CL render + toolkit tabs sidebar
src/presentation/components/Builder/ToolkitViewers.tsx
                                        Outreach email, LinkedIn note, Interview prep (copy-to-clipboard)
src/presentation/components/dashboard/JobDiscovery.tsx
                                        "Roles you might be interested in" — job-discovery BOARD on Home (dark brand-700
                                        panel, per-angle tinted tiles + directional glyphs, unopened-first sort,
                                        read/unread dimming, analytics)
src/presentation/utils/jobSearch.ts     Profile → job-board search URLs. Pure, no AI, nothing persisted. Role families,
                                        seniority ladder, title normalization, BD city table, and the VERIFIED
                                        LinkedIn/Bdjobs/WeWorkRemotely URL contracts. Read the "Quality rules learned from production
                                        profiles" header before touching the families or the ladder — every guard there
                                        maps to a real title in the DB that produced a nonsense query
src/presentation/components/FormSteps.tsx  All step forms (TargetJob, Experience, Projects, etc.)
src/presentation/components/PurchaseModal.tsx  bKash checkout for the toolkit-credits pack (shared by Dashboard + Builder).
                                               Owns the outcome since migration 028: stays open after submit and
                                               resolves 'pending' itself (Realtime, 20s window) into either the green
                                               check or a SPECIFIC verdict from /api/purchase-ops/verify-txn — typo,
                                               waiting-on-SMS, our-watcher-is-behind — with retry, one-tap dispute, and
                                               the operator's own channels after 3 attempts. It no longer closes with a
                                               success toast on a non-completed status.
src/presentation/templates/TemplateRegistry.ts  5 ATS-safe template definitions (all single-column)

src/application/services/ResumeService.ts   Orchestrator — call this from presentation
src/application/validation/                  Pre-flight content gates (run client-side before AI calls)
  ├── gibberishDetector.ts                   Refuses keyboard-mash before tokens are spent
  ├── dictionaries.ts                        English + tech + Banglish word sets (rescue layer)
  └── emailValidator.ts                      Signup gate: format + disposable + local-shape check

src/domain/entities/Resume.ts           Core types
src/domain/entities/AppStep.ts          Builder step enum
src/presentation/hooks/useBrowserNav.ts  Top-level screen routing + browser history (push/pop)
src/presentation/i18n/                  i18n infrastructure (en/bn locales, useT hook, LanguageToggle)
  ├── LocaleContext.tsx                  Provider + useT() hook + localStorage persistence
  ├── LanguageToggle.tsx                 Pill-style EN | বাং switch — used in nav/landing/login
  └── locales/{en,bn}.ts                 Typed dictionaries (TS enforces key parity)
src/domain/usecases/                    Use case classes + domain-layer interfaces (8 total)
src/domain/repositories/                Repo interfaces (IProfile, IResume, IApplication)

src/infrastructure/ai/                  AI providers (run server-side) + client proxies
  ├── GeminiClient.ts                   THE transport — @google/genai, client-side model-chain failover, error taxonomy, per-attempt record, withRetry, rotateModels
  ├── GeminiResumeOptimizer.ts          Optimizer (server-only) — OPTIMIZER_SCHEMA + full deterministic post-pipeline
  ├── GeminiToolkitGenerator.ts         Combined 4-artifact bundle (server-only) — per-artifact guards + errors map
  ├── Gemini{CoverLetter,Outreach,LinkedIn,InterviewQ}Generator.ts  Single-artifact regen (server-only, free retries)
  ├── GeminiResumeExtractor.ts          PDF/DOCX → profile JSON (server-only) — text OR inlineData multimodal
  ├── GeminiProfileNormalizer.ts        "Polished profile" on save (server-only) — faithful expansion, temp 0
  ├── prompts/resumeOptimizerPrompts.ts Shared optimizer system + user prompt + validation + post-filters
  ├── prompts/toolkitContext.ts         Shared candidate-evidence corpus + fit-mode + fabrication/specificity guards
  ├── prompts/toolkitPrompts.ts         Shared toolkit + single-artifact system instructions & user-prompt builders (extracted Phase 0)
  ├── prompts/extractorPrompts.ts       Shared extractor prompt + JSON-shape hint
  └── proxy/ProxyClients.ts             Client-side adapters that POST to /api/*

api/                                    Vercel Functions — server-side AI proxy + bKash flow
  ├── optimize.ts                       POST — runs optimizer + toolkit (paid: gates on toolkit_credits, refunds on optimizer failure)
  ├── optimize-general.ts               POST — optimizer only, no toolkit, no credit gate (free General Resume path)
  ├── toolkit-item.ts                   POST — single-item regenerate (free retry)
  ├── extract-resume.ts                 POST — PDF/Word extract (base64 + mimeType)
  ├── purchase.ts                       POST — records pending bKash purchase
  ├── confirm-purchase.ts               POST — HMAC webhook from Flutter; amount + msisdn checks (migration 007)
  ├── orphan-inbound-sms.ts             POST — HMAC; Flutter dumps unmatched SMS after 24h retry window
  ├── reverse-purchase.ts               POST — HMAC; bKash reversal SMS path
  ├── purchase-ops/                     Dispatcher consolidating 3 endpoints into 1 Vercel function (Hobby 12-fn cap)
  │   ├── [action].ts                   Routes status/dispute/expire-pending to _handlers
  │   └── _handlers/                    status.ts (GET, auth — customer pill polls), dispute.ts (POST, auth — customer disputes), expire-pending.ts (GET, Bearer CRON_SECRET — flips pending>24h to expired)
  │   # Public URLs preserved via vercel.json rewrites:
  │   #   /api/my-purchase-status → /api/purchase-ops/status
  │   #   /api/dispute-purchase   → /api/purchase-ops/dispute
  │   #   /api/cron/expire-pending → /api/purchase-ops/expire-pending  (NOT a Vercel Cron — see §13)
  │   # Two later actions have NO rewrite — the client calls them at their real path:
  │   #   /api/purchase-ops/verify-txn  (migration 028; why a purchase is still pending)
  │   #   /api/purchase-ops/void-txn    (migration 028; retire a mistyped pending row)
  ├── admin/                            All gated by owner-login session token (Authorization: Bearer); login is the only open action
  │   ├── [action].ts                   Dynamic-route dispatcher — single Vercel function. Migration 009 added ~18 actions; all live here, not as separate files (Hobby's 12-function cap).
  │   ├── _lib/adminAuth.ts             requireAdmin (verifies bearer token) + requireReason + adminSupabase + recordAuditAction
  │   ├── _lib/session.ts               session-token mint/verify (HMAC, signed by ADMIN_API_KEY) + scrypt credential check
  │   └── _handlers/                    Per-action implementations (underscore prefix → not routed by Vercel)
  │       ├── login.ts                  POST — owner username+password → session token (UNAUTHENTICATED)
  │       ├── summary.ts                GET ?range=day|week|month|all — business summary (earnings/users/failures/disputes)
  │       ├── dashboard.ts              GET — operational stat tiles
  │       ├── action-queue.ts           GET — unified "needs attention" feed (dashboard)
  │       ├── pending.ts                GET — stuck non-terminal rows (legacy; superseded by action-queue but kept for compat)
  │       ├── orphans.ts                GET — unmatched SMS + pending candidates (excludes PARSE_FAIL_*)
  │       ├── disputes.ts               GET — customer disputes
  │       ├── parser-failures.ts        GET (admin, unreviewed only) + POST (HMAC) — bKash SMS the parser couldn't classify
  │       ├── parser-mark-reviewed.ts   POST — bulk-mark reviewed
  │       ├── parser-export.ts          GET — JSON corpus download for Dart parser tests
  │       ├── orphan-mark-ignored.ts    POST — drop a personal SMS that snuck through
  │       ├── confirm-purchase.ts       POST — operator manual confirm (P0-B)
  │       ├── refund-purchase.ts        POST — operator manual refund
  │       ├── expire-purchase.ts        POST — force a pending/underpaid/mismatch row to expired
  │       ├── reopen-purchase.ts        POST — flip expired/failed back to pending
  │       ├── grant-override.ts         POST — for underpaid/mismatch/expired: grant pack anyway
  │       ├── purchase-note.ts          POST — audit-only note on a purchase
  │       ├── match-orphan.ts           POST — link orphan SMS to pending row
  │       ├── resolve-dispute.ts        POST — close a dispute
  │       ├── users.ts                  GET — list/search users (email substring or UUID prefix)
  │       ├── user-detail.ts            GET — profile + purchases + resumes + AI-usage + notes + audit
  │       ├── grant-credits.ts          POST — operator grant
  │       ├── deduct-credits.ts         POST — operator deduct (allows negative balance)
  │       ├── user-note.ts              POST — append profile_notes row
  │       ├── flag-user.ts              POST — toggle profiles.flagged_at
  │       ├── purchases.ts              GET — filterable list (status[], age, q)
  │       ├── purchase-detail.ts        GET — purchase + customer + state changes + topups + overpayments + linked SMS + audit
  │       ├── audit-log.ts              GET — admin_audit_log feed
  │       └── settings.ts               GET env health + POST run-expiry-now
  └── _lib/                             auth.ts, rateLimit.ts, aiFactory.ts, webhookAuth.ts

src/presentation/admin/                  Operator SPA at /admin (English-only, no i18n)
  ├── AdminScreen.tsx                    Shell — Gate, left sidebar (grouped Overview/Operations/Records/System), top bar, tab routing, cross-tab navigation, ⌘K palette, Sonner Toaster
  ├── adminApi.ts                        AdminApi class (Bearer token) + taka/ageMin helpers + ADMIN_TOKEN_STORAGE constant + download()
  ├── charts.tsx                         Dependency-free SVG chart primitives — Sparkline / TimeSeriesChart / BarChart / HBarChart / FunnelChart / DonutChart / KpiCard (brand tokens, no gradients)
  ├── ui.tsx                             Design-system primitives — Card / Section / PageHeader / Button / SearchInput / FilterChip / Skeleton / EmptyState / ErrorState / StatusPill (with dot) / DataTable / KeyValue / JsonDiff / ReasonModal / Timeline / Toast helpers (toastSuccess/toastError/withToast) / useDebounced hook
  ├── DashboardTab.tsx                   Range-filtered business summary (Day/Week/Month/All) + 30-day revenue trend chart + operational tiles (poll 30s) + unified action queue using DataTable
  ├── RevenueTab.tsx                     Gross/net/refunds KPIs + daily revenue trend + status breakdown + credit liability + CSV export
  ├── ProductTab.tsx                     Generation mix (free vs paid) + AI cost/error/latency by provider + credits sold-vs-consumed + approx gross margin
  ├── MarketingTab.tsx                   Acquisition funnel + per-channel CAC/ROAS + ad-spend logging (marketing_spend CRUD)
  ├── CustomerIntelTab.tsx               Segments (warm leads / whales / dormant / never-purchased / negative-balance / fast-burners) + customer leaderboards
  ├── SystemTab.tsx                      AI health (24h/7d/30d cost) + payments pipeline + environment health
  ├── UsersTab.tsx                       Instant-search list (debounced 250ms, inline spinner, slash-to-focus) + UserDetail subview (header card with credit adjuster + 4 sub-tabs: purchases / resumes / audit / notes)
  ├── PurchasesTab.tsx                   Status multi-select + age single-select chips + instant search + PurchaseDetail subview (lifecycle Timeline + audit list + state-driven action panel)
  ├── OrphansTab.tsx                     Unmatched SMS DataTable — match to pending dropdown OR mark ignored
  ├── DisputesTab.tsx                    Open/resolved/rejected chip filter + resolve/reject with operator note
  ├── ParserFailuresTab.tsx              Multi-select cards + bulk mark reviewed + JSON corpus export
  ├── AuditLogTab.tsx                    Append-only feed with action-name search + target-kind chips + JSON diff per row
  └── SettingsTab.tsx                    Env health cards (present/missing only — never values), last-confirm card, recent activity, manual cron trigger

src/infrastructure/api/purchaseClient.ts  Typed client for /api/purchase — used by PurchaseModal
src/infrastructure/auth/AuthContext.tsx Supabase Auth context/provider/hook
src/infrastructure/config/dependencies.ts  DI container — call createResumeService() for a wired service
src/infrastructure/export/              Word + PDF exporters (Composite pattern)
src/infrastructure/repositories/        Supabase repo implementations
src/infrastructure/supabase/client.ts   Supabase client singleton

supabase/schema.sql                     Fresh-DB bootstrap (reflects current state)
supabase/migrations/                    Incremental changes (run in SQL editor in order)

.agent/skills/                          Skill packages with opinion-rules (see §11)
```

---

## 8. Database (Supabase, Postgres + RLS)

All tables have RLS enabled; policies restrict rows to `auth.uid() = user_id`.

- `profiles` — user profile (linked 1:1 with `auth.users`), trigger `handle_new_user` auto-creates on signup. Includes `toolkit_credits integer not null default 0` — current balance for paid tailored generations. **No client-facing UPDATE policy for that column**; mutations only via security-definer RPCs. `flagged_at` (added by migration 009) is the operator-set fraud flag; null = clean, non-null = flagged.
- `experiences`, `educations`, `projects`, `skills`, `extracurriculars`, `awards`, `certifications`, `affiliations`, `publications`, `languages`, `references_list` — profile sub-tables. **Note:** the `references` table is named `references_list` because `references` is a reserved keyword in Postgres.
- `applications` — legacy, partially unused (the current code persists generated output to `generated_resumes`)
- `generated_resumes` — final snapshots
  - `id`, `user_id`, `title`, `created_at`, `updated_at`
  - `data jsonb` — `ResumeData` minus toolkit
  - `toolkit jsonb` — `JobToolkit` (outreach email / LinkedIn note / interview questions / prep topics)
  - `company text GENERATED ALWAYS AS ((data -> 'targetJob' ->> 'company')) STORED` — extracted for efficient dashboard search (added migration 006)
- `purchases` — audit trail for the monetization flow. One row per purchase event (`credits_granted`, `amount_taka`, `payment_reference` [bKash TrxID, UNIQUE], `status`). Status enum: `pending` / `completed` / `failed` / `expired` / `underpaid` / `msisdn_mismatch_review` / `refunded`. RLS allows users to SELECT their own; there is no direct INSERT policy — rows are created only via the `initiate_purchase` RPC (the older `process_mock_purchase` RPC was dropped in migration 005). **In the `supabase_realtime` publication + `REPLICA IDENTITY FULL`** (migration 012) so the customer's browser can subscribe to its own purchase row via Supabase Realtime; RLS still gates delivery to the user's own rows.
- `inbound_payments` (migration 012) — server-side memory of an HMAC-verified bKash SMS that arrived *before* the customer submitted their TrxID. PK `payment_reference`; columns `sender_msisdn`, `amount_taka`, `raw_body`, `sms_timestamp`, `received_at`, `consumed_at`, `consumed_purchase_id`. RLS enabled with **no user policies** — only the SECURITY DEFINER functions + the service role touch it. Distinct from `unmatched_inbound_sms` (the 24h operator reconciliation queue): an `inbound_payments` row is consumed automatically (usually within seconds, by match-on-submit in `initiate_purchase`) and never surfaces in the admin Orphans tab. Pruned by `expire_stale_pending_purchases()` (consumed rows, or rows older than 48h).
- `watcher_heartbeats` (migration 028) — liveness of the operator's Flutter SMS-watcher phone. PK `device_id` (a random per-install id, **not** a hardware identifier); columns `last_seen_at`, `app_version`, `queue_depth`, `ping_count`. RLS enabled with **no user policies**. Fed by `POST /api/confirm-purchase { kind: 'heartbeat', … }` (same endpoint/secret/signature — the function cap forbids a new file); read only via `diagnose_pending_purchase`. Exists so the purchase modal can distinguish "your TrxID is wrong" from "our phone is offline" instead of blaming paying customers during our own outages. Stale threshold 5 min; pruned at 30 days by `expire_stale_pending_purchases()`.
- `ai_call_log` — per-user daily-cap audit trail (existing).
- `admin_audit_log` (migration 009) — append-only operator action log. Layered alongside `purchase_state_changes`: that table tracks purchase-row transitions only (and is written by Flutter + customer paths too); `admin_audit_log` covers every operator action on ANY target (user, purchase, dispute, orphan SMS, parser failure, system) with `before_state` / `after_state` JSON snapshots + reason. Written by the shared `recordAuditAction()` helper after each admin endpoint's underlying RPC succeeds. Not in the same transaction as the action — see migration 009 header for trade-off.
- `profile_notes` (migration 009) — operator-private free-text notes on customer profiles. Append-only. Service-role only.
- `unmatched_inbound_sms.reviewed_at` (migration 009) — operator marks a parser failure or orphan SMS reviewed without matching it (`matched_to_purchase_id` = "matched to a row"; `reviewed_at` = "I've seen this, drop it from the queue").
- RPC `public.delete_user()` — deletes all user-owned rows (including `purchases`) then the auth user

**Credit-system RPCs** (all `SECURITY DEFINER` with `set search_path = public, pg_temp`):
- `reserve_ai_call(kind, overall_cap, kind_cap, excluded_kinds)` — **atomically** checks the daily AI caps and inserts a `status='pending'` ai_call_log row, returning its id. Reachable via user JWT (user comes from `auth.uid()`, never a parameter). Takes `pg_advisory_xact_lock` per user, because the caps previously could not be enforced under concurrency: the old `assertWithinLimit` SELECTed the count and the row was only INSERTed after the provider returned, so the check-to-record window was the full 5–30s provider latency and a parallel burst all passed on the same stale count. Raises `rate_limited:<used>:<cap>:<scope>`, which `reserveCall` parses into a 429. A reserved row that never finalizes keeps counting until it ages out of the 24h window — correct accounting, since a timed-out generation did consume provider capacity, and no sweeper is needed because the window is the expiry. `normalize` is exempt from the overall cap in BOTH directions now (it neither counts toward it nor is gated by it); its own 40/day cap still applies.
- `finalize_ai_call(id, meta jsonb)` — writes the outcome onto a reserved row, own-row only. Deliberately a function and **not** an UPDATE RLS policy on `ai_call_log`: a policy would let a user rewrite any of their own telemetry, destroying the audit trail the caps depend on. Keys are extracted explicitly, so a caller cannot set columns it does not name.
- `consume_toolkit_credit()` — atomic decrement. Reachable via user JWT. Single `UPDATE … WHERE toolkit_credits > 0 RETURNING …`; raises `insufficient_credits` if balance is 0.
- `refund_toolkit_credit()` — increments by 1. Reachable via user JWT. Called server-side when the optimizer fails after a credit was consumed.
- `initiate_purchase(p_package_id, p_transaction_id, p_sender_msisdn)` — **v3** (migration 012); reachable via user JWT. Records a `pending` purchase (same validation: server-side package mapping, txn id ≥6 chars, uniqueness, per-user pending cap ≤5 in 24h). Return type changed from `uuid` to `TABLE(purchase_id, status_out, credits_granted, new_balance)`. After inserting the pending row it does **match-on-submit**: if a matching `inbound_payments` row already exists (pay-first ordering), it settles the purchase synchronously in the same locked path `confirm_purchase` uses — `completed` (credits granted inside the submit request), or `underpaid` / `msisdn_mismatch_review`. Grants credits in ~1-2s instead of waiting for the watcher's next retry.
- `confirm_purchase(p_transaction_id, p_observed_sender_msisdn)` — **service-role only** (EXECUTE revoked from anon + authenticated). Called by `/api/confirm-purchase` webhook. Locks the matching pending row, optionally verifies the sender msisdn matches, flips status to 'completed', and grants credits.
- `record_inbound_payment(...)` (migration 012) — **service-role only**. Called by `/api/confirm-purchase` on a genuine 404 (when it knows the amount) to store the verified SMS in `inbound_payments` for a later match-on-submit.
- `record_watcher_heartbeat(p_device_id, p_app_version, p_queue_depth)` (migration 028) — **service-role only**. Upserts the watcher liveness row.
- `diagnose_pending_purchase(p_transaction_id)` (migration 028, tightened by 029) — reachable via user JWT; ownership from `auth.uid()`, never a parameter. Answers "why is my purchase still pending?" and returns a `verdict`: `likely_typo` (an unclaimed HMAC-verified payment in `inbound_payments` / `unmatched_inbound_sms` either resembles the typed TrxID by `similarity()` ≥ 0.45, or came from the msisdn the customer supplied), `awaiting_sms` (inside a 15s grace window, or no heartbeat data at all), `watcher_stale`, `nothing_found`, or the already-settled status. **PRIVACY/FRAUD RULE — do not "improve" this:** it must return **nothing whatsoever** about the unclaimed payment it matched against — not the reference, not the amount, not a masked sender, not even a boolean. Ownership cannot be established at diagnosis time: `purchases.sender_msisdn` is customer-supplied and unverified, and TrxID similarity is not ownership either. 028 got this half-right (it withheld the reference but still exposed amount + masked msisdn gated on the unverified msisdn match), which left two oracles — claim a victim's number and learn they have an unclaimed payment and its size, or have an honest typo disclose a stranger's payment. 029 removed all of it; the near-miss search now only picks the verdict. **`c_grace_seconds` must stay below `VERIFY_WINDOW_MS` in `PurchaseModal.tsx`**, or the modal always asks inside the grace window and `nothing_found` / `watcher_stale` become unreachable (that was the 90s bug). Probing is rate-limited by the 5-pending-per-24h cap.
- `void_pending_purchase(p_transaction_id)` (migration 028) — reachable via user JWT; own `pending` rows only. Backs "Edit & resubmit" after a mistyped TrxID: flips the row to `failed` (+ audit row, actor `user-corrected`) so the corrected submit doesn't consume another of the customer's 5 pending slots. The mistyped `payment_reference` stays taken by the voided row — intentional, and harmless because the corrected ID differs.

**Migrations applied**
- `supabase/migrations/001_add_toolkit_column.sql` — adds `toolkit jsonb` + partial index on `generated_resumes`
- `supabase/migrations/002_add_languages_and_references.sql` — adds `languages` and `references_list` profile sub-tables with RLS
- `supabase/migrations/003_add_ai_call_log.sql` — adds `ai_call_log` table for per-user daily-cap rate limiting at the `/api/*` layer
- `supabase/migrations/004_add_toolkit_credits.sql` — adds `profiles.toolkit_credits`, `purchases` table, and the original credit-system RPCs (`consume_toolkit_credit`, `refund_toolkit_credit`, `process_mock_purchase`)
- `supabase/migrations/005_lock_toolkit_credits_and_bkash_pending.sql` — column-level GRANT lockdown on `profiles` (closes the toolkit_credits self-grant exploit), drops `process_mock_purchase`, adds `initiate_purchase` + `confirm_purchase` for the bKash + Flutter-SMS-watcher flow, adds `purchases.sender_msisdn` + unique index on `payment_reference`
- `supabase/migrations/006_add_company_generated_column.sql` — adds `generated_resumes.company` stored generated column + trigram indexes on `title`/`company` for server-side paginated search in the dashboard
- `supabase/migrations/007_transaction_flow_hardening.sql` — expands `purchases.status` enum (+ `expired`, `underpaid`, `msisdn_mismatch_review`), adds `observed_amount_taka`, adds the audit/aggregation tables (`purchase_topups`, `purchase_overpayments`, `unmatched_inbound_sms`, `purchase_disputes`, `purchase_state_changes`), rebuilds `confirm_purchase` v2 (amount + msisdn checks + audit logging), adds operator RPCs (`operator_confirm_purchase`, `operator_refund_purchase`, `apply_purchase_topup`, `record_orphan_sms`, `record_purchase_reversal`, `record_purchase_dispute`, `resolve_purchase_dispute`), adds `expire_stale_pending_purchases()` for cron
- `supabase/migrations/007_optional_pg_cron.sql` — opt-in `pg_cron` schedule for the 15-min pending expiry. Only run if the extension is enabled (Supabase Database → Extensions). Skip if you're using the Vercel Cron entry instead.
- `supabase/migrations/008_lock_credit_rpcs.sql` — closes the `refund_toolkit_credit` self-grant exploit. Drops the 0-arg `consume/refund_toolkit_credit()` and replaces with `(p_user_id uuid)` versions that are service-role only. `/api/optimize.ts` updated to call them via `SUPABASE_SERVICE_ROLE_KEY`.
- `supabase/migrations/009_admin_panel.sql` — adds the full admin panel surface: `admin_audit_log` + `profile_notes` tables; `profiles.flagged_at` and `unmatched_inbound_sms.reviewed_at` columns; `record_admin_action()` shared audit RPC; operator-only credit RPCs (`admin_grant_credits` / `admin_deduct_credits`, deduct allows negative balance); operator-only purchase RPCs (`admin_expire_purchase` / `admin_reopen_purchase` / `admin_grant_override`); pg_trgm GIN index on `profiles.email` for the Users tab substring search.
- `supabase/migrations/010_align_profiles_columns.sql` — schema-drift catch-up. `schema.sql` declared `profiles.created_at` and `profiles.updated_at` from day one but no prior migration ever added them, so databases provisioned from an early `schema.sql` revision were missing both. The admin Users tab orders by `created_at`, which is where the drift surfaced. Adds both columns idempotently and backfills `created_at` from `auth.users.created_at` so existing rows have a meaningful signup timestamp.
- `supabase/migrations/011_webhook_nonces.sql` — webhook replay protection (protocol v2). Adds the `webhook_nonces` table; combined with a timestamp ±5min window enforced in `api/_lib/webhookAuth.ts`, this stops a captured HMAC-signed webhook body from being replayed. Enforced when `BKASH_WEBHOOK_REQUIRE_TIMESTAMP=true`; the legacy (no-timestamp) signature path still works until the watcher is upgraded.
- `supabase/migrations/012_realtime_and_match_on_submit.sql` — near-real-time credit assignment. Adds the `inbound_payments` table + `record_inbound_payment` RPC; rebuilds `initiate_purchase` as v3 (table return + match-on-submit for the pay-first ordering); extends `expire_stale_pending_purchases()` to prune `inbound_payments`; adds `purchases` to the `supabase_realtime` publication and sets `REPLICA IDENTITY FULL` so the customer browser can subscribe to its own purchase row (RLS still gates delivery). **Requires Supabase Realtime enabled for the project.**
- `supabase/migrations/013_analytics_and_bi.sql` — first-party analytics + BI foundation (all additive/idempotent): `analytics_events` (insert-only RLS), `credit_ledger` (trigger-fed journal of every `toolkit_credits` change), `marketing_spend`, acquisition/activity columns on `profiles` (`utm_*`, `signup_referrer`, `last_active_at`), AI cost/telemetry columns on `ai_call_log` (`provider`/`model`/`prompt_tokens`/`completion_tokens`/`cost_usd`/`status`/`latency_ms`), `generation_type` on `generated_resumes`, and read views `v_daily_revenue` / `v_daily_signups` / `v_daily_ai_usage` / `v_credit_liability`. Backs the admin analytics tabs.
- `supabase/migrations/014_add_toolkit_call_kind.sql` — the combined toolkit bundle moved off `/api/optimize` onto its own `/api/toolkit` endpoint; this adds the `'toolkit'` `ai_call_log` kind (distinct from `'toolkit_item'`) so the free bundle request is tracked separately.
- `supabase/migrations/015_profile_normalization.sql` — "polished profile": adds the `normalized` column (+ a source-hash) to `experiences`, storing one cheap AI normalization (canonical English bullets + evidenced skills + coaching gaps) beside the raw description, reused as pre-cleaned evidence by later generation. Run on SAVE, not per generation.
- `supabase/migrations/016_normalize_projects_extracurriculars.sql` — extends the polished-profile pipeline from experiences to `projects` and `extracurriculars` (same `normalized` + hash contract).
- `supabase/migrations/017_delete_user_complete.sql` — fixes `delete_user()`: three child tables that reference `profiles(id)` with `ON DELETE NO ACTION` were added in later migrations and never added to the RPC's delete list, blocking account deletion. Adds them.
- `supabase/migrations/018_guided_mode.sql` — Guided Mode: adds `guided` (JSONB), `input_mode` (default `'guided'`), and `guided_version` to every description-bearing profile item (experiences, projects, extracurriculars, **awards** — which also gain `normalized` columns here for the first time). Structured answers store in `guided` AND assemble into the existing `description` column so the AI path is unchanged.
- `supabase/migrations/019_guided_free_for_existing_text.sql` — corrective backfill. Migration 018's blanket `default 'guided'` wrongly flipped legacy rows (and resume-imported rows) that already had free-text `description` and no guided answers — opening them showed an empty guided form and saving overwrote the text. Flips ONLY those rows back to `'free'` (scope-guarded: rows with description text AND no guided answers; genuine guided items untouched). Idempotent.
- `supabase/migrations/026_admin_login_throttle.sql` — per-IP lockout + attempt log for the admin login. Adds `admin_login_attempts` (RLS deny-all, service-role only, 90-day opportunistic prune, never stores the password) plus `begin_admin_login_attempt()` / `finalize_admin_login_attempt()`. Same reserve-then-finalize shape as 024: the `pending` row is inserted under a per-IP advisory lock BEFORE credentials are checked, so concurrent guesses count against each other instead of all passing the check. Ladder per IP, failures since that IP's last success in a 15-minute window: 5+ → 60s, 10+ → 15min, 20+ → 60min.

- `supabase/migrations/027_account_ip_signals.sql` — detection-only abuse signal. Adds `account_ip_signals` (RLS deny-all, service-role only, 180-day opportunistic prune) + `record_account_ip()`. Stores an **HMAC of the caller's IP, never the address**, keyed with `IP_HASH_SALT` (falls back to the service-role key so it works unconfigured). Written from `api/_lib/auth.ts` on authenticated API calls — NOT at signup, because signup is browser-to-Supabase with no server in the path; Supabase's own `auth.audit_log_entries` has an `ip_address` column but is empty on this project (GoTrue prunes it). Feeds the System tab's "Abuse signals" panel. Blocks nothing.

- `supabase/migrations/028_purchase_verification_ux.sql` — in-modal purchase verification. `PurchaseModal` used to close the instant `/api/purchase` returned anything but `completed`, with a **success** toast — so a mistyped TrxID got the same "credits will land soon" message as a matched payment (then span in the navbar pill until the 24h expiry sweep), and `underpaid` / `msisdn_mismatch_review` were announced as successes. Adds `watcher_heartbeats` + `record_watcher_heartbeat()` (liveness, so "wrong TrxID" is distinguishable from "operator's phone offline"), `diagnose_pending_purchase()` (the customer-facing verdict, with the privacy rule above), and `void_pending_purchase()` (edit-and-resubmit without burning a pending slot); extends `expire_stale_pending_purchases()` to prune heartbeats at 30 days. Depends on `pg_trgm`, already installed. Consumed by `GET /api/purchase-ops/verify-txn` and `POST /api/purchase-ops/void-txn`.

- `supabase/migrations/029_diagnose_no_payment_details.sql` — privacy correction to 028. `diagnose_pending_purchase` stopped returning the amount, the masked sender, and the `near_*` booleans for the unclaimed payment it matched against. 028 already withheld the `payment_reference` on the grounds that the customer-supplied `sender_msisdn` proves nothing — then used that same unverified value to gate revealing the rest. Two leaks followed: an msisdn oracle (submit a junk TrxID claiming a victim's number; the UI confirmed "we can see a ৳200 payment from 01712•••78") and a similarity oracle (an honest typo landing near a stranger's payment disclosed its amount). The near-miss search is kept — it still chooses between `likely_typo` and `nothing_found` — but the payment is described to nobody. Client copy changed to match: one typo message that makes no claim about any payment, and `problemTypoBodyYours` was deleted.

> **020–025 are not itemised above** (pre-existing gap in this list, not a signal they don't exist): `020_ai_failure_telemetry`, `021_revoke_analytics_views`, `022_restrict_profiles_select`, `023_ai_failures_exclude_non_ai`, `024_atomic_ai_call_reservation`, `025_harden_definer_functions`. Read the files — each carries its own rationale header.

**Running migrations**: open the Supabase SQL editor and paste the migration file contents. All migrations are idempotent (`add column if not exists`, `create index if not exists`, `create or replace function`).

---

## 9. External services

### AI providers

**Single provider: direct Google Gemini, one key (`GEMINI_API_KEY`).** OpenRouter and Groq were removed 2026-08-04. Every workload goes through `GeminiClient` (`src/infrastructure/ai/GeminiClient.ts`), a `@google/genai` adapter, constructed in `api/_lib/aiFactory.ts`.

**Why we left OpenRouter:** Gemini calls ran on OpenRouter's *pooled* Google credentials, so ~30% failed with a shared-pool 429 arriving as HTTP 200 + `finish_reason='error'` — a shape OpenRouter's own `models[]` fallback never routed around. Credits are not quota.

**Model chains** (walked left-to-right by the client on transport failure; Google has no server-side `models[]`, so failover is client-side):

- **Optimizer / toolkit / all four single-artifact generators** → `gemini-3.5-flash-lite` → `gemini-3.6-flash` → `gemini-3.1-flash-lite`
- **Extractor / normalizer** → `gemini-3.5-flash-lite` → `gemini-3.1-flash-lite`

Assignment is measured, not reasoned (`npm run ai:bench`, 2026-08-04): `3.5-flash-lite` is Google's own documented replacement for `gemini-2.5-flash` at identical pricing ($0.30/$2.50), and it measured fastest (optimizer 1.9s vs 11.9s), emitted 0 thought tokens, and produced the cleanest Bengali. `3.6-flash` is fallback-only — 4x cost, 6x slower, *worse* Bengali. `3.1-flash-lite` is the cheap fallback but writes thinner prose (790-char cover letter vs 2133), so it never fronts an artifact-quality path.

**⚠️ Four hard-won facts. Do not "simplify" these away** (all verified by probe, not docs):

1. **`gemini-2.5-*` is unreachable** — HTTP 404 "no longer available to new users" on our key, versioned aliases included. They still appear in `models.list`; listing a model is not proof you can call it.
2. **`thinkingBudget: 0` returns HTTP 400** on `3.5-flash-lite` and `3.6-flash` (works only on `3.1-flash-lite`). `thinkingLevel: MINIMAL` is the only portable form and is the client default. Corollary: a 400 can be *model-specific*, which is why `schema_invalid` advances the chain instead of aborting.
3. **Google returns HTTP 400, not 401, for a bad API key.** Auth must be classified *before* the generic 400 branch or a rotated key burns the whole chain on every call.
4. **A 429's message is byte-identical for per-minute vs per-day limits.** Only `details[].QuotaFailure.violations[].quotaId` distinguishes them (`...PerMinute...` / `...PerDay...`, no spaces). Never match the prose.

**Structured output:** `responseJsonSchema` + `responseMimeType: 'application/json'`. Never `responseSchema` — that type has no `additionalProperties` field. All six schemas live in `prompts/` (`OPTIMIZER_SCHEMA`, `TOOLKIT_SCHEMA`, `INTERVIEW_SCHEMA`, `OUTREACH_SCHEMA`, `EXTRACTOR_SCHEMA`, `NORMALIZER_SCHEMA`) — never module-local, so the combined and single-artifact paths cannot drift.

**Retry structure — two layers:**
1. `GeminiClient.generate()` walks the model chain on TRANSPORT failure inside one shared wall-clock budget. `STOP_CHAIN` (auth / safety_blocked / truncated) halts it; `ADVANCE_TO_NEXT_MODEL` continues.
2. Generators keep the deadline-bounded `withRetry` for PARSE/VALIDATION failure, with `rotateModels` so a retry leads with a different model. `NO_OUTER_RETRY` is deliberately *narrower* than `STOP_CHAIN` — `truncated` stops the chain but must still get a retry (generation is non-deterministic).

Per-generator deadlines: optimizer 50s (`/api/optimize`), toolkit 52s (`/api/toolkit`), single-artifact interview 55s (`/api/toolkit-item`), extractor 45s, normalizer 30s x3 attempts. Each fits Vercel's 60s cap independently. **Measured in Vercel, the toolkit ran 26.7s** (vs 9.3s locally) — cold start plus network, so judge headroom against the deployed number.

**Client-facing error contract — never echo provider text.** Every AI endpoint's failure response goes through `publicAiError()` in `api/_lib/aiErrorResponse.ts`, which returns `{ error, code }` where `code` is one of `rate_limited | provider_busy | provider_timeout | provider_down | bad_output | blocked | guard_rejected | generation_failed`. The handlers used to send `err.message`, and on this path that is raw provider output — `@google/genai` builds `ApiError.message` as `JSON.stringify(errorBody)`, so a throttled user was shown `gemini-3.5-flash-lite: {"error":{"code":429,"message":"You exceeded your current quota…","status":"RESOURCE_EXHAUSTED"}}` verbatim in a toast, in English regardless of their locale, while the very same string was key-redacted before going into the database. **The client localizes off `code`** (`src/presentation/i18n/apiErrorMessage.ts` → the `apiError.*` keys); the English `error` string is only a fallback for an unrecognized code. 429s additionally carry `used`/`cap`, and `isRetryPointless()` suppresses the Retry button on a daily-cap rejection — pressing it can only fail again. Guard rejections are classified by ERROR CLASS via the shared `isGuardError()` (also in `aiTelemetry.ts`), never by message text. When you add an endpoint: return `publicAiError(err)`, never `err.message`. **Every generation-failure toast in `BuilderScreen` shares one sonner id** (`GENERATION_TOAST_ID`), dismissed the moment a generation actually starts. Sonner clears a toast when its OWN action is pressed, but a retry launched from anywhere else — the full-screen panel's Retry, the idle panel's Generate, the automatic resume after purchased credits land — left a red failure toast sitting on top of a progress panel reading "Building your application" for the rest of its 10-15s duration, including when that retry then succeeded. Keep the id on any failure toast you add here.

**Failure telemetry:** `api/_lib/aiTelemetry.ts` builds every `ai_call_log` row. Migration 020 added `error_code` (normalized taxonomy — see `GeminiErrorCode`), `error_message` (truncated + key-redacted, since the column is user-readable under RLS), `model_attempts` (jsonb, the chain as actually tried), `thought_tokens` (billed at the OUTPUT rate), `attempt_count`. Views: `v_ai_failures_daily`, `v_ai_model_health`.

**Cost:** `api/_lib/aiCost.ts` maps bare model ids. Every `-flash-lite` price test MUST precede its `-flash` sibling — `gemini-3.5-flash` is a substring of `gemini-3.5-flash-lite`. Measured paid generation ≈ **$0.0101** (optimizer $0.0025 + toolkit $0.0077) → ~96.8% margin on a ৳200 5-credit pack.

**⚠️ Concentration risk, accepted knowingly:** every model in every chain is Google, so a Google-wide outage takes down all six workloads at once. The former non-Google last resort (Llama via OpenRouter) is gone. Adding a second provider is cheap — the app depends on the domain interfaces, not these classes — but it is a deliberate future decision.

**Local probes:** `npm run ai:selftest` (offline classifier regression over recorded real payloads + live taxonomy walk), `npm run ai:bench`, plus `e2e` (all 8 real generators), `tier` (free vs paid) and `gaps` (multimodal PDF + premium model at scale) modes in `scripts/ai-probe.ts`. Fixtures are synthetic on purpose: Google's free tier trains on prompts and ToS §3 promises users otherwise.

**Hot-path budget unchanged:** initial generation = **2 AI calls only** (optimizer + combined toolkit), carried by two parallel HTTP requests since 2026-06-11. Do not re-fan the toolkit into N parallel calls.


### Supabase

- Auth: email/password + Google OAuth (Supabase provider; PKCE redirect). Same `auth.users` row model for both — no "two kinds of users" branching. `useAuth().provider` exposes `'email'`/`'google'`.
- Row-level security is on for every table
- Env vars: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
- Client: `src/infrastructure/supabase/client.ts` (has a dev fallback so the app does not crash on missing env — it will fail at network time instead)

---

## 10. Brand & design

**Name:** TOP CANDIDATE (two-word wordmark: ink + saffron). No "R" badge, no square mark — with ONE scoped exception, the app icon (below).

**Palette** (defined in `src/index.css` under the Tailwind v4 `@theme` directive — `--color-<group>-<shade>` tokens; no `tailwind.config`):
- `brand-*` — Editorial Ink (warm near-black, 700 = `#1A1812`). Primary text, buttons, ink.
- `accent-*` — Saffron Gold (400 = `#E59321`). Single accent — CTAs, highlights, active-state hints. Use sparingly (≤ 10% of pixels).
- `charcoal-*` — Stone (warm neutrals, 50 = `#FAFAF7`). Backgrounds, borders, muted text.

**Explicit constraints:**
- **No gradients** anywhere — with ONE scoped exception, the dashboard hero/master surfaces (see below). Everywhere else, search the codebase before adding one — chances are you don't need it.
- **No blue, indigo, or purple** brand colors (generic AI look) — except the two muted dashboard toolkit-chip tints noted in the scoped exception below.
- No emojis in UI unless the user asked for them.

**Scoped exception — bKash magenta (`#E2136E`):** `PurchaseModal.tsx` is a bKash **payment surface**, so bKash's brand magenta is the action color for that ONE component — the trust chip, the numbered step markers, the copy-number button, and the primary "Submit" CTA all use `#E2136E` (deep `#B80E5D` on hover); emerald `#10B981` marks valid/success. Saffron is intentionally NOT used inside this modal so the user feels they're in a bKash-branded flow. Layout: a two-column **split-sheet on desktop** (cream receipt panel + white action panel) and a **keyboard-aware bottom sheet on mobile** (receipt collapses to a one-line disclosure ribbon; the sheet is sized to `window.visualViewport` so the TrxID input + docked CTA stay above the soft keyboard). Do NOT extend bKash magenta to any other screen, button, or component.

**Scoped exception — dashboard hero gradients + toolkit tints (2026 redesign):** the dashboard area (`DashboardScreen` Home, `components/dashboard/*`) uses a deliberate, narrow set of gradients: the dark "Start a new application" CTA card's animated amber glint (`@keyframes glintMove` in `index.css`) and its amber icon square (`linear-gradient(135deg,#E8960F,#C7590E)`), plus the cream Master Resume banner (`linear-gradient(120deg,#FFFDF8,#FBF4E4)`). The same exception covers the **5 muted per-artifact toolkit-chip tints** on that dark card — Tailored Resume (amber), Cover Letter (coral), Recruiter Email (green), LinkedIn Message (blue `#9DB8DF`), Interview Prep (purple `#B7A3D8`) — the only place blue/purple appear, always as low-opacity semantic labels on the dark surface. The same **tint formula** (14% fill / 32% border / full-strength glyph on ink) is reused ONCE more, on the **job-discovery board** (`components/dashboard/JobDiscovery.tsx`) — six muted per-angle tints on a second dark `brand-700` panel, which is what makes the two ink surfaces read as one family. That board deliberately does NOT reuse `glintMove`: the sweep is what makes the primary CTA feel alive, and spending it twice on one page would cost the CTA its distinction. **These two dark panels are now the whole exception.** Everywhere else the flat Saffron/Ink/Stone rules hold; do NOT extend gradients, blue/purple, or the tint formula to any further surface.

**Scoped exception — the app icon is a square "TC" monogram (approved 2026-08-11):** the favicon / apple-touch-icon is the ONE place a square mark is allowed, because the slot is a square by definition and the two-word wordmark is illegible at 16–32px. `public/favicon.svg` is the master: a `brand-700` (`#1A1812`) rounded tile (rx 112/512 ≈ 22%), a `charcoal-50` (`#FAFAF7`) "T" and an `accent-400` (`#E59321`) "C". Shipped as `favicon.svg` + `favicon.ico` (32px PNG-in-ICO) + `apple-touch-icon.png` (180px, **square and unrounded** — iOS masks it itself and a pre-rounded tile gets rounded twice), wired with three `<link>` tags in `index.html`.

The letterforms are the real Source Serif 4 semibold glyphs **converted to SVG paths** (extracted with `fontTools`, `SVGPathPen`), so the file carries the brand typeface with no font dependency at render time and every raster size is identical to the vector. To regenerate: pull Source Serif 4 semibold, dump the `T`/`C` outlines, place them on a 512 canvas (cap height ≈ 210px, ~22px gap, baseline `(512 + cap) / 2`), then rasterise the SVG to 32/180 (`qlmanage -t -s <n>` works on macOS) and wrap the 32 in an ICO container. Do NOT re-author the mark with `<text>` — a webfont the viewer lacks silently falls back to a different serif.

**This exception is the ICON SLOT ONLY.** In-product the logo is always the two-word wordmark; never a TC tile in the top bar, a nav element, an avatar, a loading state, or an empty state. Alternatives B (single saffron "C"), C ("TC" on cream) and D (tile-free saffron "TC", the only variant that keeps the no-square-mark rule literally) were built and compared before A was chosen.

**Fonts** (Google Fonts, loaded in `index.html`):
- `Instrument Sans` — UI and body (default `font-sans`) — Latin script (adopted with the 2026 dashboard redesign, replacing Inter)
- `Source Serif 4` — display headlines (`font-display`) — editorial serif, Latin (adopted with the 2026 dashboard redesign, replacing Fraunces)
- `Merriweather` — resume template serif (`font-serif`) — don't change, used by PDF
- `Hind Siliguri` — Bengali UI/body. Stack swaps in via `html[data-locale="bn"] body`
- `Tiro Bangla` — Bengali display headlines. Stack swaps in via `html[data-locale="bn"] .font-display`

**Mobile / phone conventions (load-bearing — don't fight these):**
- **iOS zoom is handled globally.** `src/index.css` has an unlayered `@media (max-width:640px){ input,textarea,select{ font-size:16px } }` rule (with a `#resume-source`/`#cover-letter-source` exclusion so the pt-based resume edit fields are untouched). It's unlayered so it beats Tailwind's `.text-sm` utility. So: keep `text-sm` on form controls for desktop density — do NOT add `text-base sm:text-sm` per field; the global rule already makes them 16px on phones. Don't remove this rule or you reintroduce zoom-on-focus everywhere.
- **Tap targets:** the `icon-btn` / `icon-btn-danger` utilities auto-grow to 44px on touch (`@media (hover:none) and (pointer:coarse)`) while staying 2rem on desktop — use them for row edit/delete actions. For other controls, aim for `min-h-11` (44px) on phones.
- **Never hide actions behind hover only on touch.** Use `opacity-100 sm:opacity-0 sm:group-hover:opacity-100` (visible on phones, hover-reveal on desktop) — a plain `group-hover` makes the control unreachable on phones.
- **Viewport height:** use `h-dvh`/`min-h-dvh` (not `*-screen`) on full-height screens so the mobile URL bar / keyboard doesn't clip content.
- **Established mobile patterns:** Preview uses a slim app bar + horizontal artifact tab rail + thumb-zone bottom dock + bottom sheet; dashboard navbar collapses extras (language toggle) into the account menu on phones; wide tables (purchase history) become stacked label-value cards below `md`. Gate all mobile-only changes behind base→`sm:`/`md:` so desktop stays unchanged.

**Bengali rendering rule:** the resume document itself stays in English (so the rendered preview matches the PDF/Word exporter byte-for-byte and recruiters get the format they expect). Only UI chrome — navbar, dashboard, builder forms, preview tabs, toasts — translates. AI-generated content (resume bullets, cover letter, outreach, interview prep) stays in the language the user typed.

**UI idioms established:**
- Rounded cards: `rounded-2xl` (24px) for content, `rounded-full` for pill buttons
- Section eyebrows: `text-[11px] uppercase tracking-[0.22em] text-accent-600 font-semibold`
- Dividers inside grouped cards: 1px `bg-charcoal-200` between cells (using the `gap-px` + bg-container trick)
- **Form wizards** (`ProfileSetupScreen`, `BuilderScreen`) use a sticky left
  phase rail on `lg+` (numbered phase groups: "About you" → "Your work" →
  "Your credentials"), collapsing to a progress bar on mobile. Active step
  marker is saffron, completed is ink, untouched is charcoal.
- **Form primitives** (defined in `components/FormSteps.tsx`, shared across
  profile setup and builder) — use these rather than reinventing:
  - `TipCard` — always-on "Quick guide" panel (saffron-tinted) above form
    fields. **Defaults to open** so users see guidance without a click; the
    user can collapse it. Rules + real examples. Used in steps where rules
    genuinely help (Education, Skills, Target Job, Extracurriculars).
  - `WritingGuide` — friendlier alternative to `TipCard` used at the top of
    the **brain-dump-heavy steps** (Experience, Projects). Leads with a
    *reassurance hero* ("write it however feels natural — the AI polishes
    it") instead of a rule list, with examples tucked behind a "Want a peek?"
    toggle. Use this whenever the section is open-ended writing, not
    structured fields.
  - `MiniGuide` — single-paragraph saffron callout for sparse credential
    steps (Awards, Certifications, Affiliations, Publications). Friendlier
    than a TipCard, just inline orientation. Renders an icon + one-line rule.
  - `PromptList` — numbered scaffolding shown above brain-dump textareas. 3
    small questions that turn "what should I write?" into 3 sub-answers.
  - `WritingChecklist` — live, transparent feedback under brain-dump
    textareas. 4 explicit checks (action verb / real number / outcome / 2–3
    sentences of detail) that flip filled as the user types. Pure regex,
    no AI call. Replaces the previous opaque 3-bar `QualityMeter`.
  - `PolishHint` — short "type messy, the AI will polish this" reassurance
    next to brain-dump fields, so users feel free to brain-dump.
  - `CollapsibleItem` — list-item cards (experience / projects / education /
    awards etc.) auto-collapse to a one-line summary once their key fields are
    filled. Click the header to re-expand.
  - `SectionHeader` — eyebrow + display title + subtitle for every step.

---

## 11. Skills / coding conventions

Skill packages live at `.agent/skills/` and are also mirrored to `~/.claude/skills/` so Claude Code's Skill tool can load them. Consult these when working in their domain:

- `composition-patterns` — React composition rules (compound components, avoid boolean props, React 19 no-forwardRef)
- `react-best-practices` — general React 19 + bundle + storage rules
- `web-design-guidelines` — general web design standards

**Project-level conventions** (enforced by the codebase, observe when editing):
- Clean Architecture layering (§4) is non-negotiable — infrastructure imports from domain, never vice versa
- New AI generator ⇒ domain interface + use case + Gemini impl + DI wire + orchestrator call, in that order
- All persistence goes through a repository interface, never a raw Supabase call from presentation/application
- Prefer `Promise.allSettled` for parallel independent AI calls so a single failure does not kill the flow
- `Preview.tsx` renders in pt (`PAGE_WIDTH_PT = 595.28`) to mirror the PDF exporter exactly — numeric sizes must stay in lockstep
- **All user-facing strings go through `useT()`** (`src/presentation/i18n/LocaleContext.tsx`). Never inline a literal in JSX or a `toast.*()` call. Add the key to `locales/en.ts` first, then `locales/bn.ts` — TypeScript enforces parity. Toggle is `<LanguageToggle />`, mounted in `Navbar`, `LandingScreen`, `LoginScreen`, `DashboardScreen` header, and `ProfileSetupScreen` top bar. Switching locale only mutates context — form state, current builder step, and scroll position are React state and survive a switch automatically.

---

## 12. Commands & env

```bash
npm install          # first time
npm run dev          # Vite dev server
npm run typecheck:api # tsc -p tsconfig.api.json — type-check the api/ serverless functions only
npm run build        # = typecheck:api + vite build (Vite transpiles the client but does NOT type-check it)
npm run preview      # serve the dist/ build
```

No test suite currently (no `npm test`). Verification = successful `npm run build` + manual browser pass. NOTE: `vite build` does NOT type-check — it only transpiles. The client (presentation layer) carries pre-existing, tolerated TS noise and is intentionally not type-checked. `npm run build` prepends `typecheck:api`, which DOES type-check the `api/` serverless functions (the surface Vercel type-checks on deploy) so an api/ type error can't pass locally yet fail every deploy. Vercel's `buildCommand` is also `npm run build`.

**Required env vars** — split into client-visible (`VITE_*`) and server-only (no prefix). Set both in Vercel's Environment Variables UI; non-`VITE_` keys are NEVER bundled into the client:
```
# AI provider — server-only (used by Vercel Functions in /api/*). ONE key.
GEMINI_API_KEY           # https://aistudio.google.com/app/apikey
                         # MUST be on a PAID tier: the free tier trains on your
                         # prompts and allows human review, which contradicts
                         # ToS §3. Free tier is also only 15 RPM.
                         # Bound the spend in Cloud Console -> Billing -> Budgets
                         # with a SPEND CAP budget (a plain budget only emails you)
                         # scoped to the Gemini API service. A mandatory Tier-1
                         # cap ($250/mo) also applies underneath it.

# Supabase — client-visible (anon key is public-by-design, RLS-gated)
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY

# Supabase service role — server-only. Bypasses RLS. Used by the HMAC
# webhooks (/api/confirm-purchase, /api/orphan-inbound-sms,
# /api/reverse-purchase), /api/cron/expire-pending, /api/optimize (the
# service-role-only credit RPCs from migration 008), and the /api/admin/* dispatcher.
SUPABASE_SERVICE_ROLE_KEY

# bKash purchase flow (no traditional payment gateway)
VITE_BKASH_PAYMENT_NUMBER          # owner's bKash number, shown to users in PurchaseModal
BKASH_WEBHOOK_SECRET               # 32-byte hex secret shared with the Flutter SMS-watcher
BKASH_WEBHOOK_REQUIRE_TIMESTAMP    # optional; 'true' enforces webhook v2 (timestamp + nonce replay protection, migration 011)

# Admin SPA + cron (server-only)
ADMIN_API_KEY              # 32-byte hex; gates X-Admin-Key on /api/admin/* and the /admin SPA
CRON_SECRET                # 32-byte hex; Bearer auth on /api/cron/expire-pending. NOTE: vercel.json has no `crons` block, so Vercel does not call this automatically — see §13 (pg_cron is the default path)
```

**Vercel deployment notes:**
- `vercel.json` sets `maxDuration: 60` for `api/**/*.ts` so optimizer calls (up to ~45s with retry) don't time out. On the Hobby tier 60s is the cap; consider Pro if you start chaining toolkit retries.
- `api/*` files use the standard `(req: VercelRequest, res: VercelResponse)` handler signature. They import freely from `src/` (Vercel's Node runtime resolves them via the same node_modules).
- Local dev: `vercel dev` is the canonical way to exercise `/api/*` routes; `npm run dev` only serves the Vite client (unauthenticated calls to `/api/*` return 404 in plain Vite).

---

## 13. Known debt / explicit non-goals

Agents: **do not build these unless the user asks.**

- **Mock-interview marketplace** — consultant profiles, booking, payments. **No UI references it anywhere** — the landing page never did (BD-localized redesign), and the dashboard "Coming soon" teaser + its `dashboard.mockTeaser*` i18n keys + the `metadata.json` claim were all removed (2026-06-21) so we don't promise something we haven't built. Do NOT re-add a mock-interview teaser/section/claim to landing, dashboard, or metadata. Separate product scope.
- **OAuth providers** — Google is shipped (email/password + Google). Apple / LinkedIn and the in-Profile "Connect Google" (account-linking from settings) are still out of scope — see `pending-work/oauth-google-signin.md` §12.
- **Unit / integration tests** — no test harness exists. Don't invent one without asking.
- **Code-splitting** — the bundle is ~1.7MB. Vite warns about it; acceptable for now.
- **Legacy `applications` table** — exists in schema, unused by current code. Do not write to it; use `generated_resumes`.
- **Languages / References in ProfileSetupScreen and ProfileScreen** — currently only wired into the BuilderScreen flow (and loaded from the profile sub-tables when prefilling). To capture in the master profile too, add: state vars + step entries in `ProfileSetupScreen.tsx`, save cases in its switch, and tab + section component in `ProfileScreen.tsx` (mirror `PublicationSection`).
- **AI output in Bengali** — the UI translates (en/bn), but the AI-generated resume bullets, cover letter, outreach email, LinkedIn note, and interview Q&A still come back in English. Most BD recruiters expect English CVs, so this is intentional. Adding a per-document "Generate in: English / বাংলা" toggle would mean: branching prompts in `prompts/resumeOptimizerPrompts.ts` and each toolkit generator + a UI affordance + a prompt-language pass-through in the optimize flow. Don't ship without an explicit ask.
- **Locale persistence to Supabase** — locale is currently `localStorage`-only. Cross-device sync would need a `preferred_locale` column on `profiles` + a fetch on sign-in. Skipped for v1 because device-local is enough for a Bangladesh-first launch.
- ~~**Flutter SMS-watcher app for the new webhooks.**~~ — **WIRED.** The watcher confirms `/api/confirm-purchase` end-to-end AND calls all three migration-007 endpoints: `/api/orphan-inbound-sms` (unmatched SMS after the 24h retry window), `/api/reverse-purchase` (bKash reversal SMS), and `/api/admin/parser-failures` POST (unclassifiable SMS) — see `apps/mobile/lib/dispatch/webhook_client.dart` (`orphan`/`reversal`/parser-failure sends) + `dispatcher.dart`. All reuse the same `BKASH_WEBHOOK_SECRET` HMAC. No manual SQL fallback needed.

- ~~**Dev mock-confirm scaffolding**~~ — **REMOVED 2026-05-24**. `api/dev-mock-confirm.ts` deleted, `mockConfirm()` block and `MOCK_AUTOCONFIRM` flag removed from `PurchaseModal.tsx`, `VITE_BKASH_MOCK_AUTOCONFIRM` / `BKASH_MOCK_AUTOCONFIRM` removed from `.env.example`. The shipped Flutter watcher confirms purchases for real; the mock scaffolding is no longer needed. A few orphan locale strings remain (`purchaseModal.mockBadge`, `verifying`, `confirmedToast`, `confirmedHeading`, `confirmedSub`, `confirmedShort`) — they're unused dead text and can be cleaned up in a future PR; not load-bearing.

- ~~**`refund_toolkit_credit()` is user-callable**~~ — **CLOSED 2026-05-24 by migration 008**. Both `consume_toolkit_credit` and `refund_toolkit_credit` now take an explicit `p_user_id uuid` arg and have EXECUTE revoked from `anon` + `authenticated`. `api/optimize.ts` calls them via `SUPABASE_SERVICE_ROLE_KEY`. End-user JWTs no longer have any RPC path that mutates `toolkit_credits`.

- **Cron cadence is on Supabase pg_cron, not Vercel Cron.** Vercel Hobby restricts cron schedules to once-per-day (per https://vercel.com/docs/cron-jobs/usage-and-pricing); a `*/15 * * * *` entry in `vercel.json` fails at deploy time. We removed the `vercel.json` `crons` block on 2026-05-24 and rely on `supabase/migrations/007_optional_pg_cron.sql` which schedules `expire_stale_pending_purchases()` every 15 min at the DB layer. The `/api/cron/expire-pending` HTTP endpoint stays in the codebase as a manual trigger (`curl -H 'Authorization: Bearer $CRON_SECRET' ...`) and as the path that gets re-enabled in `vercel.json` if/when the operator upgrades to Vercel Pro.

- **Operator email digest for stuck pending rows** (case #20 from `topcandidate-audit-2026-05-08/PROMPT-transaction-flow-edge-cases.md`). The cron-driven `expired` flip handles the 24h cliff, and the admin dashboard tile surfaces the oldest pending row at every page load. The proactive ping (e.g. "any pending row > 12h triggers an email") is NOT wired — the repo has no email provider. Add when the operator picks one (Resend / Postmark / SES).

- ~~**Larger admin surface from `topcandidate-audit-2026-05-08/PROMPT-admin-panel.md`**~~ — **SHIPPED 2026-05-30 via migration 009**. Users tab + UserDetail (grant/deduct/flag/notes), Purchases tab + PurchaseDetail (full lifecycle + state-driven action panel), Audit log tab (with JSON diffs), Settings tab (env health + manual cron trigger), Dashboard action queue, parser-failures mark-reviewed + corpus export, ⌘K palette. Deviations from the spec, all intentional: (a) single `api/admin/[action].ts` dispatcher with flat `/api/admin/<verb>` URLs instead of nested `users/:id/grant-credits` paths (Vercel Hobby 12-function cap); (b) no react-router — selection state lives in the shell; (c) one shared `record_admin_action` RPC instead of one per action — same auditing contract, one place to evolve; (d) no Vitest harness — `AGENTS.md` rule against inventing one. The manual checklist in `ADMIN.md` is the verification surface.

- **Real job feeds are Phase 1, and Phase 0's click data is the gate.** The shipped job discovery (§3, issue #39) builds SEARCH URLs and hands them to the browser. Do **not** "finish" it into a crawler: no scraping, no cached job table, no background worker, no storing third-party job data, no results grid, no apply-in-app. The research behind this is in issue #39 — LinkedIn (no read API; *hiQ v. LinkedIn* ended in a $500k judgment and an order to delete the scraped data and the collecting code), Indeed (publisher API dead 2023, feed retired 2024, `GET indeed.com/jobs?l=Bangladesh` → 403), Bdjobs (`robots.txt` allows a named list of search-engine bots then `User-agent: * / Disallow: /`), and public Facebook posts (Groups API deprecated, CrowdTangle shut down 2024-08-14, Meta Content Library excludes for-profits). The global aggregators mostly don't cover BD either (Adzuna, Careerjet, Jooble, JSearch all absent). Licensed APIs / ATS integrations / board partnerships get revisited when `job_search_link_clicked` says they'd pay for themselves.
- **Rotating angle pool** — generate 10 angles, show 6, rotate weekly. Deliberately NOT built. Revisit only if click data shows users exhausting the list.

- **Tests.** No test harness — Vitest, Playwright, pgTAP would each be new SDK additions. The 2026-05-08 PROMPT-transaction-flow-edge-cases asked for them; we deferred them per `apps/web/AGENTS.md` §13's "do not invent a test harness without asking" rule. Migration 007's RPCs are all idempotent and were written against the spec's edge cases; the per-state branches in `confirm_purchase` and `apply_purchase_topup` are the highest-value targets when a harness is added.

---

## 14. Update checklist (copy into your PR description)

```
[ ] AGENTS.md updated (product surface, architecture, data model, schema — whichever changed)
[ ] CLAUDE.md updated (if a new hard rule was introduced)
[ ] supabase/migrations/ — new file added, idempotent, schema.sql reflects it
[ ] No new gradient / generic blue / generic purple introduced
[ ] npm run build passes clean
[ ] No new test harness added without explicit ask
```
