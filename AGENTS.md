# AGENTS.md — TOP CANDIDATE

> Single source of truth for AI agents (Claude Code, Cursor, Antigravity, etc.) working on this repo.
> Read this before touching code. Updating this file is **part of every change** — see the maintenance protocol below.

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
- **Tailwind CSS** (via CDN, not PostCSS — config lives in `index.html`)
- **Internationalisation** — DIY typed dictionary at `src/presentation/i18n/` (no library). Two locales: `en` (default) and `bn` (বাংলা / Bengali). Switch via `<LanguageToggle />` in the navbar / landing / login. Locale persists in `localStorage` (`topcandidate.locale`) and is applied to `<html data-locale>` for font-stack swapping. See §10 for fonts and §11 for the convention.
- **AI providers** for resume optimization: **Groq** (`llama-3.3-70b-versatile`, primary — 1,000 RPD free, ~5–8s latency) → **Google Gemini 2.5 Flash** (fallback). Routed through `MultiProviderResumeOptimizer`. Toolkit generators (cover letter, outreach, LinkedIn, interview, extractor) are still Gemini-only. SDK: `@google/genai` for Gemini; plain `fetch` to `api.groq.com/openai/v1/chat/completions` for Groq
- **Server-side API proxy** — all AI calls go through Vercel Functions in `/api/*` (deployed automatically alongside the Vite app). Client holds NO provider keys. Auth via Supabase JWT bearer; per-user daily-cap rate limiting via the `ai_call_log` table.
- **Supabase** (`@supabase/supabase-js`) for auth + persistence
- **docx**, **jspdf**, **html2pdf.js** for export
- **Radix Popover**, **Lucide icons**, **Sonner** (toasts), **date-fns**
- **fuse.js** — fuzzy matching used inside our custom JD skill **extractor**
  at `src/presentation/utils/skillMatcher.ts`. The extractor (`extractSkillsFromJD`)
  runs four passes — known-skill match (regex + fuse), intro-phrase
  (`experience with X, Y`), section-aware bullet parsing
  (`Requirements:` / `Tech stack:`), and repeated-capitalized-phrase
  frequency. Scores + dedupes + canonicalises against the dictionary. Pure
  client-side, no Gemini call (would burn the 2-call budget).
- Import map in `index.html` for CDN-loaded modules (lucide-react, @google/genai, docx, etc.) — build also bundles locally

No monorepo, no workspaces. Single Vite app.

---

## 3. Product surface (currently shipped)

| Area | File entry point | Status |
| --- | --- | --- |
| Landing page | `src/presentation/LandingScreen.tsx` | shipped — rebranded, no gradients, Saffron/Ink palette |
| Auth (email + password) | `src/presentation/LoginScreen.tsx`, `src/infrastructure/auth/AuthContext.tsx` | shipped (Supabase Auth) |
| Profile setup (master profile) | `src/presentation/ProfileSetupScreen.tsx` | shipped — one-time profile capture used to seed future resumes |
| Profile edit | `src/presentation/ProfileScreen.tsx` | shipped — view/edit saved master profile sections |
| Dashboard (two-card action zone — Master vs. Tailor — + applications grid + slim consultant teaser) | `src/presentation/DashboardScreen.tsx` | shipped |
| Internationalisation (en + bn) | `src/presentation/i18n/` — `LocaleContext.tsx`, `LanguageToggle.tsx`, `locales/en.ts`, `locales/bn.ts` | shipped — full UI in English and Bengali; AI output stays English |
| Resume builder (multi-step form) | `src/presentation/BuilderScreen.tsx` | shipped |
| Resume preview + templates | `src/presentation/components/Preview.tsx`, `src/presentation/templates/TemplateRegistry.ts` | shipped (4 ATS-safe templates) |
| Cover letter generation + viewer | `src/infrastructure/ai/GeminiCoverLetterGenerator.ts`, viewer inside `Preview.tsx` | shipped |
| **Outreach email** generation + viewer | `src/infrastructure/ai/GeminiOutreachEmailGenerator.ts`, `src/presentation/components/Builder/ToolkitViewers.tsx` | shipped |
| **LinkedIn note** generation + viewer | `src/infrastructure/ai/GeminiLinkedInMessageGenerator.ts`, `ToolkitViewers.tsx` | shipped |
| **Interview Q prep** generation + viewer | `src/infrastructure/ai/GeminiInterviewQuestionsGenerator.ts`, `ToolkitViewers.tsx` | shipped |
| General Resume (profile-based, 24h regen cooldown) | `ResumeService.generateGeneralResume()` | shipped |
| Export (Word + PDF) for resume & cover letter | `src/infrastructure/export/` | shipped |
| Resume extract (from uploaded PDF/Word) | `src/infrastructure/ai/GeminiResumeExtractor.ts` | shipped |
| **Toolkit credits + mock purchase** — paid tier gating tailored generations | `profiles.toolkit_credits`, `api/optimize.ts` (gate), `api/purchase.ts` (mock), `PurchaseModal.tsx` | shipped (mock) — replace `api/purchase.ts` with a real payment-gateway webhook before launch |

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
 │  api/purchase          — mock purchase (grants credits)   │
 │  api/_lib/auth         — Supabase JWT verifier            │
 │  api/_lib/rateLimit    — daily cap (ai_call_log)          │
 │  api/_lib/aiFactory    — constructs:                      │
 │    MultiProviderResumeOptimizer (Groq → Gemini fallback)  │
 │    GeminiToolkitGenerator + 4 single-artifact generators  │
 │    GeminiResumeExtractor                                  │
 │  Shared: prompts/resumeOptimizerPrompts.ts                │
 │  Keys read from process.env.{GROQ,GEMINI}_API_KEY         │
 │  (NEVER VITE_-prefixed — server-only, never bundled)      │
 └───────────────────────────────────────────────────────────┘
