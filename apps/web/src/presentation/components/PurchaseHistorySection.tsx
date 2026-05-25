// PurchaseHistorySection — read-only list of the user's bKash purchases.
//
// Rendered at the bottom of the dashboard. RLS lets the user see their own
// rows only; we don't expose anything privileged here.
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
import { supabase } from '../../infrastructure/supabase/client';
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

interface PurchaseRow {
  id: string;
  payment_reference: string | null;
  amount_taka: number;
  observed_amount_taka: number | null;
  credits_granted: number;
  status: string;
  created_at: string;
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
  const [rows, setRows] = useState<PurchaseRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('purchases')
        .select('id, payment_reference, amount_taka, observed_amount_taka, credits_granted, status, created_at')
        .order('created_at', { ascending: false })
        .limit(20);
      if (!cancelled) {
        if (!error) setRows((data ?? []) as PurchaseRow[]);
        setLoading(false);
      }
    })();
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
                  {new Date(r.created_at).toLocaleDateString()}
                </td>
                <td className="px-4 py-2.5 font-mono text-[12px] text-brand-700">
                  {r.payment_reference ?? '—'}
                </td>
                <td className="px-4 py-2.5 text-right text-brand-700 tabular-nums">
                  ৳{r.amount_taka}
                  {r.observed_amount_taka != null && r.observed_amount_taka !== r.amount_taka && (
                    <span className="ml-1 text-[11px] text-charcoal-500">
                      {t('purchaseHistory.observedAmount', { observed: r.observed_amount_taka })}
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-right text-brand-700 tabular-nums">
                  {r.status === 'completed' ? `+${r.credits_granted}` : '—'}
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
