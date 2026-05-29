// PurchaseHistorySection — read-only list of the user's bKash purchases.
//
// Rendered at the bottom of the dashboard. RLS lets the user see their own
// rows only; we don't expose anything privileged here. Reads go through
// `purchaseRepository` (Clean Architecture: presentation never imports
// the Supabase client directly).
//
// Status badge colors follow the project palette — no blue/indigo/purple:
//   completed              → emerald (positive terminal)
//   pending                → charcoal (neutral, in-flight)
//   underpaid              → accent/saffron (needs review)
//   msisdn_mismatch_review → accent/saffron
//   expired                → red
//   refunded               → red
//   failed                 → red

import React, { useEffect, useState } from 'react';
import { purchaseRepository } from '../../infrastructure/config/dependencies';
import type { Purchase } from '../../domain/repositories/IPurchaseRepository';
import { useT } from '../i18n/LocaleContext';

type T = ReturnType<typeof useT>;

function statusLabel(t: T, status: string): string {
  switch (status) {
    case 'pending': return t('purchaseHistory.statusPending');
    case 'completed': return t('purchaseHistory.statusCompleted');
    case 'underpaid': return t('purchaseHistory.statusUnderpaid');
    case 'msisdn_mismatch_review': return t('purchaseHistory.statusReview');
    case 'expired': return t('purchaseHistory.statusExpired');
    case 'refunded': return t('purchaseHistory.statusRefunded');
    case 'failed': return t('purchaseHistory.statusFailed');
    default: return status;
  }
}

const STATUS_BADGE: Record<string, string> = {
  completed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  pending: 'bg-charcoal-100 text-brand-700 border-charcoal-300',
  underpaid: 'bg-accent-50 text-brand-700 border-accent-200',
  msisdn_mismatch_review: 'bg-accent-50 text-brand-700 border-accent-200',
  expired: 'bg-red-50 text-red-700 border-red-200',
  refunded: 'bg-red-50 text-red-700 border-red-200',
  failed: 'bg-red-50 text-red-700 border-red-200',
};

export const PurchaseHistorySection: React.FC = () => {
  const t = useT();
  const [rows, setRows] = useState<Purchase[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    purchaseRepository.listMyPurchases(20)
      .then((data) => { if (!cancelled) setRows(data); })
      .catch((err) => {
        // Don't surface to the user — the dashboard is fine without this
        // section. Log so we can debug if anyone reports a missing list.
        console.warn('[purchase-history] failed to load:', err);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading) return null;
  if (rows.length === 0) return null;

  return (
    <section className="mt-12">
      <h2 className="font-display text-xl font-semibold text-brand-700 mb-3">
        {t('purchaseHistory.title')}
      </h2>
      <div className="bg-white rounded-2xl border border-charcoal-200 overflow-hidden">
        <table className="min-w-full text-sm">
          <thead className="bg-charcoal-50 text-[11px] uppercase tracking-[0.18em] text-charcoal-500 font-bold">
            <tr>
              <th className="px-4 py-2.5 text-left">{t('purchaseHistory.colDate')}</th>
              <th className="px-4 py-2.5 text-left">{t('purchaseHistory.colTxn')}</th>
              <th className="px-4 py-2.5 text-right">{t('purchaseHistory.colAmount')}</th>
              <th className="px-4 py-2.5 text-right">{t('purchaseHistory.colCredits')}</th>
              <th className="px-4 py-2.5 text-left">{t('purchaseHistory.colStatus')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-charcoal-100">
                <td className="px-4 py-2.5 text-charcoal-600 whitespace-nowrap">
                  {new Date(r.createdAt).toLocaleDateString()}
                </td>
                <td className="px-4 py-2.5 font-mono text-[12px] text-brand-700">
                  {r.paymentReference ?? '—'}
                </td>
                <td className="px-4 py-2.5 text-right text-brand-700 tabular-nums">
                  ৳{r.amountTaka}
                  {r.observedAmountTaka != null && r.observedAmountTaka !== r.amountTaka && (
                    <span className="ml-1 text-[11px] text-charcoal-500">
                      {t('purchaseHistory.observedAmount', { observed: r.observedAmountTaka })}
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-right text-brand-700 tabular-nums">
                  {r.status === 'completed' ? `+${r.creditsGranted}` : '—'}
                </td>
                <td className="px-4 py-2.5">
                  <span className={[
                    'inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border',
                    STATUS_BADGE[r.status] ?? 'bg-charcoal-100 text-brand-700 border-charcoal-300',
                  ].join(' ')}>
                    {statusLabel(t, r.status)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
};
