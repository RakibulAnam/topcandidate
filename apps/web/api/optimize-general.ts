// POST /api/optimize-general
//
// Master ("General") resume path — runs the resume optimizer only (no toolkit
// generator, no credit charge). Since migration 032 the master resume is a
// bonus of the FIRST pack: generating or regenerating it requires
// `profiles.master_resume_unlocked_at` (stamped by a trigger when a purchase
// completes). Users who already had one keep it; only new writes are gated.
// Beyond that, this endpoint enforces auth, the overall daily AI-call cap, AND
// a stricter per-kind cap (KIND_DAILY_CAPS, 5/day).
//
// Request:  { data: ResumeData }
// Response: { optimized: OptimizedResumeData }
//
// 401 if not authenticated; 402 `master_locked` if no pack bought yet;
// 429 if user over daily cap; 503 if no AI provider.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authenticate, userClient } from './_lib/auth.js';
import { reserveCall, logCall, RateLimitError } from './_lib/rateLimit.js';
import { buildCallMeta } from './_lib/aiTelemetry.js';
import { publicAiError } from './_lib/aiErrorResponse.js';
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

  // Master-resume unlock gate — checked before reserving a call so a locked
  // user doesn't burn their daily cap. Read under the user's own JWT (RLS:
  // own profile row). A DB hiccup fails open, matching the credit gate in
  // optimize.ts, so a Supabase blip never blocks paying users.
  const { data: profile, error: profileError } = await userClient(auth.jwt)
    .from('profiles')
    .select('master_resume_unlocked_at')
    .eq('id', auth.userId)
    .single();
  if (profileError) {
    console.warn(`[optimize-general] unlock check failed (fail-open): ${profileError.message}`);
  } else if (!profile?.master_resume_unlocked_at) {
    res.status(402).json({
      error: 'The master resume is included with your first pack.',
      code: 'master_locked',
    });
    return;
  }

  // Reserved BEFORE the provider call so a parallel burst cannot overshoot the
  // daily caps; null means reservation was unavailable and we failed open.
  let reservation: string | null = null;
  try {
    reservation = await reserveCall(auth.userId, auth.jwt, 'optimize_general');
  } catch (err) {
    if (err instanceof RateLimitError) {
      res.status(429).json({ error: err.message, used: err.used, cap: err.cap, code: 'rate_limited' });
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
    await logCall(
      auth.userId,
      auth.jwt,
      'optimize_general',
      buildCallMeta({ usage, latencyMs, fallbackInputText: data.targetJob?.description, fallbackOutputText: optimized.summary }),
      reservation,
    );
    res.status(200).json({ optimized });
  } catch (err) {
    const latencyMs = Date.now() - t0;
    const msg = err instanceof Error ? err.message : 'Optimizer failed';
    await logCall(
      auth.userId,
      auth.jwt,
      'optimize_general',
      buildCallMeta({ usage, latencyMs, error: err, fallbackInputText: data.targetJob?.description }),
      reservation,
    );
    res.status(502).json(publicAiError(err));
  }
}
