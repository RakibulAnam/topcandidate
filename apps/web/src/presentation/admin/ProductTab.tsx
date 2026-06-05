// Product analytics — generation mix, daily trend, AI cost & margin.
// Range-scoped with Refresh. Margin/cost figures are approximate (USD→BDT and
// per-credit assumptions), surfaced as such in the UI.

import React, { useCallback, useEffect, useState } from 'react';
import type { AdminApi } from './adminApi';
import { taka } from './adminApi';
import {
  Button, Card, ContentGrid, ErrorState, PageHeader, Section, Skeleton, focusRing,
} from './ui';
import { KpiCard, TimeSeriesChart, DonutChart, HBarChart, BarChart } from './charts';

type Range = 'day' | 'week' | 'month' | 'all';
const RANGE_SHORT: Record<Range, string> = { day: 'Day', week: 'Week', month: 'Month', all: 'All' };

const usd = (n: number): string => `$${Number(n ?? 0).toFixed(4)}`;

interface ProductData {
  range: Range;
  generations: { paidTailored: number; freeGeneral: number; toolkitItems: number; extracts: number };
  dailyGenerations: { day: string; value: number }[];
  aiCost: { totalCostUsd: number; callsWithCost: number; errorRatePct: number; avgLatencyMs: number; byProvider: { provider: string; calls: number; costUsd: number }[] };
  creditsSoldVsConsumed: { sold: number; consumed: number };
  margin: { revenueTaka: number; aiCostTaka: number; grossMarginPct: number };
}

export const ProductTab: React.FC<{ api: AdminApi }> = ({ api }) => {
  const [range, setRange] = useState<Range>('month');
  const [data, setData] = useState<ProductData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    setErr(null);
    api.call<ProductData>('product-analytics', { query: { range } })
      .then(setData)
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [api, range]);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <div>
      <PageHeader
        eyebrow="Analytics"
        title="Product"
        description="Generation mix, daily trend, AI cost and gross margin. Cost & margin figures are approximate."
        actions={<Button variant="secondary" size="sm" onClick={refresh}>Refresh</Button>}
      />

      <Section title="Summary" actions={<RangeToggle value={range} onChange={setRange} />}>
        {err ? <ErrorState error={err} onRetry={refresh} /> : !data ? (
          <ContentGrid cols={4}>{Array.from({ length: 4 }).map((_, i) => <Card key={i}><Skeleton className="h-16 w-full" /></Card>)}</ContentGrid>
        ) : (
          <ContentGrid cols={4}>
            <KpiCard label="Paid generations" value={String(data.generations.paidTailored)} tone="brand" sub="tailored resumes" />
            <KpiCard label="Free generations" value={String(data.generations.freeGeneral)} sub="general resumes" />
            <KpiCard label="Gross margin" value={`${data.margin.grossMarginPct.toFixed(1)}%`} tone={data.margin.grossMarginPct < 0 ? 'bad' : 'neutral'} sub="approx" />
            <KpiCard label="AI cost" value={usd(data.aiCost.totalCostUsd)} tone="warn" sub={`${data.aiCost.callsWithCost} priced calls`} />
          </ContentGrid>
        )}
      </Section>

      <div className="mt-6">
        <Section title="Daily generations">
          <Card>
            {data ? <TimeSeriesChart data={data.dailyGenerations} /> : <Skeleton className="h-48 w-full" />}
          </Card>
        </Section>
      </div>

      <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Section title="Generation mix">
          <Card>
            {data ? (
              <DonutChart
                data={[
                  { label: 'Paid (tailored)', value: data.generations.paidTailored },
                  { label: 'Free (general)', value: data.generations.freeGeneral },
                  { label: 'Toolkit items', value: data.generations.toolkitItems },
                  { label: 'Extracts', value: data.generations.extracts },
                ]}
              />
            ) : <Skeleton className="h-40 w-full" />}
          </Card>
        </Section>

        <Section title="AI cost by provider">
          <Card>
            {data ? (
              <HBarChart
                data={data.aiCost.byProvider.map((p) => ({ label: p.provider, value: p.costUsd, sub: `${p.calls} calls` }))}
                formatValue={usd}
              />
            ) : <Skeleton className="h-32 w-full" />}
            {data && (
              <div className="mt-3 pt-3 border-t border-charcoal-100 grid grid-cols-2 gap-3 text-[12px] text-charcoal-500">
                <div>Error rate <span className="font-semibold text-brand-700">{data.aiCost.errorRatePct.toFixed(1)}%</span></div>
                <div>Avg latency <span className="font-semibold text-brand-700">{Math.round(data.aiCost.avgLatencyMs)} ms</span></div>
              </div>
            )}
          </Card>
        </Section>
      </div>

      <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Section title="Credits: sold vs consumed">
          <Card>
            {data ? (
              <BarChart
                data={[
                  { label: 'Sold', value: data.creditsSoldVsConsumed.sold },
                  { label: 'Consumed', value: data.creditsSoldVsConsumed.consumed },
                ]}
                height={160}
                formatValue={(n) => String(n)}
              />
            ) : <Skeleton className="h-40 w-full" />}
          </Card>
        </Section>

        <Section title="Margin (approx)">
          <Card>
            {data ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-[10.5px] uppercase tracking-[0.18em] text-charcoal-500 font-bold">Revenue</div>
                    <div className="mt-1 font-display text-2xl font-semibold text-brand-700 tabular-nums">{taka(data.margin.revenueTaka)}</div>
                  </div>
                  <div>
                    <div className="text-[10.5px] uppercase tracking-[0.18em] text-charcoal-500 font-bold">AI cost</div>
                    <div className="mt-1 font-display text-2xl font-semibold text-accent-600 tabular-nums">{taka(data.margin.aiCostTaka)}</div>
                  </div>
                </div>
                <div className="pt-3 border-t border-charcoal-100">
                  <div className="text-[10.5px] uppercase tracking-[0.18em] text-charcoal-500 font-bold">Gross margin</div>
                  <div className={`mt-1 font-display text-3xl font-semibold leading-none tabular-nums ${data.margin.grossMarginPct < 0 ? 'text-red-700' : 'text-brand-700'}`}>{data.margin.grossMarginPct.toFixed(1)}%</div>
                  <div className="mt-2 text-[11px] text-charcoal-400">Approximate — USD costs converted and per-credit assumptions applied.</div>
                </div>
              </div>
            ) : <Skeleton className="h-40 w-full" />}
          </Card>
        </Section>
      </div>
    </div>
  );
};

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
