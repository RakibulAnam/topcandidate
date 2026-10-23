// "Open in your browser" bar for visitors inside an in-app browser (Facebook,
// Messenger, Instagram, TikTok, a generic Android WebView). Most of our
// traffic arrives that way, and those browsers are a poor home for the app:
// no saved login, Google sign-in is discouraged inside them, and PDF/Word
// downloads are unreliable.
//
// There is no guaranteed way out, so the bar offers the best one per platform
// and always keeps the manual route visible:
//   - Android: an `intent://…#Intent;scheme=https;end` link — hands the URL to
//     the default browser; works from Facebook, Messenger and Instagram.
//   - iOS: Apple gives in-app browsers no approved escape. `x-safari-https://`
//     works from Messenger and (via window.open) Facebook; Instagram has its
//     own `instagram://extbrowser/` route. Everyone also gets the
//     "⋯ → Open in external browser" hint and a Copy link button.
//
// Fixed to the bottom of the viewport, rendered after mount only (the landing
// page is prerendered and the server has no user agent) — so it never shifts
// layout. Dismissal lasts for the browser session.

import React, { useEffect, useState } from 'react';
import { ExternalLink, Copy, Check, X } from 'lucide-react';
import { useT } from '../i18n/LocaleContext';
import { track } from '../../infrastructure/analytics/track';
import { detectInAppBrowser, detectMobileOs, type InAppBrowser, type MobileOs } from '../../infrastructure/env/browserEnv';

const DISMISS_KEY = 'topcandidate.inappBarHidden';

const APP_NAME: Partial<Record<NonNullable<InAppBrowser>, string>> = {
  facebook: 'Facebook',
  messenger: 'Messenger',
  instagram: 'Instagram',
  tiktok: 'TikTok',
};

/** The escape URL for this platform/app, or null when there is none to try. */
export function escapeUrl(href: string, os: MobileOs, app: InAppBrowser): string | null {
  let url: URL;
  try { url = new URL(href); } catch { return null; }
  if (os === 'android') {
    // No `url.hash`: the intent syntax itself starts at the first '#', so a
    // fragment would corrupt it (the app routes by path anyway).
    return `intent://${url.host}${url.pathname}${url.search}#Intent;scheme=https;end`;
  }
  if (os === 'ios') {
    if (app === 'instagram') return `instagram://extbrowser/?url=${encodeURIComponent(url.href)}`;
    if (app === 'facebook' || app === 'messenger') return `x-safari-https://${url.host}${url.pathname}${url.search}${url.hash}`;
  }
  return null;
}

export const InAppBrowserBar: React.FC = () => {
  const t = useT();
  const [env, setEnv] = useState<{ app: InAppBrowser; os: MobileOs } | null>(null);
  const [hidden, setHidden] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const app = detectInAppBrowser();
    if (!app) return;
    let dismissed = false;
    try { dismissed = sessionStorage.getItem(DISMISS_KEY) === '1'; } catch { /* ignore */ }
    if (dismissed) return;
    const os = detectMobileOs();
    setEnv({ app, os });
    setHidden(false);
    track('inapp_escape_shown', { app, os });
  }, []);

  if (hidden || !env) return null;

  const target = escapeUrl(window.location.href, env.os, env.app);

  const open = () => {
    track('inapp_escape_click', { action: 'open', app: env.app, os: env.os });
    if (!target) return;
    // Facebook on iOS only honours the Safari scheme through window.open.
    if (env.os === 'ios' && env.app === 'facebook') {
      const w = window.open(target, '_blank');
      if (w) return;
    }
    window.location.href = target;
  };

  const copy = async () => {
    track('inapp_escape_click', { action: 'copy', app: env.app, os: env.os });
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard blocked — the manual hint still applies */ }
  };

  const dismiss = () => {
    track('inapp_escape_click', { action: 'dismiss', app: env.app, os: env.os });
    try { sessionStorage.setItem(DISMISS_KEY, '1'); } catch { /* ignore */ }
    setHidden(true);
  };

  return (
    <div
      role="region"
      aria-label={t('inappBar.label')}
      className="fixed inset-x-0 bottom-0 z-[60] px-3 pb-[max(12px,env(safe-area-inset-bottom))] motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-4 motion-safe:duration-300"
    >
      <div className="mx-auto max-w-xl rounded-2xl bg-brand-700 p-4 text-charcoal-50 shadow-[0_18px_50px_-18px_rgba(9,18,31,0.7)]">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-500 text-brand-800">
            <ExternalLink size={17} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[14.5px] font-semibold leading-snug">
              {env.app && APP_NAME[env.app] ? t('inappBar.title', { app: APP_NAME[env.app] as string }) : t('inappBar.titleGeneric')}
            </p>
            <p className="mt-1 text-[12.5px] leading-snug text-charcoal-300">
              {target ? t('inappBar.body') : t('inappBar.bodyManual')}
            </p>
          </div>
          <button
            type="button"
            onClick={dismiss}
            className="-mr-1 -mt-1 shrink-0 rounded-full p-2 text-charcoal-400 transition-colors hover:text-charcoal-50"
            aria-label={t('common.close')}
          >
            <X size={16} />
          </button>
        </div>
        <div className="mt-3 flex gap-2">
          {target && (
            <button
              type="button"
              onClick={open}
              className="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-full bg-accent-500 px-4 text-[14px] font-semibold text-brand-800 transition-colors hover:bg-accent-400"
            >
              {t('inappBar.open')}
            </button>
          )}
          <button
            type="button"
            onClick={copy}
            className={`inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full border border-charcoal-500 px-4 text-[13.5px] font-semibold transition-colors hover:border-charcoal-50 ${target ? '' : 'flex-1'}`}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? t('inappBar.copied') : t('inappBar.copy')}
          </button>
        </div>
        {env.os === 'ios' && (
          <p className="mt-2.5 text-[11.5px] leading-snug text-charcoal-400">{t('inappBar.iosHint')}</p>
        )}
      </div>
    </div>
  );
};
