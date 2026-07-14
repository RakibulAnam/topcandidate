// PurchaseHistoryScreen — the redesign's full-screen purchase history
// (route /purchases), rendered inside <DashboardShell>. Three stat cards +
// a month-grouped payment list. Reuses the existing purchaseHistory.* status
// labels and the shared credits balance from the shell.
import React, { useEffect, useState } from 'react';
import { ArrowLeft, Plus, CreditCard, Loader2 } from 'lucide-react';
import { useAuth } from '../infrastructure/auth/AuthContext';
import { purchaseRepository } from '../infrastructure/config/dependencies';
import type { Purchase, PurchaseStatus } from '../domain/repositories/IPurchaseRepository';
import { useT, useLocale } from './i18n/LocaleContext';
import { useDashboardShell } from './components/dashboard/DashboardShell';

interface Props {
  onBack: () => void;
}

const STATUS_STYLE: Record<PurchaseStatus, string> = {
  completed: 'bg-emerald-50 text-emerald-700',
  pending: 'bg-charcoal-100 text-charcoal-600',
  underpaid: 'bg-accent-50 text-accent-700',
  msisdn_mismatch_review: 'bg-accent-50 text-accent-700',
  expired: 'bg-red-50 text-red-600',
  refunded: 'bg-red-50 text-red-600',
  failed: 'bg-red-50 text-red-600',
};

const STATUS_KEY: Record<PurchaseStatus, string> = {
  completed: 'purchaseHistory.statusCompleted',
  pending: 'purchaseHistory.statusPending',
  underpaid: 'purchaseHistory.statusUnderpaid',
  msisdn_mismatch_review: 'purchaseHistory.statusReview',
  expired: 'purchaseHistory.statusExpired',
  refunded: 'purchaseHistory.statusRefunded',
  failed: 'purchaseHistory.statusFailed',
};

