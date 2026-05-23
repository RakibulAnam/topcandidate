import { useEffect, useRef, useState } from 'react';

export type NavScreen =
  | 'LANDING'
  | 'LOGIN'
  | 'DASHBOARD'
  | 'PROFILE'
  | 'PROFILE_SETUP'
  | 'BUILDER';

export interface NavState {
  screen: NavScreen;
}

const SCREEN_PATHS: Record<NavScreen, string> = {
  LANDING: '/',
  LOGIN: '/login',
  DASHBOARD: '/dashboard',
  PROFILE: '/profile',
  PROFILE_SETUP: '/profile-setup',
  BUILDER: '/builder',
};

const pathToScreen = (path: string): NavScreen | null => {
  const entry = Object.entries(SCREEN_PATHS).find(([, p]) => p === path);
  return (entry?.[0] as NavScreen) ?? null;
};

const readInitialStateFromUrl = (fallback: NavState): NavState => {
  if (typeof window === 'undefined') return fallback;
  const existing = window.history.state;
  if (existing && typeof existing === 'object' && 'screen' in existing) {
    return existing as NavState;
  }
  const guessed = pathToScreen(window.location.pathname);
  return guessed ? { screen: guessed } : fallback;
};

export function useBrowserNav(fallback: NavState) {
  const [state, setState] = useState<NavState>(() => readInitialStateFromUrl(fallback));
  const seeded = useRef(false);

  useEffect(() => {
    if (seeded.current) return;
    seeded.current = true;
    window.history.replaceState(state, '', SCREEN_PATHS[state.screen]);
  }, [state]);

  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      if (e.state && typeof e.state === 'object' && 'screen' in e.state) {
        setState(e.state as NavState);
      } else {
        const guessed = pathToScreen(window.location.pathname);
        setState(guessed ? { screen: guessed } : fallback);
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [fallback]);

  const navigate = (next: NavState, opts: { replace?: boolean } = {}) => {
    const path = SCREEN_PATHS[next.screen];
    if (opts.replace) {
      window.history.replaceState(next, '', path);
    } else {
      window.history.pushState(next, '', path);
    }
    setState(next);
  };

  return { navState: state, navigate };
}
