// Build-time prerender entry (NOT part of the client bundle).
//
// The app is a client-rendered SPA, so the HTML Vercel serves is an empty
// <div id="root">. Google renders JavaScript eventually, but most crawlers —
// and every AI crawler (GPTBot, ClaudeBot, PerplexityBot, …) — read only the
// raw HTML. scripts/prerender.mjs renders the landing page to static markup
// here and injects it, with the head tags + JSON-LD below, into
// dist/index.html (English, `/`) and dist/bn.html (Bangla, `/bn`).
// On load, index.tsx's createRoot() simply replaces the markup — this is a
// snapshot for crawlers and first paint, not hydration.

import React from 'react';
import { renderToString } from 'react-dom/server';
import { LocaleProvider, BN_LANDING_PATH, type Locale } from './presentation/i18n/LocaleContext';
import { LandingScreen } from './presentation/LandingScreen';
import { en } from './presentation/i18n/locales/en';
import { bn } from './presentation/i18n/locales/bn';
import { CONTACT_EMAIL, CONTACT_FACEBOOK_URL } from './presentation/support';
import { SITE_URL } from './presentation/seo';

export { SITE_URL };

const DICTS = { en, bn };

export const LOCALES: Locale[] = ['en', 'bn'];

export const pathFor = (locale: Locale): string => (locale === 'bn' ? BN_LANDING_PATH : '/');

const urlFor = (locale: Locale): string => `${SITE_URL}${pathFor(locale)}`;

const noop = () => {};

export const renderLanding = (locale: Locale): string =>
  renderToString(
    <LocaleProvider initialLocale={locale}>
      <LandingScreen onGetStarted={noop} onOpenTerms={noop} />
    </LocaleProvider>,
  );

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const structuredData = (locale: Locale) => {
  const d = DICTS[locale];
  const l = d.landing;
  const faqs = [0, 1, 2, 3, 4, 5].map((n) => ({
    q: l[`faq${n}Q` as keyof typeof l],
    a: l[`faq${n}A` as keyof typeof l],
  }));
  const org = `${SITE_URL}/#organization`;
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': org,
        name: 'TOP CANDIDATE',
        alternateName: ['Top Candidate', 'TopCandidate', 'Top Candidate BD', 'topcandidatebd', 'টপ ক্যান্ডিডেট'],
        url: `${SITE_URL}/`,
        logo: `${SITE_URL}/icon-512.png`,
        email: CONTACT_EMAIL,
        sameAs: [CONTACT_FACEBOOK_URL],
        areaServed: { '@type': 'Country', name: 'Bangladesh' },
      },
      {
        '@type': 'WebSite',
        '@id': `${SITE_URL}/#website`,
        name: 'TOP CANDIDATE',
        alternateName: ['Top Candidate', 'topcandidatebd.com'],
        url: `${SITE_URL}/`,
        inLanguage: ['en', 'bn'],
        publisher: { '@id': org },
      },
      {
        '@type': 'WebApplication',
        '@id': `${SITE_URL}/#app`,
        name: 'TOP CANDIDATE',
        url: urlFor(locale),
        description: d.seo.description,
        applicationCategory: 'BusinessApplication',
        applicationSubCategory: 'Resume builder',
        operatingSystem: 'Web browser',
        inLanguage: locale,
        availableLanguage: ['en', 'bn'],
        areaServed: { '@type': 'Country', name: 'Bangladesh' },
        audience: { '@type': 'Audience', audienceType: 'Job seekers', geographicArea: { '@type': 'Country', name: 'Bangladesh' } },
        featureList: [l.tool1Title, l.tool2Title, l.tool3Title, l.tool4Title, l.tool5Title],
        image: `${SITE_URL}/og-image.png`,
        publisher: { '@id': org },
        offers: [
          { '@type': 'Offer', name: l.trustFree, price: '0', priceCurrency: 'BDT' },
          { '@type': 'Offer', name: l.trustPrice, price: '200', priceCurrency: 'BDT' },
        ],
      },
      {
        '@type': 'FAQPage',
        '@id': `${urlFor(locale)}#faq`,
        inLanguage: locale,
        mainEntity: faqs.map(({ q, a }) => ({
          '@type': 'Question',
          name: q,
          acceptedAnswer: { '@type': 'Answer', text: a },
        })),
      },
    ],
  };
};

/** Everything between the `<!-- seo:start -->` / `<!-- seo:end -->` markers in index.html. */
export const headFor = (locale: Locale): string => {
  const { seo } = DICTS[locale];
  const url = urlFor(locale);
  const image = `${SITE_URL}/og-image.png`;
  const json = JSON.stringify(structuredData(locale)).replace(/</g, '\\u003c');
  return [
    `<title>${esc(seo.title)}</title>`,
    `<meta name="description" content="${esc(seo.description)}" />`,
    `<link rel="canonical" href="${url}" />`,
    `<link rel="alternate" hreflang="en" href="${urlFor('en')}" />`,
    `<link rel="alternate" hreflang="bn" href="${urlFor('bn')}" />`,
    `<link rel="alternate" hreflang="x-default" href="${urlFor('en')}" />`,
    `<meta name="robots" content="index, follow, max-image-preview:large" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="TOP CANDIDATE" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:title" content="${esc(seo.title)}" />`,
    `<meta property="og:description" content="${esc(seo.description)}" />`,
    `<meta property="og:image" content="${image}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="${esc(seo.ogImageAlt)}" />`,
    `<meta property="og:locale" content="${locale === 'bn' ? 'bn_BD' : 'en_US'}" />`,
    `<meta property="og:locale:alternate" content="${locale === 'bn' ? 'en_US' : 'bn_BD'}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(seo.title)}" />`,
    `<meta name="twitter:description" content="${esc(seo.description)}" />`,
    `<meta name="twitter:image" content="${image}" />`,
    `<script type="application/ld+json">${json}</script>`,
  ].join('\n  ');
};
