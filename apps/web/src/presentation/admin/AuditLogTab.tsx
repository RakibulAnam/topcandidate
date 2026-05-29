// Audit log — append-only feed of every operator action with diffs.

import React, { useCallback, useEffect, useState } from 'react';
import type { AdminApi } from './adminApi';
import {
  Button, Card, EmptyState, ErrorState, FilterChip, JsonDiff, PageHeader, SearchInput, Skeleton, TimeCell, useDebounced,
} from './ui';

interface AuditRow {
  id: string;
  actor: string;
  action: string;
  target_kind: string;
  target_id: string | null;
  before_state: unknown;
  after_state: unknown;
  reason: string | null;
  created_at: string;
}

interface AuditResp { rows: AuditRow[]; total: number; page: number; pageSize: number }

const TARGET_KINDS: { value: string; label: string }[] = [
  { value: '', label: 'any target' },
  { value: 'user', label: 'user' },
  { value: 'purchase', label: 'purchase' },
  { value: 'dispute', label: 'dispute' },
  { value: 'orphan_sms', label: 'orphan SMS' },
  { value: 'parser_failure', label: 'parser failure' },
  { value: 'system', label: 'system' },
];

export const AuditLogTab: React.FC<{ api: AdminApi }> = ({ api }) => {
  const [data, setData] = useState<AuditResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [action, setAction] = useState('');
  const debouncedAction = useDebounced(action, 250);
  const [targetKind, setTargetKind] = useState('');
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { setPage(0); }, [debouncedAction, targetKind]);

  const refresh = useCallback(() => {
    setLoading(true);
    setErr(null);
    api.call<AuditResp>('audit-log', { query: { page, action: debouncedAction, targetKind } })
      .then(setData)
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [api, page, debouncedAction, targetKind]);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <div>
      <PageHeader
        eyebrow="Records"
        title="Audit log"
        description="Append-only stream of every operator action. Each entry has the reason you typed and a before/after JSON diff."
      />

      <div className="mb-3 max-w-md">
        <SearchInput
          value={action}
          onChange={setAction}
          loading={loading && action.length > 0}
          placeholder="Filter by action (e.g. confirm_purchase)…"
          ariaLabel="Filter audit log by action"
        />
      </div>

      <div className="mb-4 flex items-center gap-2 flex-wrap">
        <span className="text-[10.5px] uppercase tracking-[0.18em] text-charcoal-500 font-bold mr-1">Target</span>
        {TARGET_KINDS.map(k => (
          <FilterChip key={k.value || 'any'} active={targetKind === k.value} onClick={() => setTargetKind(k.value)}>{k.label}</FilterChip>
        ))}
      </div>

      {err && <ErrorState error={err} onRetry={refresh} />}

      {loading && !data && (
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Card key={i}><Skeleton className="h-16 w-full" /></Card>)}</div>
      )}

      {data && data.rows.length === 0 && (
        <Card><EmptyState title="No entries match" description="Try clearing the filters." /></Card>
      )}

      {data && data.rows.length > 0 && (
        <ul className="space-y-2">
          {data.rows.map((r) => (
            <li key={r.id}>
              <Card>
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-[12px] font-semibold text-brand-700">{r.action}</span>
                    <span className="text-[11px] text-charcoal-500">on {r.target_kind}{r.target_id ? ` · ${r.target_id.slice(0, 8)}…` : ''}</span>
                  </div>
                  <span className="text-[11px] text-charcoal-500"><span className="font-mono">{r.actor}</span> · <TimeCell iso={r.created_at} /></span>
                </div>
                {r.reason && <div className="mt-2 text-[12px] text-charcoal-600 italic">"{r.reason}"</div>}
                <div className="mt-2"><JsonDiff before={r.before_state} after={r.after_state} /></div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {data && (
        <div className="flex items-center justify-between mt-3 text-[12px] text-charcoal-500">
          <span>{data.total === 0 ? 'No results' : `Page ${data.page + 1} of ${Math.max(1, Math.ceil(data.total / data.pageSize))}`}</span>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" disabled={data.page === 0} onClick={() => setPage(data.page - 1)}>← Prev</Button>
            <Button size="sm" variant="ghost" disabled={data.page + 1 >= Math.ceil(data.total / data.pageSize)} onClick={() => setPage(data.page + 1)}>Next →</Button>
          </div>
        </div>
      )}
    </div>
  );
};
