import React from 'react';
import { Globe } from 'lucide-react';
import { useLocale, type Locale } from './LocaleContext';

interface LanguageToggleProps {
  // Visual variant for placement on dark / cream / inside-card surfaces.
  // Default = 'pill' (used in Navbar). 'mini' = a single space-saving button
  // (globe + the other language) for tight mobile bars; tapping switches.
  variant?: 'pill' | 'compact' | 'mini';
  className?: string;
}

const OPTIONS: Array<{ value: Locale; short: string; full: string }> = [
  { value: 'en', short: 'EN', full: 'English' },
  { value: 'bn', short: 'বাং', full: 'বাংলা' },
];

export const LanguageToggle: React.FC<LanguageToggleProps> = ({
  variant = 'pill',
  className = '',
}) => {
  const { locale, setLocale, t } = useLocale();

  // 'mini' — one compact button showing the OTHER language (tap to switch).
  // Keeps the language control visible in tight mobile bars without the width
  // of the two-segment pill.
  if (variant === 'mini') {
    const other = OPTIONS.find((o) => o.value !== locale)!;
    return (
      <button
        type="button"
        onClick={() => setLocale(other.value)}
        aria-label={locale === 'bn' ? t('languageToggle.switchToEnglish') : t('languageToggle.switchToBengali')}
        title={other.full}
        className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border border-charcoal-200 bg-charcoal-100 px-2.5 py-1.5 text-xs font-semibold text-charcoal-600 transition-colors hover:text-brand-700 ${className}`}
      >
        <Globe size={13} className="text-charcoal-500" />
        {other.short}
      </button>
    );
  }

  // Comfortable touch targets on phones; stays compact on desktop.
  const padding = variant === 'compact' ? 'px-2.5 py-1.5 text-xs' : 'px-3 py-2 text-xs sm:py-1.5';
  const radius = 'rounded-full';

  return (
    <div
      role="group"
      aria-label={locale === 'bn' ? t('languageToggle.switchToEnglish') : t('languageToggle.switchToBengali')}
      className={`inline-flex items-center gap-0.5 ${radius} bg-charcoal-100 border border-charcoal-200 p-0.5 ${className}`}
    >
      {OPTIONS.map((opt) => {
        const active = locale === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => setLocale(opt.value)}
            aria-pressed={active}
            aria-label={opt.full}
            title={opt.full}
            className={`${padding} ${radius} font-semibold tracking-wide transition-colors ${
              active
                ? 'bg-brand-700 text-charcoal-50 shadow-sm'
                : 'text-charcoal-600 hover:text-brand-700 hover:bg-white'
            }`}
          >
            {opt.short}
          </button>
        );
      })}
    </div>
  );
};
