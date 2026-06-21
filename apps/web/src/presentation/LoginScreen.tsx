// LoginScreen — auth landing for unauthenticated users.
//
// LAYOUT (OAuth-ready, 2026-05-31)
// ================================
// The screen is structured so a future "Continue with Google" button slots
// in above the email form without a rewrite. The flow today:
//
//   ┌────────────────────────────────────────┐
//   │  TOP CANDIDATE        EN | বাং         │   ← brand + language
//   ├────────────────────────────────────────┤
//   │  Welcome back / Create account / Reset │   ← contextual title
//   │  subtitle                              │
//   ├────────────────────────────────────────┤
//   │  [error banner — only if auth failed]  │
//   │  [info  banner — reset link sent etc.] │
//   ├────────────────────────────────────────┤
//   │  ┌─── OAuth slot (future) ──────────┐  │   ← Google button lands here
//   │  │ <Continue with Google> button    │  │     when we ship OAuth (PR
//   │  └──────────────────────────────────┘  │     `pending-work/oauth-google-signin.md`)
//   │  ── or continue with email ──          │   ← divider, only renders
//   ├────────────────────────────────────────┤     when 2+ methods exist
//   │  [email auth form: name/email/pass]    │
//   │  [Continue / Sign up / Send reset]     │
//   ├────────────────────────────────────────┤
//   │  switch mode  ·  Terms of Service      │
//   └────────────────────────────────────────┘
//
// EMAIL VERIFICATION POLICY
// =========================
// Email confirmation is OFF in Supabase by default — see AuthContext header.
// On signup, the user is logged in immediately and the AuthProvider redirects
// them through to the dashboard. We do NOT branch on
// `needsEmailConfirmation` here; the flag is kept in the AuthContext return
// type for forward-compatibility only.

import React, { useState } from 'react';
import { toast } from 'sonner';
import { Mail, Lock, Loader2, ArrowRight, AlertCircle, XCircle, CheckCircle2, User as UserIcon } from 'lucide-react';
import { validateEmail } from '../application/validation/emailValidator';
import { useAuth } from '../infrastructure/auth/AuthContext';
import { useT } from './i18n/LocaleContext';
import { LanguageToggle } from './i18n/LanguageToggle';
import { ContinueWithGoogleButton } from './auth/ContinueWithGoogleButton';

type Mode = 'login' | 'signup' | 'forgot';

interface LoginScreenProps {
    onOpenTerms?: () => void;
}

// When true, the screen renders the Google CTA + OR divider above the email
// form. Requires the Supabase Google provider to be configured (Client ID +
// Secret) — see `pending-work/oauth-google-signin.md` §11.
const OAUTH_GOOGLE_ENABLED = true;

