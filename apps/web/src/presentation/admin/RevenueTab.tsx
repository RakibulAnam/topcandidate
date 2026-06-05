// Revenue analytics — gross/net/refunds, daily revenue series, status breakdown,
// and outstanding credit liability. Range-scoped (Day/Week/Month/All) with a
// Refresh button and a CSV export. Fetches on mount + on range change + Refresh.

import React, { useCallback, useEffect, useState } from 'react';
import type { AdminApi } from './adminApi';
import { taka } from './adminApi';
import {
  Button, Card, ContentGrid, ErrorState, PageHeader, Section, Skeleton, focusRing, withToast,
} from './ui';
import { KpiCard, TimeSeriesChart, HBarChart } from './charts';

type Range = 'day' | 'week' | 'month' | 'all';
const RANGE_SHORT: Record<Range, string> = { day: 'Day', week: 'Week', month: 'Month', all: 'All' };

interface RevenueData {
  range: Range;
  totals: { grossTaka: number; refundsTaka: number; netTaka: number; orders: number; creditsSold: number; payingUsers: number; aovTaka: number; arppuTaka: number };
  rates: { refundRatePct: number; failureRatePct: number };
  statusBreakdown: { status: string; count: number; taka: number }[];
  dailyRevenue: { day: string; revenue_taka: number; orders: number }[];
  creditLiability: { outstandingCredits: number; liabilityTaka: number; negativeBalanceUsers: number };
}

export const RevenueTab: React.FC<{ api: AdminApi }> = ({ api }) => {
  const [range, setRange] = useState<Range>('month');
  const [data, setData] = useState<RevenueData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    setErr(null);
    api.call<RevenueData>('revenue-analytics', { query: { range } })
      .then(setData)
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [api, range]);

  useEffect(() => { refresh(); }, [refresh]);

  const exportCsv = () =>
    void withToast(api.download('revenue-export', { range }), { success: 'Export started.' });

  return (
    <div>
      <PageHeader
        eyebrow="Analytics"
        title="Revenue"
        description="Gross, net, refunds, daily trend, and outstanding credit liability — scoped by period."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={exportCsv}>Export CSV</Button>
            <Button variant="secondary" size="sm" onClick={refresh}>Refresh</Button>
          </div>
        }
      />

      <Section title="Summary" actions={<RangeToggle value={range} onChange={setRange} />}>
        {err ? <ErrorState error={err} onRetry={refresh} /> : !data ? (
          <ContentGrid cols={3}>{Array.from({ length: 6 }).map((_, i) => <Card key={i}><Skeleton className="h-16 w-full" /></Card>)}</ContentGrid>
        ) : (
          <ContentGrid cols={3}>
            <KpiCard label="Net revenue" value={taka(data.totals.netTaka)} tone="brand" sub={`${data.totals.orders} order${data.totals.orders === 1 ? '' : 's'}`} />
            <KpiCard label="Gross revenue" value={taka(data.totals.grossTaka)} sub={`Refunds ${taka(data.totals.refundsTaka)}`} />
            <KpiCard label="Orders" value={String(data.totals.orders)} sub={`${data.totals.creditsSold} credits sold`} />
            <KpiCard label="AOV" value={taka(data.totals.aovTaka)} sub="avg order value" />
            <KpiCard label="ARPPU" value={taka(data.totals.arppuTaka)} sub={`${data.totals.payingUsers} paying user${data.totals.payingUsers === 1 ? '' : 's'}`} />
            <KpiCard label="Refund rate" value={`${data.rates.refundRatePct.toFixed(1)}%`} tone={data.rates.refundRatePct > 0 ? 'warn' : 'neutral'} sub={`Failures ${data.rates.failureRatePct.toFixed(1)}%`} />
          </ContentGrid>
        )}
      </Section>

      <div className="mt-6">
        <Section title="Daily revenue">
          <Card>
            {data ? (
              <TimeSeriesChart data={data.dailyRevenue.map((d) => ({ day: d.day, value: d.revenue_taka }))} formatValue={taka} />
            ) : <Skeleton className="h-48 w-full" />}
          </Card>
        </Section>
      </div>

      <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Section title="By status">
          <Card>
            {data ? (
              <HBarChart
                data={data.statusBreakdown.map((s) => ({ label: s.status, value: s.count, sub: taka(s.taka) }))}
                formatValue={(n) => String(n)}
              />
            ) : <Skeleton className="h-32 w-full" />}
          </Card>
        </Section>

        <Section title="Credit liability">
          <Card>
            {data ? (
              <div className="space-y-3">
                <div>
                  <div className="text-[10.5px] uppercase tracking-[0.18em] text-charcoal-500 font-bold">Outstanding liability</div>
                  <div className="mt-1 font-display text-3xl font-semibold text-brand-700 leading-none tabular-nums">{taka(data.creditLiability.liabilityTaka)}</div>
                  <div className="mt-2 text-[12px] text-charcoal-500">{data.creditLiability.outstandingCredits.toLocaleString()} unredeemed credits × ৳40</div>
                </div>
                {data.creditLiability.negativeBalanceUsers > 0 && (
                  <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700 font-semibold">
                    {data.creditLiability.negativeBalanceUsers} user{data.creditLiability.negativeBalanceUsers === 1 ? '' : 's'} with a negative credit balance
                  </div>
                )}
              </div>
            ) : <Skeleton className="h-24 w-full" />}
          </Card>
        </Section>
      </div>
    </div>
  );
};

// Local copy of the Dashboard segmented control (per build spec).
const RangeToggle: React.FC<{ value: Range; onChange: (r: Range) => void }> = ({ value, onChange }) => (
  <div className="inline-flex rounded-xl border border-charcoal-200 bg-white p-0.5" role="tablist" aria-label="Period">
    {(['day', 'week', 'month', 'all'] as Range[]).map((r) => {
      const active = r === value;
      return (
        <button
          key={r}
          type="button"
          role="tab"
          aria-selected={active}
          onClick={() => onChange(r)}
          className={[
            'px-3 py-1.5 rounded-[10px] text-[12px] font-semibold transition-colors',
            active ? 'bg-brand-700 text-white' : 'text-charcoal-600 hover:text-brand-700 hover:bg-charcoal-100',
            focusRing,
          ].join(' ')}
        >
          {RANGE_SHORT[r]}
        </button>
      );
    })}
  </div>
);
