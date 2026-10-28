// ResumeOfferPreview — the whole dashboard ask for an account that has
// finished its profile but not bought its master resume (owner, 2026-10-27:
// replaces the welcome / kit-ready / master-offer banners, which together read
// as overwhelming). One thing: their own resume.
//
//   * Header: "Your resume is ready", ~~৳200~~ ৳99 (৳50 for accounts from
//     before migration 034, see pricing.ts), one button.
//   * The page: their name, contact line and the professional summary the real
//     build wrote (resumeOfferData — built once on the server and kept for the
//     purchase, so what they read is what they get) are fully legible.
//     Everything after the summary blurs a little more with each line, so the
//     first role is nearly readable and the bottom is not.
//   * "Click here to get your resume" sits on the blur, just below the summary
//     so it never covers it. It is the page's real button (keyboard / screen
//     reader); a tap anywhere else on the page does the same. Both open the
//     bKash sheet on the ৳99 master-resume package.
//   * The name, contact line and summary are readable by screen readers; the
//     blurred part is aria-hidden (it is a teaser, not content).
//
// Blur steps, not a fade: a fade needs a gradient, which the brand forbids.
import React, { useEffect, useState } from 'react';
import { ArrowRight, Check, Loader2, Lock, Mail, MapPin, Phone } from 'lucide-react';
import { useAuth } from '../../../infrastructure/auth/AuthContext';
import { useLocale, useT } from '../../i18n/LocaleContext';
import { track } from '../../../infrastructure/analytics/track';
import { sessionFlag, setSessionFlag } from './bannerSession';
import { masterPriceLabel } from '../../pricing';
import { invalidateMasterPreview, useResumeOfferProfile, useResumeOfferSummary } from './resumeOfferData';

const SEEN_KEY = 'tc.resumeOffer.seen';

// Blur per line after the summary, in px: the first role's title reads, each
// bullet after it a little less, and by the next section nothing does.
const BLUR_STEPS = [0.5, 1.2, 1.9, 2.6, 3.3, 4.2, 5.2, 6];
const blurAt = (i: number) => ({ filter: `blur(${BLUR_STEPS[Math.min(i, BLUR_STEPS.length - 1)]}px)` });

interface Props {
  onGetResume: () => void;
  /** The build refuses this profile (random text): send them to fix it. */
  onEditProfile: () => void;
  /** Account existed before migration 034: priced ৳50, not ৳99. */
  legacyPricing: boolean | null;
}

