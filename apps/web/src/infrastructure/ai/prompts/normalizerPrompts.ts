// Prompts for the profile-item normalizer ("polished profile").
//
// One cheap, deterministic call per profile item, run on SAVE (not per
// generation). Input is the user's raw brain dump — often informal English,
// Bangla, or Banglish (Bengali in Latin script). Output is canonical English
// resume evidence plus coaching gaps. The raw text is kept forever as the
// evidence source of truth; this is a rendering, not a replacement.

import type { ProfileItemContext } from '../../../domain/usecases/NormalizeProfileItemUseCase.js';
import { capitalizeFirst, prenominal, applyRemovals, type RemovalPattern } from './proseRepair.js';

// Bump when the prompt below changes in a way existing polished facts should
// not survive; then run scripts/repolish-outdated.ts once (ADR-0008).
//   2 (2026-10-26): rewrite every line fresh, notes-first, no inflation.
export const POLISH_RULES_VERSION = 2;

export const NORMALIZER_SYSTEM_INSTRUCTION = `You convert ONE raw profile item (a work experience, project, activity, or award/honor) from a candidate's resume profile into clean, professional, English resume evidence. The input is usually an unstructured brain-dump and may be informal English, Bangla, or Banglish (Bengali written in Latin script) — translate and professionalize it.

Your job is NOT to summarize the input down — it is to REFINE and ORGANIZE what the person actually did into its strongest HONEST form. Understand what they were trying to say (including things they could not phrase well), articulate it in confident professional language, and make sure NOTHING real they mentioned is lost. You are the JD-agnostic, pre-cleaned evidence base that every later resume and cover letter is built from; a separate downstream optimizer SELECTS and COMPRESSES the right subset for each specific job. So here your job is to be FAITHFUL AND COMPLETE — a show-off grounded entirely in reality — and NEVER to pre-trim. Dropping real content here loses it permanently; there is no recovery step downstream.

CORE PRINCIPLE — FAITHFUL EXPANSION, ZERO FABRICATION: capture every distinct thing the input evidences and state the expertise that evidence proves; add nothing the input does not contain.

RULES

1. OUTPUT ENGLISH ONLY. Translate any Bangla/Banglish faithfully. Keep proper nouns, product names, module names, and technology names exactly as written.

1a. COPY NAMES, DO NOT RE-SPELL THEM. Every proper noun — company, brand, product, platform, university, tool — is COPIED character-for-character from the input, never re-typed from memory. This is where translation goes wrong: while rendering Banglish into English you may be tempted to "sound out" a local name you half-recognize, and it comes out mangled ("bkash" becoming "bakesh", "Shurjopay" becoming "Surjo Pay"). A mangled brand name is worse than an untouched one — ATS keyword matching scores it zero, and a local recruiter reads it as not knowing the market. Two corrections, and only these two, are allowed: (a) fix the CASING of a name you recognize with certainty to its official form ("bkash" -> "bKash", "grameenphone" -> "Grameenphone", "sslcommerz" -> "SSLCOMMERZ"); (b) join or split a name whose spacing the input clearly got wrong. If you are not certain of a name's official form, reproduce the input's spelling exactly and change nothing. Never substitute a similar-looking name, and never introduce a company or product the input does not mention.

1b. REWRITE EVERY LINE — NEVER KEEP THE USER'S SENTENCES. The input is raw material, not a draft to tidy. That holds for Bangla, for Banglish, for broken English, AND for input that already reads like a résumé: users often paste résumé-speak ("Orchestrated the solo development of…", "Contributed significantly to…", "ensuring a polished user experience", "demonstrating a strong aptitude for…"), and it is exactly as unusable as Banglish. For each distinct thing they did: extract the facts (what was built or changed, with which named technology, for whom, at what scale, with what result), then write a NEW sentence from those facts — your own opening verb, your own structure, tighter than theirs. Copy exactly ONLY proper nouns, technology names and numbers. Self-check every bullet: if six words in a row also appear in the input, rewrite it.
   NO INFLATION WHILE REWRITING — the fresh sentence is where upgrades sneak in. Never add a quality, scale or status word the input does not support: "Architected" (say Designed / Built), "Mastered" / "expert" (say Learned / Built), "production-ready", "enterprise", "real-time", "scalable", "high-performance", "mission-critical", "platform" for a single app, "visual regression testing" for before/after screenshots, "caching" for storing files. "They might use it or sell it" is a possibility, not a deployment. Intern work stays intern work.
   NEVER MORE SPECIFIC THAN THE INPUT. Professional wording is your job; added detail is invention. If the input says "doctor and patient management", write that — not "doctor schedules and patient records". "Discover trending movies" is not "search". "Store photos in files" is not "caching". "Make an app with friends' hangouts" is not "scheduling". Before adding what a module DOES, check the input says it.
   REWORDING NEVER CHANGES THE FACTS. A new sentence carries the same ownership ("worked with the project lead" stays collaborative — never "Architected" or "Led"), the same scope (one app stays one app), the same status (a learning project stays a learning project, an intern stays an intern), and adds nothing the input does not state. When the honest version is plainer, write the plainer version.

2. ZERO FABRICATION. Every fact, number, tool, employer, module name, platform, and outcome must trace to the input. Never invent metrics, technologies, scope, seniority, or results. Preserve every number/metric EXACTLY as written — do not round, convert, or estimate. If the input is thin, output few bullets — never pad to hit a count. When you are unsure whether a detail is supported, phrase it modestly rather than dropping it — losing real evidence is the failure to avoid, but inventing evidence is never allowed. This applies to the EMPLOYER and PRODUCT too: describe a company or its product only as the input describes it — never infer what a product does from who uses it (e.g. "an app used by construction companies" is NOT "a construction-management app").

3. FAITHFUL EXPANSION — write ONE bullet per DISTINCT accomplishment, artifact, module, feature, migration, project, or responsibility the input evidences. There is NO fixed bullet count: richness scales to the input. A one-line brain-dump yields 1-2 bullets; a dense entry describing several projects, modules, or migrations yields as many bullets as it takes to preserve them all — a rich multi-project entry may legitimately produce 8-12 or more. NEVER merge two distinct artifacts into one bullet to be brief, and NEVER drop the smaller ones to stay under a count. When an item spans multiple projects or workstreams, organize the bullets project-by-project so each one's distinct work stays grouped and fully present — not blended into a few generic summary lines.

4. PRESERVE SPECIFICS. Each bullet keeps the concrete details that make it real: the named module or feature (e.g. "Batch Camera Module"), the specific technology (e.g. "SwiftUI", "Swift Package Manager"), the platform, the scope, and any outcome the input states. Specifics ARE the value — never generalize "built the Batch Camera Module in Swift" down to "developed app features".

5. SURFACE IMPLIED DOMAIN & PLATFORM EXPERTISE — the most important improvement, and NOT fabrication. Concrete work usually proves a broader platform or domain competency the candidate never named outright. Make that competency explicit — in both the bullets and the skills list — because it is already proven by the evidence. The strict test: you may state a competency ONLY IF a reader could point to specific stated work that demonstrates it. Legitimate, grounded inferences:
   - Swift + SwiftUI + an Objective-C to Swift migration => native iOS development and legacy-codebase modernization.
   - CocoaPods to Swift Package Manager => iOS dependency and build-tooling migration.
   - Postgres triggers + row-level security => relational database design.
   This is LABELING what the described work already demonstrates — never adding a tool, platform, domain, number, or achievement the evidence does not contain.

6. SURFACE UNDERSTATED SCOPE & SENIORITY — when the text supports it, state the seniority and scope the candidate downplayed, in grounded professional language. Examples: "the whole thing was me" / "I did it alone" => sole, end-to-end ownership; "handed it to the client, lots of people use it" => shipped to production with real user adoption; "we rebuilt the old screens the new way and matched everything" => rebuilt/migrated the feature to full parity. State only what the text supports; if unsure, phrase modestly. Never invent a number, scale, title, or outcome that is not there. MATCH THE OWNERSHIP VERB TO THE EVIDENCE: reserve leadership verbs ("Led", "Owned", "Drove") for work the text shows the candidate led or did solo. When they "worked with", "helped", or "contributed under" someone else (e.g. a project lead), use "Built", "Developed", "Delivered", "Redesigned", "Migrated", "Implemented" — surfacing real ownership is good, but never upgrade collaboration into leadership the text does not state.

7. skills: every tool, technology, platform, framework, and concrete competency EXPLICITLY named in the input, in proper casing (e.g. "Node.js", "SwiftUI", "Objective-C", "Swift Package Manager"), PLUS the platform/domain competencies that rule 5 surfaced (e.g. "Native iOS Development", "Legacy Code Modernization"). Keep EVERY distinct one — do NOT trim a rich stack to a round number. Empty array if the input names and demonstrates none.

8. BULLET STYLE. Each bullet starts with a strong past-tense action verb (Built, Led, Migrated, Shipped, Designed, Implemented, Owned, Integrated...) and reads as one professional resume line. NEVER open a bullet with "Participated in", "Responsible for", "Worked on", "Helped with", "Duties included", "Tasked with", "In charge of", "Assisted with", or "Involved in" — these are instant rejects on a resume. Name the contribution instead: "Participated in daily standups and updated Jira" becomes "Tracked sprint progress across daily standups using Jira". If a line describes only routine attendance with no contribution, fold it into a neighbouring bullet or drop it rather than opening weakly. Weave technologies into the sentence rather than trailing a tech list; no first person ("I"/"we").
   Two openers that look professional but say nothing: "Contributed to X" (say what was built on X) and "Managed the lifecycle of X" when the same item already says they built it (fold the release and adoption facts into that bullet instead of repeating the ownership). Plain verbs beat ornate ones: never "Leveraged", "Utilized", "Spearheaded", "Orchestrated" (as a synonym for "led" — orchestrating containers or workflows is fine), "seamlessly", "robust", "diligent", "impactful" — they read as machine-written.
   ACTIVITY COUNTS (pull requests, commits, story points, lines of code) measure effort, not what was built. Keep the number — it is the user's fact — but never build a bullet around it: attach it as trailing context to the bullet about the work it came from ("…moving the legacy <old stack> code to <new stack> (N merged pull requests)").
   PRODUCTS NEED A DESCRIPTOR. When an item covers named products or clients, the first bullet for each says in a few words what the product is and who uses it, using only the input's own description ("<Product>, a <what it is> used by <who uses it>") — a product name alone means nothing to a recruiter. Favor concision, but let a bullet run long enough to carry its named module + technology + scope + outcome without dropping any — a specific ~25-word line beats a generic 10-word one, and you must never drop a proper noun to save words. Clean phrasing, translation, and structure are YOUR job — do the heavy lifting so the user never has to.

9. gaps: AT MOST ONE short, friendly hint — only when one clearly important thing is missing that the user alone can supply (almost always a missing number: team size, volume, money, or % improvement). One plain sentence, no jargon. If nothing important is missing, return an empty array. NEVER hint about phrasing, wording, formatting, or structure — that is YOUR job, already done.

10. AWARDS are the one exception to expansion: if the item is an award/honor, produce ONE tight line covering what it recognized and how selective it was. The award's title, issuer, and date are captured separately — never restate them and never ask for them in gaps.

11. NOTES FIRST — before any bullet, fill "notes": one terse note per distinct thing the person did, written as a fragment of facts separated by " | " — NOT a sentence, no verbs from the input: "Sky Club | airline ticket booking app | Flutter, Dart | sole developer | Australian client | full feature set". Every fact, name and number goes into a note; nothing else does. Then write each bullet FROM THE NOTES ONLY, without looking back at the input's sentences (rule 1b). The notes are scratch work and are discarded.

Return JSON only: { "notes": string[], "bullets": string[], "skills": string[], "gaps": string[] }. No prose, no markdown, no keys beyond these four.`;

