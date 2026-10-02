// Build-time prerender entry (NOT part of the client bundle).
//
// The app is a client-rendered SPA, so the HTML Vercel serves is an empty
// <div id="root">. Google renders JavaScript eventually, but most crawlers —
// and every AI crawler (GPTBot, ClaudeBot, PerplexityBot, …) — read only the
// raw HTML. scripts/prerender.mjs renders each public page in PAGES to static
// markup and injects it, with that page's head tags + JSON-LD, into its own
// HTML file (`/` → dist/index.html; every other page reached through a
// vercel.json rewrite). On load, index.tsx's createRoot() simply replaces the
// markup — this is a snapshot for crawlers and first paint, not hydration.
//
// Positioning, for anything written here: TOP CANDIDATE is a job application
// toolkit — a complete application kit for every job — never "an AI resume
// builder". Marketing copy and metadata do not mention AI.

import React from 'react';
import { renderToString } from 'react-dom/server';
import { LocaleProvider, type Locale } from './presentation/i18n/LocaleContext';
import { FEATURE_SLUGS, toLocalePath, type FeatureSlug } from './presentation/i18n/localizedPaths';
import { LandingScreen } from './presentation/LandingScreen';
import { FeaturePage, FEATURE_KEYS } from './presentation/marketing/FeaturePage';
import { TermsOfService } from './presentation/legal/TermsOfService';
import { en } from './presentation/i18n/locales/en';
import { bn } from './presentation/i18n/locales/bn';
import { CONTACT_EMAIL, CONTACT_FACEBOOK_URL } from './presentation/support';
import { SITE_URL } from './presentation/seo';

export { SITE_URL };

const DICTS = { en, bn };
const LOCALES: Locale[] = ['en', 'bn'];
const OG_IMAGE = `${SITE_URL}/og-toolkit.png`;
const ORG_ID = `${SITE_URL}/#organization`;
const SITE_ID = `${SITE_URL}/#website`;

const url = (path: string) => `${SITE_URL}${path}`;
const noop = () => {};

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const render = (locale: Locale, node: React.ReactNode): string =>
  renderToString(<LocaleProvider initialLocale={locale}>{node}</LocaleProvider>);

const faqPage = (id: string, locale: Locale, faqs: { q: string; a: string }[]) => ({
  '@type': 'FAQPage',
  '@id': id,
  inLanguage: locale,
  mainEntity: faqs.map(({ q, a }) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
});

// ── Head ─────────────────────────────────────────────────────────────────

interface HeadSpec {
  title: string;
  description: string;
  path: string;
  locale: Locale;
  /** English path of a bilingual page → emits hreflang en / bn / x-default. */
  bilingualEnPath?: string;
  imageAlt?: string;
  jsonLd?: object;
}

/** Replaces everything between the `<!-- seo:start -->` / `<!-- seo:end -->` markers in index.html. */
const head = (h: HeadSpec): string => {
  const tags = [
    `<title>${esc(h.title)}</title>`,
    `<meta name="description" content="${esc(h.description)}" />`,
    `<link rel="canonical" href="${url(h.path)}" />`,
  ];
  if (h.bilingualEnPath) {
    tags.push(
      `<link rel="alternate" hreflang="en" href="${url(toLocalePath(h.bilingualEnPath, 'en'))}" />`,
      `<link rel="alternate" hreflang="bn" href="${url(toLocalePath(h.bilingualEnPath, 'bn'))}" />`,
      `<link rel="alternate" hreflang="x-default" href="${url(toLocalePath(h.bilingualEnPath, 'en'))}" />`,
    );
  }
  tags.push(
    `<meta name="robots" content="index, follow, max-image-preview:large" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="TOP CANDIDATE" />`,
    `<meta property="og:url" content="${url(h.path)}" />`,
    `<meta property="og:title" content="${esc(h.title)}" />`,
    `<meta property="og:description" content="${esc(h.description)}" />`,
    `<meta property="og:image" content="${OG_IMAGE}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="${esc(h.imageAlt ?? DICTS[h.locale].seo.ogImageAlt)}" />`,
    `<meta property="og:locale" content="${h.locale === 'bn' ? 'bn_BD' : 'en_US'}" />`,
  );
  if (h.bilingualEnPath) tags.push(`<meta property="og:locale:alternate" content="${h.locale === 'bn' ? 'en_US' : 'bn_BD'}" />`);
  tags.push(
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(h.title)}" />`,
    `<meta name="twitter:description" content="${esc(h.description)}" />`,
    `<meta name="twitter:image" content="${OG_IMAGE}" />`,
  );
  if (h.jsonLd) tags.push(`<script type="application/ld+json">${JSON.stringify(h.jsonLd).replace(/</g, '\\u003c')}</script>`);
  return tags.join('\n  ');
};

