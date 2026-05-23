// Server-side construction of all AI providers + generators.
//
// Reads keys from `process.env.{GROQ,GEMINI}_API_KEY` (NOT VITE_-prefixed —
// we don't want them in the client bundle). Builds singletons reused across
// warm Vercel function invocations.
//
// Resume optimizer = MultiProviderResumeOptimizer (Groq → Gemini fallback).
// Toolkit / cover letter / outreach / LinkedIn / interview-Q / extractor =
// Gemini-only (haven't been ported to a multi-provider yet — all Gemini SDK
// uses are still server-only after this change, so still safe).

import { GeminiResumeOptimizer } from '../../src/infrastructure/ai/GeminiResumeOptimizer.js';
import { GroqResumeOptimizer } from '../../src/infrastructure/ai/GroqResumeOptimizer.js';
import {
  MultiProviderResumeOptimizer,
  NamedOptimizer,
} from '../../src/infrastructure/ai/MultiProviderResumeOptimizer.js';
import { GeminiToolkitGenerator } from '../../src/infrastructure/ai/GeminiToolkitGenerator.js';
import { GeminiCoverLetterGenerator } from '../../src/infrastructure/ai/GeminiCoverLetterGenerator.js';
import { GeminiOutreachEmailGenerator } from '../../src/infrastructure/ai/GeminiOutreachEmailGenerator.js';
import { GeminiLinkedInMessageGenerator } from '../../src/infrastructure/ai/GeminiLinkedInMessageGenerator.js';
import { GeminiInterviewQuestionsGenerator } from '../../src/infrastructure/ai/GeminiInterviewQuestionsGenerator.js';
import { GeminiResumeExtractor } from '../../src/infrastructure/ai/GeminiResumeExtractor.js';

const GROQ_KEY = process.env.GROQ_API_KEY ?? '';
const GEMINI_KEY = process.env.GEMINI_API_KEY ?? '';

if (!GROQ_KEY && !GEMINI_KEY) {
  console.error('[aiFactory] No AI provider keys configured. Set GROQ_API_KEY and/or GEMINI_API_KEY in Vercel env vars.');
}
if (!GEMINI_KEY) {
  console.warn('[aiFactory] GEMINI_API_KEY not set — toolkit/cover-letter/extractor will fail.');
}

// ── Resume optimizer (multi-provider) ───────────────────────────
const optimizerProviders: NamedOptimizer[] = [];
if (GROQ_KEY) {
  optimizerProviders.push({ name: 'groq', optimizer: new GroqResumeOptimizer(GROQ_KEY) });
}
if (GEMINI_KEY) {
  optimizerProviders.push({ name: 'gemini', optimizer: new GeminiResumeOptimizer(GEMINI_KEY) });
}
export const resumeOptimizer = optimizerProviders.length
  ? new MultiProviderResumeOptimizer(optimizerProviders)
  : null;

// ── Toolkit / regenerate generators ────────────────────────────
// Constructed lazily so a missing GEMINI_KEY doesn't crash the module load —
// the endpoints will return 503 with a clear message instead.
export const toolkitGenerator = GEMINI_KEY ? new GeminiToolkitGenerator(GEMINI_KEY) : null;
export const coverLetterGenerator = GEMINI_KEY ? new GeminiCoverLetterGenerator(GEMINI_KEY) : null;
export const outreachEmailGenerator = GEMINI_KEY ? new GeminiOutreachEmailGenerator(GEMINI_KEY) : null;
export const linkedInMessageGenerator = GEMINI_KEY ? new GeminiLinkedInMessageGenerator(GEMINI_KEY) : null;
export const interviewQuestionsGenerator = GEMINI_KEY ? new GeminiInterviewQuestionsGenerator(GEMINI_KEY) : null;
export const resumeExtractor = GEMINI_KEY ? new GeminiResumeExtractor(GEMINI_KEY) : null;
