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
- **AI provider:** **OpenRouter** (single key, OpenAI-compatible `fetch` via `OpenRouterClient`) when `OPENROUTER_API_KEY` is set — optimizer → Gemini 2.5 Flash (→ Llama 3.3 70B); toolkit / single-artifact → Gemini 2.5 Flash (→ DeepSeek → Llama); extractor → Gemini 2.5 Flash-Lite (→ Flash). Every call is deadline-bounded so the parallel hot path fits Vercel's 60s cap. Falls back to the **legacy** Groq (`llama-3.3-70b-versatile`) → Gemini optimizer + Gemini-only toolkit/extractor (`@google/genai`) when the key is absent. Gate + rationale: `api/_lib/aiFactory.ts`, `docs/OPENROUTER_MIGRATION.md`. `@google/genai` is still a dependency (kept one cycle as the rollback path)
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

> **AI generator note:** the `Gemini*Generator.ts` files referenced below are the **legacy** implementation. The **active** path (when `OPENROUTER_API_KEY` is set) is the sibling `OpenRouter*Generator.ts` set, wired in `api/_lib/aiFactory.ts`. Same domain interfaces, same prompts/guards. See §9 for the full provider map. The Gemini files stay until migration Phase 6b.

| Area | File entry point | Status |
| --- | --- | --- |
| Landing page | `src/presentation/LandingScreen.tsx` | shipped — BD-localized editorial redesign: centered hero with a rendered ATS resume mock, five-item toolkit list, value/pricing section (free first resume, ৳200/5 via bKash), 3-step how-it-works, BD testimonials, FAQ accordion. No announcement bar, no mock-interview section. No gradients, Saffron/Ink palette |
| Auth (email + password, **Google OAuth**) | `src/presentation/LoginScreen.tsx`, `src/presentation/auth/ContinueWithGoogleButton.tsx`, `src/infrastructure/auth/AuthContext.tsx` | shipped (Supabase Auth; Google via `signInWithGoogle` PKCE redirect — requires the Supabase Google provider configured) |
| Profile setup (master profile) | `src/presentation/ProfileSetupScreen.tsx` | shipped — one-time profile capture used to seed future resumes |
| Profile edit | `src/presentation/ProfileScreen.tsx` | shipped — view/edit saved master profile sections |
| Dashboard (two-card action zone — Master vs. Tailor — + applications grid) | `src/presentation/DashboardScreen.tsx` | shipped |
| Internationalisation (en + bn) | `src/presentation/i18n/` — `LocaleContext.tsx`, `LanguageToggle.tsx`, `locales/en.ts`, `locales/bn.ts` | shipped — full UI in English and Bengali; AI output stays English |
| Resume builder (multi-step form) | `src/presentation/BuilderScreen.tsx` | shipped |
| Resume preview + templates | `src/presentation/components/Preview.tsx`, `src/presentation/templates/TemplateRegistry.ts` | shipped (4 ATS-safe templates). **Navigation:** a single artifact nav (Resume · Cover Letter · Outreach · LinkedIn · Interview) — desktop = left sidebar, mobile = a horizontal pill rail under a slim app bar. The **template picker is a quiet, collapsible control** (desktop = a disclosure nested under the active Resume tab; mobile = a bottom sheet opened from the action dock) — NOT the front-and-center grid it used to be. **Mobile chrome:** slim app bar (back · title · `⋮` overflow for Edit/Regenerate/Word) + a bottom action dock (Template · Fit/100% · Download PDF) in the thumb zone; the dock shows only on the Resume/Cover-Letter tabs. The Fit/100% zoom is mobile-only (on desktop `fit` already renders at 100%). **Document:** the fixed-width pt sheet is wrapped in `ScaledDocument` — a `transform: scale()` fit-to-width view driven by `ResizeObserver`; the pt sheet itself is untouched (rule 7 — still PDF-identical). Contact line + project/publication/reference links render as real hyperlinks via the shared `templates/contactLinks.ts` (also used by both exporters); visible text stays the full URL for ATS. |
| Cover letter generation + viewer | `src/infrastructure/ai/GeminiCoverLetterGenerator.ts`, viewer inside `Preview.tsx` | shipped |
| **Outreach email** generation + viewer | `src/infrastructure/ai/GeminiOutreachEmailGenerator.ts`, `src/presentation/components/Builder/ToolkitViewers.tsx` | shipped |
| **LinkedIn note** generation + viewer | `src/infrastructure/ai/GeminiLinkedInMessageGenerator.ts`, `ToolkitViewers.tsx` | shipped |
| **Interview Q prep** generation + viewer | `src/infrastructure/ai/GeminiInterviewQuestionsGenerator.ts`, `ToolkitViewers.tsx` | shipped |
| General Resume (profile-based, 24h regen cooldown) | `ResumeService.generateGeneralResume()` | shipped |
| Export (Word + PDF) for resume & cover letter | `src/infrastructure/export/` | shipped |
| Resume extract (from uploaded PDF/Word) | active: `OpenRouterResumeExtractor.ts` (legacy: `GeminiResumeExtractor.ts`), prompt+schema in `prompts/extractorPrompts.ts`, in-browser text via `utils/pdfText.ts`, UI `components/profile/ResumeUploadStep.tsx` | shipped — extracts ALL sections incl. certifications / affiliations / publications via **strict `json_schema`** (`EXTRACTOR_SCHEMA`, `max_tokens` 8000) so trailing sections can't truncate. **Transport:** the client extracts PDF **text** with pdf.js and sends only that (`mimeType: 'text/plain'`, a few KB) — so text PDFs of any size work. Scanned/image PDFs (no text layer) fall back to base64 file-send, which IS bounded by Vercel's 4.5 MB body limit → that fallback caps at **3 MB raw**; the overall picker cap is 10 MB. The extractor branches on `mimeType` (text message vs `file` part); both extractors handle both modes. |
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
 │  api/_lib/aiFactory    — gates on OPENROUTER_API_KEY:     │
 │   • set  → OpenRouter{ResumeOptimizer,ToolkitGenerator,   │
 │            CoverLetter,Outreach,LinkedIn,InterviewQ,       │
 │            ResumeExtractor} via OpenRouterClient           │
 │   • unset→ legacy: MultiProviderResumeOptimizer (Groq→    │
 │            Gemini) + Gemini{Toolkit,…,Extractor}           │
 │  Shared: prompts/{resumeOptimizerPrompts,toolkitPrompts,  │
 │          toolkitContext,extractorPrompts}.ts              │
 │  Keys: process.env.{OPENROUTER,GROQ,GEMINI}_API_KEY       │
 │  (NEVER VITE_-prefixed — server-only, never bundled)      │
 └───────────────────────────────────────────────────────────┘