export const ResumeOfferPreview: React.FC<Props> = ({ onGetResume, onEditProfile, legacyPricing }) => {
  const t = useT();
  const { locale } = useLocale();
  const { user } = useAuth();
  // Fresh reads on every dashboard visit, before the hooks below fetch: the
  // profile may have been edited anywhere since (see resumeOfferData).
  useState(() => invalidateMasterPreview(user?.id));
  const profile = useResumeOfferProfile(user?.id);
  const summary = useResumeOfferSummary(user?.id);
  const eyebrowCase = locale === 'bn' ? '' : 'uppercase tracking-[0.12em]';
  const name = profile?.name || (user?.user_metadata?.full_name as string | undefined) || '';
  const contactItems = ([
    [Mail, profile?.email],
    [Phone, profile?.phone],
    [MapPin, profile?.location],
  ] as const).filter(([, text]) => !!text).map(([Icon, text]) => ({ Icon, text: text as string }));

  // One "shown" per browser session, so the funnel counts people, not renders.
  useEffect(() => {
    if (sessionFlag(SEEN_KEY)) return;
    setSessionFlag(SEEN_KEY);
    track('resume_offer', { action: 'shown' });
  }, []);

  // A profile the build refuses can't be sold a resume: the same surface
  // asks them to fix it instead (no price, no purchase).
  const unbuildable = summary.status === 'unbuildable';
  const get = (via: 'header' | 'page') => {
    track('resume_offer', { action: unbuildable ? 'fix_profile' : 'click', via, summary: summary.status });
    if (unbuildable) onEditProfile(); else onGetResume();
  };

  const dates = (start: string, end: string, current: boolean) =>
    [start, current ? t('resumeOffer.present') : end].filter(Boolean).join(' – ');

  // Each line after the summary takes the next blur step.
  let band = 0;
  // Bangla has no case, and letter-spacing pulls its conjuncts apart.
  const sectionHeading = `mt-5 border-b border-brand-700/70 pb-1 text-[11px] font-bold sm:mt-6 ${
    locale === 'bn' ? '' : 'uppercase tracking-[0.12em] sm:tracking-[0.16em]'
  }`;

  return (
    <section aria-labelledby="resume-offer-title" className="wb-enter">
      {/* Header: the claim, then the price and the button under it — all
          centred; it is the top of the page for these accounts (the welcome
          hero steps aside, see DashboardScreen). */}
      <div className="mb-6 flex flex-col items-center gap-5 text-center">
        <div className="flex min-w-0 flex-col items-center">
          <span className={`inline-flex items-center gap-1.5 text-[12px] font-bold text-emerald-700 ${eyebrowCase}`}>
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-600 text-white">
              <Check size={10} strokeWidth={3.5} />
            </span>
            {t('resumeOffer.eyebrow')}
          </span>
          {/* h1: it replaces the dashboard hero's h1 as the page's heading. */}
          <h1 id="resume-offer-title" className="mt-2 font-display text-[clamp(30px,5vw,44px)] font-semibold leading-[1.1] text-brand-700">
            {unbuildable ? t('resumeOffer.fixTitle') : t('resumeOffer.title')}
          </h1>
          <p className="mt-2 max-w-[520px] text-[15px] leading-relaxed text-charcoal-500">
            {summary.status === 'unbuildable'
              ? t('resumeOffer.fixBody', { fields: summary.fields.join(', ') })
              : t('resumeOffer.body')}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-3">
          {!unbuildable && (
          <p className="flex items-baseline gap-2 whitespace-nowrap">
            <span className="sr-only">{t('resumeOffer.priceLabel', { price: masterPriceLabel(t, legacyPricing) })}</span>
            <s aria-hidden="true" className="text-[17px] font-semibold text-charcoal-400 decoration-accent-600 decoration-2">{t('resumeOffer.wasPrice')}</s>
            <span aria-hidden="true" className="font-display text-[34px] font-bold leading-none text-brand-700">{masterPriceLabel(t, legacyPricing)}</span>
          </p>
          )}
          <button
            type="button"
            onClick={() => get('header')}
            className="mo-nudge inline-flex min-h-[48px] items-center gap-2 whitespace-nowrap rounded-full bg-accent-400 px-6 text-[15px] font-bold text-brand-800 shadow-[0_10px_22px_-12px_rgba(201,93,39,0.8)] transition-colors hover:bg-accent-300"
          >
            {unbuildable ? t('resumeOffer.fixCta') : t('resumeOffer.cta')}
            <ArrowRight size={16} />
          </button>
        </div>
      </div>

      {/* The page itself: a sheet of paper (a second one peeks out behind it),
          not a card. A tap anywhere on it buys; keyboard and screen readers use
          the pill button inside, which does the same. */}
      <div className="relative mx-auto max-w-[760px] pb-2 sm:px-2">
        <div
          aria-hidden="true"
          className="absolute inset-x-3 bottom-0 top-3 rotate-[1.4deg] rounded-[4px] border border-charcoal-200 bg-charcoal-50 sm:inset-x-6"
        />
      <div
        onClick={() => get('page')}
        className="group relative cursor-pointer overflow-hidden rounded-[4px] border border-charcoal-200 bg-white shadow-[0_24px_50px_-28px_rgba(15,27,45,0.5)] transition-transform duration-200 hover:-translate-y-0.5"
      >
        <article className="select-none px-[clamp(18px,6vw,56px)] pb-[clamp(18px,4vw,32px)] pt-[clamp(22px,5vw,48px)] font-display text-brand-700">
          {/* Header — legible */}
          <p className="text-center font-display text-[clamp(21px,4vw,30px)] font-semibold leading-tight">{name}</p>
          {profile?.roles[0]?.role && (
            <p className="mt-1 text-center text-[12.5px] font-semibold text-accent-700 sm:text-[13px]">{profile.roles[0].role}</p>
          )}
          {/* One item per piece, each with its icon, so a narrow screen wraps
              between items instead of leaving a stray "·" at a line end. */}
          {contactItems.length > 0 && (
            <ul className="mt-2 flex flex-wrap justify-center gap-x-3.5 gap-y-1 font-sans text-[11px] text-charcoal-500 sm:text-[11.5px]">
              {contactItems.map(({ Icon, text }) => (
                <li key={text} className="inline-flex min-w-0 max-w-full items-center gap-1">
                  <Icon size={11} className="shrink-0 text-charcoal-400" aria-hidden="true" />
                  <span className="truncate">{text}</span>
                </li>
              ))}
            </ul>
          )}

          {/* Summary — legible: the real one their resume will open with */}
          <h3 className={sectionHeading}>{t('resumeOffer.summaryHeading')}</h3>
          {summary.status === 'ready' ? (
            <p className="mt-2.5 text-[13.5px] leading-[1.65] text-charcoal-700 sm:text-[14px]">{summary.text}</p>
          ) : summary.status === 'loading' ? (
            <div className="mt-2.5">
              <span aria-hidden="true" className="flex flex-col gap-2">
                <span className="h-3 w-full animate-pulse rounded bg-charcoal-100" />
                <span className="h-3 w-[94%] animate-pulse rounded bg-charcoal-100" />
                <span className="h-3 w-[70%] animate-pulse rounded bg-charcoal-100" />
              </span>
              <p className="mt-2.5 inline-flex items-center gap-1.5 font-sans text-[12px] text-charcoal-500">
                <Loader2 size={13} className="animate-spin" />
                {t('resumeOffer.summaryWriting')}
              </p>
            </div>
          ) : (
            // Couldn't write it now — never block the offer on it.
            <span aria-hidden="true" className="mt-2.5 flex flex-col gap-2" style={blurAt(1)}>
              <span className="h-3 w-full rounded bg-charcoal-200" />
              <span className="h-3 w-[90%] rounded bg-charcoal-200" />
            </span>
          )}

          {/* Everything after the summary: blurred a step further per line,
              with the ask on it. A fixed-height window, so the page always
              ends on its own bottom margin (never a flat cut through a line)
              and a thin profile still has room for the pill. */}
          <div className="relative h-[clamp(250px,62vw,340px)] overflow-hidden">
            <div aria-hidden="true">
              {profile && profile.roles.length > 0 && (
                <>
                  <h3 className={sectionHeading} style={blurAt(band)}>{t('resumeOffer.experienceHeading')}</h3>
                  {profile.roles.map((r, i) => (
                    <div key={i} className="mt-3">
                      <p className="flex flex-wrap items-baseline justify-between gap-x-3 text-[13.5px]" style={blurAt(band++)}>
                        <span><b className="font-semibold">{r.role}</b>{r.company ? <span className="text-charcoal-600"> — {r.company}</span> : null}</span>
                        <span className="text-[11.5px] text-charcoal-500">{dates(r.start, r.end, r.current)}</span>
                      </p>
                      <ul className="mt-1.5 list-disc space-y-1 pl-5 text-[13px] leading-relaxed text-charcoal-700">
                        {(r.bullets.length ? r.bullets : ['', '']).map((b, j) => (
                          <li key={j} style={blurAt(band++)}>{b || <span className="inline-block h-2.5 w-[80%] rounded bg-charcoal-200 align-middle" />}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </>
              )}

              {profile && profile.education.length > 0 && (
                <div style={blurAt(band++)}>
                  <h3 className={sectionHeading}>{t('resumeOffer.educationHeading')}</h3>
                  {profile.education.map((e, i) => (
                    <p key={i} className="mt-2 flex flex-wrap items-baseline justify-between gap-x-3 text-[13.5px]">
                      <span><b className="font-semibold">{e.degree}</b>{e.school ? <span className="text-charcoal-600"> — {e.school}</span> : null}</span>
                      <span className="text-[11.5px] text-charcoal-500">{e.end}</span>
                    </p>
                  ))}
                </div>
              )}

              {profile && profile.skills.length > 0 && (
                <div style={blurAt(band++)}>
                  <h3 className={sectionHeading}>{t('resumeOffer.skillsHeading')}</h3>
                  <p className="mt-2 text-[13px] leading-relaxed text-charcoal-700">{profile.skills.join('  ·  ')}</p>
                </div>
              )}
            </div>

            {/* The ask, centred in the blurred window — below the first role's
                title line (the last thing that still reads), so it never covers
                anything legible. */}
            <div className="absolute inset-x-0 top-[58%] flex -translate-y-1/2 justify-center px-2">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); get('page'); }}
                className="inline-flex items-center gap-2 rounded-full bg-brand-700 px-5 py-3 text-center font-sans text-[14px] font-bold text-charcoal-50 shadow-[0_16px_32px_-12px_rgba(15,27,45,0.7)] transition-transform group-hover:scale-[1.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 sm:text-[14.5px]"
              >
                <Lock size={15} strokeWidth={2.6} className="shrink-0 text-accent-300" />
                {unbuildable ? t('resumeOffer.fixCta') : t('resumeOffer.overlay')}
              </button>
            </div>
          </div>
        </article>
      </div>
      </div>
    </section>
  );
};

/** Holds the preview's space while the shell is still finding out whether to
 *  show it (profile read, payment-in-flight check), so the page below doesn't
 *  jump down when it lands. */
export const ResumeOfferSkeleton: React.FC = () => (
  <section aria-hidden="true">
    {/* Header: eyebrow, title, body, then the price + button row, centred. */}
    <div className="mx-auto mb-6 h-[220px] max-w-[520px] animate-pulse rounded-xl bg-charcoal-100 sm:h-[200px]" />
    {/* The sheet: same width cap as the real one, and its measured height
        (~615px on a 375px phone, ~655px on desktop). */}
    <div className="mx-auto h-[min(650px,165vw)] max-w-[760px] rounded-[4px] border border-charcoal-200 bg-white" />
  </section>
);
