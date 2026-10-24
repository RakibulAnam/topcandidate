// KitReadyBanner — the WelcomeBanner's successor on Home, once the free
// welcome credit has been spent and no pack has been bought yet.
//
// This is the "ask after the aha" moment: the user has just seen a complete
// kit for a real job, so the banner names what they got and offers the next
// five in one tap. Before this existed, the only dashboard ask after the free
// kit was a one-line "No credits left · Top up" row at the very bottom.
//
// Same slab, same drawn kit, same per-session dismissal as the welcome banner
// — the two read as one guide, chapter one and chapter two. Visibility is the
// caller's (welcome credit spent, 0 credits, never bought, ≥1 toolkit, no
// bKash payment being verified).
import React, { useEffect } from 'react';
import { X, ArrowRight, ShieldCheck } from 'lucide-react';
import { useT, useLocale } from '../../i18n/LocaleContext';
import { track } from '../../../infrastructure/analytics/track';
import { KitArt } from './WelcomeBanner';
import { sessionFlag, setSessionFlag, KIT_READY_HIDDEN_KEY } from './bannerSession';

const SEEN_KEY = 'tc.kitReadyBanner.seen';

interface Props {
  onBuy: () => void;
  /** Null when there is no toolkit to open (should not happen given the gate). */
  onOpenKit: (() => void) | null;
  onHide: () => void;
  /** Already unlocked (bought the ৳50 master resume): don't promise it "free with it". */
  masterOwned?: boolean;
}

export const KitReadyBanner = ({ onBuy, onOpenKit, onHide, masterOwned = false }: Props) => {
  const t = useT();
  const { locale } = useLocale();

  useEffect(() => {
    if (sessionFlag(SEEN_KEY)) return;
    setSessionFlag(SEEN_KEY);
    track('kit_ready_banner_shown');
  }, []);

  const hide = () => {
    setSessionFlag(KIT_READY_HIDDEN_KEY);
    track('kit_ready_banner_click', { action: 'hide' });
    onHide();
  };

  const eyebrowType = locale === 'bn' ? '' : 'uppercase tracking-[0.09em]';
  const five = (5).toLocaleString(locale === 'bn' ? 'bn-BD' : 'en-US');

  return (
    <section aria-labelledby="kit-ready-title">
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

        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:gap-7">
          {/* The pack, drawn: the same five documents, times five. */}
          <div className="relative mx-auto h-[104px] w-[150px] shrink-0 rounded-2xl bg-[#FFF7EF] p-2.5 sm:mx-0">
            <KitArt />
            <span aria-hidden="true" className="wb-gift absolute -right-3 -top-3 flex h-11 min-w-11 items-center justify-center rounded-full bg-brand-700 px-2 font-display text-[19px] font-semibold text-accent-300">
              ×{five}
            </span>
          </div>

          <div className="min-w-0 flex-1 pr-6">
            <p className={`text-[12px] font-bold text-brand-800/75 ${eyebrowType}`}>{t('dashboard.krEyebrow')}</p>
            <h2 id="kit-ready-title" className="font-display text-[clamp(21px,3.4vw,30px)] font-semibold leading-[1.15]">
              {t('dashboard.krTitle')}
            </h2>
            <p className="mt-1 text-[14px] leading-relaxed text-brand-800/80 sm:text-[15px]">{t(masterOwned ? 'dashboard.krBodyOwned' : 'dashboard.krBody')}</p>
          </div>
        </div>

        <div className="mt-5 flex flex-col gap-2.5 sm:flex-row sm:items-center">
          <button
            type="button"
            onClick={() => { track('kit_ready_banner_click', { action: 'buy' }); onBuy(); }}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-brand-700 px-6 py-3.5 text-[15px] font-bold text-charcoal-50 transition-all hover:-translate-y-px hover:bg-brand-800 sm:w-auto"
          >
            {t('dashboard.krCtaBuy')}
            <ArrowRight size={16} />
          </button>
          {onOpenKit && (
            <button
              type="button"
              onClick={() => { track('kit_ready_banner_click', { action: 'open' }); onOpenKit(); }}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-white px-6 py-3.5 text-[15px] font-bold text-brand-800 transition-all hover:-translate-y-px hover:bg-[#FFF7EF] sm:w-auto"
            >
              {t('dashboard.krCtaOpen')}
            </button>
          )}
          <span className="inline-flex items-center justify-center gap-1.5 text-[12.5px] font-semibold text-brand-800/75 sm:ml-2">
            <ShieldCheck size={15} className="shrink-0" />
            {t('dashboard.krPay')}
          </span>
        </div>
      </div>
    </section>
  );
};
