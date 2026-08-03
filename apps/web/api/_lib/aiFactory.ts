// Server-side construction of all AI providers + generators.
//
// SINGLE PROVIDER: direct Google Gemini, one key (GEMINI_API_KEY). OpenRouter and
// Groq are gone. Every generator is a Gemini* class on GeminiClient, and each
// carries its own ordered model-fallback chain (Google has no server-side
// models[] equivalent, so the chain is walked client-side).
//
// WHY WE LEFT OPENROUTER: Gemini calls ran on OpenRouter's POOLED Google
// credentials, so ~30% failed with a shared-pool 429 that arrived as HTTP 200 +
// finish_reason='error' — a shape OpenRouter's own fallback did not route
// around. Buying OpenRouter credits does not buy Google quota. Our own key does.
//
// WHY GROQ WENT TOO: the Groq→Gemini `MultiProviderResumeOptimizer` was only
// reachable when OPENROUTER_API_KEY was unset, i.e. effectively never, and its
// llama-3.3-70b is weak at Bengali — so the bilingual toolkit it would have
// served was not an acceptable degradation. It was nominal resilience, not real.
//
// ⚠️ CONCENTRATION RISK, ACCEPTED KNOWINGLY: every model in every chain is
// Google, so a Google-wide outage takes down all six workloads at once. The
// former non-Google last resort (Llama, via OpenRouter) is gone. Adding a second
// provider later is cheap — the domain interfaces (IResumeOptimizer,
// IToolkitGenerator, …) are what the app depends on, not these classes — but it
// is a deliberate future decision, not an oversight.
//
// Model assignment is evidence-based, measured 2026-08-04 via
// `npm run ai:bench` (see scripts/ai-probe.ts):
//   • gemini-3.5-flash-lite leads EVERY chain. Google's own documented
//     replacement for gemini-2.5-flash at identical pricing ($0.30/$2.50), and
//     measured fastest (optimizer 1.9s vs 11.9s for 3.6-flash), 0 thought
//     tokens, and the cleanest Bengali of the three (0.000 Latin contamination
//     vs 0.034 for 3.6-flash).
//   • gemini-3.6-flash is the paid-path fallback only. It costs 4x more, ran 6x
//     slower, and produced WORSE Bengali — there is no case for it as primary.
//   • gemini-3.1-flash-lite is the cheap fallback, and primary-adjacent for the
//     mechanical utility paths. It writes noticeably thinner prose (790-char
//     cover letter vs 2133), so it is not fronted on artifact-quality paths.
//   • gemini-2.5-* is UNREACHABLE on this account — HTTP 404 "no longer
//     available to new users", including versioned aliases. Do not reintroduce.
//
// All keys are read from process.env (NOT VITE_-prefixed) so none reach the
// client bundle. Singletons reused across warm Vercel invocations.

import { GeminiResumeOptimizer } from '../../src/infrastructure/ai/GeminiResumeOptimizer.js';
import { GeminiToolkitGenerator } from '../../src/infrastructure/ai/GeminiToolkitGenerator.js';
import { GeminiCoverLetterGenerator } from '../../src/infrastructure/ai/GeminiCoverLetterGenerator.js';
import { GeminiOutreachEmailGenerator } from '../../src/infrastructure/ai/GeminiOutreachEmailGenerator.js';
import { GeminiLinkedInMessageGenerator } from '../../src/infrastructure/ai/GeminiLinkedInMessageGenerator.js';
import { GeminiInterviewQuestionsGenerator } from '../../src/infrastructure/ai/GeminiInterviewQuestionsGenerator.js';
import { GeminiResumeExtractor } from '../../src/infrastructure/ai/GeminiResumeExtractor.js';
import { GeminiProfileNormalizer } from '../../src/infrastructure/ai/GeminiProfileNormalizer.js';

const GEMINI_KEY = process.env.GEMINI_API_KEY ?? '';

if (!GEMINI_KEY) {
  console.error(
    '[aiFactory] GEMINI_API_KEY is not set — every AI endpoint will return 503. ' +
      'Set it in the Vercel project env vars.',
  );
} else {
  console.info('[aiFactory] Gemini active (direct Google API, single key).');
}

// Each export is null only when the key is absent → the endpoint returns 503
// with a clear message rather than crashing at module load.
export const resumeOptimizer = GEMINI_KEY ? new GeminiResumeOptimizer(GEMINI_KEY) : null;
export const toolkitGenerator = GEMINI_KEY ? new GeminiToolkitGenerator(GEMINI_KEY) : null;
export const coverLetterGenerator = GEMINI_KEY ? new GeminiCoverLetterGenerator(GEMINI_KEY) : null;
export const outreachEmailGenerator = GEMINI_KEY ? new GeminiOutreachEmailGenerator(GEMINI_KEY) : null;
export const linkedInMessageGenerator = GEMINI_KEY ? new GeminiLinkedInMessageGenerator(GEMINI_KEY) : null;
export const interviewQuestionsGenerator = GEMINI_KEY ? new GeminiInterviewQuestionsGenerator(GEMINI_KEY) : null;
export const resumeExtractor = GEMINI_KEY ? new GeminiResumeExtractor(GEMINI_KEY) : null;
export const profileNormalizer = GEMINI_KEY ? new GeminiProfileNormalizer(GEMINI_KEY) : null;
