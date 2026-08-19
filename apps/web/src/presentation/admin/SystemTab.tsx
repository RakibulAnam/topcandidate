// System health — AI usage/cost (24h), payments pipeline state, and env health.
// Current-state report; no range toggle. Refresh button re-fetches.

import React, { useCallback, useEffect, useState } from 'react';
import type { AdminApi } from './adminApi';
import {
  Button, Card, ContentGrid, ErrorState, PageHeader, Section, Skeleton, StatusPill,
} from './ui';
import { HBarChart } from './charts';

const usd = (n: number): string => `$${Number(n ?? 0).toFixed(4)}`;

interface SystemData {
  abuseSignals: {
    multiAccountBrowsers: number;
    topBrowsers: { id: string; accounts: number }[];
    multiAccountOrigins: number;
    topOrigins: { id: string; accounts: number }[];
    freeCallsNonPayers30d: number;
    freeSpendNonPayersUsd30d: number;
    nonPayingAccountsGenerating30d: number;
  };
  adminAccess: {
    failures24h: number; blocked24h: number; distinctFailingIps24h: number;
    lockedIpsNow: number; lastFailureAt: string | null; lastSuccessAt: string | null;
    topIps24h: { ip: string; failures: number }[];
    credentialStore: 'hash' | 'plaintext' | 'none';
    sessionTtlHours: number;
  };
  ai: {
    calls24h: number; errorRatePct24h: number; avgLatencyMs24h: number;
    costUsd24h: number; costUsd7d: number; costUsd30d: number;
    byProvider24h: { provider: string; calls: number; costUsd: number }[];
  };
  payments: {
    pending: number; oldestPendingMinutes: number | null; orphanBacklog: number;
    expired24h: number; confirmations24h: number; reversals7d: number;
  };
  env: Record<string, boolean>;
  serverTimeUtc: string;
}

type Tone = 'neutral' | 'warn' | 'bad';

const Stat: React.FC<{ label: string; value: string; sub?: string; tone?: Tone }> = ({ label, value, sub, tone = 'neutral' }) => {
  const color = tone === 'bad' ? 'text-red-700' : tone === 'warn' ? 'text-accent-600' : 'text-brand-700';
  return (
    <div className="rounded-xl border border-charcoal-200 bg-white p-3">
      <div className="text-[10px] uppercase tracking-[0.18em] text-charcoal-500 font-bold">{label}</div>
      <div className={`mt-1 font-display text-2xl font-semibold leading-none tabular-nums ${color}`}>{value}</div>
      {sub && <div className="mt-1 text-[11px] text-charcoal-500">{sub}</div>}
    </div>
  );
};

