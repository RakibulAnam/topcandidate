// WelcomeBanner — the first-run guide on Home, for an account that has just
// finished its profile and still holds the free welcome credit.
//
// A deliberate exception to the product's "subtle hints only" posture: the
// owner asked for an attention-grabbing, visual walkthrough because most users
// will not read text. So the banner is a picture of the path, not a paragraph:
// four drawn steps (profile done → find a job → paste the post → get the kit),
// each animated in turn, with step 1 already ticked (endowed progress — the
// user starts one step in, which measurably raises completion).
//
// It teaches by doing, not by telling: the two buttons ARE the next step. One
// scrolls to the job-discovery board, the other focuses the paste box on the
// start card. Nothing here is a tour to read and dismiss.
//
// Visibility is owned by the caller (welcome credit unspent + zero toolkits +
// a profile that isn't empty, since step 1 claims "Profile done").
// "Hide for now" lasts one browser session (see bannerSession.ts): an unused
// gift should greet the user again on their next visit, but never nag within one.
//
// Colour: a flat accent-400 slab with brand-800 ink (7.3:1) and cream step
// tiles — all brand tokens, no gradient, no tint formula, so it needs no new
// scoped exception. Motion lives in index.css (`wb-*` keyframes) and stops
// under prefers-reduced-motion.
import React, { useEffect } from 'react';
import { Gift, X, ArrowRight, ArrowDown, Check } from 'lucide-react';
import { useT, useLocale } from '../../i18n/LocaleContext';
import { track } from '../../../infrastructure/analytics/track';
import { sessionFlag, setSessionFlag, WELCOME_HIDDEN_KEY } from './bannerSession';

const SEEN_KEY = 'tc.welcomeBanner.seen';

interface Props {
  /** Null when the job-discovery board has too few searches to render. */
  onShowJobs: (() => void) | null;
  onPaste: () => void;
  onHide: () => void;
}

// ── Drawn steps (semi-abstract, brand ink + orange on cream) ────────────────
const INK = '#0F1B2D';
const ORANGE = '#E8743B';
const LINE = '#D6DCE5';

const ProfileArt = () => (
  <svg viewBox="0 0 96 72" className="h-full w-full" aria-hidden="true">
    <rect x="14" y="8" width="60" height="56" rx="7" fill="#fff" stroke={LINE} strokeWidth="2" />
    <circle cx="32" cy="27" r="8" fill={ORANGE} opacity="0.85" />
    <rect x="45" y="21" width="22" height="4" rx="2" fill={INK} />
    <rect x="45" y="29" width="15" height="4" rx="2" fill={LINE} />
    <rect x="22" y="42" width="44" height="4" rx="2" fill={LINE} />
    <rect x="22" y="50" width="32" height="4" rx="2" fill={LINE} />
    <g className="wb-pop">
      <circle cx="74" cy="12" r="10" fill={INK} />
      <path d="M69.5 12.2l3.2 3.2 6-6.4" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </g>
  </svg>
);

const FindArt = () => (
  <svg viewBox="0 0 96 72" className="h-full w-full" aria-hidden="true">
    <rect x="10" y="8" width="62" height="56" rx="7" fill="#fff" stroke={LINE} strokeWidth="2" />
    <rect x="10" y="8" width="62" height="13" rx="7" fill={INK} />
    <rect x="10" y="15" width="62" height="6" fill={INK} />
    <rect x="17" y="12.5" width="20" height="4" rx="2" fill={ORANGE} />
    <rect x="17" y="29" width="40" height="4" rx="2" fill={INK} opacity="0.75" />
    <rect x="17" y="38" width="46" height="4" rx="2" fill={LINE} />
    <rect x="17" y="46" width="36" height="4" rx="2" fill={LINE} />
    <rect x="17" y="54" width="42" height="4" rx="2" fill={LINE} />
    <g className="wb-scan">
      <circle cx="60" cy="40" r="11" fill="rgba(255,255,255,0.55)" stroke={ORANGE} strokeWidth="3.5" />
      <path d="M68 48l9 9" stroke={ORANGE} strokeWidth="5" strokeLinecap="round" />
    </g>
  </svg>
);