export const LoginScreen: React.FC<LoginScreenProps> = ({ onOpenTerms }) => {
    const t = useT();
    const { signIn, signUp, requestPasswordReset } = useAuth();
    const [mode, setMode] = useState<Mode>('login');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [fullName, setFullName] = useState('');
    const [loading, setLoading] = useState(false);

    const [passwordError, setPasswordError] = useState('');
    const [emailError, setEmailError] = useState('');
    const [authError, setAuthError] = useState<string | null>(null);
    const [info, setInfo] = useState<string | null>(null);

    const isLogin = mode === 'login';
    const isSignup = mode === 'signup';
    const isForgot = mode === 'forgot';

    const clearErrors = () => {
        setAuthError(null);
        setInfo(null);
        if (passwordError) setPasswordError('');
        if (emailError) setEmailError('');
    };

    const handleAuth = async (e: React.FormEvent) => {
        e.preventDefault();
        clearErrors();

        // Password-reset path — no password field.
        if (isForgot) {
            if (!email) {
                setEmailError(t('login.emailRequired'));
                return;
            }
            setLoading(true);
            try {
                await requestPasswordReset(email);
                setInfo(t('login.resetEmailSent'));
            } catch (error) {
                setAuthError(error instanceof Error ? error.message : t('login.authFailedFallback'));
            } finally {
                setLoading(false);
            }
            return;
        }

        if (password.length < 6) {
            setPasswordError(t('login.weakPassword'));
            return;
        }

        setLoading(true);

        // Signup-only: format + disposable-domain gate. Login accepts whatever
        // the user originally registered with even if our rules later tightened.
        if (isSignup) {
            const result = await validateEmail(email);
            if (!result.valid) {
                setEmailError(result.reason);
                setLoading(false);
                return;
            }
        }

        try {
            if (isLogin) {
                await signIn(email, password);
                toast.success(t('login.signInSuccess'));
                // AuthProvider handles the redirect via onAuthStateChange.
            } else {
                // signUp returns `needsEmailConfirmation` — we ignore it on
                // purpose. Email-confirm is OFF in Supabase, so the response
                // always includes a session and the AuthProvider redirects
                // immediately. If the operator re-enables confirmation later,
                // wire a "check your inbox" banner here off the flag.
                await signUp({ email, password, fullName });
                toast.success(t('login.signUpSuccess'));
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : t('login.authFailedFallback');
            setAuthError(message);
        } finally {
            setLoading(false);
        }
    };

    const switchMode = (next: Mode) => {
        clearErrors();
        setMode(next);
    };

    return (
        <div className="min-h-dvh bg-charcoal-100 flex items-center justify-center p-4 overflow-y-auto">
            <div className="bg-charcoal-50 w-full max-w-md rounded-2xl border border-charcoal-200 shadow-2xl shadow-brand-900/5 overflow-hidden my-auto">
                <div className="p-6 sm:p-8">
                    {/* Branding + language toggle */}
                    <div className="flex items-start justify-between mb-6">
                        <div className="inline-flex items-baseline gap-1.5 select-none">
                            <span className="font-display text-2xl font-semibold tracking-tight text-brand-700">TOP</span>
                            <span className="font-display text-2xl font-semibold tracking-tight text-accent-500">CANDIDATE</span>
                        </div>
                        <LanguageToggle />
                    </div>

                    <div className="text-center mb-8">
                        <h1 className="font-display text-2xl font-semibold text-brand-700 mb-2">
                            {isLogin ? t('login.welcomeBack') : isSignup ? t('login.createAccount') : t('login.resetPassword')}
                        </h1>
                        <p className="text-sm text-charcoal-500">
                            {isLogin ? t('login.welcomeSubtitle') : isSignup ? t('login.createSubtitle') : t('login.resetSubtitle')}
                        </p>
                    </div>

                    {/* Error alert */}
                    {authError && (
                        <div className="mb-5 p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3" role="alert">
                            <XCircle className="text-red-500 shrink-0 mt-0.5" size={20} />
                            <div className="flex-1">
                                <h3 className="text-sm font-semibold text-red-800">{t('login.authFailedTitle')}</h3>
                                <p className="text-sm text-red-600 mt-1">
                                    {authError === 'Invalid login credentials'
                                        ? t('login.invalidCredentials')
                                        : authError}
                                </p>
                            </div>
                        </div>
                    )}

                    {/* Info banner (reset link sent) */}
                    {info && (
                        <div className="mb-5 p-4 bg-emerald-50 border border-emerald-200 rounded-xl flex items-start gap-3" role="status">
                            <CheckCircle2 className="text-emerald-500 shrink-0 mt-0.5" size={20} />
                            <p className="text-sm text-emerald-700 flex-1">{info}</p>
                        </div>
                    )}

                    {/*
                     * ── OAuth methods slot (Phase 2) ─────────────────────────
                     * When OAUTH_GOOGLE_ENABLED becomes true, render the
                     * "Continue with Google" CTA here and show the OR divider.
                     * Spec: `pending-work/oauth-google-signin.md`.
                     */}
                    {OAUTH_GOOGLE_ENABLED && !isForgot && (
                        <>
                            <ContinueWithGoogleButton />
                            <div className="flex items-center gap-3 my-5" aria-hidden="true">
                                <div className="flex-1 h-px bg-charcoal-200" />
                                <span className="text-[11px] uppercase tracking-[0.18em] text-charcoal-500 font-bold">
                                    {t('login.orContinueWithEmail')}
                                </span>
                                <div className="flex-1 h-px bg-charcoal-200" />
                            </div>
                        </>
                    )}

                    {/* Email auth form */}
                    <form onSubmit={handleAuth} className="space-y-4" noValidate>
                        {isSignup && (
                            <div>
                                <label htmlFor="auth-fullName" className="block text-sm font-medium text-charcoal-700 mb-1">
                                    {t('login.fullName')}
                                </label>
                                <div className="relative">
                                    <input
                                        id="auth-fullName"
                                        type="text"
                                        autoComplete="name"
                                        required
                                        value={fullName}
                                        onChange={(e) => { setFullName(e.target.value); clearErrors(); }}
                                        className="w-full h-11 pl-10 pr-3 border border-charcoal-300 rounded-xl focus-visible:ring-2 focus-visible:ring-accent-400 focus-visible:border-accent-500 outline-none transition-colors"
                                        placeholder={t('login.fullNamePlaceholder')}
                                    />
                                    <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-charcoal-400" size={18} aria-hidden="true" />
                                </div>
                            </div>
                        )}

                        <div>
                            <label htmlFor="auth-email" className="block text-sm font-medium text-charcoal-700 mb-1">
                                {t('login.email')}
                            </label>
                            <div className="relative">
                                <input
                                    id="auth-email"
                                    type="email"
                                    autoComplete={isSignup ? 'email' : 'username'}
                                    required
                                    value={email}
                                    onChange={(e) => { setEmail(e.target.value); clearErrors(); }}
                                    aria-invalid={!!(emailError || authError)}
                                    className={`w-full h-11 pl-10 pr-3 border rounded-xl outline-none transition-colors ${emailError || authError
                                        ? 'border-red-500 focus-visible:ring-2 focus-visible:ring-red-200'
                                        : 'border-charcoal-300 focus-visible:ring-2 focus-visible:ring-accent-400 focus-visible:border-accent-500'
                                        }`}
                                    placeholder={t('login.emailPlaceholder')}
                                />
                                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-charcoal-400" size={18} aria-hidden="true" />
                            </div>
                            {emailError && (
                                <p className="mt-1.5 text-[12px] text-red-600 font-medium flex items-center gap-1.5">
                                    <AlertCircle size={14} aria-hidden="true" />
                                    {emailError}
                                </p>
                            )}
                        </div>

                        {!isForgot && (
                            <div>
                                <div className="flex items-center justify-between mb-1">
                                    <label htmlFor="auth-password" className="block text-sm font-medium text-charcoal-700">
                                        {t('login.password')}
                                    </label>
                                    {isLogin && (
                                        <button
                                            type="button"
                                            onClick={() => switchMode('forgot')}
                                            className="text-xs font-semibold text-brand-600 hover:text-brand-500 hover:underline py-1.5 -my-1.5"
                                        >
                                            {t('login.forgotPasswordLink')}
                                        </button>
                                    )}
                                </div>
                                <div className="relative">
                                    <input
                                        id="auth-password"
                                        type="password"
                                        autoComplete={isSignup ? 'new-password' : 'current-password'}
                                        required
                                        value={password}
                                        onChange={(e) => { setPassword(e.target.value); clearErrors(); }}
                                        aria-invalid={!!(passwordError || authError)}
                                        className={`w-full h-11 pl-10 pr-3 border rounded-xl outline-none transition-colors ${passwordError || authError
                                            ? 'border-red-500 focus-visible:ring-2 focus-visible:ring-red-200'
                                            : 'border-charcoal-300 focus-visible:ring-2 focus-visible:ring-accent-400 focus-visible:border-accent-500'
                                            }`}
                                        placeholder={t('login.passwordPlaceholder')}
                                    />
                                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-charcoal-400" size={18} aria-hidden="true" />
                                </div>
                                {passwordError && (
                                    <p className="mt-1.5 text-[12px] text-red-600 font-medium flex items-center gap-1.5">
                                        <AlertCircle size={14} aria-hidden="true" />
                                        {passwordError}
                                    </p>
                                )}
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full h-11 mt-2 bg-brand-700 text-white rounded-xl font-semibold hover:bg-brand-800 focus-visible:ring-4 focus-visible:ring-accent-200 transition-colors flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                            {loading ? (
                                <Loader2 className="animate-spin" size={20} />
                            ) : (
                                <>
                                    {isLogin
                                        ? t('login.continueWithEmail')
                                        : isSignup
                                            ? t('login.signUp')
                                            : t('login.sendResetLink')}
                                    <ArrowRight size={18} />
                                </>
                            )}
                        </button>
                    </form>

                    {/* Footer — mode switcher + ToS */}
                    <div className="mt-6 space-y-3 text-center">
                        <div className="text-sm text-charcoal-600">
                            {isForgot ? (
                                <button
                                    type="button"
                                    onClick={() => switchMode('login')}
                                    className="font-semibold text-brand-600 hover:text-brand-500 hover:underline"
                                >
                                    {t('login.backToSignIn')}
                                </button>
                            ) : (
                                <>
                                    {isLogin ? t('login.noAccount') : t('login.hasAccount')}{' '}
                                    <button
                                        type="button"
                                        onClick={() => switchMode(isLogin ? 'signup' : 'login')}
                                        className="font-semibold text-brand-600 hover:text-brand-500 hover:underline inline-block py-1.5 -my-1.5"
                                    >
                                        {isLogin ? t('login.switchToSignUp') : t('login.switchToSignIn')}
                                    </button>
                                </>
                            )}
                        </div>

                        {isSignup && (
                            <p className="text-xs text-charcoal-500 leading-relaxed">
                                {t('login.tosBlurb')}{' '}
                                <button
                                    type="button"
                                    onClick={onOpenTerms}
                                    className="font-semibold text-brand-700 hover:text-accent-600 underline underline-offset-2 inline-block py-1 -my-1"
                                >
                                    {t('login.tosLink')}
                                </button>
                                .
                            </p>
                        )}

                        {!isSignup && onOpenTerms && (
                            <button
                                type="button"
                                onClick={onOpenTerms}
                                className="text-xs text-charcoal-500 hover:text-brand-700 underline underline-offset-2 inline-block py-1.5 -my-1.5"
                            >
                                {t('login.tosLink')}
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};
