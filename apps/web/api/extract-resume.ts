// POST /api/extract-resume
//
// Used by the resume-import flow in ProfileSetupScreen. Client uploads the
// file as base64 + mimeType (the existing GeminiResumeExtractor already
// expects this shape, so the client adapter just forwards). Body can be
// large (PDFs); Vercel default body limit is 4.5MB which suits us.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authenticate } from './_lib/auth.js';
import { assertWithinLimit, logCall, RateLimitError } from './_lib/rateLimit.js';
import { resumeExtractor } from './_lib/aiFactory.js';

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

  try {
    await assertWithinLimit(auth.userId, auth.jwt);
  } catch (err) {
    if (err instanceof RateLimitError) {
      res.status(429).json({ error: err.message, used: err.used, cap: err.cap });
      return;
    }
    throw err;
  }

  try {
    const result = await resumeExtractor.extract(fileData, mimeType);
    await logCall(auth.userId, auth.jwt, 'extract_resume');
    res.status(200).json({ result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Extraction failed';
    res.status(502).json({ error: msg });
  }
}