```

**Rules:**
- **Domain** depends on nothing. Pure types and interfaces.
- **Application** depends on domain only.
- **Infrastructure** implements domain interfaces. Can import SDKs (Supabase, Gemini).
- **Presentation** depends on application + domain. Can read infrastructure via `dependencies.ts` but should prefer going through `ResumeService`.

**AI call budget:** initial generation runs exactly TWO concurrent AI calls — optimizer + combined toolkit — since 2026-06-11 carried by TWO parallel HTTP requests (`/api/optimize` + `/api/toolkit`), each in its own Vercel 60s function window. (On OpenRouter both are Gemini-Flash-primary; on the legacy path both are Gemini.) Free-tier RPM history (the legacy 1-optimizer-plus-4-toolkit fan-out hit quota) is why it's capped at two AI calls. Per-item regeneration still hits the single-artifact generators (one call per retry).

**Toolkit validation is per-artifact.** `GeminiToolkitGenerator.generate()` validates each of the four artifacts (cover letter, outreach email, LinkedIn note, interview questions) in isolation and returns a `GeneratedToolkit` with optional fields plus an `errors` map. A validation failure on one artifact (empty payload, fabricated token, missing specificity anchor, interview answers below the 1/3 anchor-coverage floor) records the reason in `errors[<item>]` while the other slots ship through cleanly. The old all-or-nothing throw is gone; never reintroduce it — it forced the user to manually regenerate every item when a single weak interview answer fell below the anchor threshold. The bundle runs on its own free `/api/toolkit` request (via `ResumeService.generateToolkitBundle`, which never throws — hard failures land in the errors map); only `/api/optimize` touches credits, so a toolkit retry can never double-charge. Per-item retries go through the free `/api/toolkit-item` endpoint via the Preview card buttons.

**Fit-mode dispatch (match vs. stretch).** `classifyFitMode(data)` in `toolkitContext.ts` runs a JD-vocab × candidate-evidence overlap heuristic before every toolkit call. Below 10% overlap (with JD vocab size ≥ 20) flips the toolkit into **stretch** mode — the career-switcher path. In stretch mode the prompt is rewritten to coach transferable-skill bridges and honest pivot framing, the fabrication guard accepts JD-named tools / regulators / frameworks as growth targets, outreach specificity softens from `'both'` to `'either'` (one anchor — candidate proper noun OR target company — is enough), and the interview anchor-coverage assertion is skipped (stretch candidates can't always anchor in field-specific items). Match mode keeps every original guard. **What never relaxes, in either mode:** never invent past employers, never invent credentials, never invent metrics, never coach a "claim experience you don't have" answer. JD-named tools in stretch mode must be framed as growth targets — the prompt enforces this; the guard's job is to stop blocking the vocabulary that legitimate growth-target framing requires. The same fit-mode dispatch runs in each per-item generator (`GeminiCoverLetterGenerator`, `GeminiOutreachEmailGenerator`, `GeminiLinkedInMessageGenerator`, `GeminiInterviewQuestionsGenerator`) so per-card retries stay consistent with the bundled call.

**Fabrication-dictionary categories.** The `FABRICATION_TOKEN_DICTIONARY` in `toolkitContext.ts` is intentionally restricted to **claimed-asset tokens** — vendor software (Murex, Finacle, Veeva), market-data terminals (Bloomberg, Refinitiv), certifications (CFA, FRM, ICAB), employers, and regulators. Things a candidate could fabricate to look more impressive. **Environmental regulations are NOT in the dictionary** (Basel III, IFRS 9, Basel IV, etc.) — every BD bank operates under those by definition, so saying so in a banking cover letter is descriptive, not boastful. The 2026-05-14 audit removed Basel III / IFRS 9 / Basel IV from `BANKING_TOKENS` after they kept tripping the cover letter for in-field banking candidates. When adding tokens in new industry dictionaries, apply the same test: *can a candidate fabricate this to look more impressive?* If yes (a tool, a cert, a credential), add it. If no (a regulation everyone in the industry already operates under), leave it out.

**Bilingual interview prep (English + Bangla).** Interview questions ship in both languages from the same AI call — fields `questionBn`, `whyAskedBn`, `answerStrategyBn` on `InterviewQuestion` (optional for back-compat with pre-2026-05-14 saved resumes). The English version is authoritative; Bangla is for the candidate's own rehearsal because BD interviews routinely swing into Bangla on behavioural / cultural questions even at MNCs. The combined toolkit schema and the single-artifact retry generator both require all six fields. Translation rules baked into the prompt: professional spoken Bangla (not literal word-by-word), English-canonical industry terms / employer names / regulatory frameworks / certifications kept in Roman script inline (Basel III, IFRS 9, KYC, NPL, ECL, CFA, BBA, KPI), category labels left in English. UI toggle in `InterviewPrepViewer` (English / বাংলা) defaults to English and persists via `localStorage['topcandidate.interviewPrepLang']`. Falls back to English per-field when a Bangla translation is missing. Other artifacts (cover letter / outreach / LinkedIn / resume itself) stay English-only — BD recruiters scan English, ATS systems are English-language, LinkedIn is English globally.

**Optimizer prompt + post-pipeline.** `prompts/resumeOptimizerPrompts.ts` is shared by every optimizer implementation (OpenRouter, Groq, Gemini). Beyond the system + user prompt, every optimizer response runs through this deterministic post-pipeline (in order):
1. `normalizeSkills` — dedupe flat `skills` and dedupe/clean `skillCategories` (drops empty buckets).
2. `filterFabricatedSkills` — strips skills (and category items) the candidate never evidenced. Belt-and-braces against the SKILL HONESTY rule.
3. `reorderLeadBulletByJDFit` — within each item, promote the most JD-aligned bullet to position 0 (the recruiter's highest-attention spot).
4. `reorderProjectsByJDFit` — reorder *whole projects* by aggregate JD overlap. Stable; experience stays chronological because recruiters expect a timeline. `ResumeService.mergeOptimizedData` consumes the optimizer's output order for projects via `reorderProjectsByOptimizer`.
5. `enforceBulletDensity` — items whose JD-fit score is below the median across the resume's items get trimmed to 2 bullets. Items at/above median keep up to 5. Pure deletion — never adds bullets.
6. `validateOptimizedResponse` — id-presence + non-empty bullet check. Throws if violated (triggers an optimizer retry).

The user prompt also injects a `SENIORITY` line (Junior / Mid / Senior / Senior+) inferred from total months of experience + `userType`, plus a `THINK FIRST` CoT block that asks the model to silently identify JD top requirements + candidate evidence before emitting JSON. Don't strip these — they tune verb choice and gap handling.

**Adding a new AI generator:** add an interface + use case in `domain/usecases/`, then a **provider implementation in `infrastructure/ai/`** — the active path is an `OpenRouter*Generator` built on `OpenRouterClient` (mirror an existing one; reuse the shared prompt in `prompts/` + `withRetry` for JSON); add a legacy `Gemini*` sibling only if you need the fallback path too. Wire both into `api/_lib/aiFactory.ts` (gated on `OPENROUTER_API_KEY`) and inject via `ResumeService`. For single-item ancillary output, call it from `regenerateToolkitItem()` — NOT from `optimizeResume()` (optimizer only) or `generateToolkitBundle()` (combined bundle only). To expand the initial toolkit, extend the toolkit generator's schema/prompt instead of adding a parallel call.

**Pre-flight content gates** live in `src/application/validation/` and run client-side before any AI call (in `ResumeService.optimizeResume`) and before signup (in `LoginScreen`). They are pure utilities — no SDK deps, no domain types — and exist to refuse work that would waste tokens or pollute the user pool. Two gates today:

- `gibberishDetector.ts` + `dictionaries.ts` — catches keyboard-mash on long free-form resume fields. Bengali Unicode passes through; romanized Banglish is rescued by a hand-curated word list. Conservative thresholds (errs toward letting borderline text through). Throws `GibberishContentError` with the offending field name; callers should pass `error.message` to `toast.error` rather than swallowing it.
- `emailValidator.ts` — signup gate using `validator.isEmail` for format, `disposable-email-domains` for known throwaways (lazy-imported, ~2 MB JSON kept out of the initial bundle), plus a local-part shape check. Async; only runs on signup, not login.

**Form-field email + phone validation.** Every email/phone field across `FormSteps` (PersonalInfoStep, ReferencesStep), `ReferenceSection` (master profile), and `ProfileScreen` flows through two shared UI primitives in `src/presentation/components/ui/`: `EmailInput` (synchronous `validator.isEmail` check — the disposable-list gate is reserved for signup only, to stay off the keystroke path) and `PhoneInput` (international country picker + `libphonenumber-js` validation — stores E.164 international format, defaults country to BD). Both export `isValidEmail` / `isValidPhone` helpers used by the form-submit validators in `BuilderScreen.validateStep()` and `ProfileSetupScreen.validateCurrentStep()`. Do NOT introduce raw `<input type="email">` or `type="tel">` inside the builder/profile flows — wire through these components so the per-field error UX stays consistent.

When adding a new AI entry point: add a corresponding `assertContentIsReal`-style gate at the top of the service method, listing the user-supplied free-form fields that feed the prompt. Skip short structured fields (names, dates, locations) — too noisy to score and not where waste comes from.

**Monetization & credit gate.** Tailored toolkit generation is the paid tier. The free tier is the General Resume (optimizer only, no toolkit). Splitting them is enforced at the endpoint layer:

- **`/api/optimize`** — paid path. Atomically calls `consume_toolkit_credit()` (a SECURITY DEFINER Postgres function with `search_path = public, pg_temp`) before running AI. If `toolkit_credits = 0`, returns **402** with `code: 'insufficient_credits'`. If the optimizer call itself fails, calls `refund_toolkit_credit()` so the user is not charged for an empty generation; if that refund RPC *also* fails, the 502 carries `code: 'refund_failed'` (the user was charged for nothing — the client shows a contact-support toast and the server logs `REFUND FAILED` for manual reconciliation via `credit_ledger`). Since 2026-06-11 this endpoint runs the optimizer ONLY; the response's `toolkit` field is a stale-client stub (errors map pointing at the per-item retry buttons).
- **`/api/toolkit`** — combined toolkit bundle (cover letter + outreach + LinkedIn note + interview prep) on its own function invocation, fired by the client in parallel with `/api/optimize`. Free (the optimizer's credit covers the generation, same economics as before the split); backstops are auth + the daily AI-call cap. Logs `ai_call_log` kind `'toolkit'` (migration 014). A hard toolkit failure no longer affects the optimizer request at all — the credit is **kept** because the user got their resume, and per-item retries are free.
- **`/api/optimize-general`** — free path. No credit check, no toolkit. Used exclusively by `ResumeService.generateGeneralResume()` and `regenerateGeneralResume()` via a separate `ProxyGeneralResumeOptimizer`. Backstops: the overall daily AI-call cap (20/day) **plus** a stricter per-kind cap (`KIND_DAILY_CAPS.optimize_general = 5/day` in `api/_lib/rateLimit.ts`) — the free path has no credit gate, so the per-kind cap is its only cost control.
- **`/api/normalize-item`** — "polished profile" normalization (migrations 015 + 016). Fired in the background whenever a profile item with a raw description is saved with changed text (hash-guarded): raw brain dump (English/Bangla/Banglish) → `{ bullets, skills, gaps }` stored in the item's `normalized` column beside the raw text (never replacing it). Covers all three description sources that feed generation: **experiences, projects, extracurriculars** — shared client machinery in `components/profile/polish.tsx` (`needsPolish` / `polishInBackground` / `PolishedPreview`), used by the three profile sections and `ProfileSetupScreen`. Flash-Lite, temp 0, strict `json_schema`, 20s deadline (`OpenRouterProfileNormalizer`). Telemetry kind `'normalize'` is EXCLUDED from the overall daily cap (profile edits must not starve paid generations) and has its own 40/day per-kind cap. **Coaching is deliberately subtle:** at most ONE quiet "Tip:" line per item (enforced in prompt + a `slice(0,1)` in the generator), only for things the user alone can supply (almost always a missing number) — the app does the heavy lifting, never assigns homework. Downstream: the optimizer prompt sends `canonicalBullets` as primary evidence for all three sections; the toolkit's candidate context falls back refinedBullets → normalized.bullets → raw; BOTH fabrication-guard corpora (`buildEvidenceText` in resumeOptimizerPrompts, `buildToolkitEvidenceCorpus` in toolkitContext) include normalized bullets+skills so canonical-cased terms (e.g. "PostgreSQL" polished from "postgres diye") are never false-flagged. OpenRouter-only (no legacy Gemini sibling): the endpoint 503s on the legacy path and clients treat polish as unavailable.
- **Guided Mode** (migration 018) — every description-bearing section (experience, project, extracurricular, award) offers a `Guided / Free write` toggle (Guided default). Guided shows a short bilingual questionnaire (`components/profile/guidedQuestions.ts` — warm question + always-visible example ANSWER, one required, rest optional/collapsed; designed for the BD market across ALL job fields, not just IT). Answers store in the row's `guided` JSONB (+`input_mode`/`guided_version`) AND assemble (`assembleGuided`) into the item's description column — so the normalizer/optimizer/fabrication-guards consume them exactly like a free brain dump (NO new AI path). The normalizer gets a guided-aware prompt clause (`ProfileItemContext.guided`) telling it the text is "Topic: answer" lines. Shared UI in `components/profile/GuidedModeField.tsx`. Switching guided→free seeds the free box with the assembled answers, and free→guided seeds the required question with the free text — so a mode switch never drops content. Awards gained `normalized` columns here (they had no polish before). The 5/section/day re-polish cap applies to guided edits too. Wired in BOTH the profile-screen sections AND onboarding (`FormSteps` experience/project/extracurricular/award steps); onboarding live-assembles answers into the description field so its existing validation/save/polish are unchanged.

  **`input_mode` default — important.** Brand-new (empty) items default to `'guided'`. But any item that ALREADY has free-text and no guided answers must be `'free'`: resume-imported items are marked `'free'` in `handleExtracted` (the extractor fills only the description, never `guided`), and migration **019** backfills legacy rows (migration 018's blanket `default 'guided'` had wrongly flipped them). Reason: a guided-defaulted item with existing text opens to an EMPTY guided form (hiding the text) and, worse, answering the questions overwrites the description on save. Never default an item with existing description text to `'guided'`.
- **Ongoing date ranges (affiliations + extracurriculars).** End Date is **optional** — an empty end means an ongoing membership/role. Do NOT mark it as an error (`MonthPicker isError={false}`; the label reads "End Date (Optional)") — flagging a validly-empty field is misleading per the subtle-UX rule. Anywhere a range is rendered with an empty end — the profile-card line in `AffiliationSection` and the affiliation line in all three resume renderers (`Preview.tsx` / `PdfResumeExporter` / `WordResumeExporter`) — show "– Present" rather than a dangling "2021-01 – ", and drop the parens entirely when there is no start date. (Experiences use their own `isCurrent` boolean for the same effect.)
- **No student/experienced selector — `userType` is DERIVED, and sections are optional.** The user no longer picks "Student vs Experienced Professional" (the `UserTypeStep` is gone from both wizards; `AppStep.USER_TYPE` / `SetupStep.USER_TYPE` are no longer in any visible-steps list). `userType` is computed via `inferUserType(experience)` in `Resume.ts` — `'experienced'` once there's ≥1 work experience, else `'student'` — and recomputed wherever ResumeData is assembled (`ResumeService.optimizeResume` + both general-resume paths, `App.prefillFromProfile`). It still tunes AI framing only (seniority bucket, cover-letter tone, default section emphasis); it never hides sections. Both wizards now show EVERY section to everyone, and **all item sections are optional/skippable** — validators only check the fields of items the user actually added (the old "≥1 experience/project/skill/education" gates were removed; skills is optional too). The forward button reads **"Skip"** when the current section is empty and **"Continue"/"Next"** once something's added (`ProfileSetupScreen` `showSkip`, `BuilderScreen` `showSkip` via `sectionItemCount`). The ONLY hard content gate is **education-OR-experience**: `OptimizeResumeUseCase` throws if both are empty; `ProfileSetupScreen` shows a "no resume will be created" warning screen at finish (completes the profile, skips generation); `BuilderScreen.handleGenerate` blocks before any credit spend (gate runs before BOTH the optimizer AND the parallel toolkit bundle, so neither the tailored resume nor the toolkit is generated — including the from-scratch builder path). Proactive **banners** flag the empty state before the user tries: `ProfileScreen` shows an accent warning banner (and suppresses the general-resume CTA) when both are empty, and `BuilderScreen` shows a persistent banner on every step plus disables the Generate button (`canGenerateContent`). `getUserType`/`saveUserType` + the `profiles.user_type` column remain but are no longer read for behavior (note the legacy schema CHECK is `('student','professional')` while the app uses `'experienced'` — we simply stopped writing it).
- **Education dates are INVERTED from experiences: end is mandatory, start is OPTIONAL.** Resumes usually list education with a single graduation/completion date, not a range. `Education.startDate` is optional (`startDate?`); `endDate` is the required, meaningful field. Ongoing study is encoded as `endDate === 'Present'` (NOT a separate `isCurrent` boolean — education has none; the BuilderScreen validator's old `edu.isCurrent` ref was dead and was removed). The "Currently studying here" checkbox toggles `endDate` between `'Present'` and `''`, and lives in BOTH editors — `EducationSection` (profile page) and `EducationStep` (`FormSteps`, used by onboarding + builder). Validation: `BuilderScreen`, `ProfileSetupScreen`, and `EducationSection.handleSave` require only `endDate`; start is never flagged. All five render sites omit the leading dash when start is empty (show just the end date): the two editor summary lines (`EducationSection` card, `EducationStep` `dateRange()`) and the three resume renderers. `getEducations` orders by `end_date desc` (start may be empty). Extraction: `extractorPrompts` tells the model to put a lone date in `endDate`, and BOTH extractors (`OpenRouterResumeExtractor` / `GeminiResumeExtractor`) deterministically move a start-only date to `endDate` post-parse. No DB migration — `educations.start_date`/`end_date` are already nullable `text`.
- **`/api/purchase`** — initiates a bKash purchase. Calls `initiate_purchase(p_package_id, p_transaction_id, p_sender_msisdn)` (v3, migration 012) which records a row in `purchases` with `status = 'pending'`, then **match-on-submit**: if the operator's bKash SMS already landed (pay-first), the verified `inbound_payments` row settles the purchase synchronously and credits are granted in the same request. Returns `{ success, purchaseId, status, creditsGranted, newBalance, message }` where `status` may be `pending` | `completed` | `underpaid` | `msisdn_mismatch_review`. For submit-first ordering, `status` is `pending` and confirmation arrives out-of-band via the webhook below. Server-controlled package mapping (hardcoded in the SQL function) means users cannot fake the credit/amount values they're entitled to. Per-user 24h limit of 5 pending purchases (anti-spam).
- **`/api/confirm-purchase`** — webhook called by the owner's Flutter SMS-watcher app. Authenticated via HMAC-SHA256 of the request body (shared secret `BKASH_WEBHOOK_SECRET`). On success connects to Supabase using `SUPABASE_SERVICE_ROLE_KEY` and calls `confirm_purchase(p_transaction_id, p_observed_sender_msisdn)` which atomically flips the matching pending row to `'completed'` and grants credits. Optionally cross-checks the SMS-extracted sender msisdn against the user-claimed one; mismatch → 409. On a genuine 404 (no pending row yet — the SMS beat the customer's submit) it calls `record_inbound_payment` (when it knows the amount) so a later match-on-submit in `initiate_purchase` can settle instantly.
- Postage-stamp **race-safety**: `consume_toolkit_credit` is a single `UPDATE … WHERE toolkit_credits > 0 RETURNING …`. Postgres row-locks serialise concurrent calls; the second request with `toolkit_credits = 0` updates 0 rows and the function raises `insufficient_credits`. `confirm_purchase` uses `select … for update` for the same reason — duplicate webhook firings cannot double-grant.
- **Column-level lockdown**: `profiles` UPDATE is restricted via `revoke update on profiles from authenticated; grant update (full_name, email, phone, …) on profiles to authenticated;` — RLS only restricts ROWS, not columns, so without these grants any signed-in user could direct-UPDATE `toolkit_credits`. The credit balance is mutated only via the SECURITY DEFINER functions.
- Client UX: `BuilderScreen` and `DashboardScreen` both fetch the balance via `IProfileRepository.getToolkitCredits()` and show "X generations remaining". `PurchaseModal` is shared between them. After a successful pending submission, the modal calls `onSuccess()` (no balance arg, since the grant is asynchronous) so the caller can re-fetch / refresh state. The actual credit grant arrives later through the webhook; users see it on next dashboard load.

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

**Operator surface (`/admin`)** is gated by an **owner login** (username + password → `POST /api/admin/login` → short-lived HMAC-signed session token sent as `Authorization: Bearer`). The token lives in **sessionStorage**, so closing the tab logs the owner out. Env: `ADMIN_USERNAME` + `ADMIN_PASSWORD_HASH` (scrypt; or `ADMIN_PASSWORD` plaintext fallback); `ADMIN_API_KEY` is repurposed as the token-signing secret (no longer pasted). Token mint/verify + credential check live in `api/admin/_lib/session.ts`; `requireAdmin()` (`_lib/adminAuth.ts`) verifies the bearer token. The SPA shell is `src/presentation/admin/AdminScreen.tsx`; tabs are individual files (`DashboardTab.tsx`, `UsersTab.tsx`, `PurchasesTab.tsx`, `OrphansTab.tsx`, `DisputesTab.tsx`, `ParserFailuresTab.tsx`, `AuditLogTab.tsx`, `SettingsTab.tsx`) with a single design-system primitives module in `ui.tsx` and a fetch wrapper in `adminApi.ts`. **Layout**: left sidebar with grouped sections (Overview / Operations / Records / System), top bar with breadcrumb + ⌘K trigger, mobile-friendly off-canvas drawer below `lg`. **No react-router** — selection state lives in the shell and detail subviews are rendered by their parent tab (back is `setSelected(null)`). App.tsx short-circuits at the outer `App` component when `window.location.pathname.startsWith('/admin')` so the panel mounts before `AuthProvider` (the operator doesn't sign in via Supabase). The admin SPA mounts its own `<Toaster />` for action feedback (separate from the customer-facing one in `App.tsx`).

**Analytics & BI (migration 013).** The admin panel has a full analytics surface backed by **first-party data only** — no third-party analytics SDK, no extra Vercel function. The client writes funnel events straight to Supabase `analytics_events` via `src/infrastructure/analytics/track.ts` (`track()` is fire-and-forget; `captureFirstTouch()` grabs UTM/referrer once; UTM is persisted to `profiles` at signup). Events emitted: `landing_viewed`, `signup_completed`, `profile_setup_completed`, `resume_generation_started/completed`, `purchase_modal_opened`, `purchase_submitted`, `purchase_confirmed`/`purchase_pending`. RLS on `analytics_events` is insert-only (anon+authenticated); reads are service-role (admin) only. Supporting schema: `credit_ledger` (trigger-fed journal of every `toolkit_credits` change), `marketing_spend` (operator-entered ad spend), acquisition+activity columns on `profiles` (`utm_*`, `signup_referrer`, `last_active_at`), AI cost/telemetry columns on `ai_call_log` (`provider/model/prompt_tokens/completion_tokens/cost_usd/status/latency_ms`; `kind` now includes `optimize_general`), `generation_type` on `generated_resumes`, and read views `v_daily_revenue` / `v_daily_signups` / `v_daily_ai_usage` / `v_credit_liability`. AI cost is captured server-side in the AI endpoints via `logCall(..., meta)` using the approximate price table in `api/_lib/aiCost.ts`. Admin analytics tabs: **Revenue** (`RevenueTab`), **Product** (`ProductTab`), **Marketing** (`MarketingTab`), **Customers** (`CustomerIntelTab`), **System health** (`SystemTab`) — all using the dependency-free SVG chart primitives in `src/presentation/admin/charts.tsx`. Their endpoints: `revenue-analytics`, `revenue-export` (CSV), `product-analytics`, `marketing`, `marketing-spend` (POST/DELETE), `customer-intelligence`, `system-health`.

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
  template?: 'ats-classic' | 'ats-modern' | 'ats-serif' | 'ats-compact'
}

JobToolkit {
  outreachEmail?:      { subject: string, body: string }
  linkedInMessage?:    string              // ≤ 280 chars
  interviewQuestions?: InterviewQuestion[]
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

**AppStep enum** (`src/domain/entities/AppStep.ts`) drives the builder's multi-step form.
**Top-level screen routing** is driven by `useBrowserNav` (`src/presentation/hooks/useBrowserNav.ts`) — each transition pushes a `NavState` entry onto `window.history`, and the hook listens for `popstate` so browser back/forward buttons restore the previous screen. Use `navigate({ screen: 'LANDING' | 'LOGIN' | 'DASHBOARD' | 'PROFILE' | 'PROFILE_SETUP' | 'BUILDER' })` for every transition. Use `{ replace: true }` on auth-driven redirects (sign-in / sign-out / profile-setup → dashboard) so the back button doesn't bounce the user back through the auth flow.

---

## 6. Application flow (happy path for a new tailored application)

**Paid vs. free.** The tailored Builder flow below consumes 1 toolkit credit (server-enforced in `/api/optimize`). The General Resume — built from the user's saved profile via `DashboardScreen` "Build my master resume" — is the free path: it goes through `/api/optimize-general` (optimizer only, no toolkit, no credit) and is bounded by the existing 24h regeneration cooldown. See §4 for the credit-gate detail.

```
 User signs in ──► profileRepository.isProfileComplete() ──► ProfileSetupScreen (if incomplete)
                                                          └► DashboardScreen (if complete)

 DashboardScreen ──► "New Application" ──► ResumeSourceDialog
                                          ├── "Use my profile" ──► prefill ResumeData from profileRepository
                                          └── "Start fresh"    ──► empty ResumeData
                  ──► (credits bar above the action cards) ──► PurchaseModal (bKash checkout) ──► /api/purchase (records pending; match-on-submit grants instantly if the bKash SMS already arrived — modal then shows the confirmed overlay immediately)
                  ──► VerifyingPurchasePill tracks the row via Supabase Realtime (sub-second) + 20s fallback poll (no time cap)

 BuilderScreen (multi-step form, driven by AppStep + getVisibleSteps())
   ── USER_TYPE  ── SECTIONS   ── TARGET_JOB    ── PERSONAL_INFO
   ── EXPERIENCE ── PROJECTS   ── EDUCATION     ── SKILLS
   ── EXTRACURRICULARS ── AWARDS ── CERTIFICATIONS ── AFFILIATIONS ── PUBLICATIONS
   ── LANGUAGES ── REFERENCES   (BD-aware additions; toggle in SECTIONS step)

 Final step → handleGenerate() → resumeService.optimizeResume(data):
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
   └── Top bar: Download Word / Download PDF (document tabs only), Regenerate (General Resume only)
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
src/presentation/components/FormSteps.tsx  All step forms (TargetJob, Experience, Projects, etc.)
src/presentation/components/PurchaseModal.tsx  bKash checkout for the toolkit-credits pack (shared by Dashboard + Builder)
src/presentation/templates/TemplateRegistry.ts  4 ATS-safe template definitions (all single-column)

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
  ├── OpenRouterClient.ts               Single fetch adapter — models[] fallback, usage, ZDR, withRetry (the cutover path)
  ├── OpenRouter{ResumeOptimizer,Toolkit,CoverLetter,Outreach,LinkedIn,InterviewQ,Extractor}Generator.ts (server-only; active when OPENROUTER_API_KEY set)
  ├── MultiProviderResumeOptimizer.ts   LEGACY router — Groq → Gemini fallback w/ rate-class cooldown
  ├── GroqResumeOptimizer.ts            LEGACY primary optimizer (llama-3.3-70b-versatile)
  ├── GeminiResumeOptimizer.ts          LEGACY fallback optimizer (gemini-2.5-flash, schema-enforced)
  ├── Gemini{CoverLetter,Outreach,LinkedIn,InterviewQ,Toolkit,Extractor}Generator.ts (LEGACY, server-only)
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
  - `toolkit jsonb` — `JobToolkit` (outreach email / LinkedIn note / interview questions)
  - `company text GENERATED ALWAYS AS ((data -> 'targetJob' ->> 'company')) STORED` — extracted for efficient dashboard search (added migration 006)
