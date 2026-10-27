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
// Request:  { data: ResumeData, preview?: true }
// Response: { optimized: OptimizedResumeData }   (build)
//           { summary: string }                  (preview)
//
// PREVIEW MODE (migration 034): the dashboard shows a locked account its own
// master resume, summary readable and the rest blurred, priced at ৳99. The
// summary must be the one they will get, so preview mode runs the real master
// build once, stores the whole result in `master_previews` (service role only —
// it is the paid product) and returns ONLY the summary. It skips the unlock
// gate for that reason. A later build whose profile hash still matches reuses
// the stored result instead of calling the AI again. Both lookups happen before
// a call is reserved, so a cache hit never spends the daily cap.
//
// 401 if not authenticated; 402 `master_locked` if no pack bought yet (build
// only); 429 if user over daily cap; 503 if no AI provider.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authenticate, userClient } from './_lib/auth.js';
import { reserveCall, logCall, RateLimitError } from './_lib/rateLimit.js';
import { buildCallMeta } from './_lib/aiTelemetry.js';
import { publicAiError } from './_lib/aiErrorResponse.js';
import { resumeOptimizer } from './_lib/aiFactory.js';
import { serviceClient } from './_lib/serviceClient.js';
import { computeProfileHash } from '../src/application/validation/profileHash.js';
import type { OptimizedResumeData, ResumeData } from '../src/domain/entities/Resume';
import type { UsageSink } from '../src/infrastructure/ai/usage';

// Order-independent copy of a profile list: by id for rows, by value for
// plain strings (skills). The repository reads order by date / created_at with
// no tiebreaker, so tied rows (a bulk import, empty dates) can come back in a
// different order on the next read — and the preview the user read must still
// match the build they pay for. Reordering is safe: mergeOptimizedData
// matches optimizer output back to rows by id.
function canonicalList(list: unknown[] | undefined): unknown[] {
  const key = (v: unknown) =>
    v && typeof v === 'object' && 'id' in v ? String((v as { id: unknown }).id) : JSON.stringify(v);
  return [...(list ?? [])].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}

// What the stored preview is keyed on: the user-entered profile content.
function previewHashOf(d: ResumeData): string {
  return computeProfileHash({
    personalInfo: d.personalInfo,
    experiences: canonicalList(d.experience),
    projects: canonicalList(d.projects),
    educations: canonicalList(d.education),
    skills: canonicalList(d.skills),
    extracurriculars: canonicalList(d.extracurriculars),
    awards: canonicalList(d.awards),
    certifications: canonicalList(d.certifications),
    affiliations: canonicalList(d.affiliations),
    publications: canonicalList(d.publications),
    languages: canonicalList(d.languages),
    references: canonicalList(d.references),
  });
}

type StoredPreview = { summary: string; optimized: OptimizedResumeData };

// The stored build for this exact profile. Never throws. `ok: false` means the
// store could not be read (no service key, table missing, DB error): a paid
// build just builds, but preview mode refuses — without the store every
// dashboard visit would be a fresh, uncached AI build.
async function storedPreview(userId: string, hash: string): Promise<{ ok: boolean; row: StoredPreview | null }> {
  const db = serviceClient();
  if (!db) return { ok: false, row: null };
  const { data, error } = await db
    .from('master_previews')
    .select('profile_hash, summary, optimized')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    console.warn(`[optimize-general] preview read failed: ${error.message}`);
    return { ok: false, row: null };
  }
  if (!data || data.profile_hash !== hash) return { ok: true, row: null };
  return { ok: true, row: { summary: data.summary, optimized: data.optimized as OptimizedResumeData } };
}

