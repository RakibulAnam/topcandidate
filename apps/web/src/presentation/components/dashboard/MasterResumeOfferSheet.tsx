// "Unlock your master resume" — what an account with no master resume sees
// whenever it reaches for one: the Master tab, the dashboard banner, the
// profile page's locked row, or a refused build. Replaces the explainer that
// shipped with issue #65, which told people what the master resume is and
// then made them pick a pack. The prod funnel said that click is intent —
// people want a general CV now — so this sheet sells it instead:
//
//   1. Endowed progress: "Profile 100% complete" with a full bar. The work is
//      done; one step is left, and it is a tap.
//   2. Their own resume, half-visible (MasterResumeMini), not a description of
//      one. Their name, their latest role, the rest blurred behind a lock.
//   3. Two priced choices, each a single tap straight to the bKash step
//      (MasterOfferChoices): ৳50 for the master resume alone, or ৳200 for it
//      plus 5 tailored job kits, anchored against the real ৳250 they'd add up to.
//   4. Honest scope: it's for jobs with no job post. A job post deserves a
//      tailored kit, and anyone still holding the free kit is pointed at it.
//
// No fake urgency, countdowns or invented social proof: the product has to be
// trusted with a bKash payment by people who have never paid it before.
//
// Bottom sheet on a phone, a two-panel card from md up (preview left on cream,
// offer right). Not a native alert.

import React, { useEffect, useRef } from 'react';
import { ArrowRight, Check, ShieldCheck, X } from 'lucide-react';
import { useAuth } from '../../../infrastructure/auth/AuthContext';
import type { PackageId } from '../../../infrastructure/api/purchaseClient';
import { useLocale, useT } from '../../i18n/LocaleContext';
import { track } from '../../../infrastructure/analytics/track';
import { MasterResumeMini, useMasterPreview } from './MasterResumePreview';
import { MasterOfferChoices } from './MasterOfferChoices';

/** Which surface opened it — sent with every `master_offer_view`. */
export type MasterInfoFrom = 'dashboard_banner' | 'nav' | 'profile' | 'build_refused';

interface Props {
  isOpen: boolean;
  from: MasterInfoFrom;
  onClose: () => void;
  /** Continue to the bKash step with this package chosen. */
  onChoose: (pkg: PackageId) => void;
  /** Still holding the free welcome kit: offer "tailor for a job post" too. */
  freeCredit?: boolean;
  /** Go tailor a kit for a real job post instead. */
  onTailor?: () => void;
  /** Profile has nothing to build from — send them to fill it in. */
  onEditProfile?: () => void;
}

