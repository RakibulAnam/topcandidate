// POST /api/extract-resume
//
// Used by the resume-import flow in ProfileSetupScreen. Client uploads the
// file as base64 + mimeType (the existing GeminiResumeExtractor already
// expects this shape, so the client adapter just forwards). Body can be
// large (PDFs); Vercel default body limit is 4.5MB which suits us.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authenticate } from './_lib/auth.js';
import { assertWithinLimit, logCall, RateLimitError } from './_lib/rateLimit.js';
import { resolveCost } from './_lib/aiCost.js';
import { resumeExtractor } from './_lib/aiFactory.js';
import type { UsageSink } from '../src/infrastructure/ai/usage';

export const config = {
  api: {
    bodyParser: { sizeLimit: '6mb' },
  },
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const auth = await authenticate(req, res);
  if (!auth) return;

  if (!resumeExtractor) {
    res.status(503).json({ error: 'Resume extractor not configured on server' });
    return;
  }

  const { fileData, mimeType } = (req.body ?? {}) as { fileData?: string; mimeType?: string };
  if (!fileData || !mimeType) {
    res.status(400).json({ error: 'Missing fileData or mimeType' });
    return;
  }

  // mimeType whitelist (audit M3). Without this, an attacker with a valid
  // JWT can pass arbitrary base64 and a plausible mime to waste AI quota.
  const ALLOWED_MIMES = new Set([
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
  ]);
  if (!ALLOWED_MIMES.has(mimeType)) {
    res.status(415).json({ error: `Unsupported file type: ${mimeType}. Use PDF or Word.`, code: 'unsupported_media_type' });
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

  // C5 (audit): one ai_call_log row per attempt past the rate-limit gate so
  // failed calls still count toward the daily cap. Logged at each terminal
  // point so the row carries real cost/telemetry. The extractor fills `usage`
  // with provider/model + SDK token counts. Fallback token estimate uses the
  // output JSON only — the input is a base64 document, not text, so estimating
  // prompt tokens from its char count would be wildly wrong; we let it fall to
  // 0 if the SDK omits usage (it virtually always reports it).
  const t0 = Date.now();
  const usage: UsageSink = {};
  try {
    const result = await resumeExtractor.extract(fileData, mimeType, usage);
    const latencyMs = Date.now() - t0;
    const cost = resolveCost(usage, undefined, JSON.stringify(result ?? ''));
    await logCall(auth.userId, auth.jwt, 'extract_resume', {
      provider: cost.provider,
      model: cost.model,
      promptTokens: cost.promptTokens,
      completionTokens: cost.completionTokens,
      costUsd: cost.costUsd,
      status: 'success',
      latencyMs,
    });
    res.status(200).json({ result });
  } catch (err) {
    const latencyMs = Date.now() - t0;
    const msg = err instanceof Error ? err.message : 'Extraction failed';
    const cost = resolveCost(usage);
    await logCall(auth.userId, auth.jwt, 'extract_resume', {
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
