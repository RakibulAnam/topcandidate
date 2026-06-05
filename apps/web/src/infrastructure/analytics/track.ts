// First-party product analytics — writes events straight to Supabase
// (analytics_events) via the browser client under an insert-only RLS policy.
// No third-party SDK, no extra Vercel function, no cost. Fire-and-forget:
// tracking must NEVER block the UI or throw into product code.
//
// Identity model:
//   - anon_id: stable per-browser id (localStorage), set before auth so we can
//     stitch a visitor's pre-signup funnel to their account after signup.
//   - session_id: per-tab id (sessionStorage).
//   - user_id: attached automatically from the live Supabase session.
//
// First-touch attribution: UTM params present on the very first landing are
// captured once into localStorage and replayed on every event + persisted to
// the profile at signup (see AuthContext).

import { supabase } from '../supabase/client';

const ANON_KEY = 'topcandidate.anonId';
const SESSION_KEY = 'topcandidate.sessionId';
const UTM_KEY = 'topcandidate.firstTouch';

export interface FirstTouch {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  referrer?: string;
}

const uid = (): string => {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
};

const getAnonId = (): string => {
  try {
    let id = localStorage.getItem(ANON_KEY);
    if (!id) { id = uid(); localStorage.setItem(ANON_KEY, id); }
    return id;
  } catch {
    return 'anon';
  }
};

const getSessionId = (): string => {
  try {
    let id = sessionStorage.getItem(SESSION_KEY);
    if (!id) { id = uid(); sessionStorage.setItem(SESSION_KEY, id); }
    return id;
  } catch {
    return 'session';
  }
};

/**
 * Capture first-touch attribution from the current URL exactly once. Safe to
 * call on every landing/app mount — it only writes if nothing is stored yet.
 */
export function captureFirstTouch(): void {
  try {
    if (localStorage.getItem(UTM_KEY)) return;
    const p = new URLSearchParams(window.location.search);
    const ft: FirstTouch = {
      utm_source: p.get('utm_source') ?? undefined,
      utm_medium: p.get('utm_medium') ?? undefined,
      utm_campaign: p.get('utm_campaign') ?? undefined,
      referrer: document.referrer || undefined,
    };
    // Only persist if there's something meaningful (a UTM tag or an external referrer).
    const externalRef = ft.referrer && !ft.referrer.includes(window.location.host);
    if (ft.utm_source || ft.utm_medium || ft.utm_campaign || externalRef) {
      localStorage.setItem(UTM_KEY, JSON.stringify(ft));
    }
  } catch {
    /* ignore */
  }
}

/** Read the stored first-touch attribution (for persisting to a profile at signup). */
export function getFirstTouch(): FirstTouch {
  try {
    return JSON.parse(localStorage.getItem(UTM_KEY) ?? '{}') as FirstTouch;
  } catch {
    return {};
  }
}

/**
 * Record a product/funnel event. Fire-and-forget — callers should NOT await.
 * Resolves the current user id from the live session automatically.
 */
export function track(event: string, props: Record<string, unknown> = {}): void {
  void (async () => {
    try {
      const { data } = await supabase.auth.getSession();
      const userId = data.session?.user?.id ?? null;
      const ft = getFirstTouch();
      await supabase.from('analytics_events').insert({
        anon_id: getAnonId(),
        user_id: userId,
        session_id: getSessionId(),
        event,
        props,
        path: typeof window !== 'undefined' ? window.location.pathname : null,
        referrer: ft.referrer ?? (typeof document !== 'undefined' ? document.referrer || null : null),
        utm_source: ft.utm_source ?? null,
        utm_medium: ft.utm_medium ?? null,
        utm_campaign: ft.utm_campaign ?? null,
      });
    } catch {
      /* analytics must never break product code */
    }
  })();
}