// ── Structured data ──────────────────────────────────────────────────────

const landingJsonLd = (locale: Locale) => {
  const d = DICTS[locale];
  const l = d.landing;
  const path = toLocalePath('/', locale);
  const faqs = [0, 1, 2, 3, 4, 5].map((n) => ({ q: l[`faq${n}Q` as keyof typeof l], a: l[`faq${n}A` as keyof typeof l] }));
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': ORG_ID,
        name: 'TOP CANDIDATE',
        alternateName: ['Top Candidate', 'TopCandidate', 'Top Candidate BD', 'topcandidatebd', 'টপ ক্যান্ডিডেট'],
        description: en.seo.description,
        slogan: en.landing.footerTagline,
        url: url('/'),
        logo: { '@type': 'ImageObject', url: url('/icon-512.png'), width: 512, height: 512 },
        image: OG_IMAGE,
        email: CONTACT_EMAIL,
        sameAs: [CONTACT_FACEBOOK_URL],
        areaServed: { '@type': 'Country', name: 'Bangladesh' },
        knowsLanguage: ['en', 'bn'],
      },
      {
        '@type': 'WebSite',
        '@id': SITE_ID,
        name: 'TOP CANDIDATE',
        alternateName: ['Top Candidate', 'Top Candidate BD', 'topcandidatebd.com'],
        url: url('/'),
        inLanguage: ['en', 'bn'],
        publisher: { '@id': ORG_ID },
      },
      {
        '@type': 'WebApplication',
        '@id': `${SITE_URL}/#app`,
        name: 'TOP CANDIDATE',
        url: url(path),
        description: d.seo.description,
        applicationCategory: 'BusinessApplication',
        applicationSubCategory: 'Job application toolkit',
        operatingSystem: 'Web browser',
        inLanguage: locale,
        availableLanguage: ['en', 'bn'],
        areaServed: { '@type': 'Country', name: 'Bangladesh' },
        audience: { '@type': 'Audience', audienceType: 'Job seekers', geographicArea: { '@type': 'Country', name: 'Bangladesh' } },
        featureList: [l.tool1Title, l.tool2Title, l.tool3Title, l.tool4Title, l.tool5Title],
        image: OG_IMAGE,
        publisher: { '@id': ORG_ID },
        offers: [
          { '@type': 'Offer', name: l.trustFree, price: '0', priceCurrency: 'BDT' },
          { '@type': 'Offer', name: l.trustPrice, price: '200', priceCurrency: 'BDT' },
        ],
      },
      faqPage(`${url(path)}#faq`, locale, faqs),
    ],
  };
};

const featureJsonLd = (slug: FeatureSlug, locale: Locale) => {
  const d = DICTS[locale];
  const f = d.features[FEATURE_KEYS[slug]];
  const path = toLocalePath(`/${slug}`, locale);
  const label = {
    'resume-maker': d.features.common.linkResume,
    'cover-letter': d.features.common.linkCover,
    'interview-preparation': d.features.common.linkInterview,
    'job-application-email': d.features.common.linkEmail,
  }[slug];
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage',
        '@id': url(path),
        url: url(path),
        name: f.seoTitle,
        description: f.seoDescription,
        inLanguage: locale,
        isPartOf: { '@id': SITE_ID },
        about: { '@id': `${SITE_URL}/#app` },
        publisher: { '@id': ORG_ID },
        primaryImageOfPage: OG_IMAGE,
        breadcrumb: { '@id': `${url(path)}#breadcrumb` },
      },
      {
        '@type': 'BreadcrumbList',
        '@id': `${url(path)}#breadcrumb`,
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: d.features.common.breadcrumbHome, item: url(toLocalePath('/', locale)) },
          { '@type': 'ListItem', position: 2, name: label, item: url(path) },
        ],
      },
      faqPage(`${url(path)}#faq`, locale, [1, 2, 3].map((n) => ({ q: f[`faq${n}Q` as keyof typeof f], a: f[`faq${n}A` as keyof typeof f] }))),
    ],
  };
};

