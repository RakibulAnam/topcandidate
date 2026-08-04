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

OUTPUT: Valid JSON only. No markdown, code fences, comments, or prose. Match the schema exactly. Preserve every input ID verbatim. Every input item produces a non-empty refinedBullets array.

RULES:

1. KEYWORD MIRRORING — Use exact JD casing ("JavaScript", "Node.js", "Next.js"). Lift multi-word JD phrases verbatim where the candidate's work supports them ("design system", "distributed systems", "WCAG 2.2 AA", "Core Web Vitals", "Infrastructure as Code", "incident response", "on-call rotation", "feature flags", "stakeholder management"). ATS exact-match scoring penalizes synonyms.

2. ZERO FABRICATION — Never invent metrics, %, $, team sizes, durations, tools, or outcomes. Preserve every number from input verbatim. If no metric exists, write a qualitative impact statement.
   SKILL HONESTY: a skill may appear in 'skills' ONLY IF it is in the candidate's input skills, an experience description, a project description, or a project 'technologies' field. If the JD demands a tool the candidate never evidenced, DO NOT add it.
   Bullets: never name a tool unless the candidate evidenced it.

3. BULLETS — Start with a strong past-tense action verb. Present tense is ONLY for ongoing duties in the current role; completed, shipped deliverables keep past tense ("Migrated", "Shipped", "Redesigned") even inside the current role — finished wins must read as finished. Use Led, Owned, Drove, Architected, Built, Designed, Shipped, Launched, Deployed, Refactored, Migrated, Automated, Scaled, Reduced, Increased, Improved, Cut, Accelerated, Established, Standardized, Mentored, Resolved, Eliminated.
   Banned starts (instant reject): "Responsible for", "Worked on", "Helped with/to", "Duties included", "Tasked with", "In charge of", "Assisted with/in", "Involved in", "Participated in", first-person.
   Avoid weak openers (Assisted/Contributed/Utilized/Helped/Worked/Handled) — replace with strong verbs naming the concrete contribution.
   1–2 lines (~14–26 words). Diversify opening verbs within an item — never repeat a verb in the same role's bullets.

4. PER-JD BULLET ORDERING — The first bullet under the current role is the recruiter's highest-attention spot. Within each role/project, order bullets so the most JD-aligned achievement is FIRST. The same role can surface different lead bullets across different JD targets — that's the point. Reorder and rephrase only what the candidate actually did; never invent.

