import React, { useState } from 'react';
import {
    ArrowRight,
    ArrowUpRight,
    CheckCircle2,
    FileText,
    Mail,
    Linkedin,
    MessageSquare,
    Users,
    Target,
    Sparkles,
    Quote,
    Play,
    Menu,
    X,
} from 'lucide-react';
import { useT } from './i18n/LocaleContext';
import { LanguageToggle } from './i18n/LanguageToggle';

interface Props {
    onGetStarted: () => void;
}

/**
 * Image placeholder that falls back to a styled card if the asset isn't on disk yet.
 * Replace the asset by dropping the file into /public with the matching filename.
 */
const Asset = ({
    src,
    alt,
    filename,
    description,
    dimensions,
    className = '',
}: {
    src: string;
    alt: string;
    filename: string;
    description: string;
    dimensions: string;
    className?: string;
}) => {
    const [missing, setMissing] = useState(false);
    if (!missing) {
        return (
            <img
                src={src}
                alt={alt}
                className={className}
                onError={() => setMissing(true)}
            />
        );
    }
    return (
        <div
            className={`${className} bg-charcoal-100 border border-dashed border-charcoal-300 flex items-center justify-center text-center p-6`}
            role="img"
            aria-label={alt}
        >
            <div className="max-w-sm">
                <p className="text-[10px] uppercase tracking-[0.2em] text-charcoal-500 mb-2">Asset placeholder</p>
                <p className="font-display text-lg font-semibold text-brand-700 mb-2">{alt}</p>
                <p className="text-sm text-charcoal-600 mb-3 leading-relaxed">{description}</p>
                <p className="text-xs font-mono text-charcoal-500">/public/{filename}</p>
                <p className="text-[11px] text-charcoal-400 mt-1">{dimensions}</p>
            </div>
        </div>
    );
};

const Wordmark = ({ size = 'md' }: { size?: 'sm' | 'md' }) => {
    const wordSize = size === 'sm' ? 'text-base' : 'text-lg';
    return (
        <div className="flex items-baseline gap-1.5 select-none">
            <span className={`font-display font-semibold tracking-tight text-brand-700 ${wordSize}`}>TOP</span>
            <span className={`font-display font-semibold tracking-tight text-accent-500 ${wordSize}`}>CANDIDATE</span>
        </div>
    );
};

const SectionEyebrow = ({ children }: { children: React.ReactNode }) => (
    <p className="text-[11px] uppercase tracking-[0.22em] text-accent-600 font-semibold mb-4">
        {children}
    </p>
);

const FEATURE_ICONS = [FileText, Mail, ArrowUpRight, Linkedin, MessageSquare, Users] as const;
const TESTIMONIAL_INITIALS = ['PK', 'MT', 'LR'] as const;

