import React, { useState } from 'react';
import { ArrowRight, Check, Plus, Minus, Menu, X, Sparkles, Quote } from 'lucide-react';
import { useT } from './i18n/LocaleContext';
import { LanguageToggle } from './i18n/LanguageToggle';
import { contactMailto } from './support';

interface Props {
    onGetStarted: () => void;
    onOpenTerms?: () => void;
}

const Wordmark = ({ size = 'md' }: { size?: 'sm' | 'md' }) => {
    const wordSize = size === 'sm' ? 'text-base' : 'text-lg';
    return (
        <div className="flex items-baseline gap-1.5 select-none">
            <span className={`font-display font-semibold tracking-tight text-brand-700 ${wordSize}`}>TOP</span>
            <span className={`font-display font-semibold tracking-tight text-accent-500 ${wordSize}`}>CANDIDATE</span>
        </div>
    );
};

const Eyebrow = ({ children, className = '' }: { children: React.ReactNode; className?: string }) => (
    <p className={`text-[11px] uppercase tracking-[0.22em] text-accent-600 font-semibold ${className}`}>
        {children}
    </p>
);

/** bKash wordmark — pink "b", no logo recreation. */
const BkashMark = () => (
    <span className="font-semibold">
        <span style={{ color: '#E2136E' }}>b</span>Kash
    </span>
);