```

**Rules:**
- **Domain** depends on nothing. Pure types and interfaces.
- **Application** depends on domain only.
- **Infrastructure** implements domain interfaces. Can import SDKs (Supabase, Gemini).
- **Presentation** depends on application + domain. Can read infrastructure via `dependencies.ts` but should prefer going through `ResumeService`.

**AI call budget:** initial generation runs exactly TWO concurrent Gemini calls — optimizer + combined toolkit (`GeminiToolkitGenerator`). Free-tier RPM is 5; historical 1-optimizer-plus-4-toolkit fan-out hit quota. Per-item regeneration still hits the single-artifact generators (one call per retry).

**Toolkit validation is per-artifact.** `GeminiToolkitGenerator.generate()` validates each of the four artifacts (cover letter, outreach email, LinkedIn note, interview questions) in isolation and returns a `GeneratedToolkit` with optional fields plus an `errors` map. A validation failure on one artifact (empty payload, fabricated token, missing specificity anchor, interview answers below the 1/3 anchor-coverage floor) records the reason in `errors[<item>]` while the other slots ship through cleanly. The old all-or-nothing throw is gone; never reintroduce it — it forced the user to manually regenerate every item when a single weak interview answer fell below the anchor threshold. `ResumeService.optimizeResume` does NOT wrap the toolkit call in `withRetry`: in the proxy build both halves are served by the same `/api/optimize` POST and a retry would burn a second toolkit credit (the dedupe cache clears in `.finally()`). Per-item retries go through the free `/api/toolkit-item` endpoint via the Preview card buttons.

**Fit-mode dispatch (match vs. stretch).** `classifyFitMode(data)` in `toolkitContext.ts` runs a JD-vocab × candidate-evidence overlap heuristic before every toolkit call. Below 10% overlap (with JD vocab size ≥ 20) flips the toolkit into **stretch** mode — the career-switcher path. In stretch mode the prompt is rewritten to coach transferable-skill bridges and honest pivot framing, the fabrication guard accepts JD-named tools / regulators / frameworks as growth targets, outreach specificity softens from `'both'` to `'either'` (one anchor — candidate proper noun OR target company — is enough), and the interview anchor-coverage assertion is skipped (stretch candidates can't always anchor in field-specific items). Match mode keeps every original guard. **What never relaxes, in either mode:** never invent past employers, never invent credentials, never invent metrics, never coach a "claim experience you don't have" answer. JD-named tools in stretch mode must be framed as growth targets — the prompt enforces this; the guard's job is to stop blocking the vocabulary that legitimate growth-target framing requires. The same fit-mode dispatch runs in each per-item generator (`GeminiCoverLetterGenerator`, `GeminiOutreachEmailGenerator`, `GeminiLinkedInMessageGenerator`, `GeminiInterviewQuestionsGenerator`) so per-card retries stay consistent with the bundled call.

**Fabrication-dictionary categories.** The `FABRICATION_TOKEN_DICTIONARY` in `toolkitContext.ts` is intentionally restricted to **claimed-asset tokens** — vendor software (Murex, Finacle, Veeva), market-data terminals (Bloomberg, Refinitiv), certifications (CFA, FRM, ICAB), employers, and regulators. Things a candidate could fabricate to look more impressive. **Environmental regulations are NOT in the dictionary** (Basel III, IFRS 9, Basel IV, etc.) — every BD bank operates under those by definition, so saying so in a banking cover letter is descriptive, not boastful. The 2026-05-14 audit removed Basel III / IFRS 9 / Basel IV from `BANKING_TOKENS` after they kept tripping the cover letter for in-field banking candidates. When adding tokens in new industry dictionaries, apply the same test: *can a candidate fabricate this to look more impressive?* If yes (a tool, a cert, a credential), add it. If no (a regulation everyone in the industry already operates under), leave it out.

**Bilingual interview prep (English + Bangla).** Interview questions ship in both languages from the same AI call — fields `questionBn`, `whyAskedBn`, `answerStrategyBn` on `InterviewQuestion` (optional for back-compat with pre-2026-05-14 saved resumes). The English version is authoritative; Bangla is for the candidate's own rehearsal because BD interviews routinely swing into Bangla on behavioural / cultural questions even at MNCs. The combined toolkit schema and the single-artifact retry generator both require all six fields. Translation rules baked into the prompt: professional spoken Bangla (not literal word-by-word), English-canonical industry terms / employer names / regulatory frameworks / certifications kept in Roman script inline (Basel III, IFRS 9, KYC, NPL, ECL, CFA, BBA, KPI), category labels left in English. UI toggle in `InterviewPrepViewer` (English / বাংলা) defaults to English and persists via `localStorage['topcandidate.interviewPrepLang']`. Falls back to English per-field when a Bangla translation is missing. Other artifacts (cover letter / outreach / LinkedIn / resume itself) stay English-only — BD recruiters scan English, ATS systems are English-language, LinkedIn is English globally.

**Optimizer prompt + post-pipeline.** `prompts/resumeOptimizerPrompts.ts` is shared by Groq and Gemini. Beyond the system + user prompt, every optimizer response runs through this deterministic post-pipeline (in order):
1. `normalizeSkills` — dedupe flat `skills` and dedupe/clean `skillCategories` (drops empty buckets).
2. `filterFabricatedSkills` — strips skills (and category items) the candidate never evidenced. Belt-and-braces against the SKILL HONESTY rule.
3. `reorderLeadBulletByJDFit` — within each item, promote the most JD-aligned bullet to position 0 (the recruiter's highest-attention spot).
4. `reorderProjectsByJDFit` — reorder *whole projects* by aggregate JD overlap. Stable; experience stays chronological because recruiters expect a timeline. `ResumeService.mergeOptimizedData` consumes the optimizer's output order for projects via `reorderProjectsByOptimizer`.
5. `enforceBulletDensity` — items whose JD-fit score is below the median across the resume's items get trimmed to 2 bullets. Items at/above median keep up to 5. Pure deletion — never adds bullets.
6. `validateOptimizedResponse` — id-presence + non-empty bullet check. Throws if violated (triggers an optimizer retry).

The user prompt also injects a `SENIORITY` line (Junior / Mid / Senior / Senior+) inferred from total months of experience + `userType`, plus a `THINK FIRST` CoT block that asks the model to silently identify JD top requirements + candidate evidence before emitting JSON. Don't strip these — they tune verb choice and gap handling.

**Adding a new AI generator:** add an interface + use case in `domain/usecases/`, a Gemini implementation in `infrastructure/ai/`, wire it into `dependencies.ts`, inject into `ResumeService`. For single-item ancillary output, call it from `regenerateToolkitItem()` — NOT from `optimizeResume()`, which is restricted to the 2-call hot path. If you need to expand the initial toolkit, extend `GeminiToolkitGenerator`'s schema/prompt instead of adding a parallel call.

**Pre-flight content gates** live in `src/application/validation/` and run client-side before any AI call (in `ResumeService.optimizeResume`) and before signup (in `LoginScreen`). They are pure utilities — no SDK deps, no domain types — and exist to refuse work that would waste tokens or pollute the user pool. Two gates today:

- `gibberishDetector.ts` + `dictionaries.ts` — catches keyboard-mash on long free-form resume fields. Bengali Unicode passes through; romanized Banglish is rescued by a hand-curated word list. Conservative thresholds (errs toward letting borderline text through). Throws `GibberishContentError` with the offending field name; callers should pass `error.message` to `toast.error` rather than swallowing it.
- `emailValidator.ts` — signup gate using `validator.isEmail` for format, `disposable-email-domains` for known throwaways (lazy-imported, ~2 MB JSON kept out of the initial bundle), plus a local-part shape check. Async; only runs on signup, not login.

**Form-field email + phone validation.** Every email/phone field across `FormSteps` (PersonalInfoStep, ReferencesStep), `ReferenceSection` (master profile), and `ProfileScreen` flows through two shared UI primitives in `src/presentation/components/ui/`: `EmailInput` (synchronous `validator.isEmail` check — the disposable-list gate is reserved for signup only, to stay off the keystroke path) and `PhoneInput` (international country picker + `libphonenumber-js` validation — stores E.164 international format, defaults country to BD). Both export `isValidEmail` / `isValidPhone` helpers used by the form-submit validators in `BuilderScreen.validateStep()` and `ProfileSetupScreen.validateCurrentStep()`. Do NOT introduce raw `<input type="email">` or `type="tel">` inside the builder/profile flows — wire through these components so the per-field error UX stays consistent.

When adding a new AI entry point: add a corresponding `assertContentIsReal`-style gate at the top of the service method, listing the user-supplied free-form fields that feed the prompt. Skip short structured fields (names, dates, locations) — too noisy to score and not where waste comes from.

**Monetization & credit gate.** Tailored toolkit generation is the paid tier. The free tier is the General Resume (optimizer only, no toolkit). Splitting them is enforced at the endpoint layer:

- **`/api/optimize`** — paid path. Atomically calls `consume_toolkit_credit()` (a SECURITY DEFINER Postgres function with `search_path = public, pg_temp`) before running AI. If `toolkit_credits = 0`, returns **402** with `code: 'insufficient_credits'`. If the optimizer call itself fails, calls `refund_toolkit_credit()` so the user is not charged for an empty generation. If the toolkit call fails but the optimizer succeeds, the credit is **kept** — the user got their resume, and per-item retries are free.
- **`/api/optimize-general`** — free path. No credit check, no toolkit. Used exclusively by `ResumeService.generateGeneralResume()` and `regenerateGeneralResume()` via a separate `ProxyGeneralResumeOptimizer`. Daily AI-call cap (20/day) is the only backstop.
- **`/api/purchase`** — initiates a bKash purchase. Calls `initiate_purchase(p_package_id, p_transaction_id, p_sender_msisdn)` which records a row in `purchases` with `status = 'pending'`. **No credits are granted here** — confirmation happens out-of-band via the webhook below. Server-controlled package mapping (hardcoded in the SQL function) means users cannot fake the credit/amount values they're entitled to. Per-user 24h limit of 5 pending purchases (anti-spam).
- **`/api/confirm-purchase`** — webhook called by the owner's Flutter SMS-watcher app. Authenticated via HMAC-SHA256 of the request body (shared secret `BKASH_WEBHOOK_SECRET`). On success connects to Supabase using `SUPABASE_SERVICE_ROLE_KEY` and calls `confirm_purchase(p_transaction_id, p_observed_sender_msisdn)` which atomically flips the matching pending row to `'completed'` and grants credits. Optionally cross-checks the SMS-extracted sender msisdn against the user-claimed one; mismatch → 409.
- Postage-stamp **race-safety**: `consume_toolkit_credit` is a single `UPDATE … WHERE toolkit_credits > 0 RETURNING …`. Postgres row-locks serialise concurrent calls; the second request with `toolkit_credits = 0` updates 0 rows and the function raises `insufficient_credits`. `confirm_purchase` uses `select … for update` for the same reason — duplicate webhook firings cannot double-grant.
- **Column-level lockdown**: `profiles` UPDATE is restricted via `revoke update on profiles from authenticated; grant update (full_name, email, phone, …) on profiles to authenticated;` — RLS only restricts ROWS, not columns, so without these grants any signed-in user could direct-UPDATE `toolkit_credits`. The credit balance is mutated only via the SECURITY DEFINER functions.
- Client UX: `BuilderScreen` and `DashboardScreen` both fetch the balance via `IProfileRepository.getToolkitCredits()` and show "X generations remaining". `PurchaseModal` is shared between them. After a successful pending submission, the modal calls `onSuccess()` (no balance arg, since the grant is asynchronous) so the caller can re-fetch / refresh state. The actual credit grant arrives later through the webhook; users see it on next dashboard load.

**Adding a new paid feature?** If you ever monetise something else, do NOT introduce a generic "credits" abstraction — add a separate column (e.g. `interview_coach_credits`) and a sibling RPC. Reason: keeping each feature on its own integer is clearer for the user ("3 toolkit generations remaining") and avoids the "what else can I spend credits on?" UX trap.

**Adding a new package?** Edit the `case p_package_id` block in the `initiate_purchase` SQL function (in both `schema.sql` and a new migration). The package mapping is server-side authoritative — any new pricing must ship as a SQL change, not a client constant.

---

## 5. Data model (core types)

All defined in `src/domain/entities/Resume.ts`.

```ts
ResumeData {
  userType?: 'experienced' | 'student'
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
                  ──► (credits bar above the action cards) ──► PurchaseModal (mock checkout) ──► /api/purchase

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
index.html                              Tailwind config (brand/accent/charcoal palettes), fonts, <title>
metadata.json                           App name + description (used by platform)
package.json                            Name: "top-candidate"

src/index.tsx                           Vite entry → <App />
src/presentation/App.tsx                Auth + screen routing + initial data load + ResumeService boot
src/presentation/LandingScreen.tsx      Rebranded landing (Editorial Ink + Saffron, no gradients)
src/presentation/LoginScreen.tsx        Email/password auth
src/presentation/DashboardScreen.tsx    List of generated resumes + job applications
src/presentation/ProfileSetupScreen.tsx First-run profile capture
src/presentation/ProfileScreen.tsx      Edit/view saved master profile (sections: experience, education, skills, etc.)
src/presentation/BuilderScreen.tsx      Multi-step form + generate handler + loading UI
src/presentation/components/Preview.tsx Resume/CL render + toolkit tabs sidebar
src/presentation/components/Builder/ToolkitViewers.tsx
                                        Outreach email, LinkedIn note, Interview prep (copy-to-clipboard)
src/presentation/components/FormSteps.tsx  All step forms (TargetJob, Experience, Projects, etc.)
src/presentation/components/PurchaseModal.tsx  Mock checkout for the toolkit-credits pack (shared by Dashboard + Builder)
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
  ├── MultiProviderResumeOptimizer.ts   Router — Groq → Gemini fallback w/ rate-class cooldown
  ├── GroqResumeOptimizer.ts            Primary optimizer (llama-3.3-70b-versatile)
  ├── GeminiResumeOptimizer.ts          Fallback optimizer (gemini-2.5-flash, schema-enforced)
  ├── prompts/resumeOptimizerPrompts.ts Shared system + user prompt + validation + post-filters
  ├── proxy/ProxyClients.ts             Client-side adapters that POST to /api/*
  └── Gemini{CoverLetter,Outreach,LinkedIn,InterviewQ,Toolkit,Extractor}Generator.ts (server-only)

api/                                    Vercel Functions — server-side AI proxy
  ├── optimize.ts                       POST — runs optimizer + toolkit (paid: gates on toolkit_credits, refunds on optimizer failure)
  ├── optimize-general.ts               POST — optimizer only, no toolkit, no credit gate (free General Resume path)
  ├── toolkit-item.ts                   POST — single-item regenerate (free retry)
  ├── extract-resume.ts                 POST — PDF/Word extract (base64 + mimeType)
  ├── purchase.ts                       POST — mock purchase; replaces with payment-gateway webhook for production
  └── _lib/                             auth.ts, rateLimit.ts, aiFactory.ts

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

- `profiles` — user profile (linked 1:1 with `auth.users`), trigger `handle_new_user` auto-creates on signup. Includes `toolkit_credits integer not null default 0` — current balance for paid tailored generations. **No client-facing UPDATE policy for that column**; mutations only via security-definer RPCs.
- `experiences`, `educations`, `projects`, `skills`, `extracurriculars`, `awards`, `certifications`, `affiliations`, `publications`, `languages`, `references_list` — profile sub-tables. **Note:** the `references` table is named `references_list` because `references` is a reserved keyword in Postgres.
- `applications` — legacy, partially unused (the current code persists generated output to `generated_resumes`)
- `generated_resumes` — final snapshots
  - `id`, `user_id`, `title`, `created_at`, `updated_at`
  - `data jsonb` — `ResumeData` minus toolkit
  - `toolkit jsonb` — `JobToolkit` (outreach email / LinkedIn note / interview questions)
  - `company text GENERATED ALWAYS AS ((data -> 'targetJob' ->> 'company')) STORED` — extracted for efficient dashboard search (added migration 006)
- `purchases` — audit trail for the monetization flow. One row per purchase event (`credits_granted`, `amount_taka`, `payment_reference`, `status`). RLS allows users to SELECT their own; INSERT only via the `process_mock_purchase` RPC (no direct INSERT policy).
- `ai_call_log` — per-user daily-cap audit trail (existing).
- RPC `public.delete_user()` — deletes all user-owned rows (including `purchases`) then the auth user

**Credit-system RPCs** (all `SECURITY DEFINER` with `set search_path = public, pg_temp`):
- `consume_toolkit_credit()` — atomic decrement. Reachable via user JWT. Single `UPDATE … WHERE toolkit_credits > 0 RETURNING …`; raises `insufficient_credits` if balance is 0.
- `refund_toolkit_credit()` — increments by 1. Reachable via user JWT. Called server-side when the optimizer fails after a credit was consumed.
- `initiate_purchase(p_package_id, p_transaction_id, p_sender_msisdn)` — reachable via user JWT. Records a `pending` purchase. Validates package id (server-side mapping), txn id shape (≥6 chars), uniqueness, and per-user pending cap (≤5 in 24h). Returns the new purchase UUID.
- `confirm_purchase(p_transaction_id, p_observed_sender_msisdn)` — **service-role only** (EXECUTE revoked from anon + authenticated). Called by `/api/confirm-purchase` webhook. Locks the matching pending row, optionally verifies the sender msisdn matches, flips status to 'completed', and grants credits.

**Migrations applied**
- `supabase/migrations/001_add_toolkit_column.sql` — adds `toolkit jsonb` + partial index on `generated_resumes`
- `supabase/migrations/002_add_languages_and_references.sql` — adds `languages` and `references_list` profile sub-tables with RLS
- `supabase/migrations/003_add_ai_call_log.sql` — adds `ai_call_log` table for per-user daily-cap rate limiting at the `/api/*` layer
- `supabase/migrations/004_add_toolkit_credits.sql` — adds `profiles.toolkit_credits`, `purchases` table, and the original credit-system RPCs (`consume_toolkit_credit`, `refund_toolkit_credit`, `process_mock_purchase`)
- `supabase/migrations/005_lock_toolkit_credits_and_bkash_pending.sql` — column-level GRANT lockdown on `profiles` (closes the toolkit_credits self-grant exploit), drops `process_mock_purchase`, adds `initiate_purchase` + `confirm_purchase` for the bKash + Flutter-SMS-watcher flow, adds `purchases.sender_msisdn` + unique index on `payment_reference`
- `supabase/migrations/006_add_company_generated_column.sql` — adds `generated_resumes.company` stored generated column + trigram indexes on `title`/`company` for server-side paginated search in the dashboard

**Running migrations**: open the Supabase SQL editor and paste the migration file contents. All migrations are idempotent (`add column if not exists`, `create index if not exists`, `create or replace function`).

---

## 9. External services

### AI providers

The resume optimizer is provider-agnostic — `MultiProviderResumeOptimizer` routes calls in this priority:

1. **Groq** — `llama-3.3-70b-versatile`, free tier 1,000 RPD / 30 RPM, ~5–8s latency. Configured via `GROQ_API_KEY` (server-only, never `VITE_`-prefixed). OpenAI-compatible JSON mode (no schema enforcement → JSON shape spec embedded in user prompt + post-parse validation).
2. **Gemini** — `gemini-2.5-flash`, free tier 20 RPD on 2.5-flash, ~25–40s latency, **strongest schema enforcement** via `responseSchema`. Configured via `GEMINI_API_KEY` (server-only, never `VITE_`-prefixed).

The router cools down a provider for 10 minutes when it returns 429/503/timeout, so a quota-exhausted Groq doesn't keep eating retries. If only one key is configured, the router uses just that one.

**Adding a third provider** (Cerebras, OpenRouter, etc.): implement `IResumeOptimizer`, reuse `prompts/resumeOptimizerPrompts.ts`, push into the `optimizerProviders` array in `dependencies.ts`. The shared prompt module is the contract — never hardcode rules inside an optimizer.

**Toolkit generators** (cover letter, outreach email, LinkedIn note, interview questions, resume extractor) are still Gemini-only. SDK: `@google/genai`. Free-tier RPM is the binding constraint. Initial generation = **2 calls only** (optimizer + combined `GeminiToolkitGenerator`). Do not re-fan the toolkit into N parallel calls.

**Toolkit context + guards.** Every toolkit generator (the combined hot-path + the four single-artifact retry generators) shares `infrastructure/ai/prompts/toolkitContext.ts`:
- `buildCandidateContext(data)` — full profile block (experience + raw-bullet voice excerpt + projects + raw-bullet voice + education + certifications + awards + publications + extracurriculars + affiliations + languages + skills + skill categories). Generators present this as CANDIDATE EVIDENCE *first*, then the JD as a *filter* — the candidate's evidence is the source of truth.
- `assertNoFabricatedTools(output, data)` — scans output against the `FABRICATION_TOKEN_DICTIONARY`, the union of seven industry buckets curated for the BD market: TECH (cloud, languages, frameworks, databases, devops, AI/ML, observability, big-tech), BANKING (Murex, Finacle, Avaloq, T24, Bloomberg, IFRS 9, CFA, Bangladesh Bank, …), PHARMA (Veeva, IQVIA, Square, Beximco, Pfizer, …), GARMENTS (WFX, FastReact, H&M, Inditex, BGMEA, DBL Group, …), FMCG (Unilever, Reckitt, P&G, BAT, ALEFA, RouteIQ, …), NGO (USAID, World Bank, BMGF, BRAC, Kobo Toolbox, DHIS2, …), TELECOM (Ericsson, Huawei, Grameenphone, Robi, BTRC, …). Any token in output not in the candidate's evidence corpus throws `ToolkitFabricationError`. The target company name is exempted (you may address them by name even though the candidate has no prior history there). When adding a new industry bucket, include named PROPER NOUNS only — generic methodology phrases ("primary sales", "lesson plan") would create false positives because legitimate output describes them without the candidate writing the exact phrase in their input.
- `assertOutreachSpecificity(output, data, mode)` — outreach email (`mode='both'`) must mention the target company AND ≥1 candidate proper noun (own company / role / project / certification / award / school). LinkedIn note (`mode='either'`) needs at least one because of the 280-char limit.
- `assertInterviewAnchorCoverage(strategies, data)` — at least half of interview `answerStrategy` texts must reference a candidate proper noun by name. Vague "your relevant project" doesn't count.

Guard failures throw, which the service-layer `withRetry` (1 retry) handles automatically. If both attempts fail, the toolkit's `errors` field is populated and the user can per-item retry from the UI (free).

`GeminiResumeOptimizer` has internal retry/timeout (45s, 3 attempts). `GroqResumeOptimizer` mirrors the same. The toolkit generator gets one extra `withRetry` shot from the service layer. Optimizer + toolkit are wrapped in `Promise.allSettled` so one failure doesn't kill the other.

### Supabase

- Auth: email/password (no OAuth configured)
- Row-level security is on for every table
- Env vars: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
- Client: `src/infrastructure/supabase/client.ts` (has a dev fallback so the app does not crash on missing env — it will fail at network time instead)

---

## 10. Brand & design

**Name:** TOP CANDIDATE (two-word wordmark: ink + saffron). No "R" badge, no square mark.

**Palette** (defined in `index.html` Tailwind config):
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
npm run build        # typecheck (tsc is part of Vite) + production bundle
npm run preview      # serve the dist/ build
```

No test suite currently (no `npm test`). Verification = successful `npm run build` + manual browser pass.

**Required env vars** — split into client-visible (`VITE_*`) and server-only (no prefix). Set both in Vercel's Environment Variables UI; non-`VITE_` keys are NEVER bundled into the client:
```
# AI providers — server-only (used by Vercel Functions in /api/*)
GROQ_API_KEY             # https://console.groq.com/keys   (1,000 RPD free)
GEMINI_API_KEY           # https://aistudio.google.com/app/apikey  (20 RPD free)

# Supabase — client-visible (anon key is public-by-design, RLS-gated)
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY

# Supabase service role — server-only. Bypasses RLS. Used ONLY by the
# /api/confirm-purchase webhook (which is HMAC-gated by the Flutter app).
SUPABASE_SERVICE_ROLE_KEY

# bKash purchase flow (no traditional payment gateway)
VITE_BKASH_PAYMENT_NUMBER  # owner's bKash number, shown to users in PurchaseModal
BKASH_WEBHOOK_SECRET       # 32-byte hex secret shared with the Flutter SMS-watcher
```

**Vercel deployment notes:**
- `vercel.json` sets `maxDuration: 60` for `api/**/*.ts` so optimizer calls (up to ~45s with retry) don't time out. On the Hobby tier 60s is the cap; consider Pro if you start chaining toolkit retries.
- `api/*` files use the standard `(req: VercelRequest, res: VercelResponse)` handler signature. They import freely from `src/` (Vercel's Node runtime resolves them via the same node_modules).
- Local dev: `vercel dev` is the canonical way to exercise `/api/*` routes; `npm run dev` only serves the Vite client (unauthenticated calls to `/api/*` return 404 in plain Vite).

---

## 13. Known debt / explicit non-goals

Agents: **do not build these unless the user asks.**

- **Mock-interview marketplace** — consultant profiles, booking, payments. The landing page now teases this section as **Coming Soon** (no consultant cards, no booking CTA) so we don't promise something we haven't built. The announcement bar and the `feat6` toolkit card still mention mock interviews as part of the value prop; soften further if/when product positioning calls for it. Separate product scope.
- **OAuth providers** — Supabase Auth is wired for email/password only.
- **Unit / integration tests** — no test harness exists. Don't invent one without asking.
- **Code-splitting** — the bundle is ~1.7MB. Vite warns about it; acceptable for now.
- **Legacy `applications` table** — exists in schema, unused by current code. Do not write to it; use `generated_resumes`.
- **Languages / References in ProfileSetupScreen and ProfileScreen** — currently only wired into the BuilderScreen flow (and loaded from the profile sub-tables when prefilling). To capture in the master profile too, add: state vars + step entries in `ProfileSetupScreen.tsx`, save cases in its switch, and tab + section component in `ProfileScreen.tsx` (mirror `PublicationSection`).
- **AI output in Bengali** — the UI translates (en/bn), but the AI-generated resume bullets, cover letter, outreach email, LinkedIn note, and interview Q&A still come back in English. Most BD recruiters expect English CVs, so this is intentional. Adding a per-document "Generate in: English / বাংলা" toggle would mean: branching prompts in `prompts/resumeOptimizerPrompts.ts` and each toolkit generator + a UI affordance + a prompt-language pass-through in the optimize flow. Don't ship without an explicit ask.
- **Locale persistence to Supabase** — locale is currently `localStorage`-only. Cross-device sync would need a `preferred_locale` column on `profiles` + a fetch on sign-in. Skipped for v1 because device-local is enough for a Bangladesh-first launch.
- **Flutter SMS-watcher app** for bKash purchase confirmation. Server-side endpoint `/api/confirm-purchase` is implemented and HMAC-gated; the matching client (a small Flutter app the owner runs on their bKash-receiving phone) is not yet built. The app needs to: (1) request the SMS-receive permission, (2) parse incoming bKash money-received SMS for `transactionId`, `senderMsisdn`, `amountTaka`, (3) HMAC-SHA256-sign the JSON body with `BKASH_WEBHOOK_SECRET`, (4) POST to `/api/confirm-purchase` with `X-Bkash-Webhook-Signature` header, (5) retry with exponential backoff on 5xx, never on 4xx, (6) persist locally so a flaky network doesn't replay confirmed SMS. Until this app is built, pending purchases sit in the `purchases` table and the owner has to be granted credits manually (`select confirm_purchase('<txn id>');` from the Supabase SQL editor under service-role).

- **Dev mock-confirm scaffolding** — `api/dev-mock-confirm.ts` + the `mockConfirm()` auto-trigger inside `PurchaseModal.tsx`. These exist solely so the buy → pending → credits flow can be exercised end-to-end during development before the Flutter app is built. Gated by `VITE_BKASH_MOCK_AUTOCONFIRM=true` (client) + `BKASH_MOCK_AUTOCONFIRM=true` (server). **Delete the endpoint file, the modal's `mockConfirm` block, the two env vars, and the matching `purchaseModal.mockBadge` / `verifying` / `confirmedToast` locale strings once the Flutter app is shipping confirmations.**

- **`refund_toolkit_credit()` is user-callable** and increments by 1 unconditionally. Same shape of exploit as the now-closed direct-UPDATE: a signed-in user can call `await supabase.rpc('refund_toolkit_credit')` from any browser console and self-grant 1 credit per call. The current `consume_toolkit_credit` / `refund_toolkit_credit` design assumes only `/api/optimize` calls them, but the EXECUTE privilege is wide-open to the `authenticated` role. Fix path: refactor `/api/optimize` to use `SUPABASE_SERVICE_ROLE_KEY` for the consume/refund calls, then `revoke execute on function consume_toolkit_credit, refund_toolkit_credit from authenticated, anon`. Same model the bKash flow already uses for `confirm_purchase`.

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