export const MasterResumeOfferSheet: React.FC<Props> = ({
  isOpen, from, onClose, onChoose, freeCredit = false, onTailor, onEditProfile,
}) => {
  const t = useT();
  const { locale } = useLocale();
  const { user } = useAuth();
  const preview = useMasterPreview(user?.id, isOpen);
  // Bangla has no case, and tracking pulls its conjuncts apart.
  const eyebrowCase = locale === 'bn' ? '' : 'uppercase tracking-[0.18em]';
  const sheetRef = useRef<HTMLDivElement>(null);

  const fallbackName = (user?.user_metadata?.full_name as string | undefined) ?? user?.email?.split('@')[0] ?? '';

  // Escape closes; body scroll locks while open; one `shown` per open.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!isOpen) return;
    track('master_offer_view', { action: 'shown', from, freeCredit });
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { track('master_offer_view', { action: 'close', from }); closeRef.current(); }
    };
    window.addEventListener('keydown', onKey);
    sheetRef.current?.focus();
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!isOpen) return null;

  const close = () => { track('master_offer_view', { action: 'close', from }); onClose(); };
  const choose = (pkg: PackageId) => {
    track('master_offer_view', { action: 'choose', from, packageId: pkg });
    onClose();
    onChoose(pkg);
  };
  const empty = preview?.empty === true;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center md:items-center md:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="master-offer-title"
    >
      <div className="absolute inset-0 bg-[#09121F]/65 backdrop-blur-md" onClick={close} />
      <div
        ref={sheetRef}
        tabIndex={-1}
        className="relative flex max-h-[100dvh] w-full flex-col overflow-y-auto rounded-t-3xl bg-white shadow-2xl outline-none motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-8 motion-safe:duration-300 md:max-w-[880px] md:flex-row md:overflow-hidden md:rounded-[28px] md:slide-in-from-bottom-0 md:zoom-in-95 md:duration-200"
      >
        <button
          type="button"
          onClick={close}
          className="absolute right-3 top-3 z-10 rounded-full p-2 text-[#9F998A] transition-colors hover:bg-[#F2F1EB] hover:text-[#0F1B2D]"
          aria-label={t('common.close')}
        >
          <X size={18} />
        </button>

        {/* ── Preview panel: their resume, almost ready ── */}
        <div className="shrink-0 bg-[#F6F1E6] px-6 pb-4 pt-3 md:flex md:w-[42%] md:flex-col md:items-center md:justify-center md:px-10 md:py-12">
          <div className="flex justify-center pb-3 md:hidden">
            <span className="h-1 w-9 rounded-full bg-[#E2DBC9]" aria-hidden />
          </div>
          <div className="mx-auto w-[min(200px,58vw)] md:w-full md:max-w-[270px]">
            <MasterResumeMini
              data={preview}
              fallbackName={fallbackName}
              className="mo-float h-[148px] md:h-[330px]"
            />
          </div>
          {/* Endowed progress: the hard part is behind them. Desktop only — on
              a phone the eyebrow says it, and the price buttons must stay on
              the first screen. */}
          <div className={`mx-auto mt-4 w-full max-w-[270px] ${empty ? 'hidden' : 'hidden md:block'}`}>
            <div className="flex items-center justify-between text-[12px] font-bold text-brand-700">
              <span className="inline-flex items-center gap-1.5">
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-600 text-white">
                  <Check size={10} strokeWidth={3.5} />
                </span>
                {t('masterOffer.progressLabel')}
              </span>
              <span className="tabular-nums text-emerald-700">100%</span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[#E2DBC9]">
              <div className="h-full w-full rounded-full bg-emerald-600" />
            </div>
          </div>
        </div>

        {/* ── Offer panel ── */}
        <div className="flex min-w-0 flex-1 flex-col px-6 pb-[max(22px,env(safe-area-inset-bottom))] pt-5 md:overflow-y-auto md:px-10 md:pb-9 md:pt-12">
          {!empty && (
          <p className={`inline-flex items-center gap-1.5 text-[11.5px] font-bold text-accent-600 ${eyebrowCase}`}>
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-600 text-white md:hidden">
              <Check size={10} strokeWidth={3.5} />
            </span>
            {t('masterOffer.eyebrow')}
          </p>
          )}
          <h2 id="master-offer-title" className="mt-1.5 pr-8 font-display text-[27px] font-semibold leading-[1.12] tracking-tight text-[#0F1B2D] md:text-[33px]">
            {empty ? t('masterOffer.emptyTitle') : t('masterOffer.title')}
          </h2>
          <p className="mt-2.5 text-[14.5px] leading-relaxed text-[#4A4639]">
            {empty ? t('masterOffer.emptyBody') : t('masterOffer.body')}
          </p>

          {empty ? (
            <button
              type="button"
              onClick={() => { track('master_offer_view', { action: 'edit_profile', from }); onClose(); onEditProfile?.(); }}
              className="mt-6 inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-full bg-brand-700 px-6 text-[15px] font-semibold text-charcoal-50 transition-colors hover:bg-brand-800"
            >
              {t('masterOffer.emptyCta')}
              <ArrowRight size={17} />
            </button>
          ) : (
            <>
              <div className="mt-6">
                {/* Not until the profile read has answered: an empty profile
                    must never be one tap from paying for a resume it can't
                    build. The read is cached by the shell, so this is rarely
                    seen. Same height as the two cards, so nothing jumps. */}
                {preview
                  ? <MasterOfferChoices onChoose={choose} />
                  : <div className="h-[178px] animate-pulse rounded-2xl bg-charcoal-100" aria-hidden />}
              </div>

              <p className="mt-4 flex items-start gap-2 text-[12px] leading-relaxed text-[#6B6759]">
                <ShieldCheck size={14} className="mt-0.5 shrink-0 text-emerald-600" />
                <span>{t('masterOffer.trust')}</span>
              </p>

              {/* Honest scope + the free alternative for a real job post. */}
              <div className="mt-4 rounded-2xl border border-[#E5E1D8] bg-[#FAF7F0] px-4 py-3">
                <p className="text-[12.5px] leading-relaxed text-[#6B6759]">
                  <strong className="font-semibold text-[#0F1B2D]">{t('masterOffer.whenTitle')}</strong>{' '}
                  {t('masterOffer.whenBody')}
                </p>
                {freeCredit && onTailor && (
                  <button
                    type="button"
                    onClick={() => { track('master_offer_view', { action: 'tailor', from }); onClose(); onTailor(); }}
                    className="mt-1.5 inline-flex items-center gap-1 text-[12.5px] font-bold text-accent-700 underline-offset-2 hover:underline"
                  >
                    {t('masterOffer.tailorFree')}
                    <ArrowRight size={13} />
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
