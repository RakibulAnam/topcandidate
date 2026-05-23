import React from 'react';
import { useLocale, type Locale } from './LocaleContext';

interface LanguageToggleProps {
  // Visual variant for placement on dark / cream / inside-card surfaces.
  // Default = 'pill' (used in Navbar).
  variant?: 'pill' | 'compact';
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

  const padding = variant === 'compact' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs';
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
