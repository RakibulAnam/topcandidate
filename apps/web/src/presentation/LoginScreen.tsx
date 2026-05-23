import React, { useState } from 'react';
import { supabase } from '../infrastructure/supabase/client';
import { toast } from 'sonner';
import { Mail, Lock, Loader2, ArrowRight, AlertCircle, XCircle } from 'lucide-react';
import { validateEmail } from '../application/validation/emailValidator';
import { useT } from './i18n/LocaleContext';
import { LanguageToggle } from './i18n/LanguageToggle';

export const LoginScreen = () => {
    const t = useT();
    const [isLogin, setIsLogin] = useState(true);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [fullName, setFullName] = useState('');
    const [loading, setLoading] = useState(false);

    // UX States
    const [passwordError, setPasswordError] = useState('');
    const [emailError, setEmailError] = useState('');
    const [authError, setAuthError] = useState<string | null>(null);

    const clearErrors = () => {
        setAuthError(null);
        if (passwordError) setPasswordError('');
        if (emailError) setEmailError('');
    };

    const handleAuth = async (e: React.FormEvent) => {
        e.preventDefault();
        clearErrors();

        if (password.length < 6) {
            setPasswordError(t('login.weakPassword'));
            return;
        }

        setLoading(true);

        // Client-side Validation
        // Email gate runs only on signup — login should accept whatever the
        // user originally registered with, even if our rules later tightened.
        // The disposable-domain list is lazy-loaded, so this awaits a fetch
        // on the first check; that's why we toggle `loading` first.
        if (!isLogin) {
            const result = await validateEmail(email);
            if (!result.valid) {
                setEmailError(result.reason);
                setLoading(false);
                return;
            }
        }

        try {
            if (isLogin) {
                const { error } = await supabase.auth.signInWithPassword({
                    email,
                    password,
                });
                if (error) throw error;
                toast.success(t('login.signInSuccess'));
                // AuthProvider will handle redirect
            } else {
                const { error } = await supabase.auth.signUp({
                    email,
                    password,
                    options: {
                        data: {
                            full_name: fullName,
                        },
                    },
                });

                if (error) throw error;
                toast.success(t('login.signUpSuccess'));
            }
        } catch (error) {
            console.error("Auth error:", error);
            const message = error instanceof Error ? error.message : t('login.authFailedFallback');
            setAuthError(message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-charcoal-100 flex items-center justify-center p-4">
            <div className="bg-charcoal-50 w-full max-w-md rounded-2xl border border-charcoal-200 shadow-2xl shadow-brand-900/5 overflow-hidden">
                <div className="p-8">
                    {/* Branding + language toggle */}
                    <div className="flex items-start justify-between mb-6">
                        <div className="inline-flex items-baseline gap-1.5 select-none">
                            <span className="font-display text-2xl font-semibold tracking-tight text-brand-700">TOP</span>
                            <span className="font-display text-2xl font-semibold tracking-tight text-accent-500">CANDIDATE</span>
                        </div>
                        <LanguageToggle />
                    </div>

                    <div className="text-center mb-8">
                        <h1 className="text-xl font-semibold text-charcoal-800 mb-2">
                            {isLogin ? t('login.welcomeBack') : t('login.createAccount')}
                        </h1>
                        <p className="text-sm text-charcoal-500">
                            {isLogin ? t('login.welcomeSubtitle') : t('login.createSubtitle')}
                        </p>
                    </div>

                    {/* Auth Error Alert using API response */}
                    {authError && (
                        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3 animate-in fade-in slide-in-from-top-2">
                            <XCircle className="text-red-500 shrink-0 mt-0.5" size={20} />
                            <div className="flex-1">
                                <h3 className="text-sm font-semibold text-red-800">{t('login.authFailedTitle')}</h3>
                                <p className="text-sm text-red-600 mt-1">
                                    {authError === "Invalid login credentials"
                                        ? t('login.invalidCredentials')
                                        : authError}
                                </p>
                            </div>
                        </div>
                    )}

                    <form onSubmit={handleAuth} className="space-y-4">
                        {!isLogin && (
                            <div>
                                <label className="block text-sm font-medium text-charcoal-700 mb-1">{t('login.fullName')}</label>
                                <div className="relative">
                                    <input
                                        type="text"
                                        required={!isLogin}
                                        value={fullName}
                                        onChange={(e) => {
                                            setFullName(e.target.value);
                                            clearErrors();
                                        }}
                                        className="w-full px-4 py-2 pl-10 border border-charcoal-300 rounded-lg focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:border-brand-500 outline-none transition-colors"
                                        placeholder={t('login.fullNamePlaceholder')}
                                    />
                                    <div className="absolute left-3 top-2.5 text-charcoal-400">
                                        <ArrowRight size={18} />
                                    </div>
                                </div>
                            </div>
                        )}

                        <div>
                            <label className="block text-sm font-medium text-charcoal-700 mb-1">{t('login.email')}</label>
                            <div className="relative">
                                <input
                                    type="email"
                                    required
                                    value={email}
                                    onChange={(e) => {
                                        setEmail(e.target.value);
                                        clearErrors();
                                    }}
                                    className={`w-full px-4 py-2 pl-10 border rounded-lg outline-none transition-colors ${emailError || authError
                                            ? 'border-red-500 focus-visible:ring-2 focus-visible:ring-red-200 focus-visible:border-red-500'
                                            : 'border-charcoal-300 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:border-brand-500'
                                        }`}
                                    placeholder={t('login.emailPlaceholder')}
                                />
                                <div className="absolute left-3 top-2.5 text-charcoal-400">
                                    <Mail size={18} />
                                </div>
                            </div>
                            {emailError && (
                                <p className="mt-1 text-sm text-red-500 font-medium flex items-center gap-1 animate-pulse">
                                    <AlertCircle size={14} />
                                    {emailError}
                                </p>
                            )}
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-charcoal-700 mb-1">{t('login.password')}</label>
                            <div className="relative">
                                <input
                                    type="password"
                                    required
                                    value={password}
                                    onChange={(e) => {
                                        setPassword(e.target.value);
                                        clearErrors();
                                    }}
                                    className={`w-full px-4 py-2 pl-10 border rounded-lg outline-none transition-colors ${passwordError || authError
                                            ? 'border-red-500 focus-visible:ring-2 focus-visible:ring-red-200 focus-visible:border-red-500'
                                            : 'border-charcoal-300 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:border-brand-500'
                                        }`}
                                    placeholder={t('login.passwordPlaceholder')}
                                />
                                <div className="absolute left-3 top-2.5 text-charcoal-400">
                                    <Lock size={18} />
                                </div>
                            </div>
                            {passwordError && (
                                <p className="mt-1 text-sm text-red-500 font-medium flex items-center gap-1 animate-pulse">
                                    <AlertCircle size={14} />
                                    {passwordError}
                                </p>
                            )}
                        </div>

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full bg-brand-600 text-white py-2.5 rounded-lg font-semibold hover:bg-brand-700 focus-visible:ring-4 focus-visible:ring-brand-200 transition-colors flex items-center justify-center gap-2"
                        >
                            {loading ? (
                                <Loader2 className="animate-spin" size={20} />
                            ) : (
                                <>
                                    {isLogin ? t('login.signIn') : t('login.signUp')}
                                    <ArrowRight size={18} />
                                </>
                            )}
                        </button>
                    </form>

                    <div className="mt-6 text-center text-sm text-charcoal-600">
                        {isLogin ? t('login.noAccount') : t('login.hasAccount')}{' '}
                        <button
                            type="button"
                            onClick={() => {
                                setIsLogin(!isLogin);
                                clearErrors();
                            }}
                            className="font-semibold text-brand-600 hover:text-brand-500 hover:underline"
                        >
                            {isLogin ? t('login.switchToSignUp') : t('login.switchToSignIn')}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