- `purchases` — audit trail for the monetization flow. One row per purchase event (`credits_granted`, `amount_taka`, `payment_reference` [bKash TrxID, UNIQUE], `status`). Status enum: `pending` / `completed` / `failed` / `expired` / `underpaid` / `msisdn_mismatch_review` / `refunded`. RLS allows users to SELECT their own; there is no direct INSERT policy — rows are created only via the `initiate_purchase` RPC (the older `process_mock_purchase` RPC was dropped in migration 005). **In the `supabase_realtime` publication + `REPLICA IDENTITY FULL`** (migration 012) so the customer's browser can subscribe to its own purchase row via Supabase Realtime; RLS still gates delivery to the user's own rows.
- `inbound_payments` (migration 012) — server-side memory of an HMAC-verified bKash SMS that arrived *before* the customer submitted their TrxID. PK `payment_reference`; columns `sender_msisdn`, `amount_taka`, `raw_body`, `sms_timestamp`, `received_at`, `consumed_at`, `consumed_purchase_id`. RLS enabled with **no user policies** — only the SECURITY DEFINER functions + the service role touch it. Distinct from `unmatched_inbound_sms` (the 24h operator reconciliation queue): an `inbound_payments` row is consumed automatically (usually within seconds, by match-on-submit in `initiate_purchase`) and never surfaces in the admin Orphans tab. Pruned by `expire_stale_pending_purchases()` (consumed rows, or rows older than 48h).
- `ai_call_log` — per-user daily-cap audit trail (existing).
- `admin_audit_log` (migration 009) — append-only operator action log. Layered alongside `purchase_state_changes`: that table tracks purchase-row transitions only (and is written by Flutter + customer paths too); `admin_audit_log` covers every operator action on ANY target (user, purchase, dispute, orphan SMS, parser failure, system) with `before_state` / `after_state` JSON snapshots + reason. Written by the shared `recordAuditAction()` helper after each admin endpoint's underlying RPC succeeds. Not in the same transaction as the action — see migration 009 header for trade-off.
- `profile_notes` (migration 009) — operator-private free-text notes on customer profiles. Append-only. Service-role only.
- `unmatched_inbound_sms.reviewed_at` (migration 009) — operator marks a parser failure or orphan SMS reviewed without matching it (`matched_to_purchase_id` = "matched to a row"; `reviewed_at` = "I've seen this, drop it from the queue").
- RPC `public.delete_user()` — deletes all user-owned rows (including `purchases`) then the auth user

