// Shared prompt + validation logic for the resume optimizer.
//
// Used by GeminiResumeOptimizer, which passes OPTIMIZER_SCHEMA (below) as
// `responseJsonSchema` AND embeds the shape spec in the user prompt via
// buildUserPrompt(data, { embedSchemaSpec: true }). Both are needed: a JSON
// schema cannot express "echo back exactly these input IDs", so the prompt
// states it and validateOptimizedResponse() is the final gate.
//
// Keeping all prompt text + validation here — rather than in the generator —
// is what let the provider swap from Groq/OpenRouter to direct Gemini without
// touching a single rule. The rules are the product; the SDK is not.

import { detectFabricatedTokens } from './toolkitContext.js';
import { ResumeData, OptimizedResumeData } from '../../../domain/entities/Resume.js';

// ────────────────────────────────────────────────
// 🔐 SYSTEM INSTRUCTION
// ────────────────────────────────────────────────
//
// Slimmed from ~3K tokens to ~1.2K. Optimizing for free-tier TPM (Groq's
// 12K/min ceiling is the binding constraint). Removed: prose framing,
// industry-specific verb banks (model knows them), redundant pre-emit
// checklist (rules already cover it), repeated emphasis. Kept: every
// concrete rule that empirically changes output behavior.
export function buildSystemInstruction(): string {
  return `You are a senior ATS-optimization resume writer in JSON mode. Your output passes through three readers, in order: (1) ATS keyword parsers (Workday, Greenhouse, Lever, Taleo, iCIMS, BDJobs); (2) LLM auto-rankers / screeners (Greenhouse Screener, LinkedIn match, Workday auto-rank, custom recruiter agents — these compute semantic match against the JD and rank candidates before a human ever sees them); (3) human recruiters in a 6–10 second scan. Optimize for all three.

YOUR STANDARD: this is the candidate's first and only impression, and for most applications it is the entire basis on which they are accepted or rejected. You are not formatting their profile — you are building the case that they are the top candidate for this specific job, out of the two hundred people who applied. A competent-but-unconsidered résumé, where the facts are all correct and nothing is arranged to prove anything, is a failure of this task. Decide what this employer is buying, decide which of this candidate's evidence proves it, and arrange the document so a reader reaches that conclusion in six seconds. RULE 4 is how.

OUTPUT: Valid JSON only. No markdown, code fences, comments, or prose. Match the schema exactly. Preserve every input ID verbatim. Every input item produces a non-empty refinedBullets array.

RULES:

1. KEYWORD MIRRORING — Use exact JD casing ("JavaScript", "Node.js", "Next.js"). Lift multi-word JD phrases verbatim where the candidate's work supports them ("design system", "distributed systems", "WCAG 2.2 AA", "Core Web Vitals", "Infrastructure as Code", "incident response", "on-call rotation", "feature flags", "stakeholder management"). ATS exact-match scoring penalizes synonyms.

1a. NAMES ARE COPIED, NOT REWRITTEN — You are re-typing the candidate's prose, so every proper noun in your output (employer, brand, product, platform, university, tool) must be copied character-for-character from their text or the JD. Do not re-spell a name from memory, do not "correct" one you find unfamiliar, and do not swap in a similar-looking name. This matters most for local and transliterated names ("bKash", "Nagad", "SSLCOMMERZ", "Grameenphone", "BRAC", "Pathao") — ATS exact-match scores a mangled brand at zero, and it is the single most expensive word on the résumé to get wrong. The only change allowed is casing you are certain of; when unsure, reproduce their spelling exactly.

2. ZERO FABRICATION — Never invent metrics, %, $, team sizes, durations, tools, or outcomes. Preserve every number from input verbatim. If no metric exists, write a qualitative impact statement.
   SKILL HONESTY — two different tests, do not confuse them:
   (a) NAMED ASSETS (a specific product, library, framework, platform, brand, employer, certification, licence or degree — "SQLite", "Room", "Kubernetes", "AWS", "Tally", "SAP", "H&M", "CPA", "IELTS"): include ONLY if the candidate NAMED it. Never infer one. If they wrote "local database", the skill is "Local Data Persistence" — NOT "Room" or "SQLite". If they wrote "accounting software", it is not "Tally". If the JD demands a named asset the candidate never named, DO NOT add it, in skills or in bullets. These are checkable facts and a wrong one is caught in the first interview question.
   (b) COMPETENCY LABELS (the industry-standard NAME for work the candidate actually described — "Medication Administration", "Vital Signs Monitoring", "Bank Reconciliation", "Lesson Planning", "Curriculum Development", "REST API Integration", "Production Planning", "Export Documentation"): you SHOULD supply these. Users describe their work in plain language or Banglish — "injection dei", "bank er statement er shathe khata milai", "ki porabo tar plan banai" — and naming that work the way recruiters and ATS systems search for it is your JOB. Omitting it is a failure, not caution.
   For EVERY skill whose EXACT label does not appear verbatim in the candidate's own text, add an entry to 'skillEvidence' with the skill and a VERBATIM quote (2-15 words) from their description that entails it. This includes an asset they DID name but informally — they typed "excel", you write "MS Excel": that is not verbatim, so ground it with their word. When in doubt, add the entry; an ungrounded skill is deleted, a grounded one is never penalised. Quote their exact words, in whatever language they wrote — do not translate, do not paraphrase, do not invent. A skill in (b) with no real quote will be DELETED, so ground everything you claim.
   Bullets: same rule — describe the work in professional terminology, but never name an asset the candidate did not name.

3. BULLETS — Start with a strong past-tense action verb. Present tense is ONLY for ongoing duties in the current role; completed, shipped deliverables keep past tense ("Migrated", "Shipped", "Redesigned") even inside the current role — finished wins must read as finished. Use Led, Owned, Drove, Architected, Built, Designed, Shipped, Launched, Deployed, Refactored, Migrated, Automated, Scaled, Reduced, Increased, Improved, Cut, Accelerated, Established, Standardized, Mentored, Resolved, Eliminated.
   Banned starts (instant reject): "Responsible for", "Worked on", "Helped with/to", "Duties included", "Tasked with", "In charge of", "Assisted with/in", "Involved in", "Participated in", first-person.
   Avoid weak openers (Assisted/Contributed/Utilized/Helped/Worked/Handled) — replace with strong verbs naming the concrete contribution.
   1–2 lines (~14–26 words). Diversify opening verbs within an item — never repeat a verb in the same role's bullets.

4. COMPOSITION — THE RÉSUMÉ IS AN ARGUMENT, NOT AN INVENTORY.

   This is the single most important rule here, and the one most often ignored. A recruiter gives this document six seconds and decides. Everything in it is either advancing the case that this candidate should be interviewed for THIS job, or it is diluting that case. There is no neutral line. Before you order anything, you have already written 'plan' — compose against it.

   THE PURPOSE TEST — every bullet, every skill, every ordering decision answers: "which JD requirement does this prove, and is this the strongest proof I have of it?" A line that fails that test is either cut or moved down. A résumé where the reader can feel the candidate listing everything they have ever touched reads as someone who does not know what matters — which is itself a signal about how they would work.

   BULLET ORDER WITHIN AN ITEM — position 1 is the only line guaranteed to be read. It goes to the strongest PROOF of the JD's top priority, which is frequently NOT the bullet with the biggest number. A 40% latency win is the wrong lead for a JD that hires for ownership and delivery; the migration the candidate owned end-to-end is the right one. After position 1, sequence so the item reads as a coherent claim — scope and ownership before mechanics, outcomes before implementation detail — never as a pile of unrelated tasks. Two bullets that prove the same thing are one bullet's worth of value: keep the stronger, drop the other.

   ITEM ORDER — Experience stays in the candidate's chronological order. Never resequence jobs: recruiters read a career as a timeline and a shuffled one looks like concealment. Projects and extracurriculars carry NO timeline expectation, so order those by strength of case — the item that best proves the JD's top priorities first, weakest last.
   TIE-BREAK, in this order, when two items are close: (1) REAL beats PRACTICE — something shipped to actual users, deployed in production, or delivered to a client outranks a demo, tutorial, coursework or learning build, even when the practice piece name-drops more of the JD's technologies; a recruiter reads a tutorial in the top slot as "this is the best they have". (2) OWNED beats CONTRIBUTED — work the candidate drove end-to-end outranks work they participated in. (3) RECENT beats OLD. Apply these instead of re-deciding from scratch, so the same profile against the same JD does not shuffle between runs.
   THE SAME TIE-BREAK DECIDES THE LEAD BULLET, not just which item comes first. Apply it before you commit an item's bullet order: if any bullet in the item states a DELIVERED OUTCOME — something shipped, launched, published, migrated, released, or handed to real users or a client — that bullet leads. A process or practice line (wrote tests, followed a workflow, attended ceremonies, used a tool) NEVER leads over a delivered outcome, however well it mirrors a JD keyword. Leading a published app with "Wrote unit tests covering the core logic" because the JD mentions TDD, when the next bullet says it reached 5,000 users on the Play Store, keeps the paperwork and buries the proof — shipping to real users IS the quality evidence, and the testing reinforces it from second position. Only when an item genuinely has no delivered outcome does a process bullet lead.

   THE FIRST LINE OF EACH SECTION — Recruiters scan down the left edge and read the first line under each heading. Those first lines, read together and in order, should already make the case on their own. Check them as a set before you finish.

   WHAT TO CUT — Off-JD evidence is not free; it costs the reader's attention and buries the proof that matters. When the candidate has more evidence than budget, cutting the weakest is the job, not a failure. But never cut something the JD asks for just because it is modest — thin proof of a required thing beats strong proof of an irrelevant one.

   Reorder, reword, select and cut. Never invent, and never reorder a fact into implying something that did not happen.

5. SKILLS — Emit BOTH a flat JD-ordered list ("skills") AND a grouped view ("skillCategories").
   The skills block is read in about two seconds and it is scanned, not parsed — so its ORDER is an argument too, exactly as RULE 4 describes. Lead with what this JD hires for. The first 6–8 entries are the ones that actually register: they must be the JD's named requirements that the candidate genuinely has, strongest first. Everything the candidate can honestly claim but this JD never asks about goes at the end, and if it adds nothing to this application it does not need to be there at all — a tight list of proven, relevant skills outranks a long one every time. Never bury a JD-critical skill behind three the JD never mentioned.
   FLAT: Clean, deduped (case-insensitive). JD-matched FIRST in JD casing, then remainder. Canonical forms ("CI/CD", "REST API", "PostgreSQL"). 1–3 words each.
   LENGTH — aim for 12–20 entries. Past roughly twenty the section stops being read and starts being skimmed for the ones the reader came for, so every extra entry makes the important ones harder to find. If you are over, the cuts come off the tail (the things this JD never asks about), never off the JD-matched head.
   NO SOFT SKILLS — this is absolute and it is where this list usually goes wrong. "Team Leadership", "Event Coordination", "Communication", "Problem Solving", "Time Management", "Adaptability", "Attention to Detail" and their relatives do not belong in a skills list in any field. They are unfalsifiable, every applicant claims them, and a recruiter reads them as filler that dilutes the real entries around them. Leadership is proved by a bullet that says what was led, not by the word. Watch especially for these arriving from an extracurricular or a club role that has nothing to do with the target job — that is the most common source, and such an item contributing zero skills to this list is the correct outcome, not an omission.
   PLATFORM/DOMAIN: when the candidate's evidence (canonicalBullets, normalized skills, or raw description) establishes a platform or domain the JD targets — e.g. iOS, Android, Data Engineering, Fintech — surface that exact platform/domain term in the flat list and its bucket (Domain, or Tools & Platforms). It is proven by the concrete stack (Swift/SwiftUI/Objective-C ⇒ iOS), not a new claim, so do NOT drop it as unmatched.
   CATEGORIES: Group the same items into role-appropriate buckets so a recruiter scanning by topic finds them fast. Pick category names from this taxonomy where they fit, but use only the categories the candidate actually has items for — never fabricate empty buckets:
     • Languages — EVERY programming language the candidate has, with no exceptions and nothing else filed elsewhere: Swift, Kotlin, Dart, Python, TypeScript, Java, C#, Go, SQL, Objective-C. A language is not a "tool" or a "platform" — Swift under Tools & Platforms is a filing error a technical reader notices immediately. Spoken languages go here too, but only when the profile actually lists proficiencies.
     • Frameworks & Libraries
     • Tools & Platforms
     • Cloud & Infrastructure
     • Databases
     • Testing & Quality
     • Methodologies (Agile, Scrum, Code Review, etc.)
     • Domain (industry / vertical knowledge — e.g. "Payment Systems", "B2B SaaS")
   For non-tech fields, substitute fitting category names ("Clinical Skills", "Research Methods", "Design Tools", "Legal Domains"). Every item in "skillCategories" MUST also exist in the flat "skills" array (categories regroup; they don't introduce new skills). Order categories so the JD-most-relevant bucket is first. Within a bucket, JD-matched items first.
   FILE EACH SKILL ONCE, IN THE RIGHT BUCKET. A skill appears in exactly ONE category — the same item under two headings reads as padding in the one section a recruiter scans for substance ("AWS" under both Tools & Platforms and Cloud & Infrastructure is a defect, not thoroughness). And "Methodologies" means WAYS OF WORKING — Agile, Scrum, TDD, Code Review, CI/CD as a practice. It is not the leftovers drawer: a technology, protocol or interface style belongs in a technical bucket ("REST API" is Frameworks & Libraries or Tools & Platforms, never a methodology), and a capability label like "Debugging", "Legacy Code Migration" or "Cross-Platform Mobile Development" belongs under Domain or a field-appropriate competency heading. If an item does not clearly fit any bucket you have opened, it is usually a sign the flat list should not carry it either.

6. SUMMARY — 2–4 sentences, ~50–90 words, no first-person, no clichés.
   GOAL: a positioning statement that earns the recruiter's next 5 seconds AND scores high on LLM auto-rankers. Recruiters read 200+ resumes for one role; LLMs rank them. The summary is what differentiates this candidate from the rest of the applicant pool — NOT a recap of their bullets.

   STRUCTURE — use only what the input supports; no fixed sentence count:
   a. POSITIONING (mandatory; opens the summary). Role + tenure + 1–2 JD-aligned focus areas, lifted from the JD's language. Use the candidate's actual field (engineer, nurse, marketer, attorney, designer, teacher).
      Good: "Senior backend engineer specializing in payment infrastructure and event-driven systems."
      Good: "Marketing manager with 7 years scaling B2B SaaS demand-gen and product-led growth."
      Good: "CS graduate (May 2025) focused on developer tooling and backend systems."
   b. SCOPE / PATTERN (optional). One thematic sentence on the *shape* of the candidate's work — domain breadth, recurring problem-types, or aggregate scale — synthesized across roles. NEVER lift a single bullet's metric.
      Bad (rehashes a bullet): "Reduced p95 latency by 40% on the orders service."
      Good (theme): "Repeatedly trusted with platform migrations and ambiguous reliability work."
      Good (domain): "Five years across fintech and healthtech SaaS, from seed-stage startups to listed enterprises."
   c. STACK FLUENCY (mandatory if relevant). 4–6 JD-aligned hard-skill terms WOVEN into a sentence — never a comma-separated list.
      Bad: "Skilled in React, Node.js, TypeScript, AWS, PostgreSQL, and CI/CD."
      Good: "Hands-on with React + TypeScript on the front and Node.js + PostgreSQL on the back, comfortable owning CI/CD on AWS."

   NO DANGLING -ING OPENERS. A summary sentence must not begin with a bare present participle that never attaches to a subject: "Independently owning complex module migrations, debugging deep race conditions, and participating in agile delivery workflows." — the reader waits for a subject that never arrives, and it is the most common grammatical defect in AI-written summaries. Rewrite it with a subject and a tensed verb, or fold the clause into the sentence before it.
   This is NOT a demand for textbook full sentences. The established résumé register is elliptical and correct: an opening noun phrase ("Software engineer with 3.5 years…"), "Demonstrated ability to…", "Repeatedly trusted with…", "Hands-on with…" are all good and are exactly what STRUCTURE (a)–(c) above asks for. Keep writing those. The ban is on the -ing opener specifically.

   HARD BANS (instant reject, applies to every output):
   - METRIC DUPLICATION — Do not lift any specific number, %, $, or metric-bearing outcome that appears in any refined bullet. The same number in summary AND a bullet flags as filler in both human and AI screens. Tenure ("7 years"), generic scope ("multi-region", "cross-team"), and aggregate counts that summarise across roles are fine. You MAY name the candidate's single most JD-relevant proof point (a named migration, module, system, or product) WITHOUT its metric — one concrete noun in the summary is differentiation, not filler; just never repeat its number.
   - CLICHÉS — "results-driven", "passionate", "team player", "go-getter", "innovative", "proven track record", "dynamic", "self-starter", "synergy", "value-add", "thought leader", "highly motivated", "detail-oriented", "strong communication skills".
   - VAGUE HEDGES — "various", "diverse", "multiple", "extensive", "wide range".
   - GENERIC OPENERS — Do not begin with "Highly", "Experienced", "Skilled" + adjective. Lead with role + specifics.

   Students / entry-level: a. degree + field + graduation year + 1–2 JD-aligned focus areas; b. internships, coursework themes, or major project patterns (synthesized, not bullet-rehashed); c. stack the candidate can actually demonstrate.

7. PROJECTS — Integrate listed "technologies" naturally. If empty, no inventing.
   KEEP PROVENANCE. When the evidence says an item was a learning exercise, demo, side project, coursework, thesis, bootcamp, freelance or volunteer work, that word is a FACT and it survives into the output ("demo e-commerce application", "personal Flutter app", "university thesis project"). Do not quietly upgrade it into professional delivery by dropping the qualifier — a side project written to read like production work is the most common way a strong-looking résumé collapses, because the recruiter asks one follow-up question and the whole document loses credibility with it. A well-built personal project is genuinely good evidence; it just has to be labelled as what it is. Never move the other way either: real professional work must not be described as though it were a side project.

8. BULLET COUNT — Match signal density: rich (3+ accomplishments) → 4–5 bullets, moderate → 3–4, thin → 2–3. Never pad.

9. SENIORITY ALIGNMENT — Match tone, scope language, and verb choice to the candidate's actual seniority (provided as SENIORITY in the prompt).
   NEVER STATE THE LEVEL. The SENIORITY line is an instruction to you, not a fact about the candidate to publish. A résumé does not label itself: "Mid-level software engineer with…", "Junior developer…", "Senior-level professional…" are all instant credibility damage — levelling is the employer's call, a candidate who pre-assigns their own is either capping themselves or misreading the market, and no strong résumé in any field does it. Open with the ROLE and the specifics ("Software engineer with 3.5 years building…", "Backend engineer specializing in payment infrastructure"). Bare tenure is fine; the bucket word is not. This applies to the summary and to every bullet. Junior / entry-level: emphasize execution, shipping features, technical foundations, learning velocity, collaboration. Use verbs like Built, Implemented, Shipped, Contributed, Resolved. Avoid claiming architectural ownership or strategy. Mid: emphasize ownership, cross-team collaboration, problem decomposition, architectural contributions. Use Owned, Led, Drove, Designed, Refactored. Senior+: emphasize system design, technical strategy, mentoring, scalability, organizational impact. Use Architected, Established, Scaled, Mentored, Standardized. Never inflate seniority through verb choice. Never DEFLATE evidenced ownership either: when the input or canonicalBullets state the candidate led, owned, or solo-built something, keep that verb regardless of the seniority bucket — the evidence outranks the bucket.`;
}

