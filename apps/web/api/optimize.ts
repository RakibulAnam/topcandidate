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
import { createClient } from '@supabase/supabase-js';
import { authenticate } from './_lib/auth.js';
import { assertWithinLimit, logCall, RateLimitError } from './_lib/rateLimit.js';
import { resolveCost } from './_lib/aiCost.js';
import { resumeOptimizer, toolkitGenerator } from './_lib/aiFactory.js';
import type { ResumeData, GeneratedToolkit } from '../src/domain/entities/Resume';
import type { UsageSink } from '../src/infrastructure/ai/usage';

// Service-role client for credit RPCs. Migration 008 locked consume/refund
// to service_role only — end-user JWTs no longer have EXECUTE. The userId
// is passed explicitly (the RPCs no longer read auth.uid()).
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

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
  // Server-side payload cap (M4 from the 2026-05-30 audit). Gemini's context
  // window can handle far more, but we cap to keep AI cost bounded and to
  // refuse pathological inputs early. 20k chars ≈ 5k tokens, far past the
  // longest real JD we've seen in production.
  if (data.targetJob.description.length > 20_000) {
    console.warn(`[optimize ${rid}] 413 jd too long jdLen=${data.targetJob.description.length}`);
    res.status(413).json({ error: 'Job description is too long (max 20,000 characters).', code: 'jd_too_long' });
    return;
  }
  console.info(`[optimize ${rid}] payload ok jdLen=${data.targetJob.description.length} exp=${data.experience?.length ?? 0} proj=${data.projects?.length ?? 0} skills=${data.skills?.length ?? 0}`);

  // C5 (audit): every attempt past the rate-limit gate must write exactly ONE
  // ai_call_log row so failed/aborted calls still count toward the per-user
  // daily cap (default 20/day) — a valid JWT must not be able to spam-fail the
  // optimizer to burn Groq's shared RPD quota. We now log once at each terminal
  // point (instead of up-front) so the single row can also carry real
  // cost/telemetry (provider/model/tokens/cost/status/latency) when AI ran.
  // Helper closes over the rate-limit identity so each call site stays terse.

  // ── Credit gate ───────────────────────────────────────────────────────────
  // Atomically decrement the user's toolkit_credits balance before running AI.
  // Migration 008 locked the RPCs to service_role only — we pass userId
  // explicitly. The function still enforces balance ≥ 0 at the row level
  // via the WHERE clause + RETURNING idiom (no race with a concurrent call).
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error(`[optimize ${rid}] 503 service-role not configured`);
    await logCall(auth.userId, auth.jwt, 'optimize', { status: 'error' });
    res.status(503).json({ error: 'Server is not configured for credit accounting.' });
    return;
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const tCredit = Date.now();
  const { error: creditError } = await supabase.rpc('consume_toolkit_credit', {
    p_user_id: auth.userId,
  });

  if (creditError) {
    if (creditError.message?.includes('insufficient_credits')) {
      console.info(`[optimize ${rid}] 402 insufficient_credits (rpc=${Date.now() - tCredit}ms)`);
      // Counts toward the daily cap (C5) — no AI ran, so no telemetry.
      await logCall(auth.userId, auth.jwt, 'optimize', { status: 'error' });
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
  // Telemetry sink — the optimizer (Groq primary / Gemini fallback via the
  // multi-provider router) fills in the provider/model that actually served
  // the request plus token counts. Additive: does not change the hot path.
  const optUsage: UsageSink = {};
  const [optimizedResult, toolkitResult] = await Promise.allSettled([
    resumeOptimizer.optimize(data, optUsage),
    toolkitGenerator ? toolkitGenerator.generate(data) : Promise.reject(new Error('Toolkit generator not configured')),
  ]);
  const latencyMs = Date.now() - tAI;
  console.info(`[optimize ${rid}] AI done in ${latencyMs}ms optimizer=${optimizedResult.status} toolkit=${toolkitResult.status}`);

  if (optimizedResult.status === 'rejected') {
    const msg = optimizedResult.reason instanceof Error ? optimizedResult.reason.message : String(optimizedResult.reason);
    console.error(`[optimize ${rid}] optimizer rejected: ${msg}`);
    // Telemetry row (status=error). Tokens estimated from the input JD when the
    // provider didn't report usage on the failed attempt.
    {
      const cost = resolveCost(optUsage, data.targetJob.description);
      await logCall(auth.userId, auth.jwt, 'optimize', {
        provider: cost.provider,
        model: cost.model,
        promptTokens: cost.promptTokens,
        completionTokens: cost.completionTokens,
        costUsd: cost.costUsd,
        status: 'error',
        latencyMs,
      });
    }
    // Core artifact failed — refund the credit so the user isn't charged for
    // a generation that produced nothing. If the refund itself fails the user
    // HAS been charged for nothing — that must never be silent: tell the
    // client (code: refund_failed) so the UI can direct them to support, and
    // log loudly so the operator can reconcile via the credit_ledger.
    let refundFailed = false;
    if (creditConsumed) {
      const { error: refundError } = await supabase.rpc('refund_toolkit_credit', {
        p_user_id: auth.userId,
      });
      if (refundError) {
        refundFailed = true;
        console.error(`[optimize ${rid}] REFUND FAILED user=${auth.userId}: ${refundError.message} — credit charged with no resume delivered, manual reconciliation needed`);
      } else {
        console.info(`[optimize ${rid}] credit refunded`);
      }
    }
    if (refundFailed) {
      res.status(502).json({
        error: 'Generation failed and the automatic credit refund also failed. Your credit will be restored — contact support if it is not back within a few hours.',
        code: 'refund_failed',
      });
    } else {
      res.status(502).json({ error: msg });
    }
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

  // Success telemetry (status=success). Fallback token estimate uses the JD
  // (input) + the optimized summary (output) when the provider omitted usage.
  {
    const cost = resolveCost(
      optUsage,
      data.targetJob.description,
      optimized.summary
    );
    await logCall(auth.userId, auth.jwt, 'optimize', {
      provider: cost.provider,
      model: cost.model,
      promptTokens: cost.promptTokens,
      completionTokens: cost.completionTokens,
      costUsd: cost.costUsd,
      status: 'success',
      latencyMs,
    });
  }

  console.info(`[optimize ${rid}] 200 total=${Date.now() - t0}ms`);
  res.status(200).json({ optimized, toolkit });
}

// 8-char base36 id, plenty for correlation inside a Vercel log stream.
function makeRid(): string {
  return Math.random().toString(36).slice(2, 10);
}
