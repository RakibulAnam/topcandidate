// Search metadata at runtime.
//
// The static <head> (title, description, canonical, hreflang, OG, JSON-LD) of
// every public page is written at build time by scripts/prerender.mjs (pages
// listed in src/prerender.tsx PAGES). Once the app is running, this hook
// re-points the per-page tags at the current screen as the user navigates:
// the landing pages, feature pages and Terms are indexable; everything behind
// sign-in is `noindex` (vercel.json also sends an `X-Robots-Tag: noindex`
// header for those paths, which covers crawlers that don't run JavaScript).

import { useEffect } from 'react';
import type { NavScreen } from './hooks/useBrowserNav';
import { useLocale, type TKey } from './i18n/LocaleContext';
import type { FeatureSlug } from './i18n/localizedPaths';
import { FEATURE_KEYS } from './marketing/FeaturePage';

/** The production origin. The apex domain 308s here (Vercel domain settings); the *.vercel.app host is noindex (vercel.json). */
export const SITE_URL = 'https://www.topcandidatebd.com';

const INDEXABLE: NavScreen[] = ['LANDING', 'LEGAL_TERMS', 'FEATURE'];

const upsert = (selector: string, create: () => HTMLElement, attr: string, value: string) => {
  let el = document.head.querySelector<HTMLElement>(selector);
  if (!el) {
    el = create();
    document.head.appendChild(el);
  }
  el.setAttribute(attr, value);
};

const meta = (name: string) => () => {
  const el = document.createElement('meta');
  el.setAttribute('name', name);
  return el;
};

export function useDocumentMeta(screen: NavScreen, feature?: FeatureSlug) {
  const { locale, t } = useLocale();

  useEffect(() => {
    const indexable = INDEXABLE.includes(screen);
    const featureKey = screen === 'FEATURE' && feature ? FEATURE_KEYS[feature] : null;
    document.title =
      screen === 'LANDING' ? t('seo.title')
        : featureKey ? t(`features.${featureKey}.seoTitle` as TKey)
          : screen === 'LEGAL_TERMS' ? t('seo.termsTitle')
            : t('seo.appTitle');
    const description =
      featureKey ? t(`features.${featureKey}.seoDescription` as TKey)
        : screen === 'LEGAL_TERMS' ? t('seo.termsDescription')
          : t('seo.description');

    upsert('meta[name="description"]', meta('description'), 'content', description);
    upsert('meta[name="robots"]', meta('robots'), 'content', indexable ? 'index, follow, max-image-preview:large' : 'noindex, nofollow');
    upsert(
      'link[rel="canonical"]',
      () => {
        const el = document.createElement('link');
        el.setAttribute('rel', 'canonical');
        return el;
      },
      'href',
      `${SITE_URL}${indexable ? window.location.pathname : '/'}`,
    );
  }, [screen, feature, locale, t]);
}
