// MasterOfferBanner — the dashboard's standing offer for an account that has
// finished its profile but has no master resume yet (never bought anything).
// It sits beside the welcome-credit banner, just as loud as it: the free kit is
// one gift and this is the other thing their finished profile has earned.
//
// The banner makes the whole sale in place. Their own resume preview, a
// "profile 100%" tick, and the two priced choices (MasterOfferChoices), each one
// tap from the bKash step. It is not a teaser that opens another explainer.
//
// Colours: a cream slab with an accent-400 frame. Every colour is a brand token
// and there is no gradient. The visual weight comes from the preview and the
// two big price buttons.
import React, { useEffect } from 'react';
import { Check } from 'lucide-react';
import type { PackageId } from '../../../infrastructure/api/purchaseClient';
import { useAuth } from '../../../infrastructure/auth/AuthContext';
import { useLocale, useT } from '../../i18n/LocaleContext';
import { track } from '../../../infrastructure/analytics/track';
import { sessionFlag, setSessionFlag } from './bannerSession';
import { MasterResumeMini, useMasterPreview } from './MasterResumePreview';
import { MasterOfferChoices } from './MasterOfferChoices';

const SEEN_KEY = 'tc.masterOfferBanner.seen';

interface Props {
  onChoose: (pkg: PackageId) => void;
}

export const MasterOfferBanner: React.FC<Props> = ({ onChoose }) => {
  const t = useT();
  const { locale } = useLocale();
  const { user } = useAuth();
  const preview = useMasterPreview(user?.id);
  const fallbackName = (user?.user_metadata?.full_name as string | undefined) ?? user?.email?.split('@')[0] ?? '';
  const eyebrowCase = locale === 'bn' ? '' : 'uppercase tracking-[0.12em]';

  // One "shown" per browser session, so the funnel counts people, not renders.
  useEffect(() => {
    if (sessionFlag(SEEN_KEY)) return;
    setSessionFlag(SEEN_KEY);
    track('master_offer_banner', { action: 'shown' });
  }, []);

  const choose = (pkg: PackageId) => {
    track('master_offer_banner', { action: 'choose', packageId: pkg });
    onChoose(pkg);
  };

  return (
    <section aria-labelledby="master-offer-banner-title">
      <div className="wb-enter relative overflow-hidden rounded-[22px] border-2 border-accent-400 bg-[#FFF7EF] p-[clamp(18px,3vw,30px)] shadow-[0_24px_48px_-24px_rgba(201,93,39,0.45)]">
        <div className="grid items-center gap-x-8 gap-y-5 md:grid-cols-[220px_1fr]">
          {/* Their resume, almost ready. Beside the copy on desktop, a small
              tilted card under the headline on a phone. */}
          <div className="order-2 mx-auto w-[min(210px,62vw)] md:order-1 md:w-full">
            <MasterResumeMini data={preview} fallbackName={fallbackName} className="mo-float h-[190px] md:h-[268px]" />
          </div>

          <div className="order-1 min-w-0 md:order-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600/10 px-2.5 py-1 text-[12px] font-bold text-emerald-700">
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-600 text-white">
                <Check size={10} strokeWidth={3.5} />
              </span>
              {t('masterOffer.progressLabel')} · 100%
            </span>
            <p className={`mt-3 text-[12px] font-bold text-accent-700 ${eyebrowCase}`}>{t('masterOffer.bannerEyebrow')}</p>
            <h2 id="master-offer-banner-title" className="mt-1 font-display text-[clamp(23px,3.4vw,32px)] font-semibold leading-[1.12] text-brand-700">
              {t('masterOffer.bannerTitle')}
            </h2>
            <p className="mt-2 max-w-[560px] text-[14.5px] leading-relaxed text-charcoal-600">{t('masterOffer.bannerBody')}</p>
            {/* Choices sit under the copy from md; on a phone they follow the
                preview (rendered again below in source order). */}
            <div className="mt-5 hidden md:block">
              <MasterOfferChoices onChoose={choose} layout="row" />
            </div>
          </div>

          <div className="order-3 md:hidden">
            <MasterOfferChoices onChoose={choose} />
          </div>
        </div>
      </div>
    </section>
  );
};
