import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '../supabase/client';

/**
 * Sign-in / sign-up moved here from `LoginScreen` (2026-05-30 audit, Clean
 * Architecture violation). Presentation never imports the Supabase client
 * directly; auth flows through this single facade. Future work — Google
 * OAuth, MFA, account-linking — hooks here too.
 *
 * EMAIL VERIFICATION POLICY (2026-05-31)
 * --------------------------------------
 * The product currently does NOT require users to confirm their email
 * before using the app. Email-confirmation must be turned **OFF** in
 * Supabase → Authentication → Providers → Email. With confirmation OFF,
 * `supabase.auth.signUp` returns an active session immediately and the
 * user can use the app without friction.
 *
 * `signUp` still returns `{ needsEmailConfirmation }` so this facade
 * stays forward-compatible if the operator ever turns confirmation back
 * on. In that case:
 *   - `signUp` resolves with `{ needsEmailConfirmation: true }` and no
 *     session is created server-side
 *   - The current `LoginScreen` does NOT branch on this flag — the user
 *     stays on the auth screen until they click the confirmation link
 *     and sign in again
 * If/when we add a confirmation-pending UI surface, it will read this
 * flag rather than re-detecting the server state.
 */
export interface AuthSignUpInput {
    email: string;
    password: string;
    fullName?: string;
}

export interface SignUpResult {
    /**
     * Reserved for the future case where the Supabase project requires email
     * confirmation. Currently always `false` in production because the
     * product runs with confirmation off. Do not gate the post-signup
     * navigation on this; consume only in a dedicated "check your inbox"
     * UI when we re-enable confirmation.
     */
    needsEmailConfirmation: boolean;
}

interface AuthContextType {
    user: User | null;
    session: Session | null;
    loading: boolean;
    signIn: (email: string, password: string) => Promise<void>;
    signUp: (input: AuthSignUpInput) => Promise<SignUpResult>;
    requestPasswordReset: (email: string) => Promise<void>;
    /** Used by the password-reset landing flow after the user clicks the recovery link. */
    updatePassword: (newPassword: string) => Promise<void>;
    signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [session, setSession] = useState<Session | null>(null);
    const [loading, setLoading] = useState(() => {
        // FAST PATH: Check if we have a token in localStorage
        // Key format: sb-<project-ref>-auth-token
        const projectRef = import.meta.env.VITE_SUPABASE_URL?.split('//')[1]?.split('.')[0];
        if (projectRef) {
            const key = `sb-${projectRef}-auth-token`;
            const hasToken = localStorage.getItem(key);
            return !!hasToken; // If token exists, start with loading=true, else false (guest)
        }
        return true; // Fallback to safe default
    });

    useEffect(() => {
        // Check active sessions and sets the user
        supabase.auth.getSession().then(({ data: { session } }) => {
            setSession(session);
            setUser(session?.user ?? null);
        }).catch((err) => {
            console.warn('Auth initialization error:', err);
        }).finally(() => {
            setLoading(false);
        });

        // Listen for changes on auth state (sign in, sign out, etc.).
        //
        // IMPORTANT: Supabase fires `TOKEN_REFRESHED` (and sometimes
        // `SIGNED_IN`) every time the browser tab regains visibility — that's
        // baked into GoTrue's auto-refresh behavior. Calling setUser/setSession
        // with a fresh object reference every time would cause every
        // `useEffect([user])` downstream to re-run on tab focus, which would
        // look to the user like the app "reloading" on every tab switch.
        //
        // So we treat the handler as idempotent on user identity: if the
        // signed-in user id hasn't changed, we don't touch React state.
        const {
            data: { subscription },
        } = supabase.auth.onAuthStateChange((_event, newSession) => {
            const newUserId = newSession?.user?.id ?? null;

            setUser((prev) => {
                const prevUserId = prev?.id ?? null;
                // Same user (or still signed out): return the existing
                // reference so consumers keyed on [user] don't re-fire.
                if (prevUserId === newUserId) return prev;
                return newSession?.user ?? null;
            });

            setSession((prev) => {
                const prevUserId = prev?.user?.id ?? null;
                if (prevUserId === newUserId) return prev;
                return newSession;
            });

            setLoading(false);
        });

        return () => subscription.unsubscribe();
    }, []);

    const signIn = async (email: string, password: string) => {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
    };

    const signUp = async ({ email, password, fullName }: AuthSignUpInput): Promise<SignUpResult> => {
        const { data, error } = await supabase.auth.signUp({
            email,
            password,
            options: { data: { full_name: fullName } },
        });
        if (error) throw error;
        // When Supabase has email confirmation OFF (the product default — see
        // file header), `data.session` is populated and the user is logged in
        // immediately. We still expose `needsEmailConfirmation` for future
        // re-enablement; the LoginScreen currently does not branch on it.
        const needsEmailConfirmation = !data.session && !!data.user;
        return { needsEmailConfirmation };
    };

    const requestPasswordReset = async (email: string) => {
        // After the user clicks the link in the recovery email, Supabase
        // redirects them here with a hash fragment that includes
        // `type=recovery` + a one-time access token. App.tsx detects this
        // and renders the SetNewPasswordScreen.
        const redirectTo = typeof window !== 'undefined'
            ? `${window.location.origin}/?auth=recovery`
            : undefined;
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
        if (error) throw error;
    };

    const updatePassword = async (newPassword: string) => {
        const { error } = await supabase.auth.updateUser({ password: newPassword });
        if (error) throw error;
    };

    const signOut = async () => {
        await supabase.auth.signOut();
        // Clear app-managed localStorage that survived signOut by default (audit M7):
        // resume drafts and pending-purchase pill state. If two users share a
        // browser, user B should not see user A's draft on next sign-in.
        try {
            localStorage.removeItem('resume_draft');
            localStorage.removeItem('topcandidate.pendingPurchase');
            window.dispatchEvent(new Event('topcandidate:pending-purchase-changed'));
        } catch { /* ignore — quota or private mode */ }
    };

    return (
        <AuthContext.Provider value={{ user, session, loading, signIn, signUp, requestPasswordReset, updatePassword, signOut }}>
            {children}
        </AuthContext.Provider>
    );
}

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
};