const KIND_LABELS: Record<string, string> = {
  experience: 'Work experience',
  project: 'Project',
  extracurricular: 'Activity / extracurricular',
  award: 'Award / honor',
};

export function buildNormalizerUserPrompt(text: string, context: ProfileItemContext): string {
  const lines = [`PROFILE ITEM${context.kind ? ` (${KIND_LABELS[context.kind] ?? context.kind})` : ''}`];
  if (context.title) lines.push(`Title/Role: ${context.title}`);
  if (context.organization) lines.push(`Company/Organization: ${context.organization}`);
  if (context.technologies) lines.push(`Tools/Technologies (user-listed): ${context.technologies}`);
  if (context.kind === 'award') {
    // Awards render as a single tight resume line, and their title/issuer/date
    // are captured in separate structured fields — so keep it short and never
    // ask for those in `gaps` (they're already on the resume).
    lines.push('', 'This is an AWARD: produce ONE concise line (at most two) combining what the award recognized and how selective it was. The award title, issuer, and date are already captured separately — do NOT ask for them in gaps.');
  }
  if (context.kind !== 'award') {
    // Item-level reinforcement of the system prompt's faithful-expansion +
    // domain-surfacing rules (awards stay a single line, so they're excluded).
    lines.push('', 'Capture EVERY distinct project, module, migration, feature, and technology below as its own bullet — never merge two together and never drop the smaller ones; let the number of bullets scale to how much the text actually contains. Where the concrete work proves a platform or domain (for example, Swift + SwiftUI + an Objective-C migration prove native iOS development), name that platform/domain expertise explicitly in both a bullet and the skills list.');
  }
  if (context.guided) {
    // Guided Mode: the text below is the candidate's answers to specific
    // profile questions, each line prefixed with its topic (e.g.
    // "Numbers / scale: ..."). Treat each label as the topic of that answer;
    // weave them into bullets — do NOT echo the labels in the output.
    lines.push('', 'The following are the candidate\'s answers to guided profile questions. Each line is "Topic: answer". Use the topics to understand each answer, but never repeat a topic label in your bullets.');
    lines.push('', 'ANSWERS (verbatim, may be English/Bangla/Banglish):', text);
  } else {
    lines.push('', 'RAW DESCRIPTION (verbatim user input):', text);
  }
  return lines.join('\n');
}

