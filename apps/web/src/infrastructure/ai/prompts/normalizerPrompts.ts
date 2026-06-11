// Prompts for the profile-item normalizer ("polished profile").
//
// One cheap, deterministic call per profile item, run on SAVE (not per
// generation). Input is the user's raw brain dump — often informal English,
// Bangla, or Banglish (Bengali in Latin script). Output is canonical English
// resume evidence plus coaching gaps. The raw text is kept forever as the
// evidence source of truth; this is a rendering, not a replacement.

import type { ProfileItemContext } from '../../../domain/usecases/NormalizeProfileItemUseCase.js';

export const NORMALIZER_SYSTEM_INSTRUCTION = `You convert ONE raw work-experience description from a resume profile into clean professional resume evidence. The input may be informal English, Bangla, or Banglish (Bengali written in Latin script) — translate and professionalize it.

RULES
1. OUTPUT ENGLISH ONLY.
2. ZERO FABRICATION — every fact, number, tool, employer, and outcome must come from the input text. Never invent metrics, technologies, or scope. If the input is thin, output fewer bullets rather than padding.
3. bullets: 2-5 concise professional resume bullets. Each starts with a strong verb, 8-22 words, preserves every number/metric from the input EXACTLY as written.
4. skills: tools, technologies, and competencies EXPLICITLY evidenced in the input (proper casing, e.g. "Node.js" not "nodejs"). Max 10. Empty array if none.
5. gaps: 0-3 short coaching hints naming what is missing that would strengthen this entry (e.g. "No measurable outcome — add team size, volume handled, or % improvement", "No tools or methods named — mention what you used"). Empty array when nothing notable is missing. Write hints in simple, friendly English.

Return JSON only.`;

export function buildNormalizerUserPrompt(text: string, context: ProfileItemContext): string {
  const lines = ['PROFILE ITEM'];
  if (context.role) lines.push(`Role: ${context.role}`);
  if (context.company) lines.push(`Company/Organization: ${context.company}`);
  lines.push('', 'RAW DESCRIPTION (verbatim user input):', text);
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