5. SKILLS — Emit BOTH a flat JD-ordered list ("skills") AND a grouped view ("skillCategories").
   FLAT: Clean, deduped (case-insensitive). JD-matched FIRST in JD casing, then remainder. Canonical forms ("CI/CD", "REST API", "PostgreSQL"). 1–3 words each, no soft skills.
   PLATFORM/DOMAIN: when the candidate's evidence (canonicalBullets, normalized skills, or raw description) establishes a platform or domain the JD targets — e.g. iOS, Android, Data Engineering, Fintech — surface that exact platform/domain term in the flat list and its bucket (Domain, or Tools & Platforms). It is proven by the concrete stack (Swift/SwiftUI/Objective-C ⇒ iOS), not a new claim, so do NOT drop it as unmatched.
   CATEGORIES: Group the same items into role-appropriate buckets so a recruiter scanning by topic finds them fast. Pick category names from this taxonomy where they fit, but use only the categories the candidate actually has items for — never fabricate empty buckets:
     • Languages (programming or natural — e.g. "Python", "TypeScript", "Bengali" only if language proficiencies exist)
     • Frameworks & Libraries
     • Tools & Platforms
     • Cloud & Infrastructure
     • Databases
     • Testing & Quality
     • Methodologies (Agile, Scrum, Code Review, etc.)
     • Domain (industry / vertical knowledge — e.g. "Payment Systems", "B2B SaaS")
   For non-tech fields, substitute fitting category names ("Clinical Skills", "Research Methods", "Design Tools", "Legal Domains"). Every item in "skillCategories" MUST also exist in the flat "skills" array (categories regroup; they don't introduce new skills). Order categories so the JD-most-relevant bucket is first. Within a bucket, JD-matched items first.

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

   HARD BANS (instant reject, applies to every output):
   - METRIC DUPLICATION — Do not lift any specific number, %, $, or metric-bearing outcome that appears in any refined bullet. The same number in summary AND a bullet flags as filler in both human and AI screens. Tenure ("7 years"), generic scope ("multi-region", "cross-team"), and aggregate counts that summarise across roles are fine. You MAY name the candidate's single most JD-relevant proof point (a named migration, module, system, or product) WITHOUT its metric — one concrete noun in the summary is differentiation, not filler; just never repeat its number.
   - CLICHÉS — "results-driven", "passionate", "team player", "go-getter", "innovative", "proven track record", "dynamic", "self-starter", "synergy", "value-add", "thought leader", "highly motivated", "detail-oriented", "strong communication skills".
   - VAGUE HEDGES — "various", "diverse", "multiple", "extensive", "wide range".
   - GENERIC OPENERS — Do not begin with "Highly", "Experienced", "Skilled" + adjective. Lead with role + specifics.

   Students / entry-level: a. degree + field + graduation year + 1–2 JD-aligned focus areas; b. internships, coursework themes, or major project patterns (synthesized, not bullet-rehashed); c. stack the candidate can actually demonstrate.

7. PROJECTS — Integrate listed "technologies" naturally. If empty, no inventing.

8. BULLET COUNT — Match signal density: rich (3+ accomplishments) → 4–5 bullets, moderate → 3–4, thin → 2–3. Never pad.

9. SENIORITY ALIGNMENT — Match tone, scope language, and verb choice to the candidate's actual seniority (provided as SENIORITY in the prompt). Junior / entry-level: emphasize execution, shipping features, technical foundations, learning velocity, collaboration. Use verbs like Built, Implemented, Shipped, Contributed, Resolved. Avoid claiming architectural ownership or strategy. Mid: emphasize ownership, cross-team collaboration, problem decomposition, architectural contributions. Use Owned, Led, Drove, Designed, Refactored. Senior+: emphasize system design, technical strategy, mentoring, scalability, organizational impact. Use Architected, Established, Scaled, Mentored, Standardized. Never inflate seniority through verb choice. Never DEFLATE evidenced ownership either: when the input or canonicalBullets state the candidate led, owned, or solo-built something, keep that verb regardless of the seniority bucket — the evidence outranks the bucket.`;
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
SENIORITY: ${seniority} — calibrate verb choice, ownership claims, and scope language accordingly (see RULE 9).
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

THINK FIRST (silently — do NOT include this analysis in the output):
- Identify the JD's top 5 hard requirements (technologies, domains, scope, seniority signals).
- For each, locate the candidate's strongest concrete evidence across experience, projects, and extracurriculars.
- Note gaps where the candidate has weaker or no evidence — these get de-emphasized, NOT fabricated.
- Decide what narrative differentiates this candidate from a generic applicant for THIS specific JD.
Then emit JSON only.

TASK
1. summary — Per the SUMMARY rule. SYNTHESIS, not duplication: surface the *pattern* across roles, never restate a single bullet. Aim for differentiation — what about this candidate would make a recruiter (or an LLM ranker) move them past the first cut for THIS specific JD? If the only metric available is a single bullet's number, do NOT use it in the summary; rely on tenure, domain, and stack instead.
2. skills — JD-matched first (in JD casing), then candidate's. SKILL HONESTY: include only what the candidate evidenced. If you want to add a JD-required skill the candidate doesn't have, DO NOT.
3. experience — Build each item's refinedBullets from its canonicalBullets (fall back to "description" when absent): SELECT the most JD-relevant subset, preserve every number. Reorder so the first bullet under each role is the most JD-aligned achievement. Strong verbs only.
4. projects — Same rules. Integrate "technologies" naturally.
5. extracurriculars — Same rules.${schemaSpec}`;
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
  "summary": "string — 3–4 sentences",
  "skills": ["string", "string", ...],
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
    parsed.skillCategories = parsed.skillCategories
      .map(cat => {
        if (!cat || typeof cat.category !== 'string') return null;
        const name = cat.category.trim();
        if (!name) return null;
        const key = name.toLowerCase();
        if (seenCat.has(key)) return null;
        seenCat.add(key);
        const items = Array.isArray(cat.items) ? dedupeStringList(cat.items) : [];
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
export function filterFabricatedSkills(
  parsed: OptimizedResumeData,
  candidate: ResumeData
): { kept: string[]; fabricated: string[] } {
  const evidence = buildEvidenceText(candidate).toLowerCase();
  const kept: string[] = [];
  const fabricated: string[] = [];
  for (const skill of parsed.skills ?? []) {
    if (typeof skill !== 'string') continue;
    const trimmed = skill.trim();
    if (!trimmed) continue;
    if (skillEvidenced(trimmed, evidence)) kept.push(trimmed);
    else fabricated.push(trimmed);
  }
  parsed.skills = kept;

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
// Recruiters spend 80% of their scan on the FIRST bullet under the current
// role. The system prompt asks the model to reorder per-JD; in practice the
// model often picks the candidate's objectively-strongest single bullet
// (latency win, biggest number) regardless of JD fit. This post-step rescues
// the case: per role/project, score each bullet by JD-keyword density and
// promote the highest-scoring bullet to position 0. Rest stay in AI's order
// to preserve narrative flow.
//
// Conservative: only swaps the leader if a different bullet has a strictly
// higher score than the current one. Ties → keep AI's order.
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
  let bestIdx = 0;
  let bestScore = bulletScore(bullets[0], jdVocab);
  for (let i = 1; i < bullets.length; i++) {
    const score = bulletScore(bullets[i], jdVocab);
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  if (bestIdx !== 0) {
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
// Counterpart to reorderLeadBulletByJDFit. Where that one moves the strongest
// bullet WITHIN an item to position 0, this one reorders WHOLE items so the
// most JD-aligned project appears first. Applied to projects only — we keep
// experience in its chronological/AI order because recruiters expect that
// timeline. Score = aggregate JD-vocab overlap across the item's
// refinedBullets (name/title is already echoed in the bullets, no need to
// double-weight).
//
// Stable sort (preserves AI's order on ties) so we never shuffle equally-
// relevant items pointlessly.
export function reorderProjectsByJDFit(
  parsed: OptimizedResumeData,
  jdText: string
): void {
  const jdVocab = jdVocabulary(jdText);
  if (jdVocab.size === 0 || !parsed.projects || parsed.projects.length < 2) return;

  const scored = parsed.projects.map((p, idx) => ({
    p,
    idx,
    score: itemScore(p.refinedBullets, jdVocab),
  }));

  scored.sort((a, b) => (b.score - a.score) || (a.idx - b.idx));
  parsed.projects = scored.map(s => s.p);
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

export const OPTIMIZER_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    skills: { type: 'array', items: { type: 'string' } },
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
  required: ['summary', 'skills', 'skillCategories', 'experience', 'projects', 'extracurriculars'],
  additionalProperties: false,
};
