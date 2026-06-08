import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
    // Only warn if we are in a context where we expect these to be present.
    // We can default to a null-like operational state or handle check later.
    console.warn('Missing Supabase environment variables. Check .env');
}

// Fallback for development to prevent crash if keys are missing.
// In production the warning above will fire and any network call will fail
// loudly — we'd rather get a clear error at first request than a runtime
// crash at import time.
const url = supabaseUrl || 'https://placeholder.supabase.co';
const key = supabaseAnonKey || 'placeholder';

// Auth config:
//  - PKCE flow: the secure OAuth flow for SPAs (signInWithOAuth stores a
//    code_verifier; we exchange the `?code=` for a session).
//  - detectSessionInUrl: **false** — we consume the callback params OURSELVES
//    (see initialAuthParams below + AuthContext). Supabase's built-in detection
//    is async and races the SPA router (useBrowserNav), which rewrites the URL
//    to a clean path on mount and was stripping the `?code=` before Supabase
//    could read it → no session → user bounced to the landing page.
//  - persistSession / autoRefreshToken: keep the session in localStorage and
//    refresh it transparently.
export const supabase = createClient(url, key, {
    auth: {
        flowType: 'pkce',
        detectSessionInUrl: false,
        persistSession: true,
        autoRefreshToken: true,
    },
});

// ── Auth-callback param capture ──────────────────────────────────────────
// Snapshot any auth params from the URL AT MODULE LOAD — this runs during
// import, before React renders and therefore before useBrowserNav's mount
// effect can strip the query/hash. AuthContext consumes this exactly once to
// complete the OAuth code exchange (or a recovery/implicit-hash session)
// deterministically, regardless of router timing.
export type InitialAuthParams =
    | { kind: 'code'; code: string; recovery: boolean }
    | { kind: 'hash'; accessToken: string; refreshToken: string | null; recovery: boolean }
    | { kind: 'error'; error: string; description: string | null; recovery: boolean }
    | null;

function captureInitialAuthParams(): InitialAuthParams {
    if (typeof window === 'undefined') return null;
    try {
        const url = new URL(window.location.href);
        const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
        // `requestPasswordReset` always appends `?auth=recovery` to redirectTo,
        // so this marker is present whether the session comes back as a PKCE
        // `?code=` or an implicit `#…&type=recovery` hash. It's the reliable
        // signal to route to the reset-password screen instead of the app.
        const recovery = url.searchParams.get('auth') === 'recovery' || hash.get('type') === 'recovery';

        const code = url.searchParams.get('code');
        if (code) return { kind: 'code', code, recovery };

        const accessToken = hash.get('access_token');
        if (accessToken) {
            return { kind: 'hash', accessToken, refreshToken: hash.get('refresh_token'), recovery };
        }

        const error = url.searchParams.get('error') || hash.get('error');
        if (error) return { kind: 'error', error, description: url.searchParams.get('error_description') || hash.get('error_description'), recovery };
    } catch {
        /* malformed URL — nothing to capture */
    }
    return null;
}

export const initialAuthParams: InitialAuthParams = captureInitialAuthParams();