// ────────────────────────────────────────────────
// 🧠 USER PROMPT
// ────────────────────────────────────────────────
//
// `embedSchemaSpec` controls whether to embed an explicit JSON shape spec in
// the prompt text. Gemini does NOT need this (it gets a `responseSchema`
// alongside the prompt), but OpenAI-compatible providers' JSON mode just
// guarantees valid JSON, not a particular shape — so the shape must live in
// the prompt for those.
export function buildUserPrompt(data: ResumeData, opts: { embedSchemaSpec: boolean } = { embedSchemaSpec: false }): string {
  const totalExperience = calculateTotalExperience(data.experience);
  const isStudent = data.userType === 'student';
  const seniority = inferSeniority(data);

  const cleanExperience = data.experience.map(e => ({
    id: e.id,
    company: e.company,
    role: e.role,
    startDate: e.startDate,
    endDate: e.endDate,
    isCurrent: e.isCurrent,
    description: e.rawDescription,
    // "Polished profile" (normalized once on profile save): pre-cleaned
    // professional bullets derived from the raw description. When present,
    // the NOTE in the prompt tells the model to use them as primary
    // evidence — stabler output than re-interpreting Banglish per generation.
    ...(e.normalized?.bullets?.length ? { canonicalBullets: e.normalized.bullets } : {}),
    // Normalizer-surfaced competencies ("Native iOS Development") — the
    // pre-computed platform/domain signal RULE 5 tells the model to use.
    ...(e.normalized?.skills?.length ? { canonicalSkills: e.normalized.skills } : {}),
  }));

  const cleanProjects = data.projects.map(p => ({
    id: p.id,
    name: p.name,
    description: p.rawDescription,
    technologies: p.technologies,
    link: p.link,
    ...(p.normalized?.bullets?.length ? { canonicalBullets: p.normalized.bullets } : {}),
    ...(p.normalized?.skills?.length ? { canonicalSkills: p.normalized.skills } : {}),
  }));

  const cleanExtracurriculars = (data.extracurriculars || []).map(e => ({
    id: e.id,
    title: e.title,
    organization: e.organization,
    startDate: e.startDate,
    endDate: e.endDate,
    description: e.description,
    ...(e.normalized?.bullets?.length ? { canonicalBullets: e.normalized.bullets } : {}),
    ...(e.normalized?.skills?.length ? { canonicalSkills: e.normalized.skills } : {}),
  }));

  const hasCanonical =
    cleanExperience.some(e => 'canonicalBullets' in e) ||
    cleanProjects.some(p => 'canonicalBullets' in p) ||
    cleanExtracurriculars.some(e => 'canonicalBullets' in e);

  const schemaSpec = opts.embedSchemaSpec ? buildSchemaSpec(data) : '';

  // Compact JSON (no pretty-printing) saves ~25–30% of the candidate-data
  // tokens. Models read compact JSON just as well as indented JSON.
  return `TARGET JOB
Title: ${data.targetJob.title || 'N/A'}
Company: ${data.targetJob.company || 'N/A'}
Description:
${data.targetJob.description}

CANDIDATE
Type: ${isStudent ? 'Student / Entry-level' : 'Experienced Professional'}
Total experience: ${totalExperience}
SENIORITY: ${seniority} — INTERNAL CALIBRATION INPUT, NOT RÉSUMÉ CONTENT. It tunes verb choice, ownership claims and scope language (see RULE 9). This bucket label must never appear in any field you emit.
Skills (input): ${data.skills.join(', ') || '(none)'}

${hasCanonical ? 'NOTE: items below with "canonicalBullets" carry a pre-cleaned professional rendering of their raw description — often MORE bullets than your output budget. Treat canonicalBullets as the PRIMARY evidence and the raw description as backup detail. Your job is to SELECT: keep the most JD-relevant subset within the RULE 8 bullet budget and DROP the off-JD rest — never blend two distinct projects or artifacts into one vague line. You MAY merge two canonical facts about the SAME artifact into one denser bullet when that preserves both specifics. Still reorder, reword, and emphasize for THIS JD.\n\n' : ''}EXPERIENCE (${cleanExperience.length} items — each MUST produce refinedBullets):
${JSON.stringify(cleanExperience)}

PROJECTS (${cleanProjects.length} items — each MUST produce refinedBullets):
${JSON.stringify(cleanProjects)}

EXTRACURRICULARS (${cleanExtracurriculars.length} items — each MUST produce refinedBullets):
${JSON.stringify(cleanExtracurriculars)}

EDUCATION:
${JSON.stringify(data.education)}
${data.certifications?.length ? `CERTIFICATIONS: ${data.certifications.map(c => c.issuer ? `${c.name} — ${c.issuer}` : c.name).join('; ')}\n` : ''}${data.languages?.length ? `LANGUAGES: ${data.languages.filter(l => l.name).map(l => `${l.name} (${l.proficiency})`).join(', ')}\n` : ''}

TASK

0. plan — WRITE THIS FIRST, BEFORE ANY RÉSUMÉ CONTENT. Do not skip it and do not backfill it to match a résumé you have already written; it exists to decide the résumé, and the quality of everything below depends on it. Keep every entry short — these are working notes, not prose.
   - jdPriorities: 3–5 entries, ranked most-decisive first. What is this employer ACTUALLY hiring for? Read past the boilerplate: the responsibilities and competencies sections usually say more than the bullet list of technologies. Rank by what would get someone rejected if it were missing.
   - proofMap: one entry per priority, in the same order — the candidate's single strongest concrete proof of it, naming the item it comes from ("independent delivery of moderate-complexity work → Ecommerce app: owned the checkout rewrite solo"). If nothing in the profile proves a priority, say so plainly ("no proof"). This mapping is what tells you which bullet leads each item.
   - weakSpots: what this JD wants that the evidence does NOT support. These get de-emphasised — never fabricated, never padded around.
   - thesis: ONE sentence, ≤30 words. The case: why this candidate, for this job. Everything you write afterwards should be recognisably serving this sentence.
   - orderPlan: 2–5 short decisions about sequence and why, covering the lead bullet of the strongest item, the order of projects, and what you are cutting or demoting. Name the reader effect, not the mechanic — "leads with the legacy-modernisation work because the JD's #1 is navigating existing systems", not "moved bullet 3 up".

1. summary — Per the SUMMARY rule. It must read as the thesis, evidenced. SYNTHESIS, not duplication: surface the *pattern* across roles, never restate a single bullet. Aim for differentiation — what about this candidate would make a recruiter (or an LLM ranker) move them past the first cut for THIS specific JD? If the only metric available is a single bullet's number, do NOT use it in the summary; rely on tenure, domain, and stack instead.
2. skills — Ordered per RULE 5: the JD's own priorities first, in JD casing, then the rest. Apply RULE 2 SKILL HONESTY: name the candidate's described work in industry-standard terms (competency labels), but never infer a specific product/tool/certification they did not name.
2b. skillEvidence — for each skill whose label is not literally in the candidate's text, {skill, quote} where quote is 5-15 words copied VERBATIM from their description (their language, not translated). Ungrounded skills are deleted.
3. experience — Build each item's refinedBullets from its canonicalBullets (fall back to "description" when absent): SELECT the most JD-relevant subset, preserve every number. Order the bullets per RULE 4 — the lead bullet is the strongest PROOF of the priority this item is carrying in your proofMap, not the biggest number. Keep the items in the order given (chronology). Strong verbs only.
4. projects — Same rules, but these have no timeline to respect: order the items themselves strongest-case-first per RULE 4.
5. extracurriculars — Same as projects.

FINAL CHECK before you emit — read back the first bullet of every item plus the first 8 skills, in order, as one list. Does that list alone make the case in your thesis? If a line in it is doing nothing for this application, it is in the wrong place or should not be there.${schemaSpec}`;
}

