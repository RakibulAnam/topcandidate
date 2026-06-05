// POST /api/optimize-general
//
// Free path — runs the resume optimizer only (no toolkit generator, no credit
// gate). Used exclusively for the General Resume feature, which is free for
// every user. The 24-hour cooldown between regenerations is enforced
// client-side by ResumeService; this endpoint only enforces auth and the
// existing daily AI-call cap so a single user can't drain provider quota.
//
// Request:  { data: ResumeData }
// Response: { optimized: OptimizedResumeData }
//
// 401 if not authenticated; 429 if user over daily cap; 503 if no AI provider.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authenticate } from './_lib/auth.js';
import { assertWithinLimit, logCall, RateLimitError } from './_lib/rateLimit.js';
import { resolveCost } from './_lib/aiCost.js';
import { resumeOptimizer } from './_lib/aiFactory.js';
import type { ResumeData } from '../src/domain/entities/Resume';
import type { UsageSink } from '../src/infrastructure/ai/usage';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const auth = await authenticate(req, res);
  if (!auth) return;

  if (!resumeOptimizer) {
    res.status(503).json({ error: 'No AI provider configured on server' });
    return;
  }

  try {
    await assertWithinLimit(auth.userId, auth.jwt);
  } catch (err) {
    if (err instanceof RateLimitError) {
      res.status(429).json({ error: err.message, used: err.used, cap: err.cap });
      return;
    }
    throw err;
  }

  const data = req.body?.data as ResumeData | undefined;
  if (!data) {
    res.status(400).json({ error: 'Missing resume data' });
    return;
  }
  if (data.targetJob?.description && data.targetJob.description.length > 20_000) {
    res.status(413).json({ error: 'Job description is too long (max 20,000 characters).', code: 'jd_too_long' });
    return;
  }

  // C5 (audit): one ai_call_log row per attempt past the rate-limit gate so
  // failed calls still count toward the daily cap. Logged at each terminal
  // point (success/error) so the row carries real cost/telemetry.
  const t0 = Date.now();
  const usage: UsageSink = {};
  try {
    const optimized = await resumeOptimizer.optimize(data, usage);
    const latencyMs = Date.now() - t0;
    const cost = resolveCost(usage, data.targetJob?.description, optimized.summary);
    await logCall(auth.userId, auth.jwt, 'optimize_general', {
      provider: cost.provider,
      model: cost.model,
      promptTokens: cost.promptTokens,
      completionTokens: cost.completionTokens,
      costUsd: cost.costUsd,
      status: 'success',
      latencyMs,
    });
    res.status(200).json({ optimized });
  } catch (err) {
    const latencyMs = Date.now() - t0;
    const msg = err instanceof Error ? err.message : 'Optimizer failed';
    const cost = resolveCost(usage, data.targetJob?.description);
    await logCall(auth.userId, auth.jwt, 'optimize_general', {
      provider: cost.provider,
      model: cost.model,
      promptTokens: cost.promptTokens,
      completionTokens: cost.completionTokens,
      costUsd: cost.costUsd,
      status: 'error',
      latencyMs,
    });
    res.status(502).json({ error: msg });
  }
}
