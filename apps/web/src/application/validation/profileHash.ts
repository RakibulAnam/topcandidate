// Content hash of the resume-relevant profile, used to tell whether the
// profile changed since the General Resume was generated (its dates can't:
// the item tables have no updated_at, and edits don't bump created_at).
//
// The hash is stored on the general resume at generation time and recomputed
// from the live profile to decide whether to offer a regenerate. We hash only
// USER-ENTERED content and exclude derived/AI fields (normalized bullets,
// source hashes, refined bullets) so a background polish landing after
// generation never reads as a "profile change".

import { contentHash } from './contentHash';

const DERIVED_KEYS = new Set(['normalized', 'normalizedSourceHash', 'refinedBullets']);

// Deterministic projection: sort object keys (insertion-order-independent) and
// drop derived keys, recursively. Arrays keep order (a reorder is a real
// change).
function project(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(project);
  if (v && typeof v === 'object') {
    const src = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(src).sort()) {
      if (DERIVED_KEYS.has(k)) continue;
      out[k] = project(src[k]);
    }
    return out;
  }
  return v;
}

export interface ProfileHashInput {
  personalInfo?: unknown;
  experiences?: unknown[];
  projects?: unknown[];
  educations?: unknown[];
  skills?: unknown[];
  extracurriculars?: unknown[];
  awards?: unknown[];
  certifications?: unknown[];
  affiliations?: unknown[];
  publications?: unknown[];
  languages?: unknown[];
  references?: unknown[];
}

export function computeProfileHash(input: ProfileHashInput): string {
  const canonical = project({
    personalInfo: input.personalInfo ?? null,
    experiences: input.experiences ?? [],
    projects: input.projects ?? [],
    educations: input.educations ?? [],
    skills: input.skills ?? [],
    extracurriculars: input.extracurriculars ?? [],
    awards: input.awards ?? [],
    certifications: input.certifications ?? [],
    affiliations: input.affiliations ?? [],
    publications: input.publications ?? [],
    languages: input.languages ?? [],
    references: input.references ?? [],
  });
  return contentHash(JSON.stringify(canonical));
}