// Used only when the provider's JSON mode does not natively enforce a schema
// (Groq, Cerebras, OpenAI-compat). Gemini gets the schema via responseSchema.
function buildSchemaSpec(data: ResumeData): string {
  const expIds = data.experience.map(e => `"${e.id}"`).join(', ') || '(none)';
  const projIds = data.projects.map(p => `"${p.id}"`).join(', ') || '(none)';
  const extraIds = (data.extracurriculars || []).map(e => `"${e.id}"`).join(', ') || '(none)';

  return `
═══════════════════════════════════════════════
REQUIRED OUTPUT JSON SHAPE (return EXACTLY this shape)
═══════════════════════════════════════════════
{
  // FIRST key, always — TASK step 0. Decide the case here, then write the
  // résumé below to serve it. Working notes, kept short.
  "plan": {
    "jdPriorities": ["string", ...],   // 3–5, ranked most-decisive first
    "proofMap": ["string", ...],       // one per priority, same order
    "weakSpots": ["string", ...],      // may be empty
    "thesis": "string — one sentence, ≤30 words",
    "orderPlan": ["string", ...]       // 2–5 sequencing decisions + why
  },
  "summary": "string — 3–4 sentences",
  "skills": ["string", "string", ...],
  "skillEvidence": [
    { "skill": "string", "quote": "string" }
    // one per skill whose label is not literally in the candidate's own text
  ],
  "skillCategories": [
    { "category": "string", "items": ["string", ...] }
    // optional but strongly preferred when ≥4 distinct skills exist;
    // every item here must also appear in the flat skills array above
  ],
  "experience": [
    { "id": "<input id>", "refinedBullets": ["string", ...] }
    // one entry per input experience, in input order; ids: ${expIds}
  ],
  "projects": [
    { "id": "<input id>", "refinedBullets": ["string", ...] }
    // ids: ${projIds}
  ],
  "extracurriculars": [
    { "id": "<input id>", "refinedBullets": ["string", ...] }
    // ids: ${extraIds}
  ]
}

ID PRESERVATION: every id above must appear EXACTLY once in the corresponding output array, in the same casing.
Empty arrays ARE allowed when there were zero input items in that section.`;
}

