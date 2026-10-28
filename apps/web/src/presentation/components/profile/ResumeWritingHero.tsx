import React, { useEffect, useRef, useState } from 'react';

// The first thing a new account sees in profile setup: an A4 sheet lands on a
// desk and a pen writes a resume onto it, ending on a check badge. It plays
// once and holds on the finished sheet; the import/start actions under it work
// from the first frame, so it never stands between the user and the form.
//
// The scene is hand-authored Lottie (public/onboarding/resume-writing.json,
// ~9 KB gz). The player is lottie-web's light SVG build (~47 KB gz), imported
// on mount so it ships in its own chunk and never reaches the landing page.
// Under prefers-reduced-motion it jumps straight to the finished frame.

const SCENE_URL = '/onboarding/resume-writing.json';

interface Props {
    label: string;
    className?: string;
}

export const ResumeWritingHero: React.FC<Props> = ({ label, className = '' }) => {
    const ref = useRef<HTMLDivElement>(null);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        let anim: { destroy: () => void } | null = null;
        let cancelled = false;
        const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

        import('lottie-web/build/player/lottie_light')
            .then(({ default: lottie }) => {
                if (cancelled || !ref.current) return;
                const a = lottie.loadAnimation({
                    container: ref.current,
                    renderer: 'svg',
                    loop: false,
                    autoplay: !reduce,
                    path: SCENE_URL,
                    rendererSettings: { preserveAspectRatio: 'xMidYMid slice' },
                });
                if (reduce) a.addEventListener('DOMLoaded', () => a.goToAndStop(a.totalFrames - 1, true));
                a.addEventListener('data_failed', () => setFailed(true));
                anim = a;
            })
            .catch(() => setFailed(true));

        return () => {
            cancelled = true;
            anim?.destroy();
        };
    }, []);

    // Decorative: the copy beside it says the same thing in words.
    if (failed) return null;

    return (
        <div
            ref={ref}
            role="img"
            aria-label={label}
            // The desk colour, so the box is never an empty flash while the
            // player and scene load.
            className={`aspect-[640/440] w-full overflow-hidden rounded-2xl bg-[#D9BC93] ${className}`}
        />
    );
};
