// Shared relative-time formatter for the dashboard area (home grid, All
// Toolkits, ⌘K palette, purchase list). Mirrors the formatting that used to
// live inline in DashboardScreen so every surface reads dates identically.
import { useT } from '../../i18n/LocaleContext';

export function useRelativeTime() {
  const t = useT();
  return (iso?: string | null): string | null => {
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    const diffMs = Date.now() - d.getTime();
    const sec = Math.round(diffMs / 1000);
    if (sec < 60) return t('dashboard.relativeJustNow');
    const min = Math.round(sec / 60);
    if (min < 60) return t('dashboard.relativeMin', { n: min });
    const hr = Math.round(min / 60);
    if (hr < 24) return t('dashboard.relativeHr', { n: hr });
    const days = Math.round(hr / 24);
    if (days < 7) return t('dashboard.relativeDay', { n: days });
    return d.toLocaleDateString();
  };
}
