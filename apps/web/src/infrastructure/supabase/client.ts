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

export const supabase = createClient(url, key);
