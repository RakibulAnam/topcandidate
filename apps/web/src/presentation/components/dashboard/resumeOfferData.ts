// Data behind the dashboard's resume-preview offer (ResumeOfferPreview): the
// profile the master resume is built from, and the summary the real build
// wrote for it. Kept apart from the component so that file exports only
// components (Vite Fast Refresh).
//
// Two reads, two caches, one entry per user:
//   * the profile — cheap, also read by the shell to decide whether there is
//     anything to sell (an empty profile can't be sold a resume);
//   * the summary — one master-resume build on the server the first time
//     (seconds, not instant), then a stored row for as long as the profile is
//     unchanged. Only fetched while the offer is actually on screen.
// ResumeOfferPreview refreshes both every time it mounts (invalidateMasterPreview),
// so a profile edited anywhere — profile page, setup re-walk, builder
// inline-add — shows up on the next dashboard visit. A summary request still
// in flight is never dropped: starting a second one would run a second AI
// build for the same profile.
import { useEffect, useState } from 'react';
import { createResumeService, profileRepository } from '../../../infrastructure/config/dependencies';
import { GibberishContentError } from '../../../application/validation/gibberishDetector';

export interface ResumeOfferRole {
  role: string;
  company: string;
  start: string;
  end: string;
  current: boolean;
  bullets: string[];
}

export interface ResumeOfferProfile {
  name: string;
  email: string;
  phone: string;
  location: string;
  roles: ResumeOfferRole[];
  education: { degree: string; school: string; end: string }[];
  skills: string[];
  /** Neither experience nor education → the master resume can't be built. */
  empty: boolean;
}

// Bullets for the blurred part: the polished ones when the profile has them,
// else the user's own lines. Blurred past reading either way — they only have
// to look like a real resume.
function bulletsOf(normalized: string[] | undefined, raw: string): string[] {
  if (normalized?.length) return normalized.slice(0, 4);
  return raw.split(/\n+/).map((l) => l.replace(/^[\s•\-*]+/, '').trim()).filter(Boolean).slice(0, 4);
}

const profileCache = new Map<string, Promise<ResumeOfferProfile>>();

function loadProfile(userId: string): Promise<ResumeOfferProfile> {
  let p = profileCache.get(userId);
  if (!p) {
    p = Promise.all([
      profileRepository.getProfile(userId).catch(() => null),
      // null = the read failed. Unknown is NOT empty: a flaky connection must
      // never tell someone with a full profile there is nothing to build.
      profileRepository.getExperiences(userId).catch(() => null),
      profileRepository.getEducations(userId).catch(() => null),
      profileRepository.getSkills(userId).catch(() => [] as string[]),
    ]).then(([personal, exps, edus, skills]) => ({
      name: personal?.fullName?.trim() || '',
      email: personal?.email || '',
      phone: personal?.phone || '',
      location: personal?.location || '',
      roles: (exps ?? []).filter((e) => e.role || e.company).slice(0, 4).map((e) => ({
        role: e.role,
        company: e.company,
        start: e.startDate,
        end: e.endDate,
        current: e.isCurrent,
        bullets: bulletsOf(e.normalized?.bullets, e.rawDescription ?? ''),
      })),
      education: (edus ?? []).slice(0, 2).map((e) => ({
        degree: [e.degree, e.field].filter(Boolean).join(', '),
        school: e.school,
        end: e.endDate,
      })),
      skills: skills.slice(0, 12),
      empty: exps !== null && edus !== null && exps.length === 0 && edus.length === 0,
    }));
    // A failed read must not stick for the whole session.
    p.then((d) => { if (!d.roles.length && !d.education.length && !d.empty) profileCache.delete(userId); })
      .catch(() => profileCache.delete(userId));
    profileCache.set(userId, p);
  }
  return p;
}

interface SummaryEntry {
  promise: Promise<string>;
  settled: boolean;
  /** Content hash of the profile this request is for; set once it is read. */
  hash: string | null;
  onHash: ((hash: string) => void)[];
  /** The profile may have changed while this was in flight (see invalidate). */
  invalidated: boolean;
}
const summaryCache = new Map<string, SummaryEntry>();
// The last summary each user was shown, with the profile hash it was written
// for. A dashboard visit refetches (the profile may have changed) but keeps
// showing it meanwhile — rather than flashing "Writing your summary…" for what
// is usually a stored-row read — and only while the profile still matches: a
// summary for an older profile is never shown, since that is not the one the
// purchase would deliver.
const lastSummary = new Map<string, { text: string; hash: string }>();

