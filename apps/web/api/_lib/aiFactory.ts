// Server-side construction of all AI providers + generators.
//
// Cutover (OpenRouter migration Phase 6): if OPENROUTER_API_KEY is set, the
// entire AI surface runs through OpenRouter (one key → DeepSeek optimizer +
// Gemini-flash toolkit/single-artifact + Gemini-flash-lite extractor, each with
// its own fallback chain). If the key is ABSENT, we fall back to the legacy
// Groq→Gemini optimizer + the Gemini SDK generators — unchanged. This makes the
// flip a single Vercel env var, and the rollback equally simple: remove
// OPENROUTER_API_KEY (keep GROQ/GEMINI keys present one cycle as the panic
// switch). @google/genai stays a dependency until OpenRouter is proven in prod.
//
// All keys are read from process.env (NOT VITE_-prefixed) so none reach the
// client bundle. Singletons reused across warm Vercel invocations.

// Legacy (Groq + Gemini direct) — kept as the no-OPENROUTER_API_KEY fallback.
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

// OpenRouter (single-key) — the active path when OPENROUTER_API_KEY is set.
import { OpenRouterResumeOptimizer } from '../../src/infrastructure/ai/OpenRouterResumeOptimizer.js';
import { OpenRouterToolkitGenerator } from '../../src/infrastructure/ai/OpenRouterToolkitGenerator.js';
import { OpenRouterCoverLetterGenerator } from '../../src/infrastructure/ai/OpenRouterCoverLetterGenerator.js';
import { OpenRouterOutreachEmailGenerator } from '../../src/infrastructure/ai/OpenRouterOutreachEmailGenerator.js';
import { OpenRouterLinkedInMessageGenerator } from '../../src/infrastructure/ai/OpenRouterLinkedInMessageGenerator.js';
import { OpenRouterInterviewQuestionsGenerator } from '../../src/infrastructure/ai/OpenRouterInterviewQuestionsGenerator.js';
import { OpenRouterResumeExtractor } from '../../src/infrastructure/ai/OpenRouterResumeExtractor.js';

const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY ?? '';
const GROQ_KEY = process.env.GROQ_API_KEY ?? '';
const GEMINI_KEY = process.env.GEMINI_API_KEY ?? '';

const useOpenRouter = !!OPENROUTER_KEY;

if (!OPENROUTER_KEY && !GROQ_KEY && !GEMINI_KEY) {
  console.error('[aiFactory] No AI provider keys configured. Set OPENROUTER_API_KEY (preferred) or GROQ_API_KEY/GEMINI_API_KEY in Vercel env vars.');
}
if (useOpenRouter) {
  console.info('[aiFactory] OpenRouter active (single-key path).');
} else {
  console.info('[aiFactory] OpenRouter key absent — using legacy Groq/Gemini path.');
  if (!GEMINI_KEY) {
    console.warn('[aiFactory] GEMINI_API_KEY not set — legacy toolkit/cover-letter/extractor will fail.');
  }
}

// ── Legacy optimizer (multi-provider) — only built on the fallback path ──────
function buildLegacyOptimizer(): MultiProviderResumeOptimizer | null {
  const optimizerProviders: NamedOptimizer[] = [];
  if (GROQ_KEY) {
    optimizerProviders.push({ name: 'groq', optimizer: new GroqResumeOptimizer(GROQ_KEY) });
  }
  if (GEMINI_KEY) {
    optimizerProviders.push({ name: 'gemini', optimizer: new GeminiResumeOptimizer(GEMINI_KEY) });
  }
  return optimizerProviders.length ? new MultiProviderResumeOptimizer(optimizerProviders) : null;
}

// ── Active wiring ────────────────────────────────────────────────────────────
// Each export is null only if neither path can serve it (no key) → the endpoint
// returns 503 with a clear message rather than crashing module load.
export const resumeOptimizer = useOpenRouter
  ? new OpenRouterResumeOptimizer(OPENROUTER_KEY)
  : buildLegacyOptimizer();

export const toolkitGenerator = useOpenRouter
  ? new OpenRouterToolkitGenerator(OPENROUTER_KEY)
  : (GEMINI_KEY ? new GeminiToolkitGenerator(GEMINI_KEY) : null);

export const coverLetterGenerator = useOpenRouter
  ? new OpenRouterCoverLetterGenerator(OPENROUTER_KEY)
  : (GEMINI_KEY ? new GeminiCoverLetterGenerator(GEMINI_KEY) : null);

export const outreachEmailGenerator = useOpenRouter
  ? new OpenRouterOutreachEmailGenerator(OPENROUTER_KEY)
  : (GEMINI_KEY ? new GeminiOutreachEmailGenerator(GEMINI_KEY) : null);

export const linkedInMessageGenerator = useOpenRouter
  ? new OpenRouterLinkedInMessageGenerator(OPENROUTER_KEY)
  : (GEMINI_KEY ? new GeminiLinkedInMessageGenerator(GEMINI_KEY) : null);

export const interviewQuestionsGenerator = useOpenRouter
  ? new OpenRouterInterviewQuestionsGenerator(OPENROUTER_KEY)
  : (GEMINI_KEY ? new GeminiInterviewQuestionsGenerator(GEMINI_KEY) : null);

export const resumeExtractor = useOpenRouter
  ? new OpenRouterResumeExtractor(OPENROUTER_KEY)
  : (GEMINI_KEY ? new GeminiResumeExtractor(GEMINI_KEY) : null);
