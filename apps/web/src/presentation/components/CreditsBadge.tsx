// CreditsBadge — compact navbar pill showing toolkit-credit balance.
//
// Three visual states:
//   - null  → render nothing (still loading; don't flash a stale 0)
//   - > 0   → quiet "✨ N" pill in charcoal/ink, click opens PurchaseModal
//   - = 0   → saffron "✨ Buy generations" CTA, click opens PurchaseModal
//
// Stateless — receives credits + onBuy from the host screen, which is
// responsible for the PurchaseModal itself. Keeps the badge composable across
// the dashboard's custom header and the shared Navbar component.

import React from 'react';
import { Sparkles } from 'lucide-react';
import { useT } from '../i18n/LocaleContext';

interface Props {
  credits: number | null;
  onBuy: () => void;
}

export const CreditsBadge: React.FC<Props> = ({ credits, onBuy }) => {
  const t = useT();

  if (credits === null) return null;

  if (credits === 0) {
    return (
      <button
        type="button"
        onClick={onBuy}
        title={t('navbar.creditsExhaustedTooltip')}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-accent-400 border border-accent-500 text-brand-800 text-xs font-semibold hover:bg-accent-300 transition-colors"
      >
        <Sparkles size={13} />
        <span>{t('navbar.creditsExhaustedShort')}</span>
      </button>
    );
  }

  const tooltip = credits === 1
    ? t('navbar.creditsTooltipOne')
    : t('navbar.creditsTooltip', { count: credits });

  return (
    <button
      type="button"
      onClick={onBuy}
      title={tooltip}
      aria-label={tooltip}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-charcoal-50 border border-charcoal-200 text-brand-700 text-xs font-semibold hover:border-accent-400 hover:bg-accent-50 transition-colors"
    >
      <Sparkles size={13} className="text-accent-500" />
      <span className="tabular-nums">{credits}</span>
    </button>
  );
};
