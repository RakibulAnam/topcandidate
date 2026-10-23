// "What is the master resume?" — shown to an account that hasn't bought a pack
// yet whenever it reaches for the master resume (dashboard banner, the Master
// Resume tab with nothing built, the profile page's locked row, a refused
// build). Before this, those clicks went straight to the bKash sheet, or
// nowhere at all, without saying what the master resume is for — or that a
// job with a post deserves a tailored resume instead (issue #65).
//
// Same sheet shape as the purchase modal's gift panel: bottom sheet on a
// phone, centred card from md up. Not a native alert.

import React, { useEffect, useRef } from 'react';
import { ArrowRight, Check, FileText, X } from 'lucide-react';
import { useLocale, useT } from '../../i18n/LocaleContext';
import { track } from '../../../infrastructure/analytics/track';

/** Which surface opened it — sent with every `master_info_view`. */
export type MasterInfoFrom = 'dashboard_banner' | 'nav' | 'profile' | 'build_refused';

interface Props {
  isOpen: boolean;
  from: MasterInfoFrom;
  onClose: () => void;
  /** Continue to the purchase sheet. */
  onGetPack: () => void;
  /** Go tailor a kit for a real job post instead. */
  onTailor: () => void;
}

export const MasterResumeInfoDialog: React.FC<Props> = ({ isOpen, from, onClose, onGetPack, onTailor }) => {
  const t = useT();
  const { locale } = useLocale();
  // Bangla has no case, and tracking pulls its conjuncts apart.
  const eyebrowCase = locale === 'bn' ? '' : 'uppercase tracking-[0.22em]';
  const sheetRef = useRef<HTMLDivElement>(null);

  // Escape closes; body scroll locks while open; one `shown` per open.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!isOpen) return;
    track('master_info_view', { action: 'shown', from });
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { track('master_info_view', { action: 'close', from }); closeRef.current(); }
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

  const close = () => { track('master_info_view', { action: 'close', from }); onClose(); };
  const points = [t('masterInfo.point1'), t('masterInfo.point2')];

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center md:items-center md:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="master-info-title"
    >
      <div className="absolute inset-0 bg-[#09121F]/65 backdrop-blur-md" onClick={close} />
      <div
        ref={sheetRef}
        tabIndex={-1}
        className="relative flex max-h-[100dvh] w-full flex-col overflow-y-auto rounded-t-3xl bg-white shadow-2xl outline-none motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-8 motion-safe:duration-300 md:max-w-lg md:rounded-[28px]"
      >
        <div className="flex justify-center pt-2.5 md:hidden">
          <span className="h-1 w-9 rounded-full bg-[#EAE6DA]" aria-hidden />
        </div>
        <div className="px-6 pb-[max(24px,env(safe-area-inset-bottom))] pt-4 md:px-9 md:pb-9 md:pt-8">
          <div className="flex items-start justify-between gap-3">
            <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-accent-100 text-accent-600">
              <FileText size={22} />
            </span>
            <button
              type="button"
              onClick={close}
              className="-mr-2 -mt-1 shrink-0 rounded-full p-2 text-[#9F998A] transition-colors hover:bg-[#F2F1EB] hover:text-[#0F1B2D]"
              aria-label={t('common.close')}
            >
              <X size={18} />
            </button>
          </div>
          <p className={`mt-4 text-[11px] font-bold text-accent-600 ${eyebrowCase}`}>{t('masterInfo.eyebrow')}</p>
          <h2 id="master-info-title" className="mt-1.5 font-display text-[28px] font-semibold leading-tight tracking-tight text-[#0F1B2D] md:text-[32px]">
            {t('masterInfo.title')}
          </h2>
          <ul className="mt-4 space-y-2.5">
            {points.map((p, i) => (
              <li key={i} className="flex items-start gap-2.5 text-[14.5px] leading-relaxed text-[#0F1B2D]">
                <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600">
                  <Check size={12} strokeWidth={3.5} />
                </span>
                <span>{p}</span>
              </li>
            ))}
          </ul>
          <div className="mt-5 rounded-2xl border border-[#E5E1D8] bg-[#FAF7F0] px-4 py-3.5">
            <p className="text-[13.5px] font-semibold text-[#0F1B2D]">{t('masterInfo.whenTitle')}</p>
            <p className="mt-1 text-[13px] leading-relaxed text-[#6B6759]">{t('masterInfo.whenBody')}</p>
          </div>
          <div className="mt-6 flex flex-col gap-2.5">
            <button
              type="button"
              onClick={() => { track('master_info_view', { action: 'get_pack', from }); onClose(); onGetPack(); }}
              className="inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-full bg-brand-700 px-6 text-[15px] font-semibold text-charcoal-50 outline-none transition-colors hover:bg-brand-800 focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2"
            >
              {t('masterInfo.getPack')}
              <ArrowRight size={17} />
            </button>
            <button
              type="button"
              onClick={() => { track('master_info_view', { action: 'tailor', from }); onClose(); onTailor(); }}
              className="inline-flex min-h-[48px] w-full items-center justify-center rounded-full border border-[#D8D3C4] px-6 text-[14px] font-semibold text-[#0F1B2D] outline-none transition-colors hover:border-[#0F1B2D] focus-visible:ring-2 focus-visible:ring-accent-500"
            >
              {t('masterInfo.tailor')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
