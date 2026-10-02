import { useEffect, useRef, useState } from 'react';
import { isFeatureSlug, toEnPath, toLocalePath, type FeatureSlug } from '../i18n/localizedPaths';

export type NavScreen =
  | 'LANDING'
  | 'LOGIN'
  | 'DASHBOARD'
  | 'APPLICATIONS'
  | 'PURCHASES'
  | 'PROFILE'
  | 'PROFILE_SETUP'
  | 'SUMMARY'
  | 'BUILDER'
  | 'RESET_PASSWORD'
  | 'LEGAL_TERMS'
  | 'FEATURE';

export interface NavState {
  screen: NavScreen;
  /** BUILDER only: which generated resume this history entry is showing.
   *  Stamped in when the builder saves (replaceState) or when an existing
   *  resume is opened, so a Back-then-Forward gesture — and a hard reload,
   *  since the browser persists history.state — can restore the preview
   *  instead of dropping the user on the builder's idle panel. */
  resumeId?: string;
  /** FEATURE only: which public feature page (`/resume-maker`, …). */
  feature?: FeatureSlug;
}

const SCREEN_PATHS: Record<NavScreen, string> = {
  LANDING: '/',
  LOGIN: '/login',
  DASHBOARD: '/dashboard',
  APPLICATIONS: '/applications',
  PURCHASES: '/purchases',
  PROFILE: '/profile',
  PROFILE_SETUP: '/profile-setup',
  SUMMARY: '/new',
  BUILDER: '/builder',
  RESET_PASSWORD: '/auth/reset-password',
  LEGAL_TERMS: '/legal/terms',
  FEATURE: '/', // never used directly — FEATURE paths come from `feature` (see pathOf)
};

// The URL for a nav state. Public pages (landing + feature pages) have a
// Bangla twin under `/bn` (i18n/localizedPaths), and the URL follows the
// language actually on screen: LocaleContext stamps <html lang> before React
// mounts and on every toggle, so it is the live locale. App screens have one
// path regardless of language.
const pathOf = (state: NavState): string => {
  const enPath = state.screen === 'FEATURE' && state.feature ? `/${state.feature}` : SCREEN_PATHS[state.screen];
  const locale = typeof document !== 'undefined' && document.documentElement.lang === 'bn' ? 'bn' : 'en';
  return toLocalePath(enPath, locale);
};

const pathToState = (path: string): NavState | null => {
  const enPath = toEnPath(path);
  const slug = enPath.slice(1);
  if (isFeatureSlug(slug)) return { screen: 'FEATURE', feature: slug };
  const entry = Object.entries(SCREEN_PATHS).find(([screen, p]) => screen !== 'FEATURE' && p === enPath);
  return entry ? { screen: entry[0] as NavScreen } : null;
};

const readInitialStateFromUrl = (fallback: NavState): NavState => {
  if (typeof window === 'undefined') return fallback;
  const existing = window.history.state;
  if (existing && typeof existing === 'object' && 'screen' in existing) {
    return existing as NavState;
  }
  return pathToState(window.location.pathname) ?? fallback;
};

export function useBrowserNav(fallback: NavState) {
  const [state, setState] = useState<NavState>(() => readInitialStateFromUrl(fallback));
  const seeded = useRef(false);

  useEffect(() => {
    if (seeded.current) return;
    seeded.current = true;
    window.history.replaceState(state, '', pathOf(state));
  }, [state]);

  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      if (e.state && typeof e.state === 'object' && 'screen' in e.state) {
        setState(e.state as NavState);
      } else {
        setState(pathToState(window.location.pathname) ?? fallback);
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [fallback]);

  const navigate = (next: NavState, opts: { replace?: boolean } = {}) => {
    const path = pathOf(next);
    if (opts.replace) {
      window.history.replaceState(next, '', path);
    } else {
      window.history.pushState(next, '', path);
    }
    setState(next);
  };

  return { navState: state, navigate };
}
