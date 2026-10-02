// Public feature pages — /resume-maker, /cover-letter, /interview-preparation,
// /job-application-email (and their /bn twins).
//
// One component, four pages: each is the deep version of one part of the
// application kit, written to answer what people actually search for
// ("resume maker", "cover letter", "interview questions") while keeping the
// positioning — every piece is part of a complete application for ONE job,
// not a standalone generator. Copy lives in the `features` dictionary section;
// the page is prerendered for crawlers (src/prerender.tsx) and is SSR-safe
// (no window/document at render time).

import React, { useEffect } from 'react';
import { ArrowRight, Check, ChevronRight } from 'lucide-react';
import { useLocale, type TKey } from '../i18n/LocaleContext';
import { LanguageToggle } from '../i18n/LanguageToggle';
import { FEATURE_SLUGS, toLocalePath, type FeatureSlug } from '../i18n/localizedPaths';
import { Wordmark } from '../components/ui/Wordmark';
import { contactMailto } from '../support';

/** Dictionary section per slug (`features.<key>.*`). */
export const FEATURE_KEYS: Record<FeatureSlug, 'resume' | 'cover' | 'interview' | 'email'> = {
    'resume-maker': 'resume',
    'cover-letter': 'cover',
    'interview-preparation': 'interview',
    'job-application-email': 'email',
};

const LINK_LABEL: Record<FeatureSlug, TKey> = {
    'resume-maker': 'features.common.linkResume',
    'cover-letter': 'features.common.linkCover',
    'interview-preparation': 'features.common.linkInterview',
    'job-application-email': 'features.common.linkEmail',
};

interface Props {
    slug: FeatureSlug;
    /** Primary CTA — sign up (signed out) or the dashboard (signed in). */
    onGetStarted: () => void;
    onOpenHome: () => void;
    onOpenFeature: (slug: FeatureSlug) => void;
    onOpenTerms: () => void;
}

const Eyebrow = ({ children, className = '' }: { children: React.ReactNode; className?: string }) => (
    <p className={`text-[11px] uppercase tracking-[0.22em] text-accent-700 font-semibold ${className}`}>{children}</p>
);

