// Profile-setup walkthrough video (YouTube, one video for both locales).
//
// Two entry points in ProfileSetupScreen: inline on the "Important!" primer,
// and a thumbnail card in the wizard (rail on desktop, above the form on
// mobile) that opens the same player in a dialog — the primer is gone once the
// wizard starts, and people get stuck mid-flow, not before it.
//
// The player is a click-to-load facade: we render YouTube's poster image and
// only mount the iframe on click. The embed pulls ~1 MB of YouTube JS, and the
// primer is the first screen every new user sees, often on mobile data.
// youtube-nocookie + rel=0 keeps it privacy-enhanced and stops the end screen
// suggesting other channels' videos.

import React, { useEffect, useState } from 'react';
import { PlayCircle, X } from 'lucide-react';
import { useT } from '../../i18n/LocaleContext';
import { track } from '../../../infrastructure/analytics/track';

const VIDEO_ID = 'giK4Qg3m9VQ';

type Placement = 'intro' | 'wizard';

export const TutorialVideoPlayer: React.FC<{ placement: Placement; autoStart?: boolean }> = ({ placement, autoStart = false }) => {
    const t = useT();
    const [playing, setPlaying] = useState(autoStart);

    useEffect(() => {
        if (autoStart) track('tutorial_video_played', { placement });
    }, [autoStart, placement]);

    const play = () => {
        setPlaying(true);
        track('tutorial_video_played', { placement });
    };

    return (
        <div className="relative aspect-video w-full overflow-hidden rounded-2xl bg-brand-700">
            {playing ? (
                <iframe
                    className="absolute inset-0 h-full w-full"
                    src={`https://www.youtube-nocookie.com/embed/${VIDEO_ID}?autoplay=1&rel=0&playsinline=1`}
                    title={t('profileSetup.tutorialTitle')}
                    allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                    allowFullScreen
                    referrerPolicy="strict-origin-when-cross-origin"
                />
            ) : (
                <button
                    type="button"
                    onClick={play}
                    className="group absolute inset-0 h-full w-full"
                    aria-label={t('profileSetup.tutorialPlay')}
                >
                    <img
                        src={`https://i.ytimg.com/vi/${VIDEO_ID}/maxresdefault.jpg`}
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-cover opacity-90 transition-opacity group-hover:opacity-100"
                    />
                    <span className="absolute inset-0 flex items-center justify-center">
                        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-accent-500 text-white shadow-lg transition-transform group-hover:scale-105">
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" /></svg>
                        </span>
                    </span>
                    <span className="absolute bottom-2.5 right-2.5 rounded-md bg-brand-900/80 px-2 py-0.5 text-[12px] font-semibold tabular-nums text-charcoal-50">
                        {t('profileSetup.tutorialLength')}
                    </span>
                </button>
            )}
        </div>
    );
};

/**
 * Wizard entry point: a compact thumbnail card that opens the player in a
 * dialog. Mounted twice — in the desktop rail and inline above the form below
 * lg, where the rail doesn't render — so it's a visible section on every step
 * and screen size, never an icon to discover.
 */
export const TutorialVideoCard: React.FC<{ layout?: 'row' | 'stacked'; className?: string }> = ({ layout = 'row', className = '' }) => {
    const stacked = layout === 'stacked';
    const t = useT();
    const [open, setOpen] = useState(false);

    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open]);

    return (
        <>
            <button
                type="button"
                onClick={() => setOpen(true)}
                className={`group flex w-full gap-3 rounded-2xl border border-charcoal-200 bg-white p-3 text-left transition-colors hover:border-accent-300 ${stacked ? 'flex-col' : 'items-center'} ${className}`}
            >
                <span className={`relative aspect-video shrink-0 overflow-hidden rounded-lg bg-brand-700 ${stacked ? 'w-full' : 'w-28'}`}>
                    <img
                        src={`https://i.ytimg.com/vi/${VIDEO_ID}/mqdefault.jpg`}
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-cover"
                    />
                    <span className="absolute inset-0 flex items-center justify-center">
                        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-500 text-white shadow transition-transform group-hover:scale-105">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" /></svg>
                        </span>
                    </span>
                    <span className="absolute bottom-1 right-1 rounded bg-brand-900/80 px-1 text-[10px] font-semibold tabular-nums text-charcoal-50">
                        {t('profileSetup.tutorialLength')}
                    </span>
                </span>
                <span className={`min-w-0 ${stacked ? 'px-1 pb-1' : ''}`}>
                    <span className="mb-0.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-accent-600">
                        <PlayCircle size={12} />
                        {t('profileSetup.tutorialCardEyebrow')}
                    </span>
                    <span className="block text-sm font-semibold leading-snug text-brand-700">
                        {t('profileSetup.tutorialTitle')}
                    </span>
                    <span className="mt-0.5 block text-xs leading-snug text-charcoal-500">
                        {t('profileSetup.tutorialCardBody')}
                    </span>
                </span>
            </button>

            {open && (
                <div
                    className="fixed inset-0 z-[60] flex items-center justify-center bg-[rgba(15,27,45,0.6)] px-4 backdrop-blur-[3px]"
                    onClick={() => setOpen(false)}
                    role="dialog"
                    aria-modal="true"
                    aria-label={t('profileSetup.tutorialTitle')}
                >
                    <div
                        className="w-full max-w-3xl rounded-[20px] border border-charcoal-200 bg-white p-3 shadow-2xl sm:p-4"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="mb-3 flex items-center justify-between gap-3 px-1">
                            <h3 className="font-display text-lg font-semibold text-brand-700">{t('profileSetup.tutorialTitle')}</h3>
                            <button
                                type="button"
                                onClick={() => setOpen(false)}
                                className="rounded-full p-1.5 text-charcoal-500 transition-colors hover:bg-charcoal-100 hover:text-brand-700"
                                aria-label={t('profileSetup.tutorialClose')}
                            >
                                <X size={18} />
                            </button>
                        </div>
                        <TutorialVideoPlayer placement="wizard" autoStart />
                    </div>
                </div>
            )}
        </>
    );
};
