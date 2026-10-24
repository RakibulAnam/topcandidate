// The two ways to get the master resume, as two big tap targets. Shared by the
// offer sheet and the dashboard banner so both make the exact same offer.
//
// Each card IS the button — one tap lands on the bKash step with that package
// already chosen. The pair is built to be compared, not read:
//   * ৳50 alone (orange) is the low-friction "yes" for the thing they came for.
//   * ৳200 (ink, "Best value") is anchored against what it replaces: the
//     master resume (৳50) + 5 kits at ৳40 = ৳250, so the strike-through price
//     is real arithmetic, not an invented "was" price.
// Order: the ৳50 card first — it answers the click that opened this. The pack
// sits right under it as the obvious upgrade ("+৳150 → 5 job kits").
import React from 'react';
import { ArrowRight, FileText, Sparkles } from 'lucide-react';
import type { PackageId } from '../../../infrastructure/api/purchaseClient';
import { useT } from '../../i18n/LocaleContext';

interface Props {
  onChoose: (pkg: PackageId) => void;
  /** 'stack' in the sheet / on a phone; 'row' puts the cards side by side from xl. */
  layout?: 'stack' | 'row';
}

export const MasterOfferChoices: React.FC<Props> = ({ onChoose, layout = 'stack' }) => {
  const t = useT();
  return (
    <div className={`grid gap-3 ${layout === 'row' ? 'xl:grid-cols-2' : ''}`}>
      {/* Icons drop below sm: at 375px they cost the title a line. */}
      <button
        type="button"
        onClick={() => onChoose('master-resume')}
        className="mo-nudge group relative flex w-full items-center gap-3.5 rounded-2xl bg-accent-400 px-4 py-4 text-left text-brand-800 shadow-[0_14px_30px_-14px_rgba(201,93,39,0.75)] outline-none transition-colors hover:bg-accent-300 focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2"
      >
        <span className="hidden h-11 w-11 shrink-0 items-center justify-center sm:flex rounded-full bg-brand-700 text-accent-300">
          <FileText size={20} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15.5px] font-bold leading-snug">{t('masterOffer.soloTitle')}</span>
          <span className="mt-0.5 block text-[12.5px] leading-snug text-brand-800/80">{t('masterOffer.soloSub')}</span>
        </span>
        <span className="flex shrink-0 flex-col items-end">
          <span className="font-display text-[26px] font-bold leading-none">{t('masterOffer.soloPrice')}</span>
          <span className="mt-1 inline-flex items-center gap-0.5 text-[12px] font-bold">
            {t('masterOffer.soloCta')}
            <ArrowRight size={13} className="transition-transform group-hover:translate-x-0.5" />
          </span>
        </span>
      </button>

      <button
        type="button"
        onClick={() => onChoose('five-pack')}
        className="group relative flex w-full items-center gap-3.5 rounded-2xl bg-brand-700 px-4 pb-4 pt-5 text-left text-charcoal-50 outline-none transition-colors hover:bg-brand-800 focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2"
      >
        <span className="absolute -top-2.5 left-4 rounded-full bg-accent-400 px-2.5 py-0.5 text-[10.5px] font-extrabold uppercase tracking-[0.08em] text-brand-800">
          {t('masterOffer.packBadge')}
        </span>
        <span className="hidden h-11 w-11 shrink-0 items-center justify-center sm:flex rounded-full bg-white/10 text-accent-300">
          <Sparkles size={19} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15.5px] font-bold leading-snug">{t('masterOffer.packTitle')}</span>
          <span className="mt-0.5 block text-[12.5px] leading-snug text-charcoal-300">{t('masterOffer.packSub')}</span>
        </span>
        <span className="flex shrink-0 flex-col items-end">
          <span className="text-[12px] font-semibold text-charcoal-400 line-through decoration-accent-400 decoration-2">{t('masterOffer.packWas')}</span>
          <span className="font-display text-[26px] font-bold leading-none text-accent-300">{t('masterOffer.packPrice')}</span>
        </span>
      </button>
    </div>
  );
};