const PasteArt = () => (
  <svg viewBox="0 0 96 72" className="h-full w-full" aria-hidden="true">
    {/* the job post */}
    <rect x="4" y="10" width="38" height="52" rx="6" fill="#fff" stroke={LINE} strokeWidth="2" />
    <rect className="wb-select" x="9" y="18" width="28" height="27" rx="3" fill={ORANGE} />
    <rect x="11" y="21" width="22" height="3.5" rx="1.75" fill={INK} opacity="0.7" />
    <rect x="11" y="29" width="24" height="3.5" rx="1.75" fill={INK} opacity="0.35" />
    <rect x="11" y="37" width="18" height="3.5" rx="1.75" fill={INK} opacity="0.35" />
    <rect x="11" y="51" width="22" height="3.5" rx="1.75" fill={LINE} />
    {/* the box on the dashboard */}
    <rect x="54" y="10" width="38" height="52" rx="6" fill={INK} />
    <g className="wb-filled">
      <rect x="60" y="20" width="22" height="3.5" rx="1.75" fill="#fff" opacity="0.85" />
      <rect x="60" y="28" width="26" height="3.5" rx="1.75" fill="#fff" opacity="0.45" />
      <rect x="60" y="36" width="20" height="3.5" rx="1.75" fill="#fff" opacity="0.45" />
    </g>
    {/* the copied block travelling across */}
    <rect className="wb-fly" x="12" y="24" width="20" height="14" rx="3" fill={ORANGE} stroke="#fff" strokeWidth="1.5" />
  </svg>
);

const KIT = [INK, ORANGE, '#5A6A85', '#C95D27', '#22324B'];
export const KitArt = () => (
  <svg viewBox="0 0 96 72" className="h-full w-full overflow-visible" aria-hidden="true">
    {KIT.map((c, i) => (
      <g key={i} className="wb-fan" style={{ ['--wb-r' as string]: `${(i - 2) * 14}deg` }}>
        <rect x="35" y="14" width="26" height="34" rx="4" fill="#fff" stroke={c} strokeWidth="2.5" />
        <rect x="40" y="21" width="16" height="3" rx="1.5" fill={c} />
        <rect x="40" y="28" width="12" height="3" rx="1.5" fill={LINE} />
        <rect x="40" y="34" width="14" height="3" rx="1.5" fill={LINE} />
      </g>
    ))}
  </svg>
);

const STEPS = [
  { Art: ProfileArt, title: 'dashboard.wbStep1', sub: 'dashboard.wbStep1Sub', done: true },
  { Art: FindArt, title: 'dashboard.wbStep2', sub: 'dashboard.wbStep2Sub', done: false },
  { Art: PasteArt, title: 'dashboard.wbStep3', sub: 'dashboard.wbStep3Sub', done: false },
  { Art: KitArt, title: 'dashboard.wbStep4', sub: 'dashboard.wbStep4Sub', done: false },
] as const;

