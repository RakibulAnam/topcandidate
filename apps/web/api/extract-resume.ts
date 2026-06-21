// POST /api/extract-resume
//
// Used by the resume-import flow in ProfileSetupScreen. Two input shapes, both
// `{ fileData, mimeType }` (the extractor branches on mimeType):
//   • mimeType 'text/plain' → `fileData` is resume TEXT the client already
//     pulled out with pdf.js (ResumeUploadStep.tsx). This is the normal path —
//     a few KB, nowhere near any body limit, so text PDFs of any size work.
//   • mimeType 'application/pdf' (etc.) → `fileData` is base64 of the raw file,
//     the scanned/image-PDF fallback for when there's no selectable text.
//
// Body-size note: Vercel hard-caps the serverless request body at 4.5MB BEFORE
// this handler runs, and base64 inflates the raw file ×1.333. That only bites
// the base64 FALLBACK path, so the client caps THAT at 3MB raw; the text path
// is unaffected. A `config.api.bodyParser` block does NOT apply here — that's
// legacy Next.js Pages-Router syntax, ignored by the @vercel/node runtime.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authenticate } from './_lib/auth.js';
import { assertWithinLimit, logCall, RateLimitError } from './_lib/rateLimit.js';
import { resolveCost } from './_lib/aiCost.js';
import { resumeExtractor } from './_lib/aiFactory.js';
import type { UsageSink } from '../src/infrastructure/ai/usage';

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
  // with provider/model + SDK token counts (the SDK virtually always reports
  // them, for both the text and the base64-file input paths). The fallback
  // estimate intentionally uses only the output JSON — for the file path the
  // input is a base64 document (estimating prompt tokens from its char count
  // would be wildly wrong), so we let prompt tokens fall to 0 if usage is
  // somehow absent.
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