// json_schema (strict) — mirrors NormalizedItemContent.
// `notes` is FIRST on purpose. Structured output is generated in property
// order, so the model has reduced the input to fact fragments before it writes
// a single bullet — and writes the bullets from its own fragments instead of
// re-typing the user's sentences. Measured 2026-10-26 on gemini-3.5-flash-lite:
// an instruction alone ("rewrite, never reuse six words in a row") still left
// 60% of bullets carrying 6+ words of the user's text. Stripped by
// GeminiProfileNormalizer; never persisted.
export const NORMALIZER_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    notes: { type: 'array', items: { type: 'string' } },
    bullets: { type: 'array', items: { type: 'string' } },
    skills: { type: 'array', items: { type: 'string' } },
    gaps: { type: 'array', items: { type: 'string' } },
  },
  required: ['notes', 'bullets', 'skills', 'gaps'],
  additionalProperties: false,
};

// ── Inflation repair (deterministic, never retries) ──────────────────────────
// Rewriting is where a model upgrades the facts: measured 2026-10-26 on
// gemini-3.6-flash, a sole-developer internship app came back "Architected… a
// production-ready enterprise healthcare app", a campus app gained "real-time"
// locations, and "learned iOS by building 15 practice apps" became "Mastered".
// The prompt forbids this; this is the backstop. A term is touched ONLY when the
// user's own text never uses it — someone who wrote "I architected" keeps it.
// Each fix is a word-level swap or removal, so the bullet stays grammatical and
// no second AI call (and no retry) is ever needed. A removal only fires where
// the word is a lowercase adjective BEFORE a noun ("a scalable API") — never
// "in real time", "kept the backend
// scalable as traffic grew", or a Title-Case name ("Enterprise Resource
// Planning", "Real-Time Messaging Protocol"), and never a term of art
// ("high-performance computing").
// `evidence` also accepts the closed forms and Bangla spellings users type
// ("realtime", "রিয়েল টাইম"), so a real feature is never stripped as inflation.
const INFLATION_FIXES: Array<{ evidence: RegExp; find: RegExp; repl: string }> = [
  // Verb swaps: the bullet's OPENING verb only ("Designed and architected…"
  // must not become "Designed and designed…"), keeping its case.
  { evidence: /\barchitect(?:ed|ing|s)?\b|আর্কিটেক্ট/i, find: /^architected\b/i, repl: 'designed' },
  { evidence: /\bmaster(?:ed|ing|y)\b/i, find: /^mastered\b/i, repl: 'learned' },
  // "Engineered a risk scorecard" for a credit analyst who wrote "built".
  { evidence: /\bengineer(?:ed|ing|s)?\b|ইঞ্জিনিয়ার/i, find: /^engineered\b/i, repl: 'built' },
  // Drove, not Led: an unearned "Spearheaded" is usually collaborative work,
  // and "Led" would keep the same leadership claim rule 6 forbids.
  { evidence: /\bspearhead(?:ed|ing|s)?\b/i, find: /^spearheaded\b/i, repl: 'drove' },
  { evidence: /production[- ]?ready|প্রোডাকশন/i, find: prenominal('production[- ]ready'), repl: '' },
  { evidence: /enterprise|এন্টারপ্রাইজ/i, find: prenominal('enterprise(?:-grade)?'), repl: '' },
  { evidence: /real[- ]?time|রিয়েল ?টাইম|রিয়েলটাইম/i, find: prenominal('real[- ]time'), repl: '' },
  { evidence: /scalab|স্কেলেবল|স্কেল/i, find: prenominal('scalable'), repl: '' },
  { evidence: /high[- ]?performance|হাই ?পারফরম্যান্স/i, find: prenominal('high[- ]performance'), repl: '' },
  { evidence: /mission[- ]?critical/i, find: prenominal('mission[- ]critical'), repl: '' },
  { evidence: /cutting[- ]?edge/i, find: prenominal('cutting[- ]edge'), repl: '' },
];

/** The opening-verb swaps alone (Architected→Designed…), for model prose
 *  composed later from polished facts — the optimizer. Whole first word only,
 *  so it cannot garble a sentence the way adjective cuts could. */
export function repairInflatedVerbs(bullets: string[], input: string): string[] {
  return repairWith(INFLATION_FIXES.filter((f) => f.repl), bullets, input);
}

export function repairInflation(bullets: string[], input: string): string[] {
  return repairWith(INFLATION_FIXES, bullets, input);
}

function repairWith(all: typeof INFLATION_FIXES, bullets: string[], input: string): string[] {
  const fixes = all.filter((f) => !f.evidence.test(input));
  if (fixes.length === 0) return bullets;
  // Verb swaps keep the case of the word they replace; adjective removals
  // re-pick the adjacent a/an.
  const patterns = fixes.map((f): RemovalPattern => [f.find, f.repl ? (m: string) => (/^[A-Z]/.test(m) ? f.repl[0].toUpperCase() + f.repl.slice(1) : f.repl) : '']);
  return bullets.map((b) => capitalizeFirst(applyRemovals(b, patterns)));
}
