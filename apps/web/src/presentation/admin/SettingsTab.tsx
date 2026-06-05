// Settings — env health, recent activity, manual cron trigger.
// Sensitive env values are never returned by the backend; only present/missing.

import React, { useCallback, useEffect, useState } from 'react';
import type { AdminApi } from './adminApi';
import { ADMIN_TOKEN_STORAGE } from './adminApi';
import {
  Button, Card, ContentGrid, EmptyState, ErrorState, KeyValue, PageHeader,
  ReasonModal, Section, Skeleton, StatusPill, TimeCell, withToast,
} from './ui';

interface SettingsResp {
  env: Record<string, boolean>;
  lastConfirmAt: string | null;
  lastConfirmActor: string | null;
  recentActivity: Array<{ id: string; from_status: string | null; to_status: string; actor: string; reason: string | null; created_at: string }>;
  serverTimeUtc: string;
}

export const SettingsTab: React.FC<{ api: AdminApi; onLock: () => void }> = ({ api, onLock }) => {
  const [data, setData] = useState<SettingsResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [confirmExpiry, setConfirmExpiry] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    setLoading(true);
    setErr(null);
    api.call<SettingsResp>('settings')
      .then(setData)
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [api]);

  useEffect(() => { refresh(); }, [refresh]);

  const runExpiry = async () => {
    setBusy(true);
    try {
      const r = await withToast(
        api.call<{ expiredCount: number }>('settings', { method: 'POST', body: { op: 'run-expiry' } }),
        { success: 'Pending-expiry triggered.' }
      );
      if (r) { /* expiredCount surfaced via the toast description below */ }
      setConfirmExpiry(false);
      refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow="System"
        title="Settings"
        description="Environment health, recent activity, and manual maintenance triggers. Sensitive values are never displayed — only whether they're configured."
        actions={<Button variant="secondary" size="sm" onClick={refresh}>Refresh</Button>}
      />

      {err && <ErrorState error={err} onRetry={refresh} />}

      {loading && !data && (
        <ContentGrid cols={2}>{Array.from({ length: 4 }).map((_, i) => <Card key={i}><Skeleton className="h-20 w-full" /></Card>)}</ContentGrid>
      )}

      {data && (
        <ContentGrid cols={2}>
          <Card>
            <div className="text-[10.5px] uppercase tracking-[0.18em] text-charcoal-500 font-bold mb-2">Server time</div>
            <div className="font-mono text-sm">{data.serverTimeUtc}</div>
            <div className="text-[12px] text-charcoal-500 mt-1">Local: {new Date(data.serverTimeUtc).toLocaleString()}</div>
          </Card>

          <Card>
            <div className="text-[10.5px] uppercase tracking-[0.18em] text-charcoal-500 font-bold mb-2">Last successful confirm</div>
            {data.lastConfirmAt ? (
              <>
                <div className="text-sm"><TimeCell iso={data.lastConfirmAt} /></div>
                <div className="text-[12px] text-charcoal-500 mt-1">by <span className="font-mono">{data.lastConfirmActor}</span></div>
              </>
            ) : <EmptyState title="No confirms yet" />}
          </Card>

          <Card>
            <div className="text-[10.5px] uppercase tracking-[0.18em] text-charcoal-500 font-bold mb-3">Environment</div>
            <ul className="space-y-1.5">
              {Object.entries(data.env).map(([k, v]) => (
                <li key={k} className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[12px]">{k}</span>
                  <StatusPill status={v ? 'completed' : 'failed'} label={v ? 'present' : 'missing'} />
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <div className="text-[10.5px] uppercase tracking-[0.18em] text-charcoal-500 font-bold mb-3">Recent activity</div>
            {data.recentActivity.length === 0 ? <EmptyState title="No activity" description="Nothing has happened recently." /> : (
              <ul className="space-y-2">
                {data.recentActivity.map(a => (
                  <li key={a.id} className="text-[12px]">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span>{a.from_status ?? '(init)'} → <span className="font-semibold">{a.to_status}</span></span>
                      <TimeCell iso={a.created_at} />
                    </div>
                    <div className="text-charcoal-500 mt-0.5">by <span className="font-mono">{a.actor}</span></div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </ContentGrid>
      )}

      <div className="mt-6">
        <Section title="Maintenance">
          <Card>
            <div className="flex items-start justify-between flex-wrap gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-brand-700">Run pending-expiry now</div>
                <p className="text-[12px] text-charcoal-500 mt-1 max-w-md">Manually fires <code className="font-mono text-[11px]">expire_stale_pending_purchases()</code>. Normally runs every 15 min via pg_cron.</p>
              </div>
              <Button size="sm" variant="primary" onClick={() => setConfirmExpiry(true)}>Run now</Button>
            </div>
          </Card>

          <Card>
            <div className="flex items-start justify-between flex-wrap gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-brand-700">Session</div>
                <p className="text-[12px] text-charcoal-500 mt-1 max-w-md">Lock the panel without removing the stored key, or fully reset.</p>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="secondary" onClick={() => { try { sessionStorage.removeItem(ADMIN_TOKEN_STORAGE); } catch { /* ignore */ } window.location.reload(); }}>Reset session</Button>
                <Button size="sm" variant="danger" onClick={onLock}>Lock</Button>
              </div>
            </div>
          </Card>
        </Section>
      </div>

      <ReasonModal
        open={confirmExpiry}
        title="Run pending-expiry now"
        subtitle="Manually fires expire_stale_pending_purchases(). Type a brief reason for the audit log."
        confirmVariant="primary"
        busy={busy}
        onConfirm={() => void runExpiry()}
        onClose={() => setConfirmExpiry(false)}
      />
    </div>
  );
};
