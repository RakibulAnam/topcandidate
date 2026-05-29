// Parser failures — SMS the watcher couldn't classify. Multi-select +
// bulk mark reviewed + JSON corpus download.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { AdminApi } from './adminApi';
import {
  Button, Card, EmptyState, ErrorState, PageHeader, Skeleton, TimeCell, withToast,
} from './ui';

interface ParserRow { id: string; payment_reference: string; sender_msisdn: string | null; raw_body: string | null; sms_timestamp: string; created_at: string; reviewed_at: string | null }

export const ParserFailuresTab: React.FC<{ api: AdminApi }> = ({ api }) => {
  const [rows, setRows] = useState<ParserRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    setLoading(true);
    setErr(null);
    api.call<{ rows: ParserRow[] }>('parser-failures')
      .then((r) => setRows(r.rows))
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [api]);

  useEffect(() => { refresh(); }, [refresh]);

  const allSelected = useMemo(() => rows != null && rows.length > 0 && rows.every((r) => selected.has(r.id)), [rows, selected]);

  const toggleAll = () => {
    if (!rows) return;
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(rows.map((r) => r.id)));
  };
  const toggle = (id: string) => setSelected(cur => {
    const next = new Set(cur);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const markReviewed = async () => {
    if (selected.size === 0) return;
    setBusy(true);
    try {
      await withToast(api.call('parser-mark-reviewed', { method: 'POST', body: { ids: Array.from(selected) } }), { success: `${selected.size} marked reviewed.` });
      setSelected(new Set());
      refresh();
    } finally {
      setBusy(false);
    }
  };

  const download = async () => {
    try {
      await api.download('parser-export');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow="Operations"
        title="Parser failures"
        description="SMS the Flutter watcher couldn't classify. Select unreviewed entries, mark them reviewed, then export the corpus to update the Dart parser tests."
        actions={(
          <>
            <Button variant="secondary" size="sm" disabled={!rows || rows.length === 0} onClick={toggleAll}>{allSelected ? 'Unselect all' : 'Select all'}</Button>
            <Button variant="primary" size="sm" disabled={selected.size === 0} loading={busy} onClick={markReviewed}>Mark reviewed ({selected.size})</Button>
            <Button variant="secondary" size="sm" onClick={download}>Export JSON</Button>
          </>
        )}
      />

      {err && <ErrorState error={err} onRetry={refresh} />}

      {loading && !rows && (
        <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Card key={i}><Skeleton className="h-16 w-full" /></Card>)}</div>
      )}

      {!loading && rows && rows.length === 0 && (
        <Card>
          <EmptyState
            title="No unreviewed parser failures"
            description="When bKash changes its SMS format and the watcher's parser stops matching, raw SMS land here for you to triage."
          />
        </Card>
      )}

      {rows && rows.length > 0 && (
        <ul className="space-y-2">
          {rows.map((r) => {
            const isSelected = selected.has(r.id);
            return (
              <li key={r.id}>
                <label className={['block bg-white border rounded-2xl p-4 cursor-pointer transition-colors', isSelected ? 'border-accent-400 bg-accent-50/30' : 'border-charcoal-200 hover:border-charcoal-300'].join(' ')}>
                  <div className="flex items-start gap-3">
                    <input type="checkbox" checked={isSelected} onChange={() => toggle(r.id)} className="w-4 h-4 mt-0.5 accent-accent-500" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <span className="text-[11px] uppercase tracking-[0.18em] text-charcoal-500 font-bold"><TimeCell iso={r.sms_timestamp} /></span>
                        <span className="font-mono text-[11px] text-charcoal-500">{r.sender_msisdn ?? '—'}</span>
                      </div>
                      <pre className="mt-2 whitespace-pre-wrap font-mono text-[12px] text-brand-700 break-all">{r.raw_body}</pre>
                    </div>
                  </div>
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