export const LandingScreen = ({ onGetStarted, onOpenTerms }: Props) => {
    const t = useT();
    const [mobileOpen, setMobileOpen] = useState(false);
    const [faqOpen, setFaqOpen] = useState(0);

    const scrollTo = (id: string) => {
        document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        setMobileOpen(false);
    };

    const navLinks = [
        { id: 'toolkit', label: t('landing.navToolkit') },
        { id: 'pricing', label: t('landing.navPricing') },
        { id: 'how', label: t('landing.navHow') },
        { id: 'reviews', label: t('landing.navReviews') },
    ];

    const toolkit = [
        { n: '01', title: t('landing.tool1Title'), body: t('landing.tool1Body') },
        { n: '02', title: t('landing.tool2Title'), body: t('landing.tool2Body') },
        { n: '03', title: t('landing.tool3Title'), body: t('landing.tool3Body') },
        { n: '04', title: t('landing.tool4Title'), body: t('landing.tool4Body') },
        { n: '05', title: t('landing.tool5Title'), body: t('landing.tool5Body'), bn: true },
    ];

    const compareRows = [
        { label: t('landing.compare1Label'), price: t('landing.compare1Price'), note: t('landing.compare1Note'), muted: true },
        { label: t('landing.compare2Label'), price: t('landing.compare2Price'), note: t('landing.compare2Note'), muted: true },
        { label: t('landing.compare3Label'), price: t('landing.compare3Price'), note: t('landing.compare3Note'), muted: false },
    ];

    const packIncludes = [
        t('landing.packInclude1'),
        t('landing.packInclude2'),
        t('landing.packInclude3'),
        t('landing.packInclude4'),
        t('landing.packInclude5'),
    ];

    const steps = [
        { n: '01', title: t('landing.step1Title'), body: t('landing.step1Body') },
        { n: '02', title: t('landing.step2Title'), body: t('landing.step2Body') },
        { n: '03', title: t('landing.step3Title'), body: t('landing.step3Body') },
    ];

    const reviews = [
        { quote: t('landing.review1Quote'), name: t('landing.review1Name'), role: t('landing.review1Role'), initials: 'TH' },
        { quote: t('landing.review2Quote'), name: t('landing.review2Name'), role: t('landing.review2Role'), initials: 'NJ' },
        { quote: t('landing.review3Quote'), name: t('landing.review3Name'), role: t('landing.review3Role'), initials: 'RK' },
    ];

    const faqs = [
        { q: t('landing.faq1Q'), a: t('landing.faq1A') },
        { q: t('landing.faq2Q'), a: t('landing.faq2A') },
        { q: t('landing.faq3Q'), a: t('landing.faq3A') },
        { q: t('landing.faq4Q'), a: t('landing.faq4A') },
        { q: t('landing.faq5Q'), a: t('landing.faq5A') },
    ];

    return (
        <div className="min-h-screen bg-charcoal-50 text-brand-700 overflow-x-clip">
            {/* Navbar */}
            <nav className="border-b border-charcoal-200 bg-charcoal-50/85 backdrop-blur-md sticky top-0 z-50">
                <div className="max-w-6xl mx-auto px-5 sm:px-8 h-16 flex items-center justify-between">
                    <button type="button" onClick={() => scrollTo('top')} className="flex items-center">
                        <Wordmark />
                    </button>

                    <div className="hidden lg:flex items-center gap-8 text-sm font-medium text-brand-500">
                        {navLinks.map((l) => (
                            <button key={l.id} type="button" onClick={() => scrollTo(l.id)} className="hover:text-brand-700 transition-colors whitespace-nowrap">
                                {l.label}
                            </button>
                        ))}
                    </div>

                    <div className="hidden lg:flex items-center gap-3">
                        <LanguageToggle />
                        <button
                            type="button"
                            onClick={onGetStarted}
                            className="text-sm font-semibold text-brand-600 hover:text-brand-700 transition-colors px-2 whitespace-nowrap"
                        >
                            {t('landing.navSignIn')}
                        </button>
                        <button
                            type="button"
                            onClick={onGetStarted}
                            className="inline-flex items-center gap-1.5 text-sm font-semibold bg-brand-700 text-charcoal-50 pl-4 pr-3.5 py-2 rounded-full hover:bg-brand-800 transition-colors whitespace-nowrap"
                        >
                            {t('landing.navGetStarted')}
                            <ArrowRight size={14} />
                        </button>
                    </div>

                    <div className="lg:hidden flex items-center gap-2">
                        <LanguageToggle variant="compact" />
                        <button
                            type="button"
                            className="p-2 -mr-2 text-brand-700"
                            onClick={() => setMobileOpen((s) => !s)}
                            aria-label={t('landing.navToggleMenu')}
                        >
                            {mobileOpen ? <X size={22} /> : <Menu size={22} />}
                        </button>
                    </div>
                </div>

                {mobileOpen && (
                    <div className="lg:hidden border-t border-charcoal-200 bg-charcoal-50">
                        <div className="px-5 py-4 flex flex-col gap-1 text-[15px] font-medium text-brand-600">
                            {navLinks.map((l) => (
                                <button key={l.id} type="button" onClick={() => scrollTo(l.id)} className="text-left py-2.5">
                                    {l.label}
                                </button>
                            ))}
                            <div className="h-px bg-charcoal-200 my-2" />
                            <button type="button" onClick={onGetStarted} className="text-left py-2.5">{t('landing.navSignIn')}</button>
                            <button
                                type="button"
                                onClick={onGetStarted}
                                className="mt-1 inline-flex items-center justify-center gap-1.5 bg-brand-700 text-charcoal-50 px-4 py-3 rounded-full font-semibold"
                            >
                                {t('landing.navGetStarted')} <ArrowRight size={14} />
                            </button>
                        </div>
                    </div>
                )}
            </nav>

            {/* Hero — centered */}
            <section id="top" className="bg-paper">
                <div className="max-w-6xl mx-auto px-5 sm:px-8 pt-14 sm:pt-20 lg:pt-24 pb-20 lg:pb-24">
                    <div className="max-w-3xl mx-auto text-center">
                        <Eyebrow className="mb-5">{t('landing.heroEyebrow')}</Eyebrow>
                        <h1 className="font-display text-[clamp(2.1rem,8.5vw,4.5rem)] font-semibold leading-[1.04] text-brand-700 mb-6">
                            {t('landing.heroTitleLine1')}
                            <br />
                            <span className="italic text-accent-500">{t('landing.heroTitleAccent')}</span> {t('landing.heroTitleLine2')}
                        </h1>
                        <p className="text-[17px] sm:text-xl text-brand-500 leading-relaxed max-w-2xl mx-auto mb-8">
                            {t('landing.heroSubtitle')}
                        </p>

                        <div className="flex flex-col sm:flex-row gap-3 justify-center mb-7">
                            <button
                                type="button"
                                onClick={onGetStarted}
                                className="group inline-flex items-center justify-center gap-2.5 px-6 py-4 text-[15px] font-semibold text-charcoal-50 bg-brand-700 rounded-full hover:bg-brand-800 transition-colors"
                            >
                                {t('landing.heroCtaPrimary')}
                                <ArrowRight size={17} className="group-hover:translate-x-0.5 transition-transform" />
                            </button>
                            <button
                                type="button"
                                onClick={() => scrollTo('toolkit')}
                                className="inline-flex items-center justify-center gap-2 px-6 py-4 text-[15px] font-semibold text-brand-700 bg-charcoal-50 border border-charcoal-300 rounded-full hover:border-brand-700 transition-colors"
                            >
                                {t('landing.heroCtaSecondary')}
                            </button>
                        </div>

                        <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[13.5px] text-brand-500">
                            {[t('landing.trustFree'), t('landing.trustPrice'), t('landing.trustBkash')].map((item) => (
                                <span key={item} className="inline-flex items-center gap-1.5">
                                    <Check size={15} className="text-accent-500" />
                                    {item}
                                </span>
                            ))}
                        </div>

                        {/* Resume mock — a tangible, scaled-down ATS document */}
                        <div className="mt-14 max-w-md mx-auto">
                            <div className="relative">
                                {/* fanned toolkit docs behind */}
                                <div aria-hidden className="absolute -right-5 top-8 w-[78%] h-[88%] rounded-xl bg-charcoal-50 border border-charcoal-200 shadow-lg shadow-brand-900/5 rotate-[5deg]" />
                                <div aria-hidden className="absolute -right-2.5 top-4 w-[82%] h-[92%] rounded-xl bg-charcoal-50 border border-charcoal-200 shadow-lg shadow-brand-900/5 rotate-[2.5deg]" />

                                {/* the resume */}
                                <div className="relative bg-charcoal-50 rounded-xl border border-charcoal-200 shadow-2xl shadow-brand-900/15 overflow-hidden text-left">
                                    <div className="px-7 pt-7 pb-6 sm:px-8">
                                        <div className="flex items-baseline justify-between border-b border-charcoal-200 pb-4 mb-4 gap-3">
                                            <div className="min-w-0">
                                                <p className="font-display text-[22px] font-semibold text-brand-700 leading-none">{t('landing.mockName')}</p>
                                                <p className="text-[11px] text-brand-400 mt-1.5 tracking-wide">{t('landing.mockRole')}</p>
                                            </div>
                                            <span className="text-[9px] font-mono uppercase tracking-[0.18em] text-accent-600 border border-accent-200 bg-accent-50 rounded-full px-2 py-1 whitespace-nowrap shrink-0">
                                                {t('landing.mockBadge')}
                                            </span>
                                        </div>

                                        <p className="text-[8.5px] uppercase tracking-[0.2em] text-brand-400 font-semibold mb-1.5">{t('landing.mockSummaryLabel')}</p>
                                        <p className="text-[11px] leading-relaxed text-brand-500 mb-4">{t('landing.mockSummary')}</p>

                                        <p className="text-[8.5px] uppercase tracking-[0.2em] text-brand-400 font-semibold mb-2">{t('landing.mockExperienceLabel')}</p>
                                        <div className="mb-2 flex items-baseline justify-between gap-3">
                                            <p className="text-[10.5px] font-semibold text-brand-700 truncate min-w-0">{t('landing.mockJobTitle')}</p>
                                            <p className="text-[9px] text-brand-400 font-mono shrink-0">{t('landing.mockJobDates')}</p>
                                        </div>
                                        <ul className="space-y-1.5 mb-4">
                                            {[t('landing.mockExpBullet1'), t('landing.mockExpBullet2')].map((b) => (
                                                <li key={b} className="flex gap-2 text-[10px] leading-snug text-brand-500">
                                                    <span className="mt-[5px] h-1 w-1 rounded-full bg-accent-500 shrink-0" />
                                                    {b}
                                                </li>
                                            ))}
                                        </ul>

                                        <p className="text-[8.5px] uppercase tracking-[0.2em] text-brand-400 font-semibold mb-2">{t('landing.mockSkillsLabel')}</p>
                                        <div className="flex flex-wrap gap-1.5">
                                            {['Analytics', 'Meta Ads', 'Content', 'SQL'].map((s) => (
                                                <span key={s} className="text-[9.5px] text-brand-600 bg-charcoal-100 border border-charcoal-200 rounded px-1.5 py-0.5 whitespace-nowrap">{s}</span>
                                            ))}
                                        </div>
                                    </div>
                                </div>

                                {/* floating proof chip */}
                                <div className="hidden sm:flex absolute -bottom-7 left-3 bg-brand-700 text-charcoal-50 rounded-2xl px-4 py-3 shadow-xl shadow-brand-900/20 items-center gap-3 max-w-[230px] text-left">
                                    <span className="h-9 w-9 rounded-full bg-accent-400/15 border border-accent-400/30 text-accent-300 flex items-center justify-center shrink-0">
                                        <Sparkles size={16} />
                                    </span>
                                    <div className="text-[11px] leading-tight">
                                        <p className="font-semibold">{t('landing.mockChipTitle')}</p>
                                        <p className="text-charcoal-300">{t('landing.mockChipBody')}</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* The toolkit — one paste, five deliverables */}
            <section id="toolkit" className="py-20 lg:py-28">
                <div className="max-w-6xl mx-auto px-5 sm:px-8">
                    <div className="max-w-3xl mb-14">
                        <Eyebrow className="mb-4">{t('landing.toolkitEyebrow')}</Eyebrow>
                        <h2 className="font-display text-4xl sm:text-5xl font-semibold text-brand-700 leading-[1.05] mb-5">
                            {t('landing.toolkitTitlePrefix')} <span className="italic text-accent-500">{t('landing.toolkitTitleAccent')}</span> {t('landing.toolkitTitleSuffix')}
                        </h2>
                        <p className="text-lg text-brand-500 leading-relaxed">{t('landing.toolkitBody')}</p>
                    </div>

                    <div className="border-t border-charcoal-200">
                        {toolkit.map((item) => (
                            <div
                                key={item.n}
                                className="group grid md:grid-cols-12 gap-4 md:gap-8 items-baseline py-7 border-b border-charcoal-200 hover:bg-charcoal-100/60 transition-colors -mx-4 px-4 rounded-lg"
                            >
                                <div className="md:col-span-2">
                                    <span className="font-display text-3xl font-semibold text-accent-500">{item.n}</span>
                                </div>
                                <div className="md:col-span-4">
                                    <h3 className="font-display text-2xl font-semibold text-brand-700 flex items-center gap-2.5">
                                        {item.title}
                                        {item.bn && (
                                            <span className="text-[11px] font-medium text-accent-600 bg-accent-50 border border-accent-100 rounded-full px-2 py-0.5">
                                                {t('landing.toolBnBadge')}
                                            </span>
                                        )}
                                    </h3>
                                </div>
                                <div className="md:col-span-6">
                                    <p className="text-[15px] text-brand-500 leading-relaxed">{item.body}</p>
                                </div>
                            </div>
                        ))}
                    </div>

                    <div className="mt-7 flex items-center gap-2 text-sm text-brand-500">
                        <Check size={16} className="text-accent-500 shrink-0" />
                        {t('landing.toolkitFootnote')}
                    </div>
                </div>
            </section>

            {/* Value for money — the central argument */}
            <section id="pricing" className="bg-charcoal-100 py-20 lg:py-28 border-y border-charcoal-200">
                <div className="max-w-6xl mx-auto px-5 sm:px-8">
                    <div className="max-w-3xl mb-14">
                        <Eyebrow className="mb-4">{t('landing.pricingEyebrow')}</Eyebrow>
                        <h2 className="font-display text-4xl sm:text-5xl font-semibold text-brand-700 leading-[1.05] mb-5">
                            {t('landing.pricingTitlePrefix')} <span className="italic text-accent-500">{t('landing.pricingTitleAccent')}</span>{t('landing.pricingTitleSuffix')}
                        </h2>
                        <p className="text-lg text-brand-500 leading-relaxed">{t('landing.pricingBody')}</p>
                    </div>

                    <div className="grid lg:grid-cols-12 gap-8 lg:gap-12 items-start">
                        {/* comparison */}
                        <div className="lg:col-span-7">
                            <div className="rounded-2xl border border-charcoal-200 bg-charcoal-50 overflow-hidden divide-y divide-charcoal-200">
                                {compareRows.map((row) => (
                                    <div key={row.label} className={`flex items-center justify-between gap-5 px-6 py-5 ${row.muted ? '' : 'bg-brand-700 text-charcoal-50'}`}>
                                        <div className="flex-1 min-w-0">
                                            <p className={`font-display text-[17px] font-semibold leading-snug ${row.muted ? 'text-brand-700' : 'text-charcoal-50'}`}>{row.label}</p>
                                            <p className={`text-[13.5px] mt-1 ${row.muted ? 'text-brand-400' : 'text-charcoal-300'}`}>{row.note}</p>
                                        </div>
                                        <p className={`font-display text-2xl sm:text-[28px] font-semibold whitespace-nowrap shrink-0 ${row.muted ? 'text-brand-300 line-through decoration-1' : 'text-accent-300'}`}>{row.price}</p>
                                    </div>
                                ))}
                            </div>
                            <p className="text-[13px] text-brand-400 mt-4 leading-relaxed">{t('landing.compareFootnote')}</p>
                        </div>

                        {/* pricing card */}
                        <div className="lg:col-span-5">
                            <div className="rounded-3xl border-2 border-accent-300 bg-charcoal-50 p-7 sm:p-8 shadow-xl shadow-accent-900/5">
                                <div className="flex items-center justify-between mb-5">
                                    <Eyebrow>{t('landing.packEyebrow')}</Eyebrow>
                                    <span className="text-[11px] font-semibold text-accent-700 bg-accent-50 border border-accent-100 rounded-full px-2.5 py-1 whitespace-nowrap">
                                        {t('landing.packVia')} <BkashMark />
                                    </span>
                                </div>
                                <div className="flex items-baseline gap-2 mb-1">
                                    <span className="font-display text-6xl font-semibold text-brand-700">{t('landing.packPrice')}</span>
                                    <span className="text-[15px] text-brand-400">{t('landing.packUnit')}</span>
                                </div>
                                <p className="text-sm text-brand-500 mb-6">{t('landing.packDesc')}</p>

                                <ul className="space-y-2.5 mb-7">
                                    {packIncludes.map((p) => (
                                        <li key={p} className="flex items-start gap-2.5 text-sm text-brand-600">
                                            <Check size={17} className="text-accent-500 mt-0.5 shrink-0" />
                                            <span>{p}</span>
                                        </li>
                                    ))}
                                </ul>

                                <button
                                    type="button"
                                    onClick={onGetStarted}
                                    className="w-full inline-flex items-center justify-center gap-2 bg-brand-700 text-charcoal-50 font-semibold py-4 rounded-full hover:bg-brand-800 transition-colors"
                                >
                                    {t('landing.packCta')} <ArrowRight size={17} />
                                </button>

                                <div className="mt-5 pt-5 border-t border-charcoal-200 flex items-start gap-2.5 text-[13.5px]">
                                    <Check size={17} className="text-accent-500 mt-0.5 shrink-0" />
                                    <span className="text-brand-500">
                                        <span className="font-semibold text-brand-700">{t('landing.packFreeLabel')}</span> {t('landing.packFreeNote')}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* How it works */}
            <section id="how" className="py-20 lg:py-28">
                <div className="max-w-6xl mx-auto px-5 sm:px-8">
                    <div className="max-w-3xl mb-14">
                        <Eyebrow className="mb-4">{t('landing.howEyebrow')}</Eyebrow>
                        <h2 className="font-display text-4xl sm:text-5xl font-semibold text-brand-700 leading-[1.05]">
                            {t('landing.howTitle')}
                        </h2>
                    </div>
                    <div className="grid md:grid-cols-3 gap-px bg-charcoal-200 border border-charcoal-200 rounded-3xl overflow-hidden">
                        {steps.map((s) => (
                            <div key={s.n} className="bg-charcoal-50 p-8 lg:p-9 h-full">
                                <p className="font-display text-5xl font-semibold text-accent-500 mb-6">{s.n}</p>
                                <h3 className="font-display text-xl font-semibold text-brand-700 mb-3">{s.title}</h3>
                                <p className="text-[15px] text-brand-500 leading-relaxed">{s.body}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* Reviews */}
            <section id="reviews" className="bg-charcoal-100 py-20 lg:py-28 border-y border-charcoal-200">
                <div className="max-w-6xl mx-auto px-5 sm:px-8">
                    <div className="max-w-3xl mb-14">
                        <Eyebrow className="mb-4">{t('landing.reviewsEyebrow')}</Eyebrow>
                        <h2 className="font-display text-4xl sm:text-5xl font-semibold text-brand-700 leading-[1.05]">
                            {t('landing.reviewsTitle')}
                        </h2>
                    </div>
                    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-6">
                        {reviews.map((r) => (
                            <figure key={r.name} className="h-full bg-charcoal-50 border border-charcoal-200 rounded-2xl p-6 sm:p-7 flex flex-col">
                                <Quote size={26} className="text-accent-500 mb-5" />
                                <blockquote className="font-display text-[18px] leading-snug text-brand-700 mb-7 flex-1">
                                    “{r.quote}”
                                </blockquote>
                                <figcaption className="flex items-center gap-3">
                                    <span className="h-11 w-11 rounded-full bg-brand-700 text-charcoal-50 font-semibold flex items-center justify-center text-sm shrink-0">{r.initials}</span>
                                    <span>
                                        <span className="block font-semibold text-sm text-brand-700">{r.name}</span>
                                        <span className="block text-[12.5px] text-brand-500">{r.role}</span>
                                    </span>
                                </figcaption>
                            </figure>
                        ))}
                    </div>
                </div>
            </section>

            {/* FAQ */}
            <section className="py-20 lg:py-28">
                <div className="max-w-3xl mx-auto px-5 sm:px-8">
                    <div className="mb-10 text-center">
                        <Eyebrow className="mb-4">{t('landing.faqEyebrow')}</Eyebrow>
                        <h2 className="font-display text-4xl sm:text-5xl font-semibold text-brand-700 leading-[1.05]">{t('landing.faqTitle')}</h2>
                    </div>
                    <div className="border-t border-charcoal-200">
                        {faqs.map((item, i) => {
                            const open = faqOpen === i;
                            return (
                                <div key={item.q} className="border-b border-charcoal-200">
                                    <button
                                        type="button"
                                        onClick={() => setFaqOpen(open ? -1 : i)}
                                        aria-expanded={open}
                                        className="w-full flex items-center justify-between gap-4 py-5 text-left"
                                    >
                                        <span className="font-display text-[19px] sm:text-xl font-semibold text-brand-700">{item.q}</span>
                                        <span className="h-8 w-8 rounded-full border border-charcoal-300 flex items-center justify-center text-brand-600 shrink-0">
                                            {open ? <Minus size={16} /> : <Plus size={16} />}
                                        </span>
                                    </button>
                                    <div style={{ maxHeight: open ? 240 : 0 }} className="overflow-hidden transition-all duration-300 ease-out">
                                        <p className="text-[15px] text-brand-500 leading-relaxed pb-5 pr-12">{item.a}</p>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </section>

            {/* Final CTA */}
            <section className="px-5 sm:px-8 pb-20 lg:pb-28">
                <div className="max-w-6xl mx-auto bg-brand-700 text-charcoal-50 rounded-[2rem] px-6 sm:px-12 py-16 lg:py-20 text-center relative overflow-hidden">
                    <div className="absolute inset-0 bg-paper opacity-[0.04]" aria-hidden />
                    <div className="relative max-w-2xl mx-auto">
                        <Eyebrow className="mb-5" >
                            <span className="text-accent-400">{t('landing.finalEyebrow')}</span>
                        </Eyebrow>
                        <h2 className="font-display text-3xl sm:text-4xl lg:text-5xl font-semibold leading-[1.06] mb-6">
                            {t('landing.finalTitle')}
                        </h2>
                        <p className="text-[17px] text-charcoal-300 leading-relaxed mb-9">
                            {t('landing.finalBody')}
                        </p>
                        <button
                            type="button"
                            onClick={onGetStarted}
                            className="inline-flex items-center justify-center gap-2 bg-accent-400 text-brand-800 font-semibold px-8 py-4 rounded-full hover:bg-accent-300 transition-colors"
                        >
                            {t('landing.finalCta')} <ArrowRight size={18} />
                        </button>
                    </div>
                </div>
            </section>

            {/* Footer */}
            <footer className="border-t border-charcoal-200 bg-charcoal-50 py-12">
                <div className="max-w-6xl mx-auto px-5 sm:px-8 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
                    <div>
                        <Wordmark />
                        <p className="text-[13px] text-brand-500 mt-2 max-w-xs leading-relaxed">{t('landing.footerTagline')}</p>
                    </div>
                    <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-brand-500">
                        <a href="#toolkit" className="hover:text-brand-700 transition-colors">{t('landing.navToolkit')}</a>
                        <a href="#pricing" className="hover:text-brand-700 transition-colors">{t('landing.navPricing')}</a>
                        <a href="#how" className="hover:text-brand-700 transition-colors">{t('landing.navHow')}</a>
                        <a href="#reviews" className="hover:text-brand-700 transition-colors">{t('landing.navReviews')}</a>
                        <a href={contactMailto(t('help.emailSubject'))} className="hover:text-brand-700 transition-colors">{t('help.eyebrow')}</a>
                        {onOpenTerms && (
                            <button type="button" onClick={onOpenTerms} className="hover:text-brand-700 transition-colors">
                                {t('login.tosLink')}
                            </button>
                        )}
                    </div>
                    <p className="text-[12.5px] text-brand-400">{t('landing.footerCopyright', { year: new Date().getFullYear() })}</p>
                </div>
            </footer>
        </div>
    );
};