export const SystemTab: React.FC<{ api: AdminApi }> = ({ api }) => {
  const [data, setData] = useState<SystemData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    setErr(null);
    api.call<SystemData>('system-health')
      .then(setData)
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [api]);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <div>
      <PageHeader
        eyebrow="System"
        title="System health"
        description="AI usage and cost, the payments pipeline state, and environment configuration health."
        actions={<Button variant="secondary" size="sm" onClick={refresh}>Refresh</Button>}
      />

      {err && <ErrorState error={err} onRetry={refresh} />}

      {loading && !data && (
        <ContentGrid cols={2}>{Array.from({ length: 4 }).map((_, i) => <Card key={i}><Skeleton className="h-24 w-full" /></Card>)}</ContentGrid>
      )}

      {data && (
        <>
          {/* Admin access first: it's the only section that can indicate someone
              is attacking the panel right now. */}
          <Section title="Admin access (24h)">
            <Card>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <Stat
                  label="Failed logins"
                  value={String(data.adminAccess.failures24h)}
                  tone={data.adminAccess.failures24h >= 20 ? 'bad' : data.adminAccess.failures24h >= 5 ? 'warn' : 'neutral'}
                  sub={data.adminAccess.lastFailureAt ? `last ${new Date(data.adminAccess.lastFailureAt).toLocaleString()}` : 'none'}
                />
                <Stat
                  label="Refused by lockout"
                  value={String(data.adminAccess.blocked24h)}
                  tone={data.adminAccess.blocked24h > 0 ? 'warn' : 'neutral'}
                  sub="attempts the ladder blocked"
                />
                <Stat
                  label="IPs locked now"
                  value={String(data.adminAccess.lockedIpsNow)}
                  tone={data.adminAccess.lockedIpsNow > 0 ? 'bad' : 'neutral'}
                  sub="5+ failures in 15 min"
                />
                <Stat
                  label="Failing IPs"
                  value={String(data.adminAccess.distinctFailingIps24h)}
                  tone={data.adminAccess.distinctFailingIps24h > 3 ? 'bad' : 'neutral'}
                  sub="distinct, 24h"
                />
                <Stat
                  label="Last success"
                  value={data.adminAccess.lastSuccessAt ? new Date(data.adminAccess.lastSuccessAt).toLocaleTimeString() : '—'}
                  sub={data.adminAccess.lastSuccessAt ? new Date(data.adminAccess.lastSuccessAt).toLocaleDateString() : 'none in 24h'}
                />
                <Stat
                  label="Credential store"
                  value={data.adminAccess.credentialStore === 'hash' ? 'scrypt' : data.adminAccess.credentialStore === 'plaintext' ? 'plaintext' : 'none'}
                  tone={data.adminAccess.credentialStore === 'hash' ? 'neutral' : 'warn'}
                  sub={data.adminAccess.credentialStore === 'hash' ? `${data.adminAccess.sessionTtlHours}h sessions` : 'set ADMIN_PASSWORD_HASH'}
                />
              </div>
              {data.adminAccess.topIps24h.length > 0 && (
                <div className="mt-4 pt-4 border-t border-charcoal-100">
                  <div className="text-[10.5px] uppercase tracking-[0.18em] text-charcoal-500 font-bold mb-2">Failures by IP (24h)</div>
                  <ul className="space-y-1">
                    {data.adminAccess.topIps24h.map((r) => (
                      <li key={r.ip} className="flex items-center justify-between gap-2 text-[12.5px]">
                        <span className="font-mono">{r.ip}</span>
                        <span className="tabular-nums text-charcoal-500">{r.failures}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Card>
          </Section>

          <div className="mt-6">
            {/* Detection only — nothing here blocks anyone. The free tier is a
                Master Resume (~$0.003/call, 5/day/account) and new accounts get
                zero credits, so multi-accounting buys AI spend, not product.
                These numbers exist so the decision to add signup friction is
                made on evidence rather than fear. */}
            <Section title="Abuse signals (30d)">
              <Card>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <Stat
                    label="Free spend, non-payers"
                    value={usd(data.abuseSignals.freeSpendNonPayersUsd30d)}
                    tone={data.abuseSignals.freeSpendNonPayersUsd30d > 5 ? 'bad' : data.abuseSignals.freeSpendNonPayersUsd30d > 1 ? 'warn' : 'neutral'}
                    sub={`${data.abuseSignals.freeCallsNonPayers30d} calls, 30d`}
                  />
                  <Stat
                    label="Accounts generating free"
                    value={String(data.abuseSignals.nonPayingAccountsGenerating30d)}
                    sub="never purchased"
                  />
                  <Stat
                    label="Browsers, 2+ accounts"
                    value={String(data.abuseSignals.multiAccountBrowsers)}
                    tone={data.abuseSignals.multiAccountBrowsers >= 10 ? 'bad' : data.abuseSignals.multiAccountBrowsers >= 3 ? 'warn' : 'neutral'}
                    sub="same localStorage id"
                  />
                  <Stat
                    label="Origins, 2+ accounts"
                    value={String(data.abuseSignals.multiAccountOrigins)}
                    tone={data.abuseSignals.multiAccountOrigins >= 10 ? 'bad' : data.abuseSignals.multiAccountOrigins >= 3 ? 'warn' : 'neutral'}
                    sub="same hashed network"
                  />
                </div>
                {(data.abuseSignals.topBrowsers.length > 0 || data.abuseSignals.topOrigins.length > 0) && (
                  <div className="mt-4 pt-4 border-t border-charcoal-100 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
                    {data.abuseSignals.topBrowsers.length > 0 && (
                      <div>
                        <div className="text-[10.5px] uppercase tracking-[0.18em] text-charcoal-500 font-bold mb-2">Accounts per browser</div>
                        <ul className="space-y-1">
                          {data.abuseSignals.topBrowsers.map((b) => (
                            <li key={b.id} className="flex items-center justify-between gap-2 text-[12.5px]">
                              <span className="font-mono">{b.id}…</span>
                              <span className="tabular-nums text-charcoal-500">{b.accounts}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {data.abuseSignals.topOrigins.length > 0 && (
                      <div>
                        <div className="text-[10.5px] uppercase tracking-[0.18em] text-charcoal-500 font-bold mb-2">Accounts per origin</div>
                        <ul className="space-y-1">
                          {data.abuseSignals.topOrigins.map((o) => (
                            <li key={o.id} className="flex items-center justify-between gap-2 text-[12.5px]">
                              <span className="font-mono">{o.id}…</span>
                              <span className="tabular-nums text-charcoal-500">{o.accounts}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
                <p className="mt-4 text-[11.5px] text-charcoal-500">
                  Sharing a browser or a network is normal in small numbers — a family laptop, an office,
                  a user who re-registered. Treat a jump, not a count, as the signal.
                </p>
              </Card>
            </Section>
          </div>

          <div className="mt-6" />

          <Section title="AI health (24h)">
            <Card>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <Stat label="Calls" value={String(data.ai.calls24h)} sub="last 24h" />
                <Stat label="Error rate" value={`${data.ai.errorRatePct24h.toFixed(1)}%`} tone={data.ai.errorRatePct24h > 5 ? 'bad' : data.ai.errorRatePct24h > 1 ? 'warn' : 'neutral'} />
                <Stat label="Avg latency" value={`${Math.round(data.ai.avgLatencyMs24h)} ms`} />
                <Stat label="Cost 24h" value={usd(data.ai.costUsd24h)} />
                <Stat label="Cost 7d" value={usd(data.ai.costUsd7d)} />
                <Stat label="Cost 30d" value={usd(data.ai.costUsd30d)} />
              </div>
              <div className="mt-4 pt-4 border-t border-charcoal-100">
                <div className="text-[10.5px] uppercase tracking-[0.18em] text-charcoal-500 font-bold mb-2">By provider (24h)</div>
                <HBarChart data={data.ai.byProvider24h.map((p) => ({ label: p.provider, value: p.costUsd, sub: `${p.calls} calls` }))} formatValue={usd} />
              </div>
            </Card>
          </Section>

          <div className="mt-6">
            <Section title="Payments pipeline">
              <Card>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <Stat label="Pending" value={String(data.payments.pending)} tone={data.payments.pending > 0 ? 'warn' : 'neutral'} sub={data.payments.oldestPendingMinutes != null ? `oldest ${data.payments.oldestPendingMinutes}m` : 'none'} />
                  <Stat label="Orphan backlog" value={String(data.payments.orphanBacklog)} tone={data.payments.orphanBacklog > 0 ? 'bad' : 'neutral'} />
                  <Stat label="Expired 24h" value={String(data.payments.expired24h)} tone={data.payments.expired24h > 0 ? 'warn' : 'neutral'} />
                  <Stat label="Confirmations 24h" value={String(data.payments.confirmations24h)} />
                  <Stat label="Reversals 7d" value={String(data.payments.reversals7d)} tone={data.payments.reversals7d > 0 ? 'warn' : 'neutral'} />
                </div>
              </Card>
            </Section>
          </div>

          <div className="mt-6">
            <Section title="Environment">
              <Card>
                <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1.5">
                  {Object.entries(data.env).map(([k, v]) => (
                    <li key={k} className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[12px]">{k}</span>
                      <StatusPill status={v ? 'completed' : 'failed'} label={v ? 'present' : 'missing'} />
                    </li>
                  ))}
                </ul>
              </Card>
            </Section>
          </div>

          <div className="mt-6">
            <Card>
              <div className="text-[10.5px] uppercase tracking-[0.18em] text-charcoal-500 font-bold mb-1">Server time</div>
              <div className="font-mono text-sm">{data.serverTimeUtc}</div>
              <div className="text-[12px] text-charcoal-500 mt-1">Local: {new Date(data.serverTimeUtc).toLocaleString()}</div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
};
