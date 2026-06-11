// POST /api/toolkit
//
// Combined toolkit bundle (cover letter + outreach email + LinkedIn note +
// interview questions) on its OWN function invocation. Split off /api/optimize
// (2026-06-11) so the slower toolkit half can never push the optimizer request
// past Vercel's 60s cap — the exact failure mode behind the 2026-06-10 504
// hotfix — and so the client can show the tailored resume as soon as the
// optimizer returns while the toolkit keeps generating.
//
// Request:  { data: ResumeData }
// Response: { toolkit: GeneratedToolkit }
//   `toolkit` is always present on 200; per-artifact validation failures land
//   in `toolkit.errors[<item>]` while successful artifacts populate their slot.
//
// No credit gate: the credit for a paid generation is consumed by
// /api/optimize. This endpoint is free in the same sense /api/toolkit-item is
// (per-item retries) — its only backstop is auth + the daily AI-call cap,
// matching the pre-split economics where toolkit cost rode along with the
// optimizer's credit.
//
// 401 if not authenticated; 429 over daily cap; 503 if no AI provider.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authenticate } from './_lib/auth.js';
import { assertWithinLimit, logCall, RateLimitError } from './_lib/rateLimit.js';
import { resolveCost } from './_lib/aiCost.js';
import { toolkitGenerator } from './_lib/aiFactory.js';
import type { ResumeData } from '../src/domain/entities/Resume';
import type { UsageSink } from '../src/infrastructure/ai/usage';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const rid = Math.random().toString(36).slice(2, 10);
  const t0 = Date.now();
  res.setHeader('x-request-id', rid);

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const auth = await authenticate(req, res);
  if (!auth) {
    console.warn(`[toolkit ${rid}] auth failed`);
    return;
  }

  if (!toolkitGenerator) {
    console.error(`[toolkit ${rid}] 503 no AI provider configured`);
    res.status(503).json({ error: 'No AI provider configured on server' });
    return;
  }

  try {
    await assertWithinLimit(auth.userId, auth.jwt);
  } catch (err) {
    if (err instanceof RateLimitError) {
      console.warn(`[toolkit ${rid}] 429 rate-limited used=${err.used}/${err.cap}`);
      res.status(429).json({ error: err.message, used: err.used, cap: err.cap });
      return;
    }
    throw err;
  }

  const data = req.body?.data as ResumeData | undefined;
  if (!data || !data.targetJob?.description) {
    console.warn(`[toolkit ${rid}] 400 missing resume data`);
    res.status(400).json({ error: 'Missing or invalid resume data' });
    return;
  }
  if (data.targetJob.description.length > 20_000) {
    console.warn(`[toolkit ${rid}] 413 jd too long jdLen=${data.targetJob.description.length}`);
    res.status(413).json({ error: 'Job description is too long (max 20,000 characters).', code: 'jd_too_long' });
    return;
  }
  console.info(`[toolkit ${rid}] start user=${auth.userId.slice(0, 8)} jdLen=${data.targetJob.description.length}`);

  // C5 (audit): one ai_call_log row per attempt past the rate-limit gate,
  // logged at each terminal point so the row carries real telemetry.
  const tAI = Date.now();
  const usage: UsageSink = {};
  try {
    const toolkit = await toolkitGenerator.generate(data, usage);
    const latencyMs = Date.now() - tAI;
    const errorKeys = Object.keys(toolkit.errors);
    if (errorKeys.length === 0) {
      console.info(`[toolkit ${rid}] full bundle in ${latencyMs}ms`);
    } else {
      console.warn(`[toolkit ${rid}] partial bundle in ${latencyMs}ms errors=${JSON.stringify(toolkit.errors)}`);
    }
    const outText = JSON.stringify(toolkit);
    const cost = resolveCost(usage, data.targetJob.description, outText);
    await logCall(auth.userId, auth.jwt, 'toolkit', {
      provider: cost.provider,
      model: cost.model,
      promptTokens: cost.promptTokens,
      completionTokens: cost.completionTokens,
      costUsd: cost.costUsd,
      status: 'success',
      latencyMs,
    });
    console.info(`[toolkit ${rid}] 200 total=${Date.now() - t0}ms`);
    res.status(200).json({ toolkit });
  } catch (err) {
    const latencyMs = Date.now() - tAI;
    const msg = err instanceof Error ? err.message : 'Toolkit generation failed';
    const cost = resolveCost(usage, data.targetJob.description);
    await logCall(auth.userId, auth.jwt, 'toolkit', {
      provider: cost.provider,
      model: cost.model,
      promptTokens: cost.promptTokens,
      completionTokens: cost.completionTokens,
      costUsd: cost.costUsd,
      status: 'error',
      latencyMs,
    });
    console.error(`[toolkit ${rid}] 502 total=${Date.now() - t0}ms: ${msg}`);
    res.status(502).json({ error: msg });
  }
}