// ────────────────────────────────────────────────
// 🧼 BANNED-CLICHÉ STRIP (summary post-pipeline)
// ────────────────────────────────────────────────
//
// The system prompt's RULE 6 lists hard-banned summary clichés ("results-driven",
// "passionate", "team player", "proven track record", …). Empirically, providers
// (especially Groq) slip these through anyway — the live audit (2026-05-08) saw
// "Proven track record" land in 3/3 persona summaries. This deterministic
// post-step rewrites the offending phrases. Pure regex; no model call.
//
// Strategy: replace the cliché with a tighter (but still neutral) substitute,
// or delete it outright when the surrounding sentence reads fine without it.
// We keep the rewrites conservative — leaving slightly awkward prose is fine;
// what isn't fine is shipping a banned phrase. Cleanup steps at the end fix
// double spaces, dangling commas, and lowercase sentence starts caused by
// deletion.
const BANNED_CLICHE_PATTERNS: Array<[RegExp, string]> = [
  // Most common — drop "of/in/for" connector if present so sentence still flows.
  [/\bproven track record of\s+/gi, ''],
  [/\bproven track record in\s+/gi, ''],
  [/\bproven track record\b/gi, 'consistent record'],
  [/\bresults-driven\s+/gi, ''],
  [/\bpassionate about\s+/gi, 'focused on '],
  [/\bpassionate\s+/gi, ''],
  [/\bteam player\b/gi, 'collaborative contributor'],
  [/\bgo-getter\b/gi, ''],
  [/\binnovative\s+/gi, ''],
  // "dynamic" is banned as a persona adjective ("dynamic professional") but
  // legitimate as a technical modifier — don't mangle "dynamic pricing",
  // "dynamic programming", etc.
  [/\bdynamic\s+(?!pricing|programming|routing|content|linking|analysis|dashboards?\b)/gi, ''],
  [/\bself-starter\b/gi, ''],
  [/\bsynergy\b/gi, ''],
  [/\bvalue-add\b/gi, ''],
  [/\bthought leader\b/gi, 'practitioner'],
  [/\bhighly motivated\s+/gi, ''],
  [/\bdetail-oriented\s+/gi, ''],
  [/\bstrong communication skills\b/gi, 'clear written and spoken communication'],
];

export function stripBannedCliches(parsed: OptimizedResumeData): void {
  if (typeof parsed.summary !== 'string' || !parsed.summary) return;
  let s = parsed.summary;
  for (const [re, repl] of BANNED_CLICHE_PATTERNS) {
    s = s.replace(re, repl);
  }
  // Cleanup pass — collapse internal double spaces, fix " ." / " ," artifacts,
  // re-capitalize sentence starts that lost their leading word, trim.
  s = s.replace(/\s{2,}/g, ' ')
       .replace(/\s+([.,;:!?])/g, '$1')
       .replace(/(^|\.\s+)([a-z])/g, (_, pre, ch) => pre + ch.toUpperCase())
       .trim();
  parsed.summary = s;
}

// ────────────────────────────────────────────────
// 🛡 RESPONSE VALIDATION
// ────────────────────────────────────────────────
export function validateOptimizedResponse(input: ResumeData, output: OptimizedResumeData): void {
  if (!output.summary || !output.skills) {
    throw new Error('Missing required fields in AI response');
  }
  validateArrayCounts(input.experience, output.experience, 'experience');
  validateArrayCounts(input.projects, output.projects, 'projects');
  validateArrayCounts(input.extracurriculars, output.extracurriculars, 'extracurriculars');
}

// Validate by ID SET, not by position. The post-pipeline reorders output items
// (reorderProjectsByJDFit moves the most JD-relevant project to the top), and
// mergeOptimizedData() pairs optimized items back to input BY ID
// (`find(e => e.id === item.id)`) — order is irrelevant downstream. A positional
// check here was therefore both wrong and inconsistent with how the data is
// used: a model returning the right items in a different order (which Gemini
// legitimately does) tripped a spurious "ID mismatch in <field>". We only need
// to guarantee that every input item is represented exactly once with non-empty
// bullets, regardless of order.
function validateArrayCounts(
  inputArray: { id: string }[] | undefined,
  outputArray: { id: string; refinedBullets: string[] }[] | undefined,
  field: string
): void {
  if (!inputArray?.length) return;

  if (!outputArray || inputArray.length !== outputArray.length) {
    throw new Error(`AI did not return correct ${field} count`);
  }

  const byId = new Map<string, { id: string; refinedBullets: string[] }>();
  for (const out of outputArray) {
    if (!out || typeof out.id !== 'string') throw new Error(`Malformed item in ${field}`);
    if (byId.has(out.id)) throw new Error(`Duplicate ID in ${field}: ${out.id}`);
    byId.set(out.id, out);
  }

  for (const item of inputArray) {
    const out = byId.get(item.id);
    if (!out) throw new Error(`ID mismatch in ${field}`);
    if (!out.refinedBullets || out.refinedBullets.length === 0) {
      throw new Error(`Empty bullets in ${field} ${item.id}`);
    }
  }
}

// ────────────────────────────────────────────────
// 🧹 SKILLS NORMALIZATION
// ────────────────────────────────────────────────
//
// Safety net in case the model returns duplicate casings ("React"/"react") or
// surrounding whitespace. Preserves first-seen casing (which reflects the
// model's JD-ordered priority) while removing later case-only duplicates.
export function normalizeSkills(parsed: OptimizedResumeData): void {
  if (parsed?.skills && Array.isArray(parsed.skills)) {
    parsed.skills = dedupeStringList(parsed.skills);
  }

  if (parsed?.skillCategories && Array.isArray(parsed.skillCategories)) {
    const seenCat = new Set<string>();
    // Cross-bucket dedupe. Deduping only WITHIN a bucket let the same skill be
    // filed twice under different headings — measured 2026-08-11, a live run
    // shipped "AWS" in both "Tools & Platforms" and "Cloud & Infrastructure".
    // To a recruiter that reads as padding in the one section they scan for
    // substance. First bucket wins, which preserves the model's own priority
    // ordering (RULE 5 puts the JD-most-relevant category first, so the first
    // home for a skill is the one it was most deliberately placed in).
    const seenItem = new Set<string>();
    parsed.skillCategories = parsed.skillCategories
      .map(cat => {
        if (!cat || typeof cat.category !== 'string') return null;
        const name = cat.category.trim();
        if (!name) return null;
        const key = name.toLowerCase();
        if (seenCat.has(key)) return null;
        seenCat.add(key);
        const items = (Array.isArray(cat.items) ? dedupeStringList(cat.items) : [])
          .filter(item => {
            const ik = item.toLowerCase();
            if (seenItem.has(ik)) return false;
            seenItem.add(ik);
            return true;
          });
        // A bucket emptied by the cross-bucket pass is dropped along with the
        // ones that arrived empty.
        if (items.length === 0) return null;
        return { category: name, items };
      })
      .filter((c): c is { category: string; items: string[] } => c !== null);
  }
}

