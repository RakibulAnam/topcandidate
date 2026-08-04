// POST /api/toolkit-item
//
// Single-item regenerate endpoint. Used by the per-item retry buttons
// (cover letter, outreach email, LinkedIn note, interview questions) in
// the Builder/Preview UI.
//
// Request:  { kind: 'coverLetter'|'outreachEmail'|'linkedInMessage'|'interviewQuestions', data: ResumeData }
// Response: { result: <typed-by-kind> }

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authenticate } from './_lib/auth.js';
import { assertWithinLimit, logCall, RateLimitError } from './_lib/rateLimit.js';
import { buildCallMeta } from './_lib/aiTelemetry.js';
import { publicAiError } from './_lib/aiErrorResponse.js';
import {
  coverLetterGenerator,
  outreachEmailGenerator,
  linkedInMessageGenerator,
  interviewQuestionsGenerator,
} from './_lib/aiFactory.js';
import type { ResumeData } from '../src/domain/entities/Resume';
import type { UsageSink } from '../src/infrastructure/ai/usage';

type Kind = 'coverLetter' | 'outreachEmail' | 'linkedInMessage' | 'interviewQuestions';

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
    console.warn(`[toolkit-item ${rid}] auth failed`);
    return;
  }

  const { kind, data } = (req.body ?? {}) as { kind?: Kind; data?: ResumeData };
  if (!kind || !data || !data.targetJob?.description) {
    console.warn(`[toolkit-item ${rid}] 400 missing kind or data kind=${kind}`);
    res.status(400).json({ error: 'Missing kind or resume data' });
    return;
  }
  // 503 BEFORE the rate-limit gate, matching every sibling AI endpoint
  // (optimize 66/71, optimize-general 33/38, toolkit 49/54, extract-resume
  // 34/58, normalize-item 46/67). This endpoint used to be the only one that
  // checked its generator INSIDE runItem — i.e. after the gate — so a
  // deployment with GEMINI_API_KEY unset spent one of the caller's 8 daily
  // toolkit_item slots to tell them the server is misconfigured. A config
  // problem must never be billed to the user's quota.
  if (!generatorFor(kind)) {
    console.error(`[toolkit-item ${rid}] 503 no AI provider configured kind=${kind}`);
    res.status(503).json({ error: 'No AI provider configured on server' });
    return;
  }

  console.info(`[toolkit-item ${rid}] start user=${auth.userId.slice(0, 8)} kind=${kind}`);

  try {
    // The 'toolkit_item' kind MUST be passed: assertWithinLimit only consults
    // KIND_DAILY_CAPS for the kind it is given, so omitting it silently skipped
    // the 8/day per-kind cap entirely and left this endpoint bounded only by the
    // overall 20/day — which was the whole exposure the cap exists to close.
    await assertWithinLimit(auth.userId, auth.jwt, 'toolkit_item');
  } catch (err) {
    if (err instanceof RateLimitError) {
      console.warn(`[toolkit-item ${rid}] 429 rate-limited used=${err.used}/${err.cap}`);
      res.status(429).json({ error: err.message, used: err.used, cap: err.cap, code: 'rate_limited' });
      return;
    }
    throw err;
  }

  // C5 (audit): one ai_call_log row per attempt past the rate-limit gate so
  // failed calls still count toward the daily cap. Logged at each terminal
  // point so the row carries telemetry.
  //
  // The provider/model were previously HARDCODED to 'gemini-2.5-flash' here
  // because runItem() discarded the generators' UsageSink — so this endpoint
  // reported a model it might not have used and never reported real tokens. The
  // sink is now threaded through, so the row carries the model that actually
  // served, real token counts, and the attempt chain. (It also mattered more
  // than it looked: gemini-2.5-flash is now 404 on this account, so the
  // hardcoded value would have priced every row against an unreachable model.)
  const tAI = Date.now();
  const usage: UsageSink = {};
  try {
    const result = await runItem(kind, data, usage);
    const latencyMs = Date.now() - tAI;
    const outText = typeof result === 'string' ? result : JSON.stringify(result ?? '');
    await logCall(
      auth.userId,
      auth.jwt,
      'toolkit_item',
      buildCallMeta({ usage, latencyMs, fallbackInputText: data.targetJob.description, fallbackOutputText: outText }),
    );
    console.info(`[toolkit-item ${rid}] 200 kind=${kind} total=${Date.now() - t0}ms`);
    res.status(200).json({ result });
  } catch (err) {
    const latencyMs = Date.now() - tAI;
    const msg = err instanceof Error ? err.message : 'Generation failed';
    await logCall(
      auth.userId,
      auth.jwt,
      'toolkit_item',
      buildCallMeta({ usage, latencyMs, error: err, fallbackInputText: data.targetJob.description }),
    );
    console.error(`[toolkit-item ${rid}] 502 kind=${kind} total=${Date.now() - t0}ms: ${msg}`);
    res.status(502).json(publicAiError(err));
  }
}

// One place that maps a kind to its generator, so the pre-gate 503 check above
// and runItem below can never disagree about what "configured" means.
function generatorFor(kind: Kind) {
  switch (kind) {
    case 'coverLetter': return coverLetterGenerator;
    case 'outreachEmail': return outreachEmailGenerator;
    case 'linkedInMessage': return linkedInMessageGenerator;
    case 'interviewQuestions': return interviewQuestionsGenerator;
    default: return null;
  }
}

// `usage` is filled in-place by whichever generator runs, so the caller can log
// the real model/tokens/attempt-chain instead of a hardcoded guess.
async function runItem(kind: Kind, data: ResumeData, usage: UsageSink): Promise<unknown> {
  const gen = generatorFor(kind);
  // Unreachable via the handler (guarded pre-gate) but kept as a real check so a
  // future caller can't skip it.
  if (!gen) throw new Error(`No generator configured for toolkit item kind: ${kind}`);
  switch (kind) {
    case 'coverLetter':
      return coverLetterGenerator!.generate(data, usage);
    case 'outreachEmail':
      return outreachEmailGenerator!.generate(data, usage);
    case 'linkedInMessage':
      return linkedInMessageGenerator!.generate(data, usage);
    case 'interviewQuestions':
      return interviewQuestionsGenerator!.generate(data, usage);
    default:
      throw new Error(`Unknown toolkit item kind: ${kind}`);
  }
}
