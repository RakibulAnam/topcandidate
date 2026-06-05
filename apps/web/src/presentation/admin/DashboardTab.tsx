// Dashboard — business summary (range-filtered) + operational tiles + queue.
// Everything polls every 30s. The summary re-fetches when the range changes.

import React, { useCallback, useEffect, useState } from 'react';
import type { AdminApi } from './adminApi';
import { ageMin, taka } from './adminApi';
import {
  Button, Card, ContentGrid, DataTable, EmptyState, ErrorState, PageHeader,
  Section, Skeleton, StatusPill, TimeCell, focusRing,
} from './ui';

type Range = 'day' | 'week' | 'month' | 'all';

const RANGE_LABEL: Record<Range, string> = { day: 'Today', week: 'This week', month: 'This month', all: 'All time' };
const RANGE_SHORT: Record<Range, string> = { day: 'Day', week: 'Week', month: 'Month', all: 'All' };

interface SummaryData {
  range: Range;
  totalUsers: number;
  newUsersInRange: number;
  lifetimeEarningsTaka: number;
  earningsInRangeTaka: number;
  completedInRange: number;
  lifetimeCompletedCount: number;
  failuresInRange: number;
  failureBreakdown: Record<string, number>;
  openDisputes: number;
  disputesInRange: number;
}

const FAILURE_LABEL: Record<string, string> = {
  failed: 'failed',
  expired: 'expired',
  underpaid: 'underpaid',
  msisdn_mismatch_review: 'mismatch',
};

interface DashboardStats {
  pending: number;
  completedToday: number;
  completedTodayTaka: number;
  openDisputes: number;
  expired24h: number;
  orphanSms: number;
  oldestPendingCreatedAt: string | null;
}

interface QueueItem {
  kind: 'pending' | 'mismatch' | 'underpaid' | 'expired' | 'dispute' | 'orphan';
  id: string;
  trxId: string | null;
  email: string | null;
  amountTaka: number | null;
  observedTaka: number | null;
  createdAt: string;
  extra?: { notes?: string; sender?: string };
}

const KIND_LABEL: Record<QueueItem['kind'], string> = {
  pending: 'Pending',
  mismatch: 'Mismatch',
  underpaid: 'Underpaid',
  expired: 'Expired',
  dispute: 'Dispute',
  orphan: 'Orphan SMS',
};

const KIND_STATUS: Record<QueueItem['kind'], string> = {
  pending: 'pending',
  mismatch: 'msisdn_mismatch_review',
  underpaid: 'underpaid',
  expired: 'expired',
  dispute: 'open',
  orphan: 'pending',
};