export const LandingScreen = ({ onGetStarted }: Props) => {
    const t = useT();
    const [mobileOpen, setMobileOpen] = useState(false);

    const features = [1, 2, 3, 4, 5, 6].map((n, i) => ({
        icon: FEATURE_ICONS[i],
        title: t(`landing.feat${n}Title` as 'landing.feat1Title'),
        description: t(`landing.feat${n}Body` as 'landing.feat1Body'),
    }));

    const steps = [1, 2, 3, 4].map((n) => ({
        n: String(n).padStart(2, '0'),
        title: t(`landing.step${n}Title` as 'landing.step1Title'),
        body: t(`landing.step${n}Body` as 'landing.step1Body'),
    }));

    const testimonials = [1, 2, 3].map((n, i) => ({
        quote: t(`landing.test${n}Quote` as 'landing.test1Quote'),
        author: t(`landing.test${n}Author` as 'landing.test1Author'),
        role: t(`landing.test${n}Role` as 'landing.test1Role'),
        initials: TESTIMONIAL_INITIALS[i],
    }));

    const whyRows = [1, 2, 3].map((n) => ({
        title: t(`landing.why${n}Title` as 'landing.why1Title'),
        body: t(`landing.why${n}Body` as 'landing.why1Body'),
    }));

    const mockBullets = [
        t('landing.mockBullet1'),
        t('landing.mockBullet2'),
        t('landing.mockBullet3'),
        t('landing.mockBullet4'),
    ];

    const scrollTo = (id: string) => {
        document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        setMobileOpen(false);
    };

    return (
        <div className="min-h-screen bg-charcoal-50 text-brand-700">
            {/* Announcement bar */}
            <div className="bg-brand-700 text-charcoal-100 text-xs sm:text-sm">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2.5 flex items-center justify-center gap-2 text-center">
                    <Sparkles size={14} className="text-accent-400 shrink-0" />
                    <span>
                        {t('landing.announcement')}{' '}
                        <button
                            type="button"
                            onClick={() => scrollTo('mock-interviews')}
                            className="underline underline-offset-2 decoration-accent-400 hover:text-accent-300 transition-colors font-medium"
                        >
                            {t('landing.announcementCta')}
                        </button>
                    </span>
                </div>
            </div>

            {/* Navbar */}
            <nav className="border-b border-charcoal-200 bg-charcoal-50/85 backdrop-blur-md sticky top-0 z-50">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
                    <button type="button" onClick={() => scrollTo('top')} className="flex items-center">
                        <Wordmark />
                    </button>

                    <div className="hidden lg:flex items-center gap-6 xl:gap-8 text-sm font-medium text-brand-500">
                        <button type="button" onClick={() => scrollTo('toolkit')} className="hover:text-brand-700 transition-colors">{t('landing.navToolkit')}</button>
                        <button type="button" onClick={() => scrollTo('mock-interviews')} className="hover:text-brand-700 transition-colors whitespace-nowrap">{t('landing.navMockInterviews')}</button>
                        <button type="button" onClick={() => scrollTo('how')} className="hover:text-brand-700 transition-colors whitespace-nowrap">{t('landing.navHow')}</button>
                        <button type="button" onClick={() => scrollTo('proof')} className="hover:text-brand-700 transition-colors">{t('landing.navProof')}</button>
                    </div>

                    <div className="hidden lg:flex items-center gap-2">
                        <LanguageToggle />
                        <button
                            type="button"
                            onClick={onGetStarted}
                            className="text-sm font-semibold text-brand-600 hover:text-brand-700 transition-colors px-3 py-2 whitespace-nowrap"
                        >
                            {t('landing.navSignIn')}
                        </button>
                        <button
                            type="button"
                            onClick={onGetStarted}
                            className="inline-flex items-center gap-1.5 text-sm font-semibold bg-brand-700 text-charcoal-50 px-4 py-2 rounded-full hover:bg-brand-800 transition-colors whitespace-nowrap"
                        >
                            {t('landing.navGetStarted')}
                            <ArrowRight size={14} />
                        </button>
                    </div>

                    <div className="lg:hidden flex items-center gap-2">
                        <LanguageToggle variant="compact" />
                        <button
                            type="button"
                            className="p-2 -mr-2 text-brand-600"
                            onClick={() => setMobileOpen((s) => !s)}
                            aria-label={t('landing.navToggleMenu')}
                        >
                            {mobileOpen ? <X size={22} /> : <Menu size={22} />}
                        </button>
                    </div>
                </div>

                {mobileOpen && (
                    <div className="lg:hidden border-t border-charcoal-200 bg-charcoal-50">
                        <div className="px-4 py-4 flex flex-col gap-1 text-sm font-medium text-brand-600">
                            <button type="button" onClick={() => scrollTo('toolkit')} className="text-left py-2.5">{t('landing.navToolkit')}</button>
                            <button type="button" onClick={() => scrollTo('mock-interviews')} className="text-left py-2.5">{t('landing.navMockInterviews')}</button>
                            <button type="button" onClick={() => scrollTo('how')} className="text-left py-2.5">{t('landing.navHow')}</button>
                            <button type="button" onClick={() => scrollTo('proof')} className="text-left py-2.5">{t('landing.navProof')}</button>
                            <div className="h-px bg-charcoal-200 my-2" />
                            <button type="button" onClick={onGetStarted} className="text-left py-2.5">{t('landing.navSignIn')}</button>
                            <button
                                type="button"
                                onClick={onGetStarted}
                                className="mt-2 inline-flex items-center justify-center gap-1.5 bg-brand-700 text-charcoal-50 px-4 py-3 rounded-full font-semibold"
                            >
                                {t('landing.navGetStarted')} <ArrowRight size={14} />
                            </button>
                        </div>
                    </div>
                )}
            </nav>

            {/* Hero */}
            <section id="top" className="bg-paper">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-16 sm:pt-20 lg:pt-28 pb-20 lg:pb-28">
                    <div className="grid lg:grid-cols-12 gap-10 lg:gap-16 items-center">
                        <div className="lg:col-span-7">
                            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-accent-50 text-accent-700 text-xs font-semibold border border-accent-100 mb-6">
                                <Sparkles size={12} />
                                {t('landing.heroBadge')}
                            </div>

                            <h1 className="font-display text-4xl sm:text-5xl md:text-6xl lg:text-6xl xl:text-7xl font-semibold leading-[1.04] text-brand-700 mb-6 break-words">
                                {t('landing.heroTitlePrefix')}{' '}
                                <span className="italic text-accent-500">{t('landing.heroTitleAccent')}</span>{' '}
                                {t('landing.heroTitleSuffix')}
                            </h1>

                            <p className="text-base sm:text-lg lg:text-xl text-brand-500 leading-relaxed max-w-2xl mb-8">
                                {t('landing.heroSubtitle')}
                            </p>

                            <div className="flex flex-col sm:flex-row gap-3 mb-8">
                                <button
                                    type="button"
                                    onClick={onGetStarted}
                                    className="inline-flex w-full sm:w-auto items-center justify-center gap-2 px-6 py-3.5 sm:py-4 text-base font-semibold text-charcoal-50 bg-brand-700 rounded-full hover:bg-brand-800 transition-colors"
                                >
                                    {t('landing.heroCtaPrimary')}
                                    <ArrowRight size={18} />
                                </button>
                                <button
                                    type="button"
                                    onClick={() => scrollTo('how')}
                                    className="inline-flex w-full sm:w-auto items-center justify-center gap-2 px-6 py-3.5 sm:py-4 text-base font-semibold text-brand-700 bg-charcoal-50 border border-charcoal-300 rounded-full hover:border-brand-700 transition-colors"
                                >
                                    <Play size={16} className="fill-current" />
                                    {t('landing.heroCtaSecondary')}
                                </button>
                            </div>

                            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-brand-500">
                                <div className="flex items-center gap-1.5"><CheckCircle2 size={16} className="text-accent-500" /> {t('landing.trustFreeToTry')}</div>
                                <div className="flex items-center gap-1.5"><CheckCircle2 size={16} className="text-accent-500" /> {t('landing.trustNoCard')}</div>
                                <div className="flex items-center gap-1.5"><CheckCircle2 size={16} className="text-accent-500" /> {t('landing.trustExport')}</div>
                            </div>
                        </div>

                        <div className="lg:col-span-5">
                            <div className="relative">
                                <div className="absolute -inset-4 bg-brand-700 rounded-[2rem] -rotate-2 hidden sm:block" aria-hidden />
                                <div className="relative bg-charcoal-50 rounded-3xl border border-charcoal-300 shadow-2xl shadow-brand-900/10 overflow-hidden">
                                    <Asset
                                        src="/hero_dashboard_mockup.png"
                                        alt={t('landing.heroImageAlt')}
                                        filename="hero_dashboard_mockup.png"
                                        description={t('landing.heroImageDesc')}
                                        dimensions="1600 × 1100, PNG with transparent or cream background"
                                        className="w-full h-auto aspect-[16/11] object-cover"
                                    />
                                </div>

                                <div className="hidden sm:flex absolute -bottom-6 -left-6 bg-charcoal-50 border border-charcoal-300 rounded-2xl px-4 py-3 shadow-xl shadow-brand-900/10 items-center gap-3 max-w-[260px]">
                                    <div className="w-9 h-9 rounded-full bg-accent-50 border border-accent-200 flex items-center justify-center text-accent-600 shrink-0">
                                        <Target size={16} />
                                    </div>
                                    <div className="text-xs">
                                        <p className="font-semibold text-brand-700">{t('landing.heroBadgeFloatTitle')}</p>
                                        <p className="text-brand-500">{t('landing.heroBadgeFloatBody')}</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* The toolkit */}
            <section id="toolkit" className="py-16 sm:py-20 lg:py-28">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="max-w-3xl mb-14">
                        <SectionEyebrow>{t('landing.toolkitEyebrow')}</SectionEyebrow>
                        <h2 className="font-display text-4xl sm:text-5xl font-semibold text-brand-700 leading-[1.05] mb-5">
                            {t('landing.toolkitTitle')}
                        </h2>
                        <p className="text-lg text-brand-500 leading-relaxed">
                            {t('landing.toolkitBody')}
                        </p>
                    </div>

                    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-px bg-charcoal-200 border border-charcoal-200 rounded-3xl overflow-hidden">
                        {features.map(({ icon: Icon, title, description }) => (
                            <div key={title} className="bg-charcoal-50 p-7 lg:p-8 hover:bg-charcoal-100 transition-colors">
                                <div className="w-11 h-11 rounded-xl bg-brand-700 text-charcoal-50 flex items-center justify-center mb-5">
                                    <Icon size={20} />
                                </div>
                                <h3 className="font-display text-xl font-semibold text-brand-700 mb-2.5">{title}</h3>
                                <p className="text-sm text-brand-500 leading-relaxed">{description}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* Mock interviews — coming soon */}
            <section id="mock-interviews" className="bg-brand-700 text-charcoal-100 py-16 sm:py-20 lg:py-28">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="grid lg:grid-cols-12 gap-10 lg:gap-16 items-center">
                        <div className="lg:col-span-7">
                            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-accent-400/10 text-accent-300 text-xs font-semibold border border-accent-400/30 mb-5">
                                <Sparkles size={12} />
                                {t('landing.mockSoonBadge')}
                            </div>
                            <p className="text-[11px] uppercase tracking-[0.22em] text-accent-400 font-semibold mb-4">
                                {t('landing.mockEyebrow')}
                            </p>
                            <h2 className="font-display text-3xl sm:text-4xl lg:text-5xl font-semibold leading-[1.05] text-charcoal-50 mb-5">
                                {t('landing.mockTitle')}
                            </h2>
                            <p className="text-base sm:text-lg text-charcoal-300 leading-relaxed mb-8">
                                {t('landing.mockBody')}
                            </p>

                            <ul className="space-y-3.5">
                                {mockBullets.map((item) => (
                                    <li key={item} className="flex items-start gap-3 text-charcoal-200">
                                        <CheckCircle2 size={18} className="text-accent-400 shrink-0 mt-0.5" />
                                        <span className="text-sm sm:text-base">{item}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>

                        <div className="lg:col-span-5">
                            <div className="relative rounded-3xl border border-brand-600 bg-brand-800 p-7 sm:p-9 overflow-hidden">
                                <div className="absolute inset-0 bg-paper opacity-[0.04]" aria-hidden />
                                <div className="relative">
                                    <div className="w-14 h-14 rounded-2xl bg-accent-400/10 border border-accent-400/30 flex items-center justify-center mb-6">
                                        <Users size={24} className="text-accent-400" />
                                    </div>
                                    <p className="text-[11px] uppercase tracking-[0.22em] text-accent-400 font-semibold mb-3">
                                        {t('landing.mockSoonCardEyebrow')}
                                    </p>
                                    <h3 className="font-display text-2xl sm:text-3xl font-semibold text-charcoal-50 mb-4 leading-[1.1]">
                                        {t('landing.mockSoonCardTitle')}
                                    </h3>
                                    <p className="text-sm sm:text-base text-charcoal-300 leading-relaxed">
                                        {t('landing.mockSoonCardBody')}
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* How it works */}
            <section id="how" className="py-16 sm:py-20 lg:py-28">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="max-w-3xl mb-14">
                        <SectionEyebrow>{t('landing.howEyebrow')}</SectionEyebrow>
                        <h2 className="font-display text-4xl sm:text-5xl font-semibold text-brand-700 leading-[1.05]">
                            {t('landing.howTitle')}
                        </h2>
                    </div>

                    <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-px bg-charcoal-200 border border-charcoal-200 rounded-3xl overflow-hidden">
                        {steps.map((step) => (
                            <div key={step.n} className="bg-charcoal-50 p-7 lg:p-8">
                                <p className="font-display text-5xl font-semibold text-accent-500 mb-5">{step.n}</p>
                                <h3 className="font-display text-xl font-semibold text-brand-700 mb-3">{step.title}</h3>
                                <p className="text-sm text-brand-500 leading-relaxed">{step.body}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* Why TOP CANDIDATE */}
            <section className="bg-charcoal-100 py-16 sm:py-20 lg:py-28">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid lg:grid-cols-12 gap-12 lg:gap-16">
                    <div className="lg:col-span-5">
                        <SectionEyebrow>{t('landing.whyEyebrow')}</SectionEyebrow>
                        <h2 className="font-display text-4xl sm:text-5xl font-semibold text-brand-700 leading-[1.05] mb-5">
                            {t('landing.whyTitle')}
                        </h2>
                        <p className="text-lg text-brand-500 leading-relaxed">
                            {t('landing.whyBody')}
                        </p>
                    </div>
                    <div className="lg:col-span-7 space-y-px bg-charcoal-200 border border-charcoal-200 rounded-3xl overflow-hidden">
                        {whyRows.map((row) => (
                            <div key={row.title} className="bg-charcoal-50 p-7 lg:p-8 flex gap-5 items-start">
                                <div className="w-9 h-9 rounded-full bg-accent-50 border border-accent-200 flex items-center justify-center text-accent-600 shrink-0">
                                    <CheckCircle2 size={18} />
                                </div>
                                <div>
                                    <h3 className="font-display text-lg font-semibold text-brand-700 mb-1.5">{row.title}</h3>
                                    <p className="text-sm text-brand-500 leading-relaxed">{row.body}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* Testimonials */}
            <section id="proof" className="py-16 sm:py-20 lg:py-28">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="max-w-3xl mb-14">
                        <SectionEyebrow>{t('landing.proofEyebrow')}</SectionEyebrow>
                        <h2 className="font-display text-4xl sm:text-5xl font-semibold text-brand-700 leading-[1.05]">
                            {t('landing.proofTitle')}
                        </h2>
                    </div>

                    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-6">
                        {testimonials.map((tm) => (
                            <figure key={tm.author} className="bg-charcoal-50 border border-charcoal-200 rounded-2xl p-6 sm:p-7 flex flex-col sm:last:col-span-2 lg:last:col-span-1">
                                <Quote size={22} className="text-accent-500 mb-5" />
                                <blockquote className="font-display text-base sm:text-lg leading-snug text-brand-700 mb-7 flex-1">
                                    "{tm.quote}"
                                </blockquote>
                                <figcaption className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-full bg-brand-700 text-charcoal-50 font-semibold flex items-center justify-center text-sm">
                                        {tm.initials}
                                    </div>
                                    <div>
                                        <p className="font-semibold text-sm text-brand-700">{tm.author}</p>
                                        <p className="text-xs text-brand-500">{tm.role}</p>
                                    </div>
                                </figcaption>
                            </figure>
                        ))}
                    </div>
                </div>
            </section>

            {/* Final CTA */}
            <section className="px-4 sm:px-6 lg:px-8 pb-20 lg:pb-28">
                <div className="max-w-7xl mx-auto bg-brand-700 text-charcoal-50 rounded-3xl sm:rounded-[2rem] px-6 sm:px-10 lg:px-14 py-14 sm:py-16 lg:py-20 text-center relative overflow-hidden">
                    <div className="absolute inset-0 bg-paper opacity-[0.04]" aria-hidden />
                    <div className="relative max-w-3xl mx-auto">
                        <SectionEyebrow>
                            <span className="text-accent-400">{t('landing.finalEyebrow')}</span>
                        </SectionEyebrow>
                        <h2 className="font-display text-3xl sm:text-4xl lg:text-5xl xl:text-6xl font-semibold leading-[1.05] mb-6 break-words">
                            {t('landing.finalTitle')}
                        </h2>
                        <p className="text-base sm:text-lg text-charcoal-300 leading-relaxed mb-10 max-w-2xl mx-auto">
                            {t('landing.finalBody')}
                        </p>
                        <button
                            type="button"
                            onClick={onGetStarted}
                            className="inline-flex items-center justify-center gap-2 bg-accent-400 text-brand-800 font-semibold px-7 sm:px-8 py-3.5 sm:py-4 rounded-full hover:bg-accent-300 transition-colors text-sm sm:text-base"
                        >
                            {t('landing.finalCta')}
                            <ArrowRight size={18} />
                        </button>
                    </div>
                </div>
            </section>

            {/* Footer */}
            <footer className="border-t border-charcoal-200 bg-charcoal-50 py-10 sm:py-12">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
                    <div>
                        <Wordmark />
                        <p className="text-xs text-brand-500 mt-2">{t('landing.footerTagline')}</p>
                    </div>
                    <div className="flex flex-wrap gap-x-5 sm:gap-x-6 gap-y-2 text-sm text-brand-500">
                        <a href="#toolkit" className="hover:text-brand-700 transition-colors">{t('landing.navToolkit')}</a>
                        <a href="#mock-interviews" className="hover:text-brand-700 transition-colors">{t('landing.navMockInterviews')}</a>
                        <a href="#how" className="hover:text-brand-700 transition-colors">{t('landing.navHow')}</a>
                        <a href="#proof" className="hover:text-brand-700 transition-colors">{t('landing.navProof')}</a>
                    </div>
                    <p className="text-xs text-brand-400">{t('landing.footerCopyright', { year: new Date().getFullYear() })}</p>
                </div>
            </footer>
        </div>
    );
};
