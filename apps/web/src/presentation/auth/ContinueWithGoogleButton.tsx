// "Continue with Google" CTA for the LoginScreen OAuth slot.
//
// Styling follows Google's brand guidelines: white button, neutral border,
// the official multi-color "G" mark unaltered, "Continue with Google" label.
// The actual sign-in happens on accounts.google.com (users see Google's URL).
//
// On click we start the OAuth redirect via AuthContext.signInWithGoogle().
// On success the browser navigates to Google, so we keep the spinner until the
// page leaves. Errors are surfaced as toasts (spec §8).

import React, { useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { useAuth } from '../../infrastructure/auth/AuthContext';
import { useT } from '../i18n/LocaleContext';

// Official Google "G" mark. Do NOT recolor — Google brand guidelines require
// the four-color logo as-is.
const GoogleIcon: React.FC = () => (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
        <path fill="#4285F4" d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" />
        <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.583-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" />
        <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.997 8.997 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" />
        <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" />
    </svg>
);

export const ContinueWithGoogleButton: React.FC = () => {
    const { signInWithGoogle } = useAuth();
    const t = useT();
    const [loading, setLoading] = useState(false);

    const onClick = async () => {
        setLoading(true);
        try {
            await signInWithGoogle();
            // Success → the browser is redirecting to Google. Leave the spinner
            // on; this component will unmount when navigation happens.
        } catch (error) {
            setLoading(false);
            const msg = error instanceof Error ? error.message : '';
            if (msg === 'already_signed_in') {
                toast.error(t('login.googleAlreadySignedIn'));
            } else {
                // Provider disabled / network / config — surface generically;
                // the underlying error is logged for the operator.
                console.error('[oauth] Google sign-in failed:', error);
                toast.error(t('login.googleUnavailable'));
            }
        }
    };

    return (
        <button
            type="button"
            onClick={onClick}
            disabled={loading}
            className="w-full h-11 flex items-center justify-center gap-3 border border-charcoal-300 rounded-xl bg-white hover:bg-charcoal-50 font-semibold text-brand-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 focus-visible:ring-offset-2 focus-visible:ring-offset-charcoal-50 disabled:opacity-60 disabled:cursor-not-allowed"
        >
            {loading ? <Loader2 className="animate-spin" size={20} aria-hidden="true" /> : <GoogleIcon />}
            <span>{t('login.continueWithGoogle')}</span>
        </button>
    );
};
