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
//  - PKCE flow: the secure OAuth flow for SPAs (Supabase exchanges the
//    `?code=` on the callback and rotates refresh tokens for us).
//  - detectSessionInUrl: on load, parse + consume the OAuth callback params
//    automatically, then Supabase strips them from the URL.
//  - persistSession / autoRefreshToken: keep the session in localStorage and
//    refresh it transparently (unchanged from the prior defaults).
export const supabase = createClient(url, key, {
    auth: {
        flowType: 'pkce',
        detectSessionInUrl: true,
        persistSession: true,
        autoRefreshToken: true,
    },
});