// ── Pages ────────────────────────────────────────────────────────────────

export interface PrerenderPage {
  /** The page's own URL path. Stamped as <html data-prerender-path>. */
  path: string;
  /**
   * Stamped as <html data-prerender>; index.html's boot script keys off it:
   * `landing` snapshots hide for signed-in browsers (they go to the
   * dashboard); English snapshots of bilingual pages hide for bn visitors.
   */
  kind: 'landing' | 'feature' | 'terms';
  bilingual: boolean;
  /** Output file under dist/. */
  file: string;
  locale: Locale;
  head: () => string;
  body: () => string;
  priority: string;
  /** hreflang alternates for the sitemap (the head carries its own). */
  alternates?: { hreflang: string; href: string }[];
}

const alternatesFor = (enPath: string) => [
  { hreflang: 'en', href: url(toLocalePath(enPath, 'en')) },
  { hreflang: 'bn', href: url(toLocalePath(enPath, 'bn')) },
  { hreflang: 'x-default', href: url(toLocalePath(enPath, 'en')) },
];

// Flat file names: `/bn/cover-letter` → bn-cover-letter.html. Never a `bn/`
// directory — it would sit next to bn.html and make `/bn` ambiguous to the
// static file server. vercel.json rewrites each clean URL to its file.
const fileFor = (path: string) => (path === '/' ? 'index.html' : `${path.slice(1).replace(/\//g, '-')}.html`);

const landingPages: PrerenderPage[] = LOCALES.map((locale) => {
  const path = toLocalePath('/', locale);
  return {
    path,
    kind: 'landing',
    bilingual: true,
    file: fileFor(path),
    locale,
    head: () => head({ title: DICTS[locale].seo.title, description: DICTS[locale].seo.description, path, locale, bilingualEnPath: '/', jsonLd: landingJsonLd(locale) }),
    body: () => render(locale, <LandingScreen onGetStarted={noop} onOpenTerms={noop} onOpenFeature={noop} />),
    priority: locale === 'en' ? '1.0' : '0.9',
    alternates: alternatesFor('/'),
  };
});

const featurePages: PrerenderPage[] = FEATURE_SLUGS.flatMap((slug) =>
  LOCALES.map((locale): PrerenderPage => {
    const path = toLocalePath(`/${slug}`, locale);
    const f = DICTS[locale].features[FEATURE_KEYS[slug]];
    return {
      path,
      kind: 'feature',
      bilingual: true,
      file: fileFor(path),
      locale,
      head: () => head({ title: f.seoTitle, description: f.seoDescription, path, locale, bilingualEnPath: `/${slug}`, jsonLd: featureJsonLd(slug, locale) }),
      body: () => render(locale, <FeaturePage slug={slug} onGetStarted={noop} onOpenHome={noop} onOpenFeature={noop} onOpenTerms={noop} />),
      priority: locale === 'en' ? '0.8' : '0.7',
      alternates: alternatesFor(`/${slug}`),
    };
  }),
);

// The Terms page is English-only (no `bn` twin, no JSON-LD).
const termsPage: PrerenderPage = {
  path: '/legal/terms',
  kind: 'terms',
  bilingual: false,
  file: 'legal-terms.html',
  locale: 'en',
  head: () => head({ title: en.seo.termsTitle, description: en.seo.termsDescription, path: '/legal/terms', locale: 'en' }),
  body: () => renderToString(<TermsOfService onBack={noop} />),
  priority: '0.3',
};

export const PAGES: PrerenderPage[] = [...landingPages, ...featurePages, termsPage];
