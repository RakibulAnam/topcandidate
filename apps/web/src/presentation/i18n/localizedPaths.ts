// URL ↔ language for the public (indexable) pages.
//
// Every public page except Terms exists twice: the English URL (`/`,
// `/resume-maker`, …) and a Bangla twin under `/bn` (`/bn`,
// `/bn/resume-maker`, …). Each twin is prerendered to its own HTML file
// (scripts/prerender.mjs) so search engines can index both languages. The
// app's own screens (dashboard, builder, …) are NOT localized by URL — they
// follow the stored locale only.

import type { Locale } from './LocaleContext';

/** Public feature pages. Slug = the English URL path segment. */
export const FEATURE_SLUGS = ['resume-maker', 'cover-letter', 'interview-preparation', 'job-application-email'] as const;
export type FeatureSlug = (typeof FEATURE_SLUGS)[number];

export const isFeatureSlug = (s: string): s is FeatureSlug => (FEATURE_SLUGS as readonly string[]).includes(s);

/** English paths that have a `/bn` twin. */
export const BILINGUAL_PATHS: string[] = ['/', ...FEATURE_SLUGS.map((s) => `/${s}`)];

export const isBnPath = (path: string): boolean => path === '/bn' || path.startsWith('/bn/');

/** `/bn` → `/`, `/bn/cover-letter` → `/cover-letter`; anything else unchanged. */
export const toEnPath = (path: string): string => {
  if (path === '/bn' || path === '/bn/') return '/';
  return path.startsWith('/bn/') ? path.slice(3) : path;
};

/** The URL of an English path in `locale` (only bilingual paths get a `/bn` twin). */
export const toLocalePath = (enPath: string, locale: Locale): string => {
  if (locale !== 'bn' || !BILINGUAL_PATHS.includes(enPath)) return enPath;
  return enPath === '/' ? '/bn' : `/bn${enPath}`;
};