export const FeaturePage = ({ slug, onGetStarted, onOpenHome, onOpenFeature, onOpenTerms }: Props) => {
    const { t, locale } = useLocale();
    const k = FEATURE_KEYS[slug];
    const f = (field: string) => t(`features.${k}.${field}` as TKey);

    // In-app navigation keeps the previous screen's scroll position; a new
    // page should open at its top.
    useEffect(() => {
        window.scrollTo(0, 0);
    }, [slug]);

    // Real hrefs for crawlers and new-tab clicks; plain clicks stay in-app.
    const inApp = (href: string, go: () => void) => ({
        href,
        onClick: (e: React.MouseEvent) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
            e.preventDefault();
            go();
        },
    });
    const homeLink = inApp(toLocalePath('/', locale), onOpenHome);
    const featureLink = (s: FeatureSlug) => inApp(toLocalePath(`/${s}`, locale), () => onOpenFeature(s));

    const points = [1, 2, 3, 4].map((n) => ({ title: f(`s${n}Title`), body: f(`s${n}Body`) }));
    const faqs = [1, 2, 3].map((n) => ({ q: f(`faq${n}Q`), a: f(`faq${n}A`) }));
    const steps = [
        { n: '1', title: t('landing.step1Title'), body: t('landing.step1Body') },
        { n: '2', title: t('landing.step2Title'), body: t('landing.step2Body') },
        { n: '3', title: t('landing.step3Title'), body: t('landing.step3Body') },
    ];

    const primaryCta = (
        <button
            type="button"
            onClick={onGetStarted}
            className="inline-flex items-center justify-center gap-2 bg-brand-700 text-charcoal-50 px-7 py-3.5 rounded-full font-semibold hover:bg-brand-800 transition-colors"
        >
            {t('features.common.ctaPrimary')} <ArrowRight size={16} />
        </button>
    );

    return (
        <div className="min-h-screen bg-charcoal-50 text-brand-700 overflow-x-clip">
            <header className="border-b border-charcoal-200 bg-charcoal-50/85 backdrop-blur-md sticky top-0 z-50">
                <div className="max-w-6xl mx-auto px-5 sm:px-8 h-16 flex items-center justify-between gap-3">
                    <a {...homeLink} className="flex items-center">
                        <Wordmark />
                    </a>
                    <div className="flex items-center gap-2 sm:gap-3">
                        <LanguageToggle variant="compact" />
                        <button
                            type="button"
                            onClick={onGetStarted}
                            className="hidden sm:inline-flex items-center gap-1.5 text-sm font-semibold bg-brand-700 text-charcoal-50 pl-4 pr-3.5 py-2 rounded-full hover:bg-brand-800 transition-colors whitespace-nowrap"
                        >
                            {t('landing.navGetStarted')} <ArrowRight size={14} />
                        </button>
                    </div>
                </div>
            </header>

            <main>
                {/* Hero */}
                <section className="px-5 sm:px-8 pt-8 sm:pt-12 pb-14 sm:pb-20">
                    <div className="max-w-3xl mx-auto">
                        <nav aria-label="Breadcrumb" className="mb-10">
                            <ol className="flex items-center gap-1.5 text-sm text-brand-500">
                                <li><a {...homeLink} className="hover:text-brand-700 transition-colors">{t('features.common.breadcrumbHome')}</a></li>
                                <li aria-hidden="true"><ChevronRight size={14} /></li>
                                <li aria-current="page" className="text-brand-700 font-medium">{t(LINK_LABEL[slug])}</li>
                            </ol>
                        </nav>
                        <Eyebrow className="mb-5">{f('eyebrow')}</Eyebrow>
                        <h1 className="font-display text-[clamp(2rem,6vw,3.75rem)] font-semibold leading-[1.06] text-brand-700 mb-6 text-balance">
                            {f('title')}
                        </h1>
                        <p className="text-[17px] sm:text-xl text-brand-500 leading-relaxed mb-9">{f('intro')}</p>
                        <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
                            {primaryCta}
                            <a
                                {...homeLink}
                                className="inline-flex items-center justify-center px-7 py-3.5 rounded-full font-semibold border border-charcoal-300 text-brand-700 hover:bg-charcoal-100 transition-colors"
                            >
                                {t('features.common.ctaSecondary')}
                            </a>
                        </div>
                        <p className="mt-5 text-sm text-brand-500">{t('features.common.ctaNote')}</p>
                    </div>
                </section>

                {/* What you get */}
                <section className="px-5 sm:px-8 pb-16 sm:pb-24">
                    <div className="max-w-6xl mx-auto grid sm:grid-cols-2 gap-4 sm:gap-5">
                        {points.map((p) => (
                            <div key={p.title} className="bg-white border border-charcoal-200 rounded-2xl p-6 sm:p-8">
                                <h2 className="font-display text-xl sm:text-2xl font-semibold text-brand-700 mb-3">{p.title}</h2>
                                <p className="text-[15px] text-brand-500 leading-relaxed">{p.body}</p>
                            </div>
                        ))}
                    </div>
                </section>

                {/* How it works */}
                <section className="px-5 sm:px-8 pb-16 sm:pb-24">
                    <div className="max-w-6xl mx-auto">
                        <Eyebrow className="mb-4">{t('features.common.howEyebrow')}</Eyebrow>
                        <h2 className="font-display text-3xl sm:text-4xl font-semibold text-brand-700 leading-[1.08] mb-10 max-w-2xl">
                            {t('features.common.howTitle')}
                        </h2>
                        <ol className="grid md:grid-cols-3 gap-8 md:gap-10">
                            {steps.map((s) => (
                                <li key={s.n}>
                                    <p className="font-display text-4xl font-semibold text-accent-600 mb-4" aria-hidden="true">{s.n}</p>
                                    <h3 className="font-display text-xl font-semibold text-brand-700 mb-2">{s.title}</h3>
                                    <p className="text-[15px] text-brand-500 leading-relaxed">{s.body}</p>
                                </li>
                            ))}
                        </ol>
                    </div>
                </section>

                {/* The rest of the kit — internal links between the feature pages */}
                <section className="px-5 sm:px-8 pb-16 sm:pb-24">
                    <div className="max-w-6xl mx-auto border-t border-charcoal-200 pt-14 sm:pt-20 grid lg:grid-cols-12 gap-10">
                        <div className="lg:col-span-5">
                            <Eyebrow className="mb-4">{t('features.common.kitEyebrow')}</Eyebrow>
                            <h2 className="font-display text-3xl sm:text-4xl font-semibold text-brand-700 leading-[1.08] mb-5">
                                {t('features.common.kitTitle')}
                            </h2>
                            <p className="text-[15px] text-brand-500 leading-relaxed">{t('features.common.kitBody')}</p>
                        </div>
                        <ul className="lg:col-span-7 border-t border-charcoal-200">
                            {FEATURE_SLUGS.map((s) => (
                                <li key={s} className="border-b border-charcoal-200">
                                    {s === slug ? (
                                        <span className="flex items-center justify-between gap-4 py-5">
                                            <span className="font-display text-lg sm:text-xl font-semibold text-brand-700 inline-flex items-center gap-2.5">
                                                <Check size={18} className="text-accent-600" /> {t(LINK_LABEL[s])}
                                            </span>
                                            <span className="text-[11px] font-medium text-accent-700 bg-accent-50 border border-accent-100 rounded-full px-2 py-0.5">
                                                {t('features.common.kitHere')}
                                            </span>
                                        </span>
                                    ) : (
                                        <a {...featureLink(s)} className="group flex items-center justify-between gap-4 py-5">
                                            <span className="font-display text-lg sm:text-xl font-semibold text-brand-700 group-hover:text-accent-700 transition-colors">
                                                {t(LINK_LABEL[s])}
                                            </span>
                                            <ArrowRight size={18} className="text-brand-400 group-hover:text-accent-700 transition-colors shrink-0" />
                                        </a>
                                    )}
                                </li>
                            ))}
                        </ul>
                    </div>
                </section>

                {/* FAQ — always expanded: short, and every answer is visible to readers and crawlers alike */}
                <section className="px-5 sm:px-8 pb-16 sm:pb-24">
                    <div className="max-w-3xl mx-auto">
                        <Eyebrow className="mb-4">{t('features.common.faqEyebrow')}</Eyebrow>
                        <dl className="border-t border-charcoal-200">
                            {faqs.map((item) => (
                                <div key={item.q} className="border-b border-charcoal-200 py-6">
                                    <dt className="font-display text-[19px] sm:text-xl font-semibold text-brand-700 mb-2">{item.q}</dt>
                                    <dd className="text-[15px] text-brand-500 leading-relaxed">{item.a}</dd>
                                </div>
                            ))}
                        </dl>
                    </div>
                </section>

                {/* Final CTA */}
                <section className="px-5 sm:px-8 pb-20 lg:pb-28">
                    <div className="max-w-6xl mx-auto bg-brand-700 text-charcoal-50 rounded-[2rem] px-6 sm:px-12 py-14 lg:py-20 text-center">
                        <div className="max-w-2xl mx-auto">
                            <h2 className="font-display text-3xl sm:text-4xl lg:text-5xl font-semibold leading-[1.06] mb-6">{t('features.common.finalTitle')}</h2>
                            <p className="text-[17px] text-charcoal-300 leading-relaxed mb-9">{t('features.common.finalBody')}</p>
                            <button
                                type="button"
                                onClick={onGetStarted}
                                className="inline-flex items-center justify-center gap-2 bg-accent-400 text-brand-800 font-semibold px-8 py-4 rounded-full hover:bg-accent-300 transition-colors"
                            >
                                {t('features.common.ctaPrimary')} <ArrowRight size={16} />
                            </button>
                            <p className="mt-5 text-sm text-charcoal-300">{t('features.common.ctaNote')}</p>
                        </div>
                    </div>
                </section>
            </main>

            <footer className="border-t border-charcoal-200 bg-charcoal-50 py-12">
                <div className="max-w-6xl mx-auto px-5 sm:px-8 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
                    <div>
                        <Wordmark />
                        <p className="text-[13px] text-brand-500 mt-2 max-w-xs leading-relaxed">{t('landing.footerTagline')}</p>
                    </div>
                    <nav aria-label={t('landing.navToolkit')} className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-brand-500 -my-1.5">
                        {FEATURE_SLUGS.map((s) => (
                            <a key={s} {...featureLink(s)} className="hover:text-brand-700 transition-colors py-1.5 inline-flex items-center">{t(LINK_LABEL[s])}</a>
                        ))}
                        <a href={contactMailto(t('help.emailSubject'))} className="hover:text-brand-700 transition-colors py-1.5 inline-flex items-center">{t('help.eyebrow')}</a>
                        <a {...inApp('/legal/terms', onOpenTerms)} className="hover:text-brand-700 transition-colors py-1.5 inline-flex items-center">{t('login.tosLink')}</a>
                    </nav>
                    <p className="text-[12.5px] text-brand-500 whitespace-nowrap">{t('landing.footerCopyright', { year: new Date().getFullYear() })}</p>
                </div>
            </footer>
        </div>
    );
};
