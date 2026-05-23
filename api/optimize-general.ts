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
import { resumeOptimizer } from './_lib/aiFactory.js';
import type { ResumeData } from '../src/domain/entities/Resume';

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

  try {
    const optimized = await resumeOptimizer.optimize(data);
    await logCall(auth.userId, auth.jwt, 'optimize');
    res.status(200).json({ optimized });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Optimizer failed';
    res.status(502).json({ error: msg });
  }
}
