// POST /api/optimize
//
// Hot path. Runs the resume optimizer + toolkit generator in parallel
// (matches the existing 2-call budget). Returns combined result so the
// client only makes one HTTP round-trip per generation.
//
// Request:  { data: ResumeData }
// Response: { optimized: OptimizedResumeData, toolkit: GeneratedToolkit }
//   `toolkit` always present; per-artifact validation failures land in
//   `toolkit.errors[<item>]` while successful artifacts populate their slot.
//
// 401 if not authenticated; 402 if user has no toolkit credits;
// 429 if user over daily cap; 503 if no AI provider configured.
//
// Credit flow:
//   1. consume_toolkit_credit() — atomic decrement before AI runs.
//      If balance was already 0, raises 'insufficient_credits' → 402.
//   2. If the optimizer call fails → refund_toolkit_credit() so the user
//      is not charged for a generation that produced nothing.
//   3. If the optimizer succeeds but the toolkit call fails entirely (network
//      / 5xx from Gemini, not a validation issue), the credit is kept —
//      the user got their resume, and per-item retries via /api/toolkit-item
//      are free.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authenticate, userClient } from './_lib/auth.js';
import { assertWithinLimit, logCall, RateLimitError } from './_lib/rateLimit.js';
import { resumeOptimizer, toolkitGenerator } from './_lib/aiFactory.js';
import type { ResumeData, GeneratedToolkit } from '../src/domain/entities/Resume';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Short correlation id for tracing a single generation across log lines and
  // (when surfaced via the x-request-id response header) across the client +
  // server boundary. Not auth — purely a debug aid.
  const rid = makeRid();
  const t0 = Date.now();
  res.setHeader('x-request-id', rid);

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const auth = await authenticate(req, res);
  if (!auth) {
    console.warn(`[optimize ${rid}] auth failed`);
    return;
  }
  const userTag = auth.userId.slice(0, 8);
  console.info(`[optimize ${rid}] start user=${userTag}`);

  if (!resumeOptimizer) {
    console.error(`[optimize ${rid}] 503 no AI provider configured`);
    res.status(503).json({ error: 'No AI provider configured on server' });
    return;
  }

  try {
    await assertWithinLimit(auth.userId, auth.jwt);
  } catch (err) {
    if (err instanceof RateLimitError) {
      console.warn(`[optimize ${rid}] 429 rate-limited used=${err.used}/${err.cap}`);
      res.status(429).json({ error: err.message, used: err.used, cap: err.cap });
      return;
    }
    throw err;
  }

  const data = req.body?.data as ResumeData | undefined;
  if (!data || !data.targetJob?.description) {
    console.warn(`[optimize ${rid}] 400 missing resume data`);
    res.status(400).json({ error: 'Missing or invalid resume data' });
    return;
  }
  console.info(`[optimize ${rid}] payload ok jdLen=${data.targetJob.description.length} exp=${data.experience?.length ?? 0} proj=${data.projects?.length ?? 0} skills=${data.skills?.length ?? 0}`);

  // ── Credit gate ───────────────────────────────────────────────────────────
  // Atomically decrement the user's toolkit_credits balance before running AI.
  // The security-definer RPC enforces that balance cannot go below 0 and that
  // the decrement is serialised at the row level (no race condition with a
  // concurrent request).
  const supabase = userClient(auth.jwt);
  const tCredit = Date.now();
  const { error: creditError } = await supabase.rpc('consume_toolkit_credit');

  if (creditError) {
    if (creditError.message?.includes('insufficient_credits')) {
      console.info(`[optimize ${rid}] 402 insufficient_credits (rpc=${Date.now() - tCredit}ms)`);
      res.status(402).json({
        error: 'No toolkit credits remaining. Purchase a pack to continue.',
        code: 'insufficient_credits',
      });
      return;
    }
    // Any other DB error: fail-open with a warning so a Supabase hiccup
    // doesn't silently block all users. Log it for visibility.
    console.warn(`[optimize ${rid}] credit RPC failed (fail-open): ${creditError.message}`);
  } else {
    console.info(`[optimize ${rid}] credit consumed (rpc=${Date.now() - tCredit}ms)`);
  }

  const creditConsumed = !creditError;

  // ── AI generation ─────────────────────────────────────────────────────────
  // Two AI calls in parallel — optimizer + combined toolkit. Promise.allSettled
  // so a toolkit failure doesn't kill the optimizer result.
  const tAI = Date.now();
  console.info(`[optimize ${rid}] AI start (optimizer + toolkit, parallel)`);
  const [optimizedResult, toolkitResult] = await Promise.allSettled([
    resumeOptimizer.optimize(data),
    toolkitGenerator ? toolkitGenerator.generate(data) : Promise.reject(new Error('Toolkit generator not configured')),
  ]);
  console.info(`[optimize ${rid}] AI done in ${Date.now() - tAI}ms optimizer=${optimizedResult.status} toolkit=${toolkitResult.status}`);

  if (optimizedResult.status === 'rejected') {
    const msg = optimizedResult.reason instanceof Error ? optimizedResult.reason.message : String(optimizedResult.reason);
    console.error(`[optimize ${rid}] optimizer rejected: ${msg}`);
    // Core artifact failed — refund the credit so the user isn't charged for
    // a generation that produced nothing.
    if (creditConsumed) {
      const { error: refundError } = await supabase.rpc('refund_toolkit_credit');
      if (refundError) {
        console.error(`[optimize ${rid}] credit refund failed: ${refundError.message}`);
      } else {
        console.info(`[optimize ${rid}] credit refunded`);
      }
    }
    res.status(502).json({ error: msg });
    return;
  }

  const optimized = optimizedResult.value;

  // Per-artifact validation lives inside GeminiToolkitGenerator — successful
  // slots populate themselves and validation failures land in `errors[<item>]`.
  // A hard failure here (network error, AI API down, no key) leaves every
  // slot empty and records the same reason for all four items.
  let toolkit: GeneratedToolkit;
  if (toolkitResult.status === 'fulfilled') {
    toolkit = toolkitResult.value;
    const slots = {
      coverLetter: !!toolkit.coverLetter,
      outreachEmail: !!toolkit.outreachEmail,
      linkedInMessage: !!toolkit.linkedInMessage,
      interviewQuestions: !!toolkit.interviewQuestions && toolkit.interviewQuestions.length > 0,
    };
    const errorKeys = Object.keys(toolkit.errors);
    if (errorKeys.length === 0) {
      console.info(`[optimize ${rid}] toolkit full slots=${JSON.stringify(slots)}`);
    } else {
      console.warn(`[optimize ${rid}] toolkit partial slots=${JSON.stringify(slots)} errors=${JSON.stringify(toolkit.errors)}`);
    }
  } else {
    const msg = toolkitResult.reason instanceof Error ? toolkitResult.reason.message : 'Toolkit failed';
    console.error(`[optimize ${rid}] toolkit hard-failed (credit kept): ${msg}`);
    toolkit = {
      errors: {
        coverLetter: msg,
        outreachEmail: msg,
        linkedInMessage: msg,
        interviewQuestions: msg,
      },
    };
  }

  // Log on success — only counts toward the user's daily cap if optimizer ran.
  await logCall(auth.userId, auth.jwt, 'optimize');

  console.info(`[optimize ${rid}] 200 total=${Date.now() - t0}ms`);
  res.status(200).json({ optimized, toolkit });
}

// 8-char base36 id, plenty for correlation inside a Vercel log stream.
function makeRid(): string {
  return Math.random().toString(36).slice(2, 10);
}
