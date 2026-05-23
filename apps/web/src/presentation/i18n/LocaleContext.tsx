// Locale context for TOP CANDIDATE.
//
// Two locales: 'en' (English, default) and 'bn' (Bengali / বাংলা).
//
// Switching locale only mutates this context — every other piece of state
// (form data, current builder step, scroll position) is React component
// state, untouched by a locale change. So users never lose progress when
// they toggle.
//
// The locale is read synchronously from localStorage before the first paint
// so the UI does not flash English on a Bengali browser.

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { en, type Dictionary } from './locales/en';
import { bn } from './locales/bn';

export type Locale = 'en' | 'bn';

const STORAGE_KEY = 'topcandidate.locale';

const DICTIONARIES: Record<Locale, Dictionary> = { en, bn };

const detectInitialLocale = (): Locale => {
  if (typeof window === 'undefined') return 'en';
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'en' || stored === 'bn') return stored;
  } catch {
    // localStorage unavailable (private mode, SSR, etc.)
  }
  const browser = (typeof navigator !== 'undefined' ? navigator.language : '') || '';
  if (browser.toLowerCase().startsWith('bn')) return 'bn';
  return 'en';
};

// Path-into-the-dict type. Keeps t('navbar.exitBuilder') autocomplete-friendly.
type DotPaths<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string
    ? `${P}${K}`
    : T[K] extends Record<string, unknown>
      ? DotPaths<T[K], `${P}${K}.`>
      : never;
}[keyof T & string];

export type TKey = DotPaths<Dictionary>;

const lookup = (dict: Dictionary, key: string): string => {
  const parts = key.split('.');
  let cursor: unknown = dict;
  for (const part of parts) {
    if (cursor && typeof cursor === 'object' && part in (cursor as Record<string, unknown>)) {
      cursor = (cursor as Record<string, unknown>)[part];
    } else {
      return key; // dev signal — string shows up as the raw key
    }
  }
  return typeof cursor === 'string' ? cursor : key;
};

const interpolate = (template: string, vars?: Record<string, string | number>): string => {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name) => {
    const value = vars[name];
    return value === undefined || value === null ? match : String(value);
  });
};

interface LocaleContextValue {
  locale: Locale;
  setLocale: (next: Locale) => void;
  t: (key: TKey, vars?: Record<string, string | number>) => string;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

// Initial sync application before React mounts so the very first paint is
// already in the right font / direction. Idempotent.
const applyHtmlLocaleAttr = (locale: Locale) => {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-locale', locale);
  document.documentElement.setAttribute('lang', locale === 'bn' ? 'bn' : 'en');
};

if (typeof document !== 'undefined') {
  applyHtmlLocaleAttr(detectInitialLocale());
}

export const LocaleProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [locale, setLocaleState] = useState<Locale>(detectInitialLocale);

  useEffect(() => {
    applyHtmlLocaleAttr(locale);
    try {
      window.localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      // ignore — best-effort persistence
    }
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
  }, []);

  const t = useCallback(
    (key: TKey, vars?: Record<string, string | number>) => {
      const dict = DICTIONARIES[locale];
      const raw = lookup(dict, key);
      // Fallback to English if the Bengali entry is somehow missing the key
      // (defensive — TypeScript should already prevent this).
      const safe = raw === key && locale !== 'en' ? lookup(en, key) : raw;
      return interpolate(safe, vars);
    },
    [locale],
  );

  const value = useMemo<LocaleContextValue>(
    () => ({ locale, setLocale, t }),
    [locale, setLocale, t],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
};

export const useLocale = (): LocaleContextValue => {
  const ctx = useContext(LocaleContext);
  if (!ctx) {
    throw new Error('useLocale must be called inside <LocaleProvider>');
  }
  return ctx;
};

// Sugar: most call sites only need `t`.
export const useT = () => useLocale().t;