export const DashboardTab: React.FC<{
  api: AdminApi;
  onOpenPurchase: (idOrTrx: { id?: string; trxId?: string }) => void;
  onOpenDisputes: () => void;
  onOpenOrphans: () => void;
}> = ({ api, onOpenPurchase, onOpenDisputes, onOpenOrphans }) => {
  const [range, setRange] = useState<Range>('month');
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [summaryErr, setSummaryErr] = useState<string | null>(null);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [statsErr, setStatsErr] = useState<string | null>(null);
  const [queue, setQueue] = useState<QueueItem[] | null>(null);
  const [queueLoading, setQueueLoading] = useState(true);
  const [queueErr, setQueueErr] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setSummaryErr(null);
    setStatsErr(null);
    setQueueErr(null);
    setQueueLoading(true);
    void api.call<SummaryData>('summary', { query: { range } })
      .then(setSummary)
      .catch((e: unknown) => setSummaryErr(e instanceof Error ? e.message : String(e)));
    void api.call<DashboardStats>('dashboard')
      .then(setStats)
      .catch((e: unknown) => setStatsErr(e instanceof Error ? e.message : String(e)));
    void api.call<{ items: QueueItem[] }>('action-queue')
      .then((r) => setQueue(r.items))
      .catch((e: unknown) => setQueueErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setQueueLoading(false));
  }, [api, range]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 30_000);
    return () => clearInterval(id);
  }, [refresh]);

  return (
    <div>
      <PageHeader
        eyebrow="Overview"
        title="Dashboard"
        description="Business summary, operational state, and the action queue. Polls every 30 seconds."
        actions={<Button variant="secondary" size="sm" onClick={refresh}>Refresh</Button>}
      />

      <Section
        title="Business summary"
        description="Earnings, users, failures and disputes — scoped by the selected period."
        actions={<RangeToggle value={range} onChange={setRange} />}
      >
        <SummaryCards summary={summary} error={summaryErr} range={range} onRetry={refresh} />
      </Section>

      <div className="mt-6">
        <Section title="Operations" description="Live operational counts.">
          <Tiles stats={stats} error={statsErr} onRetry={refresh} />
        </Section>
      </div>

      <div className="mt-6">
        <Section
          title="Action queue"
          description="Everything that needs attention — pending past 10 minutes, mismatch / underpaid / expired-24h purchases, open disputes, unmatched SMS — sorted oldest first."
        >
          <DataTable<QueueItem>
            columns={[
              { key: 'age', header: 'Age', width: 'w-20', render: (r) => <span className="text-charcoal-600">{ageMin(r.createdAt)}</span> },
              { key: 'type', header: 'Type', width: 'w-40', render: (r) => <StatusPill status={KIND_STATUS[r.kind]} label={KIND_LABEL[r.kind]} /> },
              { key: 'trx', header: 'TrxID', render: (r) => <span className="font-mono text-[12px] break-all">{r.trxId ?? '—'}</span> },
              { key: 'amount', header: 'Amount', width: 'w-32', render: (r) => (
                <div className="whitespace-nowrap">
                  {taka(r.amountTaka)}
                  {r.observedTaka != null && r.observedTaka !== r.amountTaka && (
                    <span className="block text-[11px] text-accent-600">obs {taka(r.observedTaka)}</span>
                  )}
                </div>
              ) },
              { key: 'who', header: 'Customer', render: (r) => <span className="text-[12px] break-all">{r.email ?? r.extra?.sender ?? '—'}</span> },
              { key: 'do', header: '', width: 'w-24', align: 'right', render: (r) => (
                <Button size="sm" variant="primary" onClick={(e) => { e.stopPropagation(); routeAction(r, onOpenPurchase, onOpenDisputes, onOpenOrphans); }}>
                  {r.kind === 'dispute' ? 'Resolve' : r.kind === 'orphan' ? 'Match' : 'View'}
                </Button>
              ) },
            ]}
            rows={queue}
            loading={queueLoading}
            error={queueErr}
            onRetry={refresh}
            keyForRow={(r) => `${r.kind}:${r.id}`}
            onRowClick={(r) => routeAction(r, onOpenPurchase, onOpenDisputes, onOpenOrphans)}
            empty={{
              title: 'Nothing needs attention',
              description: 'When customers submit payments, disputes, or unmatched SMS land, they\'ll show up here.',
              icon: <CheckIcon />,
            }}
          />
        </Section>
      </div>
    </div>
  );
};

function routeAction(item: QueueItem, openPurchase: (sel: { id?: string; trxId?: string }) => void, openDisputes: () => void, openOrphans: () => void) {
  if (item.kind === 'dispute') openDisputes();
  else if (item.kind === 'orphan') openOrphans();
  else openPurchase({ id: item.id });
}