export const WelcomeBanner = ({ onShowJobs, onPaste, onHide }: Props) => {
  const t = useT();
  const { locale } = useLocale();

  // One "shown" per browser session, so the funnel counts people, not renders.
  useEffect(() => {
    if (sessionFlag(SEEN_KEY)) return;
    setSessionFlag(SEEN_KEY);
    track('welcome_banner_shown');
  }, []);

  const hide = () => {
    setSessionFlag(WELCOME_HIDDEN_KEY);
    track('welcome_banner_click', { action: 'hide' });
    onHide();
  };

  // Bangla has no letter case; uppercase + tracking only loosens conjuncts.
  const eyebrowType = locale === 'bn' ? '' : 'uppercase tracking-[0.09em]';

  return (
    <section aria-labelledby="welcome-banner-title">
      <div className="wb-enter relative overflow-hidden rounded-[22px] bg-accent-400 p-[clamp(18px,3vw,30px)] text-brand-800 shadow-[0_24px_48px_-20px_rgba(201,93,39,0.55)]">
        <button
          type="button"
          onClick={hide}
          aria-label={t('dashboard.wbHide')}
          title={t('dashboard.wbHide')}
          className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full text-brand-800/70 transition-colors hover:bg-brand-800/10 hover:text-brand-800"
        >
          <X size={18} />
        </button>

        {/* Headline */}
        <div className="flex items-start gap-3.5 pr-10 sm:items-center">
          <span className="wb-gift flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand-700 sm:h-14 sm:w-14">
            <Gift size={24} className="text-accent-300" />
          </span>
          <div className="min-w-0">
            <p className={`text-[12px] font-bold text-brand-800/75 ${eyebrowType}`}>{t('dashboard.wbEyebrow')}</p>
            <h2 id="welcome-banner-title" className="font-display text-[clamp(21px,3.4vw,30px)] font-semibold leading-[1.15]">
              {t('dashboard.wbTitle')}
            </h2>
            <p className="mt-1 text-[14px] leading-relaxed text-brand-800/80 sm:text-[15px]">{t('dashboard.wbBody')}</p>
          </div>
        </div>

        {/* The path, drawn */}
        <ol className="mt-5 grid grid-cols-1 gap-2.5 sm:mt-6 sm:grid-cols-4 sm:gap-4">
          {STEPS.map(({ Art, title, sub, done }, i) => (
            <li
              key={title}
              className={`relative flex items-center gap-3.5 rounded-2xl bg-[#FFF7EF] p-2.5 sm:flex-col sm:items-stretch sm:gap-2 sm:p-3 ${
                done ? '' : `wb-step wb-step-${i}`
              }`}
            >
              <div className="h-[60px] w-[80px] shrink-0 sm:h-[84px] sm:w-full">
                <Art />
              </div>
              <div className="min-w-0 sm:text-center">
                <p className="flex items-center gap-1.5 text-[14.5px] font-bold leading-snug sm:justify-center">
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                      done ? 'bg-brand-700 text-white' : 'bg-accent-500 text-brand-800'
                    }`}
                  >
                    {done ? <Check size={12} strokeWidth={3} /> : (i + 1).toLocaleString(locale === 'bn' ? 'bn-BD' : 'en-US')}
                  </span>
                  <span>{t(title)}</span>
                </p>
                <p className="mt-0.5 text-[12.5px] leading-snug text-charcoal-600">{t(sub)}</p>
              </div>
              {i < STEPS.length - 1 && (
                <ArrowRight
                  size={18}
                  strokeWidth={2.75}
                  aria-hidden="true"
                  className="absolute -right-[17px] top-[52px] z-10 hidden text-brand-800 sm:block"
                />
              )}
            </li>
          ))}
        </ol>

        {/* The next step, as buttons */}
        <div className="mt-5 flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-center">
          {onShowJobs && (
            <button
              type="button"
              onClick={() => { track('welcome_banner_click', { action: 'jobs' }); onShowJobs(); }}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-brand-700 px-6 py-3.5 text-[15px] font-bold text-charcoal-50 transition-all hover:-translate-y-px hover:bg-brand-800 sm:w-auto"
            >
              {t('dashboard.wbCtaJobs')}
              <ArrowDown size={16} />
            </button>
          )}
          <button
            type="button"
            onClick={() => { track('welcome_banner_click', { action: 'paste' }); onPaste(); }}
            className={`inline-flex w-full items-center justify-center gap-2 rounded-xl px-6 py-3.5 text-[15px] font-bold transition-all hover:-translate-y-px sm:w-auto ${
              onShowJobs ? 'bg-white text-brand-800 hover:bg-[#FFF7EF]' : 'bg-brand-700 text-charcoal-50 hover:bg-brand-800'
            }`}
          >
            {t('dashboard.wbCtaPaste')}
            <ArrowDown size={16} />
          </button>
        </div>
      </div>
    </section>
  );
};