function dedupeStringList(list: unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

// ────────────────────────────────────────────────
// 🛡 SKILL FABRICATION FILTER
// ────────────────────────────────────────────────
//
// The system prompt forbids skill fabrication, but models — especially
// JD-eager ones — still slip in JD-required tools the candidate never
// evidenced. This is the most damaging failure mode: a recruiter who catches
// one fake skill rejects on the spot. So we strip programmatically as a
// belt-and-braces step, not just rely on the model.
//
// Evidence corpus = candidate's input skills + experience descriptions +
// project descriptions + project technologies + education fields +
// certification names. Substring match (lowercased). Keeps everything that
// appears in any of those; drops the rest.
/**
 * One model-supplied grounding: an industry-standard skill label plus the
 * candidate's OWN words that entail it. Transient — stripped before the response
 * leaves this module, never persisted or rendered.
 */
export interface SkillGrounding {
  skill: string;
  quote: string;
}

/**
 * The model's pre-writing deliberation. Emitted as the first field of the
 * response so everything after it is written against a decided case — see
 * PLAN_SCHEMA. Internal: logged for debugging, then stripped.
 */
export interface OptimizerPlan {
  /** What THIS JD actually hires for, ranked most-decisive first. */
  jdPriorities: string[];
  /** Each priority mapped to the candidate's strongest concrete proof. */
  proofMap: string[];
  /** Where the evidence is thin — de-emphasised, never fabricated. */
  weakSpots: string[];
  /** One sentence: why this candidate, for this job. */
  thesis: string;
  /** The ordering calls made, and what each one is doing for the reader. */
  orderPlan: string[];
}

type OptimizerRawResponse = OptimizedResumeData & {
  skillEvidence?: SkillGrounding[];
  plan?: OptimizerPlan;
};

/**
 * Take the plan off the response and return it.
 *
 * The plan is scaffolding for generation, not résumé content: it must never
 * reach the renderer, the exporters, or Supabase. Call this once, right after
 * the response validates.
 */
export function takeOptimizerPlan(parsed: OptimizedResumeData): OptimizerPlan | null {
  const raw = parsed as OptimizerRawResponse;
  const plan = raw.plan ?? null;
  delete raw.plan;
  return plan;
}

/**
 * Normalize for quote verification: lowercase, collapse whitespace, drop
 * punctuation. The model re-types the quote rather than copying bytes, so it
 * commonly differs in a comma or spacing from the original.
 */
function forQuoteMatch(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Is a model-supplied quote really the candidate's own words?
 *
 * Verified as a substring of the evidence corpus, so the model cannot invent a
 * premise. Requires ≥3 significant words so a quote like "the" can't ground
 * anything. Works in any language — the candidate's Banglish
 * ("injection dei, saline lagai") is as valid a premise as English.
 */
function quoteIsReal(quote: string, evidenceNorm: string): boolean {
  if (typeof quote !== 'string') return false;
  const q = forQuoteMatch(quote);
  // Two words and 10 characters, NOT three words. Banglish is dense: "injection
  // dei" (I give injections) and "saline lagai" (I put up saline drips) are two
  // words each and are complete, unambiguous premises for "Medication
  // Administration" and "IV Therapy". A three-word floor measured as an
  // English-language assumption that silently deleted correct nursing skills off
  // a Bengali speaker's résumé. The character floor is what stops a junk quote
  // ("ar o", "kaj kori") from grounding anything.
  const words = q.split(' ').filter((w) => w.length >= 2);
  if (words.length < 2 || q.length < 10) return false;
  return evidenceNorm.includes(q);
}

/**
 * Does this skill label name a specific ASSET the candidate never named?
 *
 * The line that matters. There are two different kinds of thing in a skills list
 * and the old filter treated them identically:
 *
 *   • A NAMED ASSET is a checkable fact — a product, library, brand, employer or
 *     credential ("SQLite", "Room", "Kubernetes", "AWS Certified", "H&M"). You
 *     either used it or you didn't. Claiming one the candidate never named is
 *     fabrication, and no amount of entailment fixes that: a candidate who wrote
 *     "local database e save kore rakhi" did use SOME local store, but naming
 *     Room specifically is a guess that collapses in the first interview
 *     question.
 *
 *   • A COMPETENCY LABEL is the industry-standard NAME for work that was
 *     described ("Medication Administration", "Bank Reconciliation", "Lesson
 *     Planning", "Production Planning", "REST API integration"). It is not an
 *     asset you possess; it is what the described activity is CALLED. Requiring
 *     the label itself to appear in the evidence is backwards — the candidate
 *     wrote "injection dei", and supplying "Medication Administration" is exactly
 *     the translation this product exists to perform.
 *
 * Only the first kind needs literal evidence. Reuses detectFabricatedTokens so
 * the asset dictionary has one definition shared with the toolkit guards.
 */
// English builds competency nouns with a small set of suffixes ("Reconciliation",
// "Merchandising", "Procurement", "Preceptorship", "Compliance", "Mathematics").
// Product and brand names essentially never carry them: Tally, SAP, Kubernetes,
// Figma, Kotlin, Epic, Primavera. That asymmetry is what lets a single-token skill
// be classified without a dictionary of every product on earth.
const COMPETENCY_SUFFIXES = /(?:ing|ment|tion|sion|ity|ance|ence|ship|ery|ics|ology|ism|ure|age|al|cy)$/i;

// Single-token competency nouns that carry no such suffix. Short and stable by
// design — the escape hatch for the suffix rule, not a second dictionary.
const COMMON_COMPETENCY_WORDS = new Set([
  'sales', 'tax', 'audit', 'design', 'research', 'payroll', 'budget', 'finance',
  'logistics', 'procurement', 'inventory', 'quality', 'safety', 'hygiene',
  'compliance', 'outreach', 'fundraising', 'copywriting', 'bookkeeping',
  'nursing', 'teaching', 'tutoring', 'catering', 'retail', 'wholesale',
  'export', 'import', 'costing', 'pricing', 'invoicing', 'dispatch',
  'welding', 'plumbing', 'masonry', 'tailoring', 'embroidery', 'cutting',
  'triage', 'phlebotomy', 'radiology', 'pharmacy', 'physiotherapy',
]);

/**
 * Does this skill label name a specific ASSET the candidate never named?
 *
 * The line that matters. There are two different kinds of thing in a skills list
 * and the old filter treated them identically:
 *
 *   • A NAMED ASSET is a checkable fact — a product, library, brand, employer or
 *     credential ("SQLite", "Room", "Kubernetes", "Tally", "SAP", "AWS Certified",
 *     "H&M"). You either used it or you didn't. Claiming one the candidate never
 *     named is fabrication, and no amount of entailment fixes it: a candidate who
 *     wrote "local database e save kore rakhi" did use SOME local store, but
 *     naming Room specifically is a guess that collapses on the first interview
 *     question. This is the dishonesty that actually costs someone the job.
 *
 *   • A COMPETENCY LABEL is the industry-standard NAME for work that WAS
 *     described ("Medication Administration", "Bank Reconciliation", "Lesson
 *     Planning", "Production Planning", "REST API Integration"). It is not an
 *     asset you possess; it is what the described activity is CALLED. Requiring
 *     the label itself to appear in the evidence was backwards — the candidate
 *     wrote "injection dei", and supplying "Medication Administration" is exactly
 *     the translation this product exists to perform.
 *
 * Three tests, cheapest first. Deliberately NOT dictionary-only: the shared
 * FABRICATION_TOKEN_DICTIONARY is tech-centric, so it blocks Kubernetes but sails
 * past Tally and SAP — which would have quietly re-created the whole problem for
 * every non-tech user, the exact blind spot this rework exists to remove.
 */
function namesUnevidencedAsset(skill: string, evidence: string): boolean {
  // 1. Credentials: verifiable, and claiming one you lack is disqualifying.
  if (/certif|licen|diploma|degree|award|accredit/i.test(skill)) return true;

  // 2. Curated proper nouns (tech tools, brands, employers) absent from evidence.
  if (detectFabricatedTokens(skill, evidence).length > 0) return true;

  // 3. Structural fallback for products no dictionary lists. A one-token label
  //    with no competency morphology, absent from the candidate's own words, is a
  //    product name far more often than a skill. Multi-word labels are exempt:
  //    those are overwhelmingly competency phrases, and any brand token inside one
  //    ("MS Excel", "Adobe Photoshop") is what test 2 is for.
  const tokens = skill.trim().split(/[\s/&,-]+/).filter(Boolean);
  if (tokens.length !== 1) return false;
  const word = tokens[0];
  const lc = word.toLowerCase();
  if (evidence.includes(lc)) return false;
  if (COMMON_COMPETENCY_WORDS.has(lc)) return false;
  if (COMPETENCY_SUFFIXES.test(lc)) return false;
  return true;
}

export function filterFabricatedSkills(
  parsed: OptimizedResumeData,
  candidate: ResumeData
): { kept: string[]; fabricated: string[] } {
  const evidence = buildEvidenceText(candidate).toLowerCase();
  const evidenceNorm = forQuoteMatch(buildEvidenceText(candidate));
  const raw = parsed as OptimizerRawResponse;

  // skill (lowercased) -> the candidate's own words the model says entail it.
  const groundings = new Map<string, string>();
  for (const g of raw.skillEvidence ?? []) {
    if (g && typeof g.skill === 'string' && typeof g.quote === 'string') {
      groundings.set(g.skill.trim().toLowerCase(), g.quote);
    }
  }

  const kept: string[] = [];
  const fabricated: string[] = [];
  const inferred: string[] = [];
  for (const skill of parsed.skills ?? []) {
    if (typeof skill !== 'string') continue;
    const trimmed = skill.trim();
    if (!trimmed) continue;

    // Fast path: the label itself is in the evidence.
    if (skillEvidenced(trimmed, evidence)) { kept.push(trimmed); continue; }

    // THE ONLY HARD BLOCK: a checkable asset the candidate never named.
    //
    // The default here is deliberately "keep", which is the reverse of the
    // original filter, and the reversal is the whole point. Measured across five
    // career fields, requiring proof-of-label deleted 13 skills from a mobile
    // dev, 11 from a nurse, and ALL 8 from an accountant — shipping a résumé with
    // an empty skills section. The bullets already stated the same work, so
    // nothing was made more honest; the deletions only stripped the ATS keywords
    // out of the section ATS weights most heavily.
    //
    // The asymmetry decides it. Deleting a real competency is silent, invisible to
    // the user, and costs them the interview. Keeping a competency label the
    // candidate can defend — "Bank Reconciliation" for someone who wrote "bank er
    // statement er shathe amader khata milai" — costs nothing, because it is a NAME
    // for work they described, not a claim to an asset they lack. Only assets are
    // checkable, and only assets are blocked.
    if (namesUnevidencedAsset(trimmed, evidence)) { fabricated.push(trimmed); continue; }

    kept.push(trimmed);
    // Not a gate any more — telemetry. A grounding proves the model could point at
    // the candidate's own words; its absence means we kept a label on the model's
    // judgement alone. Worth watching, not worth deleting over: the model supplies
    // groundings inconsistently, and gating on them lost 5 legitimate merchandiser
    // skills to a missing array entry.
    const quote = groundings.get(trimmed.toLowerCase());
    if (!quote || !quoteIsReal(quote, evidenceNorm)) inferred.push(trimmed);
  }
  parsed.skills = kept;
  if (inferred.length) {
    console.info(`[optimizer] ${inferred.length} skill(s) kept on inference without a verified quote: ${inferred.join(', ')}`);
  }
  // Transient scaffolding — must never reach ResumeData, the DB, or a renderer.
  delete raw.skillEvidence;

  // Mirror the same filter inside category buckets, then drop any bucket
  // left empty. Categories must stay a strict regrouping of the flat list.
  if (parsed.skillCategories?.length) {
    const keptLower = new Set(kept.map(k => k.toLowerCase()));
    parsed.skillCategories = parsed.skillCategories
      .map(cat => ({
        category: cat.category,
        items: (cat.items ?? []).filter(item =>
          typeof item === 'string' && keptLower.has(item.trim().toLowerCase())
        ),
      }))
      .filter(cat => cat.items.length > 0);
  }
  return { kept, fabricated };
}

// Substring evidence check + a small set of well-known abbreviation pairs so
// "JavaScript" matches "JS" in the candidate's input (and vice-versa).
function skillEvidenced(skill: string, evidence: string): boolean {
  const lc = skill.toLowerCase();
  if (evidence.includes(lc)) return true;
  const expansions = SKILL_ALIASES[lc];
  if (expansions) {
    for (const alias of expansions) if (evidence.includes(alias)) return true;
  }
  // Leading-phrase fallback for 3+-word skills: an honest longer phrasing of
  // an evidenced fact ("App Store Releases" when the raw text says
  // "currently in the app store") must not be false-flagged. Accept when the
  // skill's leading noun phrase (all words minus trailing ones, down to two
  // words) appears in evidence. NEVER applied to credential-shaped skills —
  // "Kubernetes Certification" must not pass on "Kubernetes" alone.
  if (/certif|licen|diploma|degree|award/.test(lc)) return false;
  const words = lc.split(/\s+/);
  for (let n = words.length - 1; n >= 2; n--) {
    if (evidence.includes(words.slice(0, n).join(' '))) return true;
  }
  // Order- and inflection-tolerant fallback for MULTI-WORD skills.
  //
  // Everything above is order-sensitive and exact, which systematically deletes
  // accurate skills from non-tech résumés. Tech skills are single verbatim tokens
  // ("Kafka", "Go"), so they always match; professional skills are noun phrases
  // the model naturally re-orders into idiomatic labels. Measured on a garments
  // merchandiser profile (2026-08-04), the filter stripped "Shipment
  // documentation" purely because the evidence said "documentation for shipment
  // clearance", and "Pricing negotiation" because the evidence said
  // "negotiated ... yarn pricing". Both are the candidate's real experience, and
  // the user had paid a credit for that résumé.
  //
  // So: accept when EVERY significant word is evidenced, ignoring order and light
  // inflection. This deliberately does NOT accept synonym leaps — "WIP monitoring"
  // against "tracked WIP", or "BGMEA liaison" against "coordinated BGMEA
  // documentation", still fail, because those are embellishments of the stated
  // fact rather than re-phrasings of it. The credential guard above still runs
  // first, so "Kubernetes Certification" cannot sneak in on "Kubernetes".
  if (words.length >= 2) {
    const significant = words.filter((w) => w.length >= 3 && !SKILL_STOPWORDS.has(w));
    if (significant.length >= 2 && significant.every((w) => evidence.includes(stemForEvidence(w)))) {
      return true;
    }
  }
  return false;
}

const SKILL_STOPWORDS = new Set(['and', 'the', 'for', 'with', 'of', 'in', 'on', 'to', 'a', 'an']);

/**
 * Crude single-pass suffix strip so a noun/verb pair of the SAME word matches:
 * "negotiation" and "negotiated" both reduce to "negotiat". Intentionally
 * conservative — it must not collapse two genuinely different words together,
 * so only the endings that mark an inflection of one stem are removed, and the
 * result is never shortened below 4 characters.
 */
function stemForEvidence(word: string): string {
  const stripped = word.replace(/(ations|ation|ings|ing|ers|er|ed|es|s)$/, '');
  return stripped.length >= 4 ? stripped : word;
}

const SKILL_ALIASES: Record<string, string[]> = {
  'javascript': ['js'],
  'js': ['javascript'],
  'typescript': ['ts'],
  'ts': ['typescript'],
  'kubernetes': ['k8s'],
  'k8s': ['kubernetes'],
  'postgresql': ['postgres', 'psql'],
  'postgres': ['postgresql'],
  'amazon web services': ['aws'],
  'aws': ['amazon web services'],
  'google cloud platform': ['gcp'],
  'gcp': ['google cloud platform'],
  'continuous integration': ['ci/cd', 'ci\\cd', 'cicd'],
  'ci/cd': ['continuous integration', 'continuous delivery'],
  'rest api': ['rest', 'restful'],
  'graphql': ['gql'],
  'react': ['reactjs', 'react.js'],
  'next.js': ['nextjs', 'next js'],
  'node.js': ['nodejs', 'node js'],
  'websockets': ['websocket'],
  'websocket': ['websockets'],
  // Platform/domain umbrella terms — grounded by the concrete stack, so a
  // resume for an iOS/Android JD can surface the platform even for profile
  // items normalized BEFORE the normalizer learned to emit it (sourceHash-
  // cached items keep their old skills until re-saved). Not fabrication: the
  // term is only kept when the candidate's evidence contains the stack.
  'ios': ['swift', 'swiftui', 'objective-c', 'objective c', 'cocoapods', 'xcode', 'uikit', 'app store'],
  'android': ['kotlin', 'jetpack compose', 'android studio', 'google play', 'play store'],
  // Stack ⇒ domain umbrella families beyond mobile — same grounded-inference
  // contract as ios/android above: the umbrella term is kept only when the
  // candidate's evidence contains the concrete stack that proves it. This is
  // labeling evidenced work (the normalizer's RULE 5 philosophy), never a
  // new claim.
  'data engineering': ['spark', 'airflow', 'kafka', 'etl', 'dbt', 'data pipeline', 'data warehouse', 'bigquery', 'redshift'],
  'fintech': ['payment gateway', 'payment processing', 'bkash', 'nagad', 'sslcommerz', 'core banking', 'mobile banking', 'mobile financial services'],
  'devops': ['docker', 'kubernetes', 'terraform', 'ci/cd', 'jenkins', 'github actions', 'gitlab ci', 'ansible'],
  'machine learning': ['tensorflow', 'pytorch', 'scikit-learn', 'xgboost', 'keras'],
  'data analysis': ['power bi', 'tableau', 'pandas', 'pivot table'],
  'e-commerce': ['shopify', 'woocommerce', 'daraz', 'magento'],
};

/**
 * Report high-signal tokens that appear in the optimizer's PROSE (summary +
 * refined bullets) without support in the candidate's evidence.
 *
 * Deliberately REPORTS rather than enforces. The asymmetry it exposes is real —
 * the free toolkit runs detectFabricatedTokens over its prose while the PAID
 * résumé only ever filtered the flat skills array, so an invented tool inside a
 * bullet reached the employer unchallenged. But the optimizer has no per-slot
 * degradation: every content check in this module THROWS, which fails the whole
 * generation and refunds the credit. Wiring a dictionary that has demonstrated
 * false positives (see AMBIGUOUS_WITH_ENGLISH in toolkitContext) into that path
 * as a hard gate would trade a fabrication risk for a "your paid generation
 * failed" risk, which is worse for the user and harder to diagnose.
 *
 * So this warns, the operator can grep it, and the decision to promote it to a
 * gate can be made on observed rates rather than on a guess.
 */
export function reportFabricatedProse(parsed: OptimizedResumeData, candidate: ResumeData): string[] {
  const evidence = buildEvidenceText(candidate).toLowerCase();
  const prose = [
    parsed.summary ?? '',
    ...(parsed.experience ?? []).flatMap((e) => e.refinedBullets ?? []),
    ...(parsed.projects ?? []).flatMap((e) => e.refinedBullets ?? []),
    ...(parsed.extracurriculars ?? []).flatMap((e) => e.refinedBullets ?? []),
  ].join('\n');
  return prose.trim() ? detectFabricatedTokens(prose, evidence) : [];
}

// ────────────────────────────────────────────────
// 🚫 BANNED BULLET OPENERS (deterministic enforcement of RULE 3)
// ────────────────────────────────────────────────
//
// RULE 3 calls these "instant reject", but for a long time that existed ONLY as
// prompt text — nothing checked. Measured over 6 optimizer runs on one messy
// profile (72 bullets): 4 bullets opened with "Participated in", every one of
// them the same standup/Jira line, in 4 of the 6 runs.
//
// The leak was upstream. The normalizer emitted "Participated in daily standup
// meetings…", and the optimizer is told to treat canonicalBullets as PRIMARY
// evidence and SELECT from them — so a weak opener produced one stage earlier
// passes straight through to the résumé. The normalizer prompt now forbids these
// too, but prompts are probabilistic and this is the recruiter's first impression,
// so it also gets a deterministic backstop.
//
// Dropping rather than rewriting is deliberate: a bullet whose only content is
// "attended the standup" has no achievement to salvage, and a mechanical reword
// ("Participated in X" → "Drove X") would silently upgrade attendance into
// ownership — the exact fabrication RULE 2 forbids. An item is never emptied,
// because validateOptimizedResponse requires ≥1 bullet.
const BANNED_BULLET_OPENERS: RegExp[] = [
  /^\s*responsible for\b/i,
  /^\s*worked on\b/i,
  /^\s*helped (?:with|to)\b/i,
  /^\s*duties included\b/i,
  /^\s*tasked with\b/i,
  /^\s*in charge of\b/i,
  /^\s*assisted (?:with|in)\b/i,
  /^\s*involved in\b/i,
  /^\s*participated in\b/i,
];

function hasBannedOpener(bullet: string): boolean {
  return BANNED_BULLET_OPENERS.some((re) => re.test(bullet));
}

/**
 * Strip bullets that open with a RULE 3 instant-reject phrase. Returns what was
 * dropped, for telemetry. Keeps the first bullet of an item even if it is banned,
 * rather than leaving the item empty — a weak line beats a validation failure that
 * costs the user their whole generation.
 */
export function dropBannedOpenerBullets(parsed: OptimizedResumeData): string[] {
  const dropped: string[] = [];
  const groups = [parsed.experience, parsed.projects, parsed.extracurriculars];
  for (const group of groups) {
    for (const item of group ?? []) {
      const bullets = item.refinedBullets;
      if (!Array.isArray(bullets) || bullets.length === 0) continue;
      const kept = bullets.filter((b) => !hasBannedOpener(b));
      if (kept.length === bullets.length) continue;
      if (kept.length === 0) {
        // Every bullet was banned — keep one so the item stays valid.
        dropped.push(...bullets.slice(1));
        item.refinedBullets = [bullets[0]];
        continue;
      }
      dropped.push(...bullets.filter((b) => hasBannedOpener(b)));
      item.refinedBullets = kept;
    }
  }
  return dropped;
}

export class ResumeFabricationError extends Error {
  constructor(public readonly tokens: string[]) {
    super(
      `Résumé prose claimed tool(s) the same guard already stripped from the skills list: ${tokens.join(', ')}`,
    );
    this.name = 'ResumeFabricationError';
  }
}

/**
 * The one fabrication case on the paid path that must NOT ship: a token that
 * `filterFabricatedSkills` DELETED from `skills` and that still appears in a
 * bullet or the summary.
 *
 * Why this specific intersection, and not all of reportFabricatedProse:
 *
 * A prose-only hit is treated as a warning because the dictionary can
 * false-positive on ordinary English (see AMBIGUOUS_WITH_ENGLISH in
 * toolkitContext) and killing a paid generation over one ambiguous word is
 * worse for the user than shipping it. But when the SAME token was independently
 * flagged in the structured skills array — where there is no surrounding prose to
 * make it ambiguous — the false-positive reading collapses. Two independent hits
 * on one token is a real fabrication, not a dictionary artifact.
 *
 * It is also the only case that produces a self-contradicting document. Left
 * unblocked, the pipeline deletes "Kubernetes" from the skills list and keeps
 * "Architected Kafka-backed event pipelines on Kubernetes" in the experience
 * bullet — so the résumé simultaneously claims and disclaims the same tool. That
 * is worse than either shipping or stripping it consistently, and it is the
 * artifact most likely to be caught in an interview.
 *
 * Throwing is the right shape here: `withRetry` rotates to the next model and
 * tries once more (temperature is 0.3, so a different model often does not
 * fabricate), and `api/optimize` refunds the credit if it ultimately fails. That
 * is exactly the treatment the toolkit path already gives its own artifacts.
 */
export function assertProseMatchesStrippedSkills(
  parsed: OptimizedResumeData,
  candidate: ResumeData,
  strippedSkills: string[],
): void {
  if (strippedSkills.length === 0) return;
  const inProse = reportFabricatedProse(parsed, candidate);
  if (inProse.length === 0) return;
  const stripped = new Set(strippedSkills.map((s) => s.toLowerCase()));
  const both = inProse.filter((t) => stripped.has(t.toLowerCase()));
  if (both.length > 0) throw new ResumeFabricationError(both);
}

/**
 * The candidate's own words, concatenated — the corpus every honesty check reads.
 */
function buildEvidenceText(c: ResumeData): string {
  const parts: string[] = [...(c.skills ?? [])];
  // Polished-profile bullets/skills count as evidence too — they are
  // AI-verified renderings of the raw text (e.g. "PostgreSQL" where the
  // Banglish raw says "postgres diye"); without them, canonical-cased terms
  // the model echoes from canonicalBullets would be false-flagged.
  for (const e of c.experience ?? []) {
    parts.push(e.role ?? '', e.company ?? '', e.rawDescription ?? '');
    if (e.normalized) parts.push(...e.normalized.bullets, ...e.normalized.skills);
  }
  for (const p of c.projects ?? []) {
    parts.push(p.name ?? '', p.rawDescription ?? '', p.technologies ?? '');
    if (p.normalized) parts.push(...p.normalized.bullets, ...p.normalized.skills);
  }
  for (const x of c.extracurriculars ?? []) {
    parts.push(x.title ?? '', x.organization ?? '', x.description ?? '');
    if (x.normalized) parts.push(...x.normalized.bullets, ...x.normalized.skills);
  }
  for (const ed of c.education ?? []) parts.push(ed.school ?? '', ed.degree ?? '', ed.field ?? '');
  for (const cert of c.certifications ?? []) parts.push(cert.name ?? '', cert.issuer ?? '');
  // Languages, awards, publications, and affiliations are real candidate
  // evidence too — without languages here, RULE 5's own "Bengali" example
  // would be stripped as fabricated even when the profile lists it.
  for (const lang of c.languages ?? []) parts.push(lang.name ?? '');
  for (const a of c.awards ?? []) parts.push(a.title ?? '', a.issuer ?? '', a.description ?? '');
  for (const p of c.publications ?? []) parts.push(p.title ?? '', p.publisher ?? '');
  for (const af of c.affiliations ?? []) parts.push(af.role ?? '', af.organization ?? '');
  return parts.join(' ');
}

// ────────────────────────────────────────────────
// 🎯 LEAD-BULLET REORDERING
// ────────────────────────────────────────────────
//
// LAST-RESORT rescue for the lead bullet, not an ordering policy.
//
// It used to be a policy: promote whichever bullet had the highest JD-keyword
// count. That fought the thing we actually want. Keyword density is not proof
// strength — the line with the most JD nouns in it is often a thin tooling
// mention, while the line that proves the JD's real requirement (ownership,
// independent delivery, navigating a legacy system) may share almost no
// vocabulary with the posting. Since RULE 4 + the `plan` field now make the
// model choose the lead deliberately and explain the choice, a counter that
// overrides it on a one-token margin destroys more than it saves.
//
// So the bar is now high enough that it only fires on genuine model failure —
// a lead bullet with NO JD connection at all while some other bullet is
// clearly on-target. Anything short of that keeps the model's order.
const LEAD_RESCUE_MIN_SCORE = 2;

export function reorderLeadBulletByJDFit(
  parsed: OptimizedResumeData,
  jdText: string
): void {
  const jdVocab = jdVocabulary(jdText);
  if (jdVocab.size === 0) return;

  for (const exp of parsed.experience ?? []) promoteLead(exp.refinedBullets, jdVocab);
  for (const proj of parsed.projects ?? []) promoteLead(proj.refinedBullets, jdVocab);
  for (const ex of parsed.extracurriculars ?? []) promoteLead(ex.refinedBullets, jdVocab);
}

function promoteLead(bullets: string[] | undefined, jdVocab: Set<string>): void {
  if (!bullets || bullets.length < 2) return;

  // The model's lead has SOME connection to the JD — it was a deliberate call
  // under RULE 4, so leave it alone. Only a zero-overlap lead is a failure we
  // can be confident about without re-reading the JD ourselves.
  if (bulletScore(bullets[0], jdVocab) > 0) return;

  let bestIdx = 0;
  let bestScore = 0;
  for (let i = 1; i < bullets.length; i++) {
    const score = bulletScore(bullets[i], jdVocab);
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  // And the replacement has to be clearly on-target, not merely non-zero.
  if (bestIdx !== 0 && bestScore >= LEAD_RESCUE_MIN_SCORE) {
    const winner = bullets.splice(bestIdx, 1)[0];
    bullets.unshift(winner);
  }
}

function bulletScore(bullet: string, jdVocab: Set<string>): number {
  const tokens = tokenizeForScoring(bullet);
  let score = 0;
  for (const t of tokens) if (jdVocab.has(t)) score++;
  return score;
}

// ────────────────────────────────────────────────
// 🎯 ITEM-LEVEL REORDERING (projects only)
// ────────────────────────────────────────────────
//
// Counterpart to the lead-bullet rescue, and narrowed for the same reason.
//
// This used to re-sort every project by aggregate JD-keyword count, which threw
// away the model's ordering wholesale. RULE 4 now asks the model to order
// projects by strength of case — a judgement a token counter cannot make, and
// one it will frequently contradict, because the project that best proves
// "independently delivers moderate-complexity work" is not necessarily the one
// that name-drops the most JD technologies.
//
// Kept only as a floor: if the project sitting in the first slot has no JD
// connection while another is clearly relevant, promote that one and leave the
// rest of the model's order untouched. Experience is never touched at all —
// recruiters read a career as a timeline.
const PROJECT_RESCUE_MIN_SCORE = 2;

export function reorderProjectsByJDFit(
  parsed: OptimizedResumeData,
  jdText: string
): void {
  const jdVocab = jdVocabulary(jdText);
  if (jdVocab.size === 0 || !parsed.projects || parsed.projects.length < 2) return;

  if (itemScore(parsed.projects[0].refinedBullets, jdVocab) > 0) return;

  let bestIdx = 0;
  let bestScore = 0;
  for (let i = 1; i < parsed.projects.length; i++) {
    const score = itemScore(parsed.projects[i].refinedBullets, jdVocab);
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  if (bestIdx !== 0 && bestScore >= PROJECT_RESCUE_MIN_SCORE) {
    const winner = parsed.projects.splice(bestIdx, 1)[0];
    parsed.projects.unshift(winner);
  }
}

function itemScore(bullets: string[] | undefined, jdVocab: Set<string>): number {
  if (!bullets || bullets.length === 0) return 0;
  let score = 0;
  for (const b of bullets) score += bulletScore(b, jdVocab);
  return score;
}

// ────────────────────────────────────────────────
// ✂️ BULLET-DENSITY ENFORCEMENT
// ────────────────────────────────────────────────
//
// The system prompt asks the model to match signal density (rich → 4–5,
// thin → 2–3). In practice models pad weak items to look "complete". This
// post-step enforces it: items whose JD-fit score is below the median across
// the resume's items get trimmed to their top 2 bullets. Items at or above
// median keep up to 5. Pure deletion — never adds bullets — and preserves
// the lead bullet (which was already promoted by reorderLeadBulletByJDFit).
//
// Skip when: fewer than 2 items in the array (no median to compute, no
// padding to detect), or no JD vocabulary.
export function enforceBulletDensity(
  parsed: OptimizedResumeData,
  jdText: string
): void {
  const jdVocab = jdVocabulary(jdText);
  if (jdVocab.size === 0) return;

  trimGroup(parsed.experience, jdVocab);
  trimGroup(parsed.projects, jdVocab);
  trimGroup(parsed.extracurriculars, jdVocab);
}

function trimGroup(
  items: { id: string; refinedBullets: string[] }[] | undefined,
  jdVocab: Set<string>
): void {
  if (!items || items.length < 2) return;

  const scores = items.map(it => itemScore(it.refinedBullets, jdVocab));
  const sortedScores = [...scores].sort((a, b) => a - b);
  const mid = Math.floor(sortedScores.length / 2);
  const median = sortedScores.length % 2 === 0
    ? (sortedScores[mid - 1] + sortedScores[mid]) / 2
    : sortedScores[mid];

  items.forEach((item, idx) => {
    if (!item.refinedBullets || item.refinedBullets.length <= 2) return;
    // Trim to 2 only when the item is BOTH relatively weak (below the
    // resume's median JD fit) AND absolutely weak (≤1 JD-vocab hits across
    // all its bullets). Relative rank alone guaranteed that with two items
    // of unequal scores the lower one ALWAYS lost bullets 3+ — deleting
    // honest, JD-relevant evidence the normalizer was built to preserve
    // and orphaning summary claims the deleted bullets supported.
    const isWeak = scores[idx] < median && scores[idx] <= 1;
    const cap = isWeak ? 2 : 5;
    if (item.refinedBullets.length > cap) {
      item.refinedBullets = item.refinedBullets.slice(0, cap);
    }
  });
}

function jdVocabulary(jdText: string): Set<string> {
  const vocab = new Set<string>();
  for (const t of tokenizeForScoring(jdText)) {
    if (t.length < 3) continue;
    if (STOPWORDS.has(t)) continue;
    vocab.add(t);
  }
  return vocab;
}

function tokenizeForScoring(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9+./#-]/g, ' ')
    .split(/\s+/)
    // Sentence-final punctuation sticks to the last word ("codebase." never
    // matches JD token "codebase") and slash-joined pairs hide both halves
    // ("objective-c/swift" matches neither). Keep the original token AND its
    // slash-split halves; strip trailing periods/hyphens (interior ones —
    // "node.js", "objective-c", "c++" — are untouched).
    .flatMap(t => t.includes('/') ? [t, ...t.split('/')] : [t])
    .map(t => t.replace(/[.-]+$/, ''))
    .filter(Boolean);
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'with', 'for', 'to', 'of', 'in', 'on', 'at', 'by',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
  'will', 'would', 'should', 'could', 'may', 'might', 'must', 'shall', 'can',
  'as', 'we', 'you', 'your', 'our', 'their', 'this', 'that', 'these', 'those',
  'it', 'its', 'they', 'them', 'i', 'me', 'my', 'us', 'who', 'what', 'where', 'when', 'why', 'how',
  'all', 'any', 'each', 'every', 'no', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very',
  'just', 'also', 'into', 'about', 'from', 'such', 'including', 'across',
  'will', 'work', 'role', 'team', 'teams', 'company',
]);

// ────────────────────────────────────────────────
// 🧮 EXPERIENCE TOTAL
// ────────────────────────────────────────────────
// Bucketed from total months of experience + userType. The buckets tune
// verb choice and ownership claims (see RULE 9 in the system instruction).
// Anything in the input experience descriptions that contradicts the bucket
// (e.g. a "Lead Engineer" title with only 1 year of experience) is left for
// the model to weigh — we don't try to override stated titles.
export function inferSeniority(data: ResumeData): string {
  if (data.userType === 'student') return 'Student / Entry-level';
  const months = totalMonths(data.experience);
  if (months < 24) return 'Junior (0–2 years)';
  if (months < 60) return 'Mid (2–5 years)';
  if (months < 96) return 'Senior (5–8 years)';
  return 'Senior+ / Staff (8+ years)';
}

function totalMonths(
  experience: { startDate: string; endDate: string; isCurrent: boolean }[]
): number {
  let totalMonths = 0;
  experience.forEach(exp => {
    const start = new Date(exp.startDate);
    const end = exp.isCurrent ? new Date() : new Date(exp.endDate);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return;
    let months =
      (end.getFullYear() - start.getFullYear()) * 12 +
      (end.getMonth() - start.getMonth());
    if (end.getDate() < start.getDate()) months -= 1;
    totalMonths += Math.max(0, months);
  });
  return totalMonths;
}

export function calculateTotalExperience(
  experience: { startDate: string; endDate: string; isCurrent: boolean }[]
): string {
  const months = totalMonths(experience);
  const years = Math.floor(months / 12);
  const remaining = months % 12;

  if (years === 0 && remaining === 0) return 'No Experience';

  return `${years ? `${years} year${years > 1 ? 's' : ''}` : ''} ${remaining ? `${remaining} month${remaining > 1 ? 's' : ''}` : ''
    }`.trim();
}

// ────────────────────────────────────────────────
// 🛠 PARSING / RUNTIME UTILITIES
// ────────────────────────────────────────────────
export function safeJsonParse<T = OptimizedResumeData>(text: string): T {
  try {
    return JSON.parse(text);
  } catch {
    const cleaned = text.replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(cleaned);
  }
}

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('AI request timeout')), ms)
    ),
  ]);
}