// Segmented Day/Week/Month/All control that re-scopes the summary.
const RangeToggle: React.FC<{ value: Range; onChange: (r: Range) => void }> = ({ value, onChange }) => (
  <div className="inline-flex rounded-xl border border-charcoal-200 bg-white p-0.5" role="tablist" aria-label="Summary period">
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

const SummaryCards: React.FC<{ summary: SummaryData | null; error: string | null; range: Range; onRetry: () => void }> = ({ summary, error, range, onRetry }) => {
  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  if (!summary) {
    return (
      <ContentGrid cols={4}>
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}><div className="space-y-2"><Skeleton className="h-3 w-24" /><Skeleton className="h-9 w-24" /><Skeleton className="h-3 w-28" /></div></Card>
        ))}
      </ContentGrid>
    );
  }

  const periodWord = RANGE_LABEL[range].toLowerCase();
  const failParts = Object.entries(summary.failureBreakdown)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${n} ${FAILURE_LABEL[k] ?? k}`);

  return (
    <ContentGrid cols={4}>
      <SummaryCard
        label="Earnings"
        value={taka(summary.earningsInRangeTaka)}
        sub={`Lifetime ${taka(summary.lifetimeEarningsTaka)} · ${summary.completedInRange} sale${summary.completedInRange === 1 ? '' : 's'} ${periodWord}`}
        tone="brand"
      />
      <SummaryCard
        label="Total users"
        value={String(summary.totalUsers)}
        sub={range === 'all' ? 'all registered' : `+${summary.newUsersInRange} new ${periodWord}`}
        tone="neutral"
      />
      <SummaryCard
        label="Transaction failures"
        value={String(summary.failuresInRange)}
        sub={failParts.length ? failParts.join(' · ') : `none ${periodWord}`}
        tone={summary.failuresInRange > 0 ? 'warn' : 'neutral'}
      />
      <SummaryCard
        label="Disputes"
        value={String(summary.openDisputes)}
        sub={summary.openDisputes > 0 ? `${summary.openDisputes} open · ${summary.disputesInRange} ${periodWord}` : `${summary.disputesInRange} opened ${periodWord}`}
        tone={summary.openDisputes > 0 ? 'bad' : 'neutral'}
      />
    </ContentGrid>
  );
};

type SummaryTone = 'neutral' | 'brand' | 'warn' | 'bad';

const SummaryCard: React.FC<{ label: string; value: string; sub: string; tone: SummaryTone }> = ({ label, value, sub, tone }) => {
  const valueColor = tone === 'bad' ? 'text-red-700' : tone === 'warn' ? 'text-accent-600' : tone === 'brand' ? 'text-brand-700' : 'text-brand-700';
  return (
    <Card>
      <div className="text-[10.5px] uppercase tracking-[0.18em] text-charcoal-500 font-bold">{label}</div>
      <div className={`mt-1 font-display text-3xl font-semibold ${valueColor} leading-none`}>{value}</div>
      {sub && <div className="mt-2 text-[12px] text-charcoal-500">{sub}</div>}
    </Card>
  );
};

const Tiles: React.FC<{ stats: DashboardStats | null; error: string | null; onRetry: () => void }> = ({ stats, error, onRetry }) => {
  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  if (!stats) {
    return (
      <ContentGrid cols={4}>
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}><div className="space-y-2"><Skeleton className="h-3 w-20" /><Skeleton className="h-9 w-16" /><Skeleton className="h-3 w-24" /></div></Card>
        ))}
      </ContentGrid>
    );
  }
  const oldest = stats.oldestPendingCreatedAt ? Math.floor((Date.now() - new Date(stats.oldestPendingCreatedAt).getTime()) / 60_000) : null;
  const pendingTone: TileTone = oldest == null ? 'neutral' : oldest > 12 * 60 ? 'bad' : oldest > 30 ? 'warn' : 'neutral';

  return (
    <ContentGrid cols={4}>
      <Tile label="Pending" value={String(stats.pending)} sub={oldest == null ? 'none' : `oldest ${oldest}m`} tone={pendingTone} />
      <Tile label="Completed today" value={String(stats.completedToday)} sub={taka(stats.completedTodayTaka)} tone="neutral" />
      <Tile label="Open disputes" value={String(stats.openDisputes)} sub={stats.openDisputes > 0 ? 'awaiting resolution' : ''} tone={stats.openDisputes > 0 ? 'bad' : 'neutral'} />
      <Tile label="Orphan SMS" value={String(stats.orphanSms)} sub={`${stats.expired24h} expired 24h`} tone={stats.orphanSms > 0 ? 'warn' : 'neutral'} />
    </ContentGrid>
  );
};

type TileTone = 'neutral' | 'warn' | 'bad';

const Tile: React.FC<{ label: string; value: string; sub: string; tone: TileTone }> = ({ label, value, sub, tone }) => {
  const valueColor = tone === 'bad' ? 'text-red-700' : tone === 'warn' ? 'text-accent-600' : 'text-brand-700';
  return (
    <Card>
      <div className="text-[10.5px] uppercase tracking-[0.18em] text-charcoal-500 font-bold">{label}</div>
      <div className={`mt-1 font-display text-3xl font-semibold ${valueColor} leading-none`}>{value}</div>
      {sub && <div className="mt-2 text-[12px] text-charcoal-500">{sub}</div>}
    </Card>
  );
};

const CheckIcon: React.FC = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m5 12 5 5L20 7" /></svg>
);

// Empty re-export so other tabs can re-use TimeCell without re-importing
export { TimeCell };
