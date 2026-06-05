// Customer intelligence — current-state segmentation + leaderboards.
// No range toggle (this is a snapshot, not a period report). Row "View" buttons
// jump to the user detail via onOpenUser when wired.

import React, { useCallback, useEffect, useState } from 'react';
import type { AdminApi } from './adminApi';
import { taka, ageMin } from './adminApi';
import {
  Button, Card, ContentGrid, DataTable, ErrorState, PageHeader, Section, Skeleton, TimeCell,
} from './ui';

interface CustomerRow { userId: string; email: string; lifetimeTaka: number; purchases: number; credits: number }
interface WarmLead { userId: string; email: string; resumes: number; joined: string }
interface AtRisk { userId: string; email: string; lifetimeTaka: number; lastActive: string }
interface NegBal { userId: string; email: string; credits: number }

interface IntelData {
  segments: { warmLeads: number; whales: number; dormantPayers: number; neverPurchased: number; negativeBalance: number; fastBurners: number };
  topCustomers: CustomerRow[];
  warmLeads: WarmLead[];
  atRisk: AtRisk[];
  negativeBalanceUsers: NegBal[];
}

const SEGMENTS: { key: keyof IntelData['segments']; label: string; bad?: boolean }[] = [
  { key: 'warmLeads', label: 'Warm leads' },
  { key: 'whales', label: 'Whales' },
  { key: 'dormantPayers', label: 'Dormant payers' },
  { key: 'neverPurchased', label: 'Never purchased' },
  { key: 'negativeBalance', label: 'Negative balance', bad: true },
  { key: 'fastBurners', label: 'Fast burners' },
];

export const CustomerIntelTab: React.FC<{ api: AdminApi; onOpenUser?: (id: string) => void }> = ({ api, onOpenUser }) => {
  const [data, setData] = useState<IntelData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    setErr(null);
    api.call<IntelData>('customer-intelligence')
      .then(setData)
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [api]);

  useEffect(() => { refresh(); }, [refresh]);

  const viewCol = onOpenUser
    ? [{ key: 'view', header: '', width: 'w-20', align: 'right' as const, render: (r: { userId: string }) => <Button size="sm" variant="secondary" onClick={() => onOpenUser(r.userId)}>View</Button> }]
    : [];

  return (
    <div>
      <PageHeader
        eyebrow="Analytics"
        title="Customers"
        description="Current-state segmentation, top customers, warm leads and at-risk payers. Snapshot, not a period report."
        actions={<Button variant="secondary" size="sm" onClick={refresh}>Refresh</Button>}
      />

      {err && <ErrorState error={err} onRetry={refresh} />}

      <Section title="Segments">
        {!data ? (
          <ContentGrid cols={3}>{Array.from({ length: 6 }).map((_, i) => <Card key={i}><Skeleton className="h-12 w-full" /></Card>)}</ContentGrid>
        ) : (
          <ContentGrid cols={3}>
            {SEGMENTS.map((s) => {
              const n = data.segments[s.key];
              return (
                <Card key={s.key}>
                  <div className="text-[10.5px] uppercase tracking-[0.18em] text-charcoal-500 font-bold">{s.label}</div>
                  <div className={`mt-1 font-display text-3xl font-semibold leading-none tabular-nums ${s.bad && n > 0 ? 'text-red-700' : 'text-brand-700'}`}>{n}</div>
                </Card>
              );
            })}
          </ContentGrid>
        )}
      </Section>

      <div className="mt-6">
        <Section title="Top customers" description="Highest lifetime value.">
          <DataTable<CustomerRow>
            columns={[
              { key: 'email', header: 'Email', render: (r) => <span className="font-mono text-[12px] break-all">{r.email}</span> },
              { key: 'lifetime', header: 'Lifetime', align: 'right', render: (r) => <span className="font-semibold text-brand-700">{taka(r.lifetimeTaka)}</span> },
              { key: 'purchases', header: 'Purchases', width: 'w-28', align: 'right', render: (r) => r.purchases },
              { key: 'credits', header: 'Credits', width: 'w-24', align: 'right', render: (r) => <span className={r.credits < 0 ? 'text-red-700 font-semibold' : ''}>{r.credits}</span> },
              ...viewCol,
            ]}
            rows={data?.topCustomers ?? null}
            loading={loading}
            keyForRow={(r) => r.userId}
            empty={{ title: 'No paying customers yet' }}
          />
        </Section>
      </div>

      <div className="mt-6">
        <Section title="Warm leads" description="Generated resumes but haven't purchased.">
          <DataTable<WarmLead>
            columns={[
              { key: 'email', header: 'Email', render: (r) => <span className="font-mono text-[12px] break-all">{r.email}</span> },
              { key: 'resumes', header: 'Resumes', width: 'w-28', align: 'right', render: (r) => r.resumes },
              { key: 'joined', header: 'Joined', width: 'w-44', render: (r) => <TimeCell iso={r.joined} /> },
              ...viewCol,
            ]}
            rows={data?.warmLeads ?? null}
            loading={loading}
            keyForRow={(r) => r.userId}
            empty={{ title: 'No warm leads', description: 'Users who generate without buying will appear here.' }}
          />
        </Section>
      </div>

      <div className="mt-6">
        <Section title="At-risk payers" description="Past payers who have gone quiet.">
          <DataTable<AtRisk>
            columns={[
              { key: 'email', header: 'Email', render: (r) => <span className="font-mono text-[12px] break-all">{r.email}</span> },
              { key: 'lifetime', header: 'Lifetime', align: 'right', render: (r) => taka(r.lifetimeTaka) },
              { key: 'lastActive', header: 'Last active', width: 'w-32', align: 'right', render: (r) => <span className="text-charcoal-600">{ageMin(r.lastActive)} ago</span> },
              ...viewCol,
            ]}
            rows={data?.atRisk ?? null}
            loading={loading}
            keyForRow={(r) => r.userId}
            empty={{ title: 'No at-risk payers' }}
          />
        </Section>
      </div>

      <div className="mt-6">
        <Section title="Negative balance" description="Users whose credit balance has gone negative.">
          <DataTable<NegBal>
            columns={[
              { key: 'email', header: 'Email', render: (r) => <span className="font-mono text-[12px] break-all">{r.email}</span> },
              { key: 'credits', header: 'Credits', width: 'w-24', align: 'right', render: (r) => <span className="text-red-700 font-semibold">{r.credits}</span> },
              ...viewCol,
            ]}
            rows={data?.negativeBalanceUsers ?? null}
            loading={loading}
            keyForRow={(r) => r.userId}
            empty={{ title: 'No negative balances', description: 'Nothing to reconcile.' }}
          />
        </Section>
      </div>
    </div>
  );
};
