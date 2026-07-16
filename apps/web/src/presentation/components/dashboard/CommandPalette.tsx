// CommandPalette — customer-facing ⌘K search over the user's tailored toolkits.
//
// Opened from the top-bar search field/icon or ⌘K/Ctrl+K (the global keydown
// lives in DashboardShell). Searches company+role via the existing server-side
// paginated search (ilike on title+company; the General/"master" resume is
// already excluded by getGeneratedResumesPaginated). Keyboard: ↑/↓ move, ↵
// opens, Esc closes.
import React, { useEffect, useRef, useState } from 'react';
import { Search, ChevronRight, X } from 'lucide-react';
import { useT } from '../../i18n/LocaleContext';
import { useRelativeTime } from './relativeTime';
import { monogramOf, roleFromTitle } from './ToolkitCard';
import type { ResumeService } from '../../../application/services/ResumeService';
import type { ResumeListItem } from '../../../domain/repositories/IResumeRepository';

interface Props {
  open: boolean;
  onClose: () => void;
  resumeService: ResumeService | null;
  userId: string | null;
  onOpenResume: (id: string) => void;
  onStartNew: () => void;
}

const RESULT_CAP = 6;

export const CommandPalette: React.FC<Props> = ({ open, onClose, resumeService, userId, onOpenResume, onStartNew }) => {
  const t = useT();
  const rel = useRelativeTime();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ResumeListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  // Visible-viewport height. On mobile the soft keyboard shrinks the visual
  // viewport (not the layout viewport), so we size the sheet to it — the input
  // stays put at the top and the results scroll in the space above the keyboard
  // instead of hiding behind it.
  const [vvh, setVvh] = useState<number | null>(null);

  // Reset + focus when opened.
  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      // Autofocus after paint.
      const id = window.setTimeout(() => inputRef.current?.focus(), 20);
      return () => window.clearTimeout(id);
    }
  }, [open]);

  // Track the visual viewport while open (keyboard show/hide, rotate).
  useEffect(() => {
    if (!open) return;
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setVvh(vv.height);
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, [open]);

  // Debounced search whenever the query changes while open.
  useEffect(() => {
    if (!open || !resumeService || !userId) return;
    let cancelled = false;
    const handle = window.setTimeout(() => {
      resumeService
        .getGeneratedResumesPaginated(userId, { page: 1, pageSize: RESULT_CAP, search: query.trim() || undefined })
        .then(({ items, total }) => {
          if (cancelled) return;
          setResults(items);
          setTotal(total);
          setActive(0);
        })
        .catch((err) => { if (!cancelled) console.warn('palette search failed', err); });
    }, 200);
    return () => { cancelled = true; window.clearTimeout(handle); };
  }, [open, query, resumeService, userId]);

  if (!open) return null;

  const countLabel = query.trim()
    ? t('dashboard.search.countFiltered', { n: results.length, total })
    : t('dashboard.search.countAll', { total });

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(results.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const chosen = results[active];
      if (chosen) { onOpenResume(chosen.id); onClose(); }
    }
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-x-0 top-0 z-[100] flex items-stretch justify-center bg-[rgba(25,23,18,0.4)] backdrop-blur-[4px] sm:items-start sm:px-4 sm:pt-[12vh]"
      style={{ height: vvh ? `${vvh}px` : '100dvh' }}
      role="dialog"
      aria-modal="true"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        className="flex h-full w-full flex-col overflow-hidden bg-white shadow-[0_32px_80px_-16px_rgba(25,23,18,0.45)] sm:h-auto sm:max-h-[76vh] sm:max-w-[620px] sm:rounded-[18px]"
      >
        {/* Input row */}
        <div className="flex items-center gap-3 border-b border-charcoal-100 px-5 py-4">
          <Search size={17} className="shrink-0 text-accent-600" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('dashboard.search.placeholder')}
            className="min-w-0 flex-1 border-none bg-transparent text-base text-brand-700 outline-none placeholder:text-charcoal-400"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label={t('dashboard.search.close')}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-charcoal-400 transition-colors hover:bg-charcoal-100 hover:text-charcoal-600"
          >
            <X size={18} />
          </button>
        </div>

        {results.length > 0 ? (
          <div className="flex-1 overflow-y-auto p-2 sm:max-h-[46vh] sm:flex-none">
            <div className="px-3 pt-2.5 pb-1.5 text-[11.5px] font-bold uppercase tracking-[0.07em] text-charcoal-400">
              {countLabel}
            </div>
            {results.map((r, i) => (
              <a
                key={r.id}
                href="#"
                onMouseEnter={() => setActive(i)}
                onClick={(e) => { e.preventDefault(); onOpenResume(r.id); onClose(); }}
                className={`flex items-center gap-3 rounded-[10px] px-3 py-2.5 text-brand-700 transition-colors ${i === active ? 'bg-accent-50' : ''}`}
              >
                <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[9px] bg-charcoal-100 font-display text-sm font-bold text-charcoal-500">
                  {monogramOf(r)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{r.company || roleFromTitle(r.title, t('dashboard.untitledRole'))}</span>
                  <span className="mt-px block truncate text-[12.5px] text-charcoal-500">{roleFromTitle(r.title, t('dashboard.untitledRole'))}</span>
                </span>
                <span className="whitespace-nowrap text-[12px] text-charcoal-400">
                  {t('dashboard.search.built', { when: rel(r.updatedAt ?? r.date) ?? '' })}
                </span>
                <ChevronRight size={14} className="text-charcoal-400" />
              </a>
            ))}
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-6 py-10 text-center sm:flex-none">
            <div className="mb-1 font-display text-[17px] font-semibold text-brand-700">
              {t('dashboard.search.emptyTitle', { query: query.trim() })}
            </div>
            <div className="mb-4 text-[13px] text-charcoal-500">{t('dashboard.search.emptyBody')}</div>
            <button
              type="button"
              onClick={() => { onClose(); onStartNew(); }}
              className="rounded-[10px] bg-accent-400 px-5 py-2.5 text-[13.5px] font-bold text-brand-800 transition-colors hover:bg-accent-300"
            >
              {t('dashboard.search.emptyCta')}
            </button>
          </div>
        )}

        {/* Footer hints — keyboard shortcuts only make sense with a keyboard. */}
        <div className="hidden items-center gap-3.5 border-t border-charcoal-100 bg-charcoal-50 px-5 py-2.5 text-[11.5px] text-charcoal-400 sm:flex">
          <span className="whitespace-nowrap"><strong className="text-charcoal-500">↑↓</strong> {t('dashboard.search.hintNav')}</span>
          <span className="whitespace-nowrap"><strong className="text-charcoal-500">↵</strong> {t('dashboard.search.hintOpen')}</span>
          <span className="whitespace-nowrap"><strong className="text-charcoal-500">esc</strong> {t('dashboard.search.hintClose')}</span>
          <span className="flex-1" />
          <span>{countLabel}</span>
        </div>
      </div>
    </div>
  );
};