export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Structured-output schema (Gemini `responseJsonSchema`) ──────────────────
//
// Lifted from OpenRouterResumeOptimizer during the direct-Gemini port so the
// optimizer's shape contract lives beside the prompt that describes it.
//
// Strict mode requires every property to appear in `required`, so the optional
// sections are required-as-empty-arrays; validateOptimizedResponse() still
// checks counts and IDs against the input afterwards. The schema cannot express
// "echo back exactly these input IDs" — that is why buildUserPrompt() also
// embeds the shape spec, and why the validator remains the final gate.
const REFINED_SECTION = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      refinedBullets: { type: 'array', items: { type: 'string' } },
    },
    required: ['id', 'refinedBullets'],
    additionalProperties: false,
  },
} as const;

// The model's deliberation, made a real output field instead of an instruction
// to "think silently".
//
// Why this has to exist as a field: GeminiClient pins `thinkingLevel: MINIMAL`
// on every call (a non-minimal budget times out at 400s on the flash-lite models
// — see the header of GeminiClient.ts), so the model has almost no private
// reasoning budget. "Analyse the JD first, then emit JSON" was therefore close to
// a no-op: it went straight to `summary` and composed the résumé one field at a
// time with no view of the whole case.
//
// Making the plan the FIRST property fixes that within the constraint. Structured
// output is generated in property order, so these tokens are produced before any
// résumé content and every later field is conditioned on them — the model has
// decided what this JD hires for, and which evidence proves it, before it writes
// the first bullet. This is the only form of deliberation available while
// thinking stays minimal.
//
// Consumed and deleted by takeOptimizerPlan() — logged, never persisted, never
// rendered. Keep the fields terse: they are billed output tokens on the paid
// hot-path call.
const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    jdPriorities: { type: 'array', items: { type: 'string' } },
    proofMap: { type: 'array', items: { type: 'string' } },
    weakSpots: { type: 'array', items: { type: 'string' } },
    thesis: { type: 'string' },
    orderPlan: { type: 'array', items: { type: 'string' } },
  },
  required: ['jdPriorities', 'proofMap', 'weakSpots', 'thesis', 'orderPlan'],
  additionalProperties: false,
} as const;

