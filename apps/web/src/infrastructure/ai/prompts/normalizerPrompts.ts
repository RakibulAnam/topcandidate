// Prompts for the profile-item normalizer ("polished profile").
//
// One cheap, deterministic call per profile item, run on SAVE (not per
// generation). Input is the user's raw brain dump — often informal English,
// Bangla, or Banglish (Bengali in Latin script). Output is canonical English
// resume evidence plus coaching gaps. The raw text is kept forever as the
// evidence source of truth; this is a rendering, not a replacement.

import type { ProfileItemContext } from '../../../domain/usecases/NormalizeProfileItemUseCase.js';

export const NORMALIZER_SYSTEM_INSTRUCTION = `You convert ONE raw profile item description (a work experience, project, or activity) from a resume profile into clean professional resume evidence. The input may be informal English, Bangla, or Banglish (Bengali written in Latin script) — translate and professionalize it.

RULES
1. OUTPUT ENGLISH ONLY.
2. ZERO FABRICATION — every fact, number, tool, employer, and outcome must come from the input text. Never invent metrics, technologies, or scope. If the input is thin, output fewer bullets rather than padding.
3. bullets: 2-5 concise professional resume bullets. Each starts with a strong verb, 8-22 words, preserves every number/metric from the input EXACTLY as written. Do the heavy lifting yourself: surface implicit outcomes, scope, and skills the text already supports — make the entry as strong as the evidence honestly allows.
4. skills: tools, technologies, and competencies EXPLICITLY evidenced in the input (proper casing, e.g. "Node.js" not "nodejs"). Max 10. Empty array if none.
5. gaps: AT MOST ONE short, friendly hint — only when one clearly important thing is missing that the user alone can supply (almost always a missing number: team size, volume, money, or % improvement). One sentence, plain words, no jargon. If nothing important is missing, return an empty array. Never hint about phrasing or formatting — that is YOUR job, already done.

Return JSON only.`;

const KIND_LABELS: Record<string, string> = {
  experience: 'Work experience',
  project: 'Project',
  extracurricular: 'Activity / extracurricular',
};

export function buildNormalizerUserPrompt(text: string, context: ProfileItemContext): string {
  const lines = [`PROFILE ITEM${context.kind ? ` (${KIND_LABELS[context.kind] ?? context.kind})` : ''}`];
  if (context.title) lines.push(`Title/Role: ${context.title}`);
  if (context.organization) lines.push(`Company/Organization: ${context.organization}`);
  if (context.technologies) lines.push(`Tools/Technologies (user-listed): ${context.technologies}`);
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