function loadSummary(userId: string): SummaryEntry {
  let entry = summaryCache.get(userId);
  if (!entry) {
    const e: SummaryEntry = { promise: Promise.resolve(''), settled: false, hash: null, onHash: [], invalidated: false };
    const run = (): Promise<string> => createResumeService()
      .getMasterPreviewSummary(userId, (hash) => {
        e.hash = hash;
        e.onHash.splice(0).forEach((fn) => fn(hash));
      })
      .then((text) => {
        // Invalidated mid-flight: the answer may be for a profile that has
        // since been edited. Ask again with the profile as it is now — the
        // server answers from its stored row when nothing changed, so this
        // costs a read, not a second build.
        if (!e.invalidated) return text;
        e.invalidated = false;
        return run();
      });
    e.promise = run();
    // A failure (rate limit, timeout) may clear on the next visit.
    e.promise.then(
      (text) => { e.settled = true; if (text && e.hash) lastSummary.set(userId, { text, hash: e.hash }); },
      () => { e.settled = true; summaryCache.delete(userId); },
    );
    summaryCache.set(userId, e);
    entry = e;
  }
  return entry;
}

/** Drop the cached reads — call after the profile changes. A summary request
 *  still in flight is kept (see the header) but re-asks once it lands. */
export function invalidateMasterPreview(userId?: string) {
  const users = userId ? [userId] : [...new Set([...profileCache.keys(), ...summaryCache.keys()])];
  for (const u of users) {
    profileCache.delete(u);
    const entry = summaryCache.get(u);
    if (entry?.settled) summaryCache.delete(u);
    else if (entry) entry.invalidated = true;
  }
}

export function useResumeOfferProfile(userId: string | null | undefined, enabled = true): ResumeOfferProfile | null {
  const [data, setData] = useState<ResumeOfferProfile | null>(null);
  useEffect(() => {
    if (!userId || !enabled) return;
    let cancelled = false;
    loadProfile(userId).then((d) => { if (!cancelled) setData(d); }).catch(() => {});
    return () => { cancelled = true; };
  }, [userId, enabled]);
  return data;
}

export type SummaryState =
  | { status: 'loading' }
  | { status: 'ready'; text: string }
  | { status: 'failed' }
  /** The profile has text the build refuses (random characters): a resume
   *  can't be made from it, so it must not be sold until it's fixed. */
  | { status: 'unbuildable'; fields: string[] };

export function useResumeOfferSummary(userId: string | null | undefined, enabled = true): SummaryState {
  // Optimistic start: the last summary, until the profile read says whether it
  // still belongs to this profile (a few hundred ms, see lastSummary).
  const last = (u: string | null | undefined): SummaryState => {
    const prev = u ? lastSummary.get(u) : undefined;
    return prev ? { status: 'ready', text: prev.text } : { status: 'loading' };
  };
  const [state, setState] = useState<SummaryState>(() => last(userId));
  useEffect(() => {
    if (!userId || !enabled) return;
    let cancelled = false;
    setState(last(userId));
    const entry = loadSummary(userId);
    const stillCurrent = (hash: string | null) => !!hash && lastSummary.get(userId)?.hash === hash;
    const checkHash = (hash: string) => { if (!cancelled && !stillCurrent(hash)) setState({ status: 'loading' }); };
    if (entry.hash) checkHash(entry.hash); else entry.onHash.push(checkHash);
    entry.promise
      .then((text) => { if (!cancelled) setState(text ? { status: 'ready', text } : { status: 'failed' }); })
      .catch((err) => {
        console.warn('Resume preview summary failed', err);
        if (cancelled) return;
        if (err instanceof GibberishContentError) {
          setState({ status: 'unbuildable', fields: err.issues.map((i) => i.field) });
          return;
        }
        // A failed refresh keeps the summary on screen only if it was written
        // for this same profile.
        setState(stillCurrent(entry.hash) ? last(userId) : { status: 'failed' });
      });
    return () => { cancelled = true; };
  }, [userId, enabled]);
  return state;
}