export const OPTIMIZER_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    // FIRST, deliberately — see PLAN_SCHEMA. Moving this below `summary` silently
    // reverts the whole feature: the plan would then be written to justify a
    // summary that already exists, instead of shaping it.
    plan: PLAN_SCHEMA,
    summary: { type: 'string' },
    skills: { type: 'array', items: { type: 'string' } },
    // Grounding for skills whose LABEL is not literally in the candidate's text.
    // Consumed and deleted by filterFabricatedSkills — never persisted, never
    // rendered. This is what lets an accountant who wrote "bank er statement er
    // shathe amader khata milai" legitimately list "Bank Reconciliation".
    skillEvidence: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          skill: { type: 'string' },
          quote: { type: 'string' },
        },
        required: ['skill', 'quote'],
        additionalProperties: false,
      },
    },
    skillCategories: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          category: { type: 'string' },
          items: { type: 'array', items: { type: 'string' } },
        },
        required: ['category', 'items'],
        additionalProperties: false,
      },
    },
    experience: REFINED_SECTION,
    projects: REFINED_SECTION,
    extracurriculars: REFINED_SECTION,
  },
  required: ['plan', 'summary', 'skills', 'skillCategories', 'skillEvidence', 'experience', 'projects', 'extracurriculars'],
  additionalProperties: false,
};