export const PurchaseHistoryScreen = ({ onBack }: Props) => {
  const { user } = useAuth();
  const t = useT();
  const { locale } = useLocale();
  const { credits, openPurchase } = useDashboardShell();

  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [loading, setLoading] = useState(true);

  const dateLocale = locale === 'bn' ? 'bn-BD' : 'en-US';

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setLoading(true);
    purchaseRepository.listMyPurchases(100)
      .then((ps) => { if (!cancelled) setPurchases(ps); })
      .catch((err) => { if (!cancelled) console.warn('purchases load failed', err); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const completed = purchases.filter((p) => p.status === 'completed');
  const creditsBought = completed.reduce((s, p) => s + p.creditsGranted, 0);
  const totalSpent = completed.reduce((s, p) => s + p.amountTaka, 0);
  const last = completed[0]; // list is newest-first

  // Group by calendar month, preserving the newest-first order.
  const groups: Array<{ label: string; rows: Purchase[] }> = [];
  const index = new Map<string, number>();
  for (const p of purchases) {
    const d = new Date(p.createdAt);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    if (!index.has(key)) {
      index.set(key, groups.length);
      groups.push({ label: d.toLocaleDateString(dateLocale, { month: 'long', year: 'numeric' }), rows: [] });
    }
    groups[index.get(key)!].rows.push(p);
  }

  const StatCard = ({ eyebrow, value, note }: { eyebrow: string; value: string; note: string }) => (
    <div className="flex-[1_1_180px] rounded-2xl border border-charcoal-200 bg-white px-[22px] py-[18px] shadow-[0_2px_6px_rgba(25,23,18,0.04)]">
      <div className="mb-2 text-xs font-bold uppercase tracking-[0.08em] text-charcoal-500">{eyebrow}</div>
      <div className="flex items-baseline gap-1.5">
        <span className="font-display text-[26px] font-bold text-brand-700">{value}</span>
        <span className="text-[12.5px] text-charcoal-500">{note}</span>
      </div>
    </div>
  );

  return (
    <div>
      <a
        href="#"
        onClick={(e) => { e.preventDefault(); onBack(); }}
        className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-semibold text-charcoal-500 transition-colors hover:text-accent-600"
      >
        <ArrowLeft size={14} /> {t('purchaseHistory.backToHome')}
      </a>

      <div className="mb-7 flex flex-wrap items-end gap-x-6 gap-y-4">
        <div className="flex-[1_1_320px]">
          <h1 className="font-display text-[clamp(28px,4.5vw,36px)] font-semibold leading-[1.1] text-brand-700">{t('purchaseHistory.title')}</h1>
          <p className="mt-2 text-[14.5px] text-charcoal-500">{t('purchaseHistory.subtitle')}</p>
        </div>
        <button
          type="button"
          onClick={openPurchase}
          className="inline-flex items-center gap-2 rounded-xl bg-accent-400 px-[22px] py-3 text-sm font-bold text-brand-800 transition-colors hover:bg-accent-300"
        >
          <Plus size={14} /> {t('purchaseHistory.topUpCta')}
        </button>
      </div>

      {/* Stat cards */}
      <div className="mb-7 flex flex-wrap gap-4">
        <StatCard eyebrow={t('purchaseHistory.statCreditsLeft')} value={String(credits ?? 0)} note={t('purchaseHistory.statCreditsLeftNote', { total: creditsBought })} />
        <StatCard eyebrow={t('purchaseHistory.statTotalSpent')} value={`৳${totalSpent.toLocaleString()}`} note={completed.length === 1 ? t('purchaseHistory.statTotalSpentNoteOne', { n: completed.length }) : t('purchaseHistory.statTotalSpentNote', { n: completed.length })} />
        <StatCard
          eyebrow={t('purchaseHistory.statLastTopUp')}
          value={last ? new Date(last.createdAt).toLocaleDateString(dateLocale, { day: '2-digit', month: '2-digit' }) : t('purchaseHistory.statNone')}
          note={last ? t('purchaseHistory.statLastTopUpNote', { credits: last.creditsGranted }) : ''}
        />
      </div>

      {/* Payment list */}
      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="animate-spin text-brand-600" size={28} /></div>
      ) : purchases.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-charcoal-300 px-6 py-16 text-center text-sm text-charcoal-500">
          {t('purchaseHistory.empty')}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-charcoal-200 bg-white shadow-[0_2px_6px_rgba(25,23,18,0.04)]">
          {groups.map((g) => (
            <div key={g.label}>
              <div className="border-b border-charcoal-100 bg-charcoal-50 px-[22px] pb-2 pt-3 text-[11.5px] font-bold uppercase tracking-[0.07em] text-charcoal-400">
                {g.label}
              </div>
              {g.rows.map((p) => (
                <div key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-charcoal-100 px-[22px] py-[15px] last:border-b-0">
                  <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[10px] bg-accent-50">
                    <CreditCard size={16} className="text-accent-600" />
                  </span>
                  <span className="min-w-0 flex-[1_1_200px]">
                    <span className="block text-[14.5px] font-semibold text-brand-700">
                      {t('purchaseHistory.creditsLine', { credits: p.creditsGranted, amount: p.amountTaka.toLocaleString() })}
                      {p.observedAmountTaka != null && p.observedAmountTaka !== p.amountTaka && (
                        <span className="font-normal text-charcoal-500"> {t('purchaseHistory.observedAmount', { observed: p.observedAmountTaka })}</span>
                      )}
                    </span>
                    <span className="mt-0.5 block text-[12px] text-charcoal-400">
                      {new Date(p.createdAt).toLocaleDateString(dateLocale)}
                      {p.paymentReference && <> · <span className="font-mono text-[11.5px]">{p.paymentReference}</span></>}
                    </span>
                  </span>
                  <span className={`whitespace-nowrap rounded-full px-[11px] py-1 text-[12px] font-semibold ${STATUS_STYLE[p.status]}`}>
                    {t(STATUS_KEY[p.status] as any)}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