**Credit-system RPCs** (all `SECURITY DEFINER` with `set search_path = public, pg_temp`):
- `consume_toolkit_credit()` — atomic decrement. Reachable via user JWT. Single `UPDATE … WHERE toolkit_credits > 0 RETURNING …`; raises `insufficient_credits` if balance is 0.
- `refund_toolkit_credit()` — increments by 1. Reachable via user JWT. Called server-side when the optimizer fails after a credit was consumed.
- `initiate_purchase(p_package_id, p_transaction_id, p_sender_msisdn)` — **v3** (migration 012); reachable via user JWT. Records a `pending` purchase (same validation: server-side package mapping, txn id ≥6 chars, uniqueness, per-user pending cap ≤5 in 24h). Return type changed from `uuid` to `TABLE(purchase_id, status_out, credits_granted, new_balance)`. After inserting the pending row it does **match-on-submit**: if a matching `inbound_payments` row already exists (pay-first ordering), it settles the purchase synchronously in the same locked path `confirm_purchase` uses — `completed` (credits granted inside the submit request), or `underpaid` / `msisdn_mismatch_review`. Grants credits in ~1-2s instead of waiting for the watcher's next retry.
- `confirm_purchase(p_transaction_id, p_observed_sender_msisdn)` — **service-role only** (EXECUTE revoked from anon + authenticated). Called by `/api/confirm-purchase` webhook. Locks the matching pending row, optionally verifies the sender msisdn matches, flips status to 'completed', and grants credits.
- `record_inbound_payment(...)` (migration 012) — **service-role only**. Called by `/api/confirm-purchase` on a genuine 404 (when it knows the amount) to store the verified SMS in `inbound_payments` for a later match-on-submit.

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

