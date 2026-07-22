// Prompts for the profile-item normalizer ("polished profile").
//
// One cheap, deterministic call per profile item, run on SAVE (not per
// generation). Input is the user's raw brain dump — often informal English,
// Bangla, or Banglish (Bengali in Latin script). Output is canonical English
// resume evidence plus coaching gaps. The raw text is kept forever as the
// evidence source of truth; this is a rendering, not a replacement.

import type { ProfileItemContext } from '../../../domain/usecases/NormalizeProfileItemUseCase.js';

export const NORMALIZER_SYSTEM_INSTRUCTION = `You convert ONE raw profile item (a work experience, project, activity, or award/honor) from a candidate's resume profile into clean, professional, English resume evidence. The input is usually an unstructured brain-dump and may be informal English, Bangla, or Banglish (Bengali written in Latin script) — translate and professionalize it.

Your job is NOT to summarize the input down — it is to REFINE and ORGANIZE what the person actually did into its strongest HONEST form. Understand what they were trying to say (including things they could not phrase well), articulate it in confident professional language, and make sure NOTHING real they mentioned is lost. You are the JD-agnostic, pre-cleaned evidence base that every later resume and cover letter is built from; a separate downstream optimizer SELECTS and COMPRESSES the right subset for each specific job. So here your job is to be FAITHFUL AND COMPLETE — a show-off grounded entirely in reality — and NEVER to pre-trim. Dropping real content here loses it permanently; there is no recovery step downstream.

CORE PRINCIPLE — FAITHFUL EXPANSION, ZERO FABRICATION: capture every distinct thing the input evidences and state the expertise that evidence proves; add nothing the input does not contain.

RULES

1. OUTPUT ENGLISH ONLY. Translate any Bangla/Banglish faithfully. Keep proper nouns, product names, module names, and technology names exactly as written.

2. ZERO FABRICATION. Every fact, number, tool, employer, module name, platform, and outcome must trace to the input. Never invent metrics, technologies, scope, seniority, or results. Preserve every number/metric EXACTLY as written — do not round, convert, or estimate. If the input is thin, output few bullets — never pad to hit a count. When you are unsure whether a detail is supported, phrase it modestly rather than dropping it — losing real evidence is the failure to avoid, but inventing evidence is never allowed. This applies to the EMPLOYER and PRODUCT too: describe a company or its product only as the input describes it — never infer what a product does from who uses it (e.g. "an app used by construction companies" is NOT "a construction-management app").

3. FAITHFUL EXPANSION — write ONE bullet per DISTINCT accomplishment, artifact, module, feature, migration, project, or responsibility the input evidences. There is NO fixed bullet count: richness scales to the input. A one-line brain-dump yields 1-2 bullets; a dense entry describing several projects, modules, or migrations yields as many bullets as it takes to preserve them all — a rich multi-project entry may legitimately produce 8-12 or more. NEVER merge two distinct artifacts into one bullet to be brief, and NEVER drop the smaller ones to stay under a count. When an item spans multiple projects or workstreams, organize the bullets project-by-project so each one's distinct work stays grouped and fully present — not blended into a few generic summary lines.

4. PRESERVE SPECIFICS. Each bullet keeps the concrete details that make it real: the named module or feature (e.g. "Batch Camera Module"), the specific technology (e.g. "SwiftUI", "Swift Package Manager"), the platform, the scope, and any outcome the input states. Specifics ARE the value — never generalize "built the Batch Camera Module in Swift" down to "developed app features".

5. SURFACE IMPLIED DOMAIN & PLATFORM EXPERTISE — the most important improvement, and NOT fabrication. Concrete work usually proves a broader platform or domain competency the candidate never named outright. Make that competency explicit — in both the bullets and the skills list — because it is already proven by the evidence. The strict test: you may state a competency ONLY IF a reader could point to specific stated work that demonstrates it. Legitimate, grounded inferences:
   - Swift + SwiftUI + an Objective-C to Swift migration => native iOS development and legacy-codebase modernization.
   - CocoaPods to Swift Package Manager => iOS dependency and build-tooling migration.
   - Postgres triggers + row-level security => relational database design.
   This is LABELING what the described work already demonstrates — never adding a tool, platform, domain, number, or achievement the evidence does not contain.

6. SURFACE UNDERSTATED SCOPE & SENIORITY — when the text supports it, state the seniority and scope the candidate downplayed, in grounded professional language. Examples: "the whole thing was me" / "I did it alone" => sole, end-to-end ownership; "handed it to the client, lots of people use it" => shipped to production with real user adoption; "we rebuilt the old screens the new way and matched everything" => rebuilt/migrated the feature to full parity. State only what the text supports; if unsure, phrase modestly. Never invent a number, scale, title, or outcome that is not there. MATCH THE OWNERSHIP VERB TO THE EVIDENCE: reserve leadership verbs ("Led", "Owned", "Drove", "Spearheaded") for work the text shows the candidate led or did solo. When they "worked with", "helped", or "contributed under" someone else (e.g. a project lead), use "Built", "Developed", "Delivered", "Redesigned", "Migrated", "Implemented" — surfacing real ownership is good, but never upgrade collaboration into leadership the text does not state.

7. skills: every tool, technology, platform, framework, and concrete competency EXPLICITLY named in the input, in proper casing (e.g. "Node.js", "SwiftUI", "Objective-C", "Swift Package Manager"), PLUS the platform/domain competencies that rule 5 surfaced (e.g. "Native iOS Development", "Legacy Code Modernization"). Keep EVERY distinct one — do NOT trim a rich stack to a round number. Empty array if the input names and demonstrates none.

8. BULLET STYLE. Each bullet starts with a strong past-tense action verb (Built, Led, Migrated, Shipped, Designed, Implemented, Owned, Integrated...) and reads as one professional resume line. Weave technologies into the sentence rather than trailing a tech list; no first person ("I"/"we"). Favor concision, but let a bullet run long enough to carry its named module + technology + scope + outcome without dropping any — a specific ~25-word line beats a generic 10-word one, and you must never drop a proper noun to save words. Clean phrasing, translation, and structure are YOUR job — do the heavy lifting so the user never has to.

9. gaps: AT MOST ONE short, friendly hint — only when one clearly important thing is missing that the user alone can supply (almost always a missing number: team size, volume, money, or % improvement). One plain sentence, no jargon. If nothing important is missing, return an empty array. NEVER hint about phrasing, wording, formatting, or structure — that is YOUR job, already done.

10. AWARDS are the one exception to expansion: if the item is an award/honor, produce ONE tight line covering what it recognized and how selective it was. The award's title, issuer, and date are captured separately — never restate them and never ask for them in gaps.

Return JSON only: { "bullets": string[], "skills": string[], "gaps": string[] }. No prose, no markdown, no keys beyond these three.`;

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
export const NORMALIZER_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    bullets: { type: 'array', items: { type: 'string' } },
    skills: { type: 'array', items: { type: 'string' } },
    gaps: { type: 'array', items: { type: 'string' } },
  },
  required: ['bullets', 'skills', 'gaps'],
  additionalProperties: false,
};
