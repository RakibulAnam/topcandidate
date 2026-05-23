// Shared prompt + validation logic for the resume optimizer.
//
// Used by GeminiResumeOptimizer (which passes a separate `responseSchema` to
// the Gemini SDK) and GroqResumeOptimizer (which embeds the JSON shape spec
// in the user prompt because OpenAI-compatible JSON mode does not enforce a
// schema). Keeping all prompt text + validation in one place ensures the two
// providers stay in lockstep on the rules — the rules are the product, not
// the SDK.

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

3. BULLETS — Start with a strong past-tense action verb (present for current role). Use Led, Owned, Drove, Architected, Built, Designed, Shipped, Launched, Deployed, Refactored, Migrated, Automated, Scaled, Reduced, Increased, Improved, Cut, Accelerated, Established, Standardized, Mentored, Resolved, Eliminated.
   Banned starts (instant reject): "Responsible for", "Worked on", "Helped with/to", "Duties included", "Tasked with", "In charge of", "Assisted with/in", "Involved in", "Participated in", first-person.
   Avoid weak openers (Assisted/Contributed/Utilized/Helped/Worked/Handled) — replace with strong verbs naming the concrete contribution.
   1–2 lines (~14–26 words). Diversify opening verbs within an item — never repeat a verb in the same role's bullets.

4. PER-JD BULLET ORDERING — The first bullet under the current role is the recruiter's highest-attention spot. Within each role/project, order bullets so the most JD-aligned achievement is FIRST. The same role can surface different lead bullets across different JD targets — that's the point. Reorder and rephrase only what the candidate actually did; never invent.

5. SKILLS — Emit BOTH a flat JD-ordered list ("skills") AND a grouped view ("skillCategories").
   FLAT: Clean, deduped (case-insensitive). JD-matched FIRST in JD casing, then remainder. Canonical forms ("CI/CD", "REST API", "PostgreSQL"). 1–3 words each, no soft skills.
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
   - METRIC DUPLICATION — Do not lift any specific number, %, $, named outcome, or unique phrase that appears in any refined bullet. The same number in summary AND a bullet flags as filler in both human and AI screens. Tenure ("7 years"), generic scope ("multi-region", "cross-team"), and aggregate counts that summarise across roles are fine.
   - CLICHÉS — "results-driven", "passionate", "team player", "go-getter", "innovative", "proven track record", "dynamic", "self-starter", "synergy", "value-add", "thought leader", "highly motivated", "detail-oriented", "strong communication skills".
   - VAGUE HEDGES — "various", "diverse", "multiple", "extensive", "wide range".
   - GENERIC OPENERS — Do not begin with "Highly", "Experienced", "Skilled" + adjective. Lead with role + specifics.

   Students / entry-level: a. degree + field + graduation year + 1–2 JD-aligned focus areas; b. internships, coursework themes, or major project patterns (synthesized, not bullet-rehashed); c. stack the candidate can actually demonstrate.

7. PROJECTS — Integrate listed "technologies" naturally. If empty, no inventing.

8. BULLET COUNT — Match signal density: rich (3+ accomplishments) → 4–5 bullets, moderate → 3–4, thin → 2–3. Never pad.

9. SENIORITY ALIGNMENT — Match tone, scope language, and verb choice to the candidate's actual seniority (provided as SENIORITY in the prompt). Junior / entry-level: emphasize execution, shipping features, technical foundations, learning velocity, collaboration. Use verbs like Built, Implemented, Shipped, Contributed, Resolved. Avoid claiming architectural ownership or strategy. Mid: emphasize ownership, cross-team collaboration, problem decomposition, architectural contributions. Use Owned, Led, Drove, Designed, Refactored. Senior+: emphasize system design, technical strategy, mentoring, scalability, organizational impact. Use Architected, Established, Scaled, Mentored, Standardized. Never inflate seniority through verb choice.`;
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
  }));

  const cleanProjects = data.projects.map(p => ({
    id: p.id,
    name: p.name,
    description: p.rawDescription,
    technologies: p.technologies,
    link: p.link,
  }));

  const cleanExtracurriculars = (data.extracurriculars || []).map(e => ({
    id: e.id,
    title: e.title,
    organization: e.organization,
    startDate: e.startDate,
    endDate: e.endDate,
    description: e.description,
  }));

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

EXPERIENCE (${cleanExperience.length} items — each MUST produce refinedBullets):
${JSON.stringify(cleanExperience)}

PROJECTS (${cleanProjects.length} items — each MUST produce refinedBullets):
${JSON.stringify(cleanProjects)}

EXTRACURRICULARS (${cleanExtracurriculars.length} items — each MUST produce refinedBullets):
${JSON.stringify(cleanExtracurriculars)}

EDUCATION:
${JSON.stringify(data.education)}

THINK FIRST (silently — do NOT include this analysis in the output):
- Identify the JD's top 5 hard requirements (technologies, domains, scope, seniority signals).
- For each, locate the candidate's strongest concrete evidence across experience, projects, and extracurriculars.
- Note gaps where the candidate has weaker or no evidence — these get de-emphasized, NOT fabricated.
- Decide what narrative differentiates this candidate from a generic applicant for THIS specific JD.
Then emit JSON only.

TASK
1. summary — Per the SUMMARY rule. SYNTHESIS, not duplication: surface the *pattern* across roles, never restate a single bullet. Aim for differentiation — what about this candidate would make a recruiter (or an LLM ranker) move them past the first cut for THIS specific JD? If the only metric available is a single bullet's number, do NOT use it in the summary; rely on tenure, domain, and stack instead.
2. skills — JD-matched first (in JD casing), then candidate's. SKILL HONESTY: include only what the candidate evidenced. If you want to add a JD-required skill the candidate doesn't have, DO NOT.
3. experience — Convert each "description" into refinedBullets. Preserve every number. Reorder so the first bullet under each role is the most JD-aligned achievement. Strong verbs only.
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
  [/\bdynamic\s+/gi, ''],
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

function validateArrayCounts(
  inputArray: { id: string }[] | undefined,
  outputArray: { id: string; refinedBullets: string[] }[] | undefined,
  field: string
): void {
  if (!inputArray?.length) return;

  if (!outputArray || inputArray.length !== outputArray.length) {
    throw new Error(`AI did not return correct ${field} count`);
  }

  inputArray.forEach((item, index) => {
    const out = outputArray[index];
    if (!out || out.id !== item.id) throw new Error(`ID mismatch in ${field}`);
    if (!out.refinedBullets || out.refinedBullets.length === 0) {
      throw new Error(`Empty bullets in ${field} ${item.id}`);
    }
  });
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
  return false;
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
};

function buildEvidenceText(c: ResumeData): string {
  const parts: string[] = [...(c.skills ?? [])];
  for (const e of c.experience ?? []) parts.push(e.role ?? '', e.company ?? '', e.rawDescription ?? '');
  for (const p of c.projects ?? []) parts.push(p.name ?? '', p.rawDescription ?? '', p.technologies ?? '');
  for (const ed of c.education ?? []) parts.push(ed.school ?? '', ed.degree ?? '', ed.field ?? '');
  for (const cert of c.certifications ?? []) parts.push(cert.name ?? '', cert.issuer ?? '');
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
    const isWeak = scores[idx] < median;
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
