import React, { useEffect, useRef, useState } from 'react';

// The first thing a new account sees in profile setup: an A4 sheet lands on a
// desk, a pen writes a resume onto it and a check badge stamps it; then the
// sheet is cleared away and the next one drops in. It loops (~7.7s, ending on
// the empty desk it starts on, so the restart has no cut) and the import/start
// actions under it work from the first frame, so it never stands between the
// user and the form.
//
// The scene is hand-authored Lottie (public/onboarding/resume-writing.json,
// ~11 KB gz, built by scripts/build-onboarding-scene.mjs). The player is
// lottie-web's light SVG build (~47 KB gz), imported on mount so it ships in
// its own chunk and never reaches the landing page. Under
// prefers-reduced-motion it holds on the finished sheet (the scene's
// `finished` marker) instead of looping; while scrolled out of view it pauses.

const SCENE_URL = '/onboarding/resume-writing.json';

interface Props {
    label: string;
    /** Sizing; must include an aspect ratio. The scene is 640×440 and fills
     *  the frame (`slice`), so a shorter frame crops desk off the top and
     *  bottom — keep it ≥ 640/400 or the sheet itself touches the edges. */
    className?: string;
}

export const ResumeWritingHero: React.FC<Props> = ({ label, className = 'aspect-[640/440]' }) => {
    const ref = useRef<HTMLDivElement>(null);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        let anim: import('lottie-web').AnimationItem | null = null;
        let observer: IntersectionObserver | null = null;
        let cancelled = false;
        const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

        import('lottie-web/build/player/lottie_light')
            .then(({ default: lottie }) => {
                if (cancelled || !ref.current) return;
                const a = lottie.loadAnimation({
                    container: ref.current,
                    renderer: 'svg',
                    loop: !reduce,
                    autoplay: !reduce,
                    path: SCENE_URL,
                    rendererSettings: { preserveAspectRatio: 'xMidYMid slice' },
                });
                if (reduce) {
                    a.addEventListener('DOMLoaded', () => a.goToAndStop('finished', true));
                } else if ('IntersectionObserver' in window) {
                    observer = new IntersectionObserver(([entry]) => {
                        if (entry.isIntersecting) a.play();
                        else a.pause();
                    });
                    observer.observe(ref.current);
                }
                a.addEventListener('data_failed', () => setFailed(true));
                anim = a;
            })
            .catch(() => setFailed(true));

        return () => {
            cancelled = true;
            observer?.disconnect();
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
            className={`w-full overflow-hidden rounded-2xl bg-[#D9BC93] ${className}`}
        />
    );
};