const previewUnavailable = (res: VercelResponse) =>
  res.status(503).json({ error: 'Resume preview is unavailable right now.', code: 'preview_unavailable' });

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

  const preview = req.body?.preview === true;

  // Master-resume unlock gate — checked before reserving a call so a locked
  // user doesn't burn their daily cap. Skipped in preview mode: previews are
  // for locked accounts, and they only ever get the summary back. Read under
  // the user's own JWT (RLS: own profile row). A DB hiccup fails open,
  // matching the credit gate in optimize.ts, so a Supabase blip never blocks
  // paying users.
  if (!preview) {
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
  }

  // Validated BEFORE reserving: a malformed request must not spend one of the
  // user's daily master-resume slots.
  const data = req.body?.data as ResumeData | undefined;
  // Every list the prompt builder maps over must be an array. experience and
  // education are required; the optional lists default to empty.
  if (!data || typeof data !== 'object' || !Array.isArray(data.experience) || !Array.isArray(data.education)) {
    res.status(400).json({ error: 'Missing resume data' });
    return;
  }
  for (const k of ['projects', 'extracurriculars', 'skills', 'awards', 'certifications', 'affiliations', 'publications', 'languages', 'references'] as const) {
    if (data[k] == null) data[k] = [];
    else if (!Array.isArray(data[k])) { res.status(400).json({ error: `Invalid ${k}` }); return; }
  }

  // Previews count against their own daily cap (KIND_DAILY_CAPS.master_preview)
  // so they can never use up the paid build's allowance.
  const callKind = preview ? 'master_preview' : 'optimize_general';

  // Already built for this exact profile: hand it back without an AI call.
  const hash = previewHashOf(data);
  const stored = await storedPreview(auth.userId, hash);
  if (stored.row) {
    res.status(200).json(preview ? { summary: stored.row.summary } : { optimized: stored.row.optimized });
    return;
  }
  if (preview && !stored.ok) { previewUnavailable(res); return; }

  // Reserved BEFORE the provider call so a parallel burst cannot overshoot the
  // daily caps; null means reservation was unavailable and we failed open.
  let reservation: string | null = null;
  try {
    reservation = await reserveCall(auth.userId, auth.jwt, callKind);
  } catch (err) {
    if (err instanceof RateLimitError) {
      res.status(429).json({ error: err.message, used: err.used, cap: err.cap, code: 'rate_limited' });
      return;
    }
    throw err;
  }
  // Fail closed for previews: with no reservation the caps aren't counting
  // (e.g. the kind isn't allowed yet), and previews are free to the user.
  if (preview && reservation === null) { previewUnavailable(res); return; }

  // This endpoint only ever builds the master resume. Forced here rather than
  // trusted from the client so the master prompt and post-pipeline can never be
  // skipped by a stale bundle that still sends a placeholder "JD".
  data.resumeMode = 'master';
  // The client still sends a placeholder "JD" (the use case requires one).
  // Blank it here so no step — present or future — can score the master
  // résumé against it; that placeholder is what gutted it before. (So there is
  // no JD length to check on this endpoint.)
  data.targetJob = { ...data.targetJob, description: '' };

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
      callKind,
      buildCallMeta({ usage, latencyMs, fallbackInputText: JSON.stringify(data), fallbackOutputText: optimized.summary }),
      reservation,
    );
    // A concurrent request (second tab, a quick return to the dashboard) may
    // have stored a build for this same profile while ours ran. Keep theirs
    // and answer with it, so every screen shows the one the purchase reuses.
    const raced = await storedPreview(auth.userId, hash);
    if (raced.row) {
      res.status(200).json(preview ? { summary: raced.row.summary } : { optimized: raced.row.optimized });
      return;
    }
    // Keep every successful build: the preview's is what the purchase will
    // reuse, and a paid build's makes a regenerate on an unchanged profile free.
    const db = serviceClient();
    let saved = false;
    if (db && optimized.summary) {
      const { error: saveError } = await db.from('master_previews').upsert({
        user_id: auth.userId,
        profile_hash: hash,
        summary: optimized.summary,
        optimized,
        updated_at: new Date().toISOString(),
      });
      if (saveError) console.warn(`[optimize-general] preview save failed: ${saveError.message}`);
      else saved = true;
    }
    // A preview summary that isn't stored would not be the one the purchase
    // delivers (the paid build would write a new one). Show none instead.
    if (preview && !saved) { previewUnavailable(res); return; }
    res.status(200).json(preview ? { summary: optimized.summary } : { optimized });
  } catch (err) {
    const latencyMs = Date.now() - t0;
    const msg = err instanceof Error ? err.message : 'Optimizer failed';
    await logCall(
      auth.userId,
      auth.jwt,
      callKind,
      buildCallMeta({ usage, latencyMs, error: err, fallbackInputText: JSON.stringify(data) }),
      reservation,
    );
    res.status(502).json(publicAiError(err));
  }
}
