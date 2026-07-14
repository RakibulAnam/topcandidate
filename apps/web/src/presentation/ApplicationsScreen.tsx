// ApplicationsScreen — the redesign's "All Toolkits" screen (route /applications).
// Rendered inside <DashboardShell>. Live filter is the existing server-side
// paginated search (ilike on title+company); pagination is kept for scale
// beyond the mockup's 12-card sample.
import React, { useEffect, useState } from 'react';
import { ArrowLeft, Plus, Search, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { useAuth } from '../infrastructure/auth/AuthContext';
import { createResumeService } from '../infrastructure/config/dependencies';
import type { ResumeListItem } from '../domain/repositories/IResumeRepository';
import { useT } from './i18n/LocaleContext';
import { ToolkitCard } from './components/dashboard/ToolkitCard';
import { useRelativeTime } from './components/dashboard/relativeTime';

interface Props {
  onOpenResume: (id: string) => void;
  onNewApplication: () => void;
  onBack: () => void;
}

const PAGE_SIZE = 12;

export const ApplicationsScreen = ({ onOpenResume, onNewApplication, onBack }: Props) => {
  const { user } = useAuth();
  const t = useT();
  const rel = useRelativeTime();

  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [items, setItems] = useState<ResumeListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [grandTotal, setGrandTotal] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  useEffect(() => {
    const h = setTimeout(() => { setDebounced(query.trim()); setPage(1); }, 300);
    return () => clearTimeout(h);
  }, [query]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setLoading(true);
    createResumeService()
      .getGeneratedResumesPaginated(user.id, { page, pageSize: PAGE_SIZE, search: debounced || undefined })
      .then(({ items, total }) => {
        if (cancelled) return;
        setItems(items);
        setTotal(total);
        if (!debounced) setGrandTotal(total); // remember the unfiltered total for the count label
      })
      .catch((err) => { if (!cancelled) console.warn('toolkits load failed', err); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, page, debounced]);

  const all = grandTotal ?? total;
  const countLabel = debounced
    ? t('dashboard.allToolkits.countFiltered', { n: total, total: all })
    : t('dashboard.allToolkits.countAll', { total: all });
  const subtitle = all === 1
    ? t('dashboard.allToolkits.subtitleOne', { count: all })
    : t('dashboard.allToolkits.subtitleMany', { count: all });

  return (
    <div>
      <a
        href="#"
        onClick={(e) => { e.preventDefault(); onBack(); }}
        className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-semibold text-charcoal-500 transition-colors hover:text-accent-600"
      >
        <ArrowLeft size={14} /> {t('dashboard.allToolkits.backToHome')}
      </a>

      <div className="mb-7 flex flex-wrap items-end gap-x-6 gap-y-4">
        <div className="flex-[1_1_320px]">
          <h1 className="font-display text-[clamp(28px,4.5vw,36px)] font-semibold leading-[1.1] text-brand-700">{t('dashboard.allToolkits.title')}</h1>
          <p className="mt-2 text-[14.5px] text-charcoal-500">{subtitle}</p>
        </div>
        <button
          type="button"
          onClick={onNewApplication}
          className="inline-flex items-center gap-2 rounded-xl bg-accent-400 px-[22px] py-3 text-sm font-bold text-brand-800 transition-colors hover:bg-accent-300"
        >
          <Plus size={14} /> {t('dashboard.allToolkits.newApplication')}
        </button>
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="flex max-w-[380px] flex-[1_1_260px] items-center gap-2 rounded-[10px] border border-charcoal-300 bg-white px-3 py-2.5 shadow-[0_1px_2px_rgba(25,23,18,0.03)]">
          <Search size={14} className="text-charcoal-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('dashboard.allToolkits.filterPlaceholder')}
            className="min-w-0 flex-1 border-none bg-transparent text-[13.5px] text-brand-700 outline-none placeholder:text-charcoal-400"
          />
        </div>
        <div className="flex-1" />
        <span className="text-[13px] text-charcoal-500">{countLabel}</span>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="animate-spin text-brand-600" size={28} /></div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-charcoal-300 px-6 py-16 text-center">
          <div className="mb-1.5 font-display text-[19px] font-semibold text-brand-700">
            {t('dashboard.allToolkits.emptyTitle', { query: debounced })}
          </div>
          <div className="text-[13.5px] text-charcoal-500">{t('dashboard.allToolkits.emptyBody')}</div>
        </div>
      ) : (
        <>
          <div className="grid gap-5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
            {items.map((item) => (
              <ToolkitCard
                key={item.id}
                item={item}
                builtLabel={t('dashboard.builtOn', { when: rel(item.updatedAt ?? item.date) ?? '' })}
                onOpen={onOpenResume}
              />
            ))}
          </div>

          {totalPages > 1 && (
            <div className="mt-6 flex items-center justify-center gap-1">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                aria-label={t('dashboard.appsPrevPage')}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-charcoal-200 text-charcoal-600 transition-colors hover:border-brand-700 hover:text-brand-700 disabled:opacity-40"
              >
                <ChevronLeft size={16} />
              </button>
              <span className="px-3 text-xs text-charcoal-500">
                {t('dashboard.appsPageRange', { from: (page - 1) * PAGE_SIZE + 1, to: Math.min(page * PAGE_SIZE, total), total })}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                aria-label={t('dashboard.appsNextPage')}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-charcoal-200 text-charcoal-600 transition-colors hover:border-brand-700 hover:text-brand-700 disabled:opacity-40"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};
