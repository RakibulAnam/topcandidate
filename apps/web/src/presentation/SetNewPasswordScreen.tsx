// SetNewPasswordScreen — landing for the password-recovery flow.
//
// HOW USERS ARRIVE HERE
// =====================
// 1. User clicks "Forgot password?" on the LoginScreen and submits their email.
// 2. AuthContext.requestPasswordReset → Supabase sends a recovery email with
//    a link back to `<origin>/?auth=recovery` (see AuthContext header).
// 3. When the user clicks that link, Supabase's GoTrue client parses the
//    URL hash (`#access_token=…&type=recovery`) and fires a
//    `PASSWORD_RECOVERY` auth event. App.tsx watches for that event and
//    routes the user here.
// 4. Inside this screen, the supabase-js session is the recovery session —
//    `updateUser({ password })` will set the new password and replace the
//    session with a normal one. The AuthProvider then redirects the user
//    into the app like any other sign-in.
//
// EXPIRY / INVALID TOKEN
// ======================
// Supabase recovery links expire after 1h by default and are one-use. If
// the user arrives with an expired or already-used token, the GoTrue client
// surfaces an `error` on the hash (e.g. `#error=access_denied&error_code=otp_expired`).
// We detect that and show a friendly "request a new link" CTA.
//
// SECURITY
// ========
// - The recovery token is single-use server-side (Supabase enforces).
// - We require min-6 chars + confirmation match client-side; Supabase
//   also enforces its server-side password policy.
// - We never send the new password through our API — it goes directly to
//   Supabase via the supabase-js client.

import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Lock, Loader2, AlertCircle, XCircle } from 'lucide-react';
import { useAuth } from '../infrastructure/auth/AuthContext';
import { initialAuthParams } from '../infrastructure/supabase/client';
import { useT } from './i18n/LocaleContext';
import { LanguageToggle } from './i18n/LanguageToggle';

interface Props {
  onDone: () => void;
  onRequestNewLink: () => void;
}

/**
 * Read `#error=…` from the URL hash. Supabase puts recovery errors there
 * (not in the query string).
 */
function readHashError(): string | null {
  if (typeof window === 'undefined') return null;
  const hash = window.location.hash.replace(/^#/, '');
  if (!hash) return null;
  const params = new URLSearchParams(hash);
  const errorCode = params.get('error_code') ?? params.get('error');
  if (!errorCode) return null;
  return errorCode;
}

export const SetNewPasswordScreen: React.FC<Props> = ({ onDone, onRequestNewLink }) => {
  const t = useT();
  const { updatePassword } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);

  useEffect(() => {
    // An expired/used recovery link surfaces its error either in the hash
    // (implicit flow) or the query string (PKCE flow → captured at module load
    // in initialAuthParams before the URL was cleaned). Either way: same
    // "request a new link" UI.
    const hashErr = readHashError();
    const paramErr = initialAuthParams?.kind === 'error' ? initialAuthParams.error : null;
    if (hashErr || paramErr) {
      setLinkError(t('login.recoveryLinkExpired'));
    }
  }, [t]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (password.length < 6) {
      setErr(t('login.weakPassword'));
      return;
    }
    if (password !== confirm) {
      setErr(t('login.passwordsDontMatch'));
      return;
    }
    setLoading(true);
    try {
      await updatePassword(password);
      // Clean the hash so a refresh doesn't re-trigger recovery state.
      try { window.history.replaceState(null, '', window.location.pathname); } catch { /* ignore */ }
      toast.success(t('login.passwordUpdated'));
      onDone();
    } catch (error) {
      setErr(error instanceof Error ? error.message : t('login.authFailedFallback'));
    } finally {
      setLoading(false);
    }
  };

  if (linkError) {
    return (
      <div className="min-h-dvh bg-charcoal-100 flex items-center justify-center p-4 overflow-y-auto">
        <div className="bg-charcoal-50 w-full max-w-md rounded-2xl border border-charcoal-200 shadow-2xl shadow-brand-900/5 overflow-hidden my-auto">
          <div className="p-6 sm:p-8">
            <div className="flex items-start justify-between mb-6">
              <div className="inline-flex items-baseline gap-1.5">
                <span className="font-display text-2xl font-semibold tracking-tight text-brand-700">TOP</span>
                <span className="font-display text-2xl font-semibold tracking-tight text-accent-500">CANDIDATE</span>
              </div>
              <LanguageToggle />
            </div>
            <div className="p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3" role="alert">
              <XCircle className="text-red-500 shrink-0 mt-0.5" size={20} />
              <p className="text-sm text-red-700 flex-1">{linkError}</p>
            </div>
            <button
              type="button"
              onClick={onRequestNewLink}
              className="w-full h-11 mt-5 bg-brand-700 text-white rounded-xl font-semibold hover:bg-brand-800 focus-visible:ring-4 focus-visible:ring-accent-200 transition-colors"
            >
              {t('login.forgotPasswordLink')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-charcoal-100 flex items-center justify-center p-4">
      <div className="bg-charcoal-50 w-full max-w-md rounded-2xl border border-charcoal-200 shadow-2xl shadow-brand-900/5 overflow-hidden">
        <div className="p-8">
          <div className="flex items-start justify-between mb-6">
            <div className="inline-flex items-baseline gap-1.5">
              <span className="font-display text-2xl font-semibold tracking-tight text-brand-700">TOP</span>
              <span className="font-display text-2xl font-semibold tracking-tight text-accent-500">CANDIDATE</span>
            </div>
            <LanguageToggle />
          </div>

          <div className="text-center mb-8">
            <h1 className="font-display text-2xl font-semibold text-brand-700 mb-2">
              {t('login.setNewPassword')}
            </h1>
            <p className="text-sm text-charcoal-500">{t('login.setNewPasswordSubtitle')}</p>
          </div>

          {err && (
            <div className="mb-5 p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3" role="alert">
              <AlertCircle className="text-red-500 shrink-0 mt-0.5" size={18} />
              <p className="text-sm text-red-700 flex-1">{err}</p>
            </div>
          )}

          <form onSubmit={submit} className="space-y-4" noValidate>
            <div>
              <label htmlFor="new-password" className="block text-sm font-medium text-charcoal-700 mb-1">
                {t('login.newPasswordLabel')}
              </label>
              <div className="relative">
                <input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setErr(null); }}
                  className="w-full h-11 pl-10 pr-3 border border-charcoal-300 rounded-xl focus-visible:ring-2 focus-visible:ring-accent-400 focus-visible:border-accent-500 outline-none transition-colors"
                  placeholder={t('login.newPasswordPlaceholder')}
                />
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-charcoal-400" size={18} aria-hidden="true" />
              </div>
            </div>

            <div>
              <label htmlFor="confirm-password" className="block text-sm font-medium text-charcoal-700 mb-1">
                {t('login.confirmPasswordLabel')}
              </label>
              <div className="relative">
                <input
                  id="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={confirm}
                  onChange={(e) => { setConfirm(e.target.value); setErr(null); }}
                  className="w-full h-11 pl-10 pr-3 border border-charcoal-300 rounded-xl focus-visible:ring-2 focus-visible:ring-accent-400 focus-visible:border-accent-500 outline-none transition-colors"
                  placeholder={t('login.confirmPasswordPlaceholder')}
                />
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-charcoal-400" size={18} aria-hidden="true" />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full h-11 bg-brand-700 text-white rounded-xl font-semibold hover:bg-brand-800 focus-visible:ring-4 focus-visible:ring-accent-200 transition-colors flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loading ? <Loader2 className="animate-spin" size={20} /> : t('login.savePassword')}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
