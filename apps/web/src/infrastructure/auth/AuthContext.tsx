import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '../supabase/client';

interface AuthContextType {
    user: User | null;
    session: Session | null;
    loading: boolean;
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

    const signOut = async () => {
        await supabase.auth.signOut();
    };

    return (
        <AuthContext.Provider value={{ user, session, loading, signOut }}>
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