**Running migrations**: open the Supabase SQL editor and paste the migration file contents. All migrations are idempotent (`add column if not exists`, `create index if not exists`, `create or replace function`).

---

## 9. External services

### AI providers

**The AI surface runs through OpenRouter when `OPENROUTER_API_KEY` is set** (single key; the cutover path — `api/_lib/aiFactory.ts` gates on it). All calls go via `OpenRouterClient` (OpenAI-compatible `fetch`) with `provider.data_collection:'deny'` + ZDR routing (resumes are PII — Chinese *models* are acceptable, Chinese *infra* is not), `reasoning:{enabled:false}` (reasoning tokens bill as output), and a `models[]` fallback chain per workload:

- **Optimizer** → `google/gemini-2.5-flash` → `meta-llama/llama-3.3-70b-instruct`. (DeepSeek was the original pick but a prod 504 on 2026-06-10 showed it both broke the optimizer's strict ID-preserving JSON *and* timed out >45s on a real resume — dropped from the optimizer chain.)
- **Toolkit + single-artifact** → `google/gemini-2.5-flash` (DeepSeek timed out >55s on the long bilingual output vs the 60s cap) → `deepseek/deepseek-v3.2` → Llama.
- **Timeout budget:** every generator runs through the deadline-bounded `withRetry` (in `OpenRouterClient`) — total wall time per generator is hard-capped and a timeout is never retried. Since the 2026-06-11 split each half owns its own function window: optimizer 50s on `/api/optimize`, toolkit 52s on `/api/toolkit` — each fits Vercel's 60s cap independently.
- **Extractor** → `google/gemini-2.5-flash-lite` (native PDF via the `file-parser` plugin, `engine:'native'`) → `google/gemini-2.5-flash`.

JSON handling: the **optimizer, toolkit, and interview generators use `response_format: json_schema`** (OpenRouter structured outputs — the provider enforces the shape, preventing the truncation/malformation that large structured payloads hit under `json_object`; this is the equivalent of the legacy Gemini `responseSchema`). The optimizer additionally keeps its prompt-embedded shape spec because a JSON schema cannot express "echo back exactly these input IDs". The **outreach generator still uses `json_object`** with the shape embedded in the prompt. All wrap the call in the deadline-bounded `withRetry` (2 attempts, never retries a timeout — `OpenRouterClient.ts`). The single-artifact interview gets a 55s deadline (it runs alone on `/api/toolkit-item`); the toolkit gets 52s on `/api/toolkit`; the optimizer gets 50s on `/api/optimize`. `max_tokens` is 8000 for the toolkit + interview (bilingual output is token-heavy).

**Legacy fallback (no `OPENROUTER_API_KEY`):** `MultiProviderResumeOptimizer` routes Groq (`llama-3.3-70b-versatile`, `GROQ_API_KEY`) → Gemini (`gemini-2.5-flash`, `GEMINI_API_KEY`, `responseSchema`) with a 10-min cooldown on 429/503; toolkit/extractor are Gemini-only via `@google/genai`. Kept as the one-cycle **panic switch** (remove `OPENROUTER_API_KEY` to roll back); `@google/genai` stays a dependency until OpenRouter is proven in prod, then a follow-up drops it.

**Cost telemetry:** `api/_lib/aiCost.ts` maps served model slugs (incl. OpenRouter provider prefixes + dated snapshots like `deepseek-v3.2-20251201`) to approximate prices for the analytics tables.

**Hot-path budget unchanged:** initial generation = **2 AI calls only** (optimizer + combined toolkit), carried by two parallel HTTP requests since 2026-06-11 (`/api/optimize` + `/api/toolkit`). Do not re-fan the toolkit into N parallel AI calls. Per-item retries use the single-artifact generators (free) via `/api/toolkit-item`.

**Toolkit context + guards.** Every toolkit generator (the combined hot-path + the four single-artifact retry generators) shares `infrastructure/ai/prompts/toolkitContext.ts`:
- `buildCandidateContext(data)` — full profile block (experience + raw-bullet voice excerpt + projects + raw-bullet voice + education + certifications + awards + publications + extracurriculars + affiliations + languages + skills + skill categories). Generators present this as CANDIDATE EVIDENCE *first*, then the JD as a *filter* — the candidate's evidence is the source of truth.
- `assertNoFabricatedTools(output, data)` — scans output against the `FABRICATION_TOKEN_DICTIONARY`, the union of seven industry buckets curated for the BD market: TECH (cloud, languages, frameworks, databases, devops, AI/ML, observability, big-tech), BANKING (Murex, Finacle, Avaloq, T24, Bloomberg, IFRS 9, CFA, Bangladesh Bank, …), PHARMA (Veeva, IQVIA, Square, Beximco, Pfizer, …), GARMENTS (WFX, FastReact, H&M, Inditex, BGMEA, DBL Group, …), FMCG (Unilever, Reckitt, P&G, BAT, ALEFA, RouteIQ, …), NGO (USAID, World Bank, BMGF, BRAC, Kobo Toolbox, DHIS2, …), TELECOM (Ericsson, Huawei, Grameenphone, Robi, BTRC, …). Any token in output not in the candidate's evidence corpus throws `ToolkitFabricationError`. The target company name is exempted (you may address them by name even though the candidate has no prior history there). When adding a new industry bucket, include named PROPER NOUNS only — generic methodology phrases ("primary sales", "lesson plan") would create false positives because legitimate output describes them without the candidate writing the exact phrase in their input.
- `assertOutreachSpecificity(output, data, mode)` — outreach email (`mode='both'`) must mention the target company AND ≥1 candidate proper noun (own company / role / project / certification / award / school). LinkedIn note (`mode='either'`) needs at least one because of the 280-char limit.
- **Interview questions have NO fabrication / anchor-coverage guard** (removed 2026-06-10). Interview prep must probe what THIS JD demands — including tools the candidate hasn't used yet — so blocking a question because a tech isn't on the résumé defeats the purpose. The prompt steers quality instead (draw from JD + résumé; anchor answers in real experience where it exists; coach honest preparation for gaps; never coach claiming false experience). `assertInterviewAnchorCoverage` / `detectFabricatedTokens` are NOT applied to interview output. The fabrication + specificity guards above STILL apply to the cover letter / outreach / LinkedIn — those are claims made TO an employer, where fabrication is an integrity risk.

Guard failures throw, which the service-layer `withRetry` (1 retry) handles automatically. If both attempts fail, the toolkit's `errors` field is populated and the user can per-item retry from the UI (free).

`GeminiResumeOptimizer` has internal retry/timeout (45s, 3 attempts). `GroqResumeOptimizer` mirrors the same. The toolkit generator gets one extra `withRetry` shot from the service layer. Optimizer + toolkit are wrapped in `Promise.allSettled` so one failure doesn't kill the other.

### Supabase

- Auth: email/password + Google OAuth (Supabase provider; PKCE redirect). Same `auth.users` row model for both — no "two kinds of users" branching. `useAuth().provider` exposes `'email'`/`'google'`.
- Row-level security is on for every table
- Env vars: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
- Client: `src/infrastructure/supabase/client.ts` (has a dev fallback so the app does not crash on missing env — it will fail at network time instead)

---

## 10. Brand & design

**Name:** TOP CANDIDATE (two-word wordmark: ink + saffron). No "R" badge, no square mark.

**Palette** (defined in `src/index.css` under the Tailwind v4 `@theme` directive — `--color-<group>-<shade>` tokens; no `tailwind.config`):
- `brand-*` — Editorial Ink (warm near-black, 700 = `#1A1812`). Primary text, buttons, ink.
- `accent-*` — Saffron Gold (400 = `#E59321`). Single accent — CTAs, highlights, active-state hints. Use sparingly (≤ 10% of pixels).
- `charcoal-*` — Stone (warm neutrals, 50 = `#FAFAF7`). Backgrounds, borders, muted text.

**Explicit constraints:**
- **No gradients** anywhere (search existing codebase if you think you need one — chances are you don't).
- **No blue, indigo, or purple** brand colors (generic AI look).
- No emojis in UI unless the user asked for them.

**Scoped exception — bKash magenta (`#E2136E`):** the small "bKash" trust chip and required-field asterisk inside `PurchaseModal.tsx` use bKash's brand magenta (inline `bg-[#E2136E]/10` / `text-[#E2136E]`). This is deliberate — the modal is a payment surface where users need to recognise the bKash brand to trust the flow. The exception is scoped to that one component: the primary CTA, active stepper highlight, and copy button all stay Saffron. Do NOT extend bKash magenta to any other screen, button, or component.

**Fonts** (Google Fonts, loaded in `index.html`):
- `Inter` — UI and body (default `font-sans`) — Latin script
- `Fraunces` — display headlines (`font-display`) — editorial serif, Latin
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
# AI provider — server-only (used by Vercel Functions in /api/*)
OPENROUTER_API_KEY       # https://openrouter.ai/keys — single key, ALL AI when set (cutover path); set a hard $ spend cap
# Legacy fallback (used only when OPENROUTER_API_KEY is absent; keep one cycle as the rollback path):
GROQ_API_KEY             # https://console.groq.com/keys   (1,000 RPD free)
GEMINI_API_KEY           # https://aistudio.google.com/app/apikey  (20 RPD free)

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
