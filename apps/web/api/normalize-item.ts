// POST /api/normalize-item
//
// Profile-item normalization ("polished profile"). Converts one raw profile
// description (informal English / Bangla / Banglish) into canonical English
// resume evidence: bullets + evidenced skills + coaching gaps. Fired in the
// background when a profile item is saved with a changed description — NOT
// per generation; the result is stored beside the raw text and reused by
// every later resume/toolkit generation.
//
// Request:  { text: string, context?: { role?: string, company?: string } }
// Response: { result: NormalizedItemContent }
//
// Rate limiting: kind 'normalize' has its own per-kind daily cap and is
// EXCLUDED from the overall AI cap (see rateLimit.ts) — editing a profile
// must never starve the user's paid generations.
//
// 401 unauthenticated; 413 text > 4k chars; 429 over normalize cap;
// 503 no OpenRouter provider (legacy path has no normalizer — caller treats
// normalization as unavailable, profile saves are unaffected).

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authenticate } from './_lib/auth.js';
import { assertWithinLimit, logCall, RateLimitError } from './_lib/rateLimit.js';
import { resolveCost } from './_lib/aiCost.js';
import { profileNormalizer } from './_lib/aiFactory.js';
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
    console.warn(`[normalize ${rid}] auth failed`);
    return;
  }

  if (!profileNormalizer) {
    console.warn(`[normalize ${rid}] 503 normalizer unavailable (legacy AI path)`);
    res.status(503).json({ error: 'Profile normalization is not available.', code: 'normalizer_unavailable' });
    return;
  }

  // context is passed straight through to the normalizer (kind/title/
  // organization/technologies/guided). Typed loosely here; the prompt builder
  // owns the real shape (ProfileItemContext).
  const { text, context } = (req.body ?? {}) as {
    text?: string;
    context?: Record<string, unknown>;
  };
  if (!text || !text.trim()) {
    res.status(400).json({ error: 'Missing text' });
    return;
  }
  if (text.length > 4_000) {
    res.status(413).json({ error: 'Description is too long (max 4,000 characters).', code: 'text_too_long' });
    return;
  }

  try {
    await assertWithinLimit(auth.userId, auth.jwt, 'normalize');
  } catch (err) {
    if (err instanceof RateLimitError) {
      console.warn(`[normalize ${rid}] 429 rate-limited used=${err.used}/${err.cap}`);
      res.status(429).json({ error: err.message, used: err.used, cap: err.cap });
      return;
    }
    throw err;
  }

  const tAI = Date.now();
  const usage: UsageSink = {};
  try {
    const result = await profileNormalizer.normalize(text, context ?? {}, usage);
    const latencyMs = Date.now() - tAI;
    const cost = resolveCost(usage, text, JSON.stringify(result));
    await logCall(auth.userId, auth.jwt, 'normalize', {
      provider: cost.provider,
      model: cost.model,
      promptTokens: cost.promptTokens,
      completionTokens: cost.completionTokens,
      costUsd: cost.costUsd,
      status: 'success',
      latencyMs,
    });
    console.info(`[normalize ${rid}] 200 total=${Date.now() - t0}ms bullets=${result.bullets.length} gaps=${result.gaps.length}`);
    res.status(200).json({ result });
  } catch (err) {
    const latencyMs = Date.now() - tAI;
    const msg = err instanceof Error ? err.message : 'Normalization failed';
    const cost = resolveCost(usage, text);
    await logCall(auth.userId, auth.jwt, 'normalize', {
      provider: cost.provider,
      model: cost.model,
      promptTokens: cost.promptTokens,
      completionTokens: cost.completionTokens,
      costUsd: cost.costUsd,
      status: 'error',
      latencyMs,
    });
    console.error(`[normalize ${rid}] 502 total=${Date.now() - t0}ms: ${msg}`);
    res.status(502).json({ error: msg });
  }
}
