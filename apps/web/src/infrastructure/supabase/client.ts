import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
    // Only warn if we are in a context where we expect these to be present.
    // We can default to a null-like operational state or handle check later.
    console.warn('Missing Supabase environment variables. Check .env');
}

// Fallback for development to prevent crash if keys are missing
const url = supabaseUrl || 'https://placeholder.supabase.co';
const key = supabaseAnonKey || 'placeholder';

console.log('Supabase Config:', {
    url: supabaseUrl,
    keyLength: supabaseAnonKey?.length,
    hasKey: !!supabaseAnonKey
});

export const supabase = createClient(url, key);
