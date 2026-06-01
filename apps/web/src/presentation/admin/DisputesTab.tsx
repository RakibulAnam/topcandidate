// Disputes — customer-filed disputes. Resolve / reject with operator note.

import React, { useCallback, useEffect, useState } from 'react';
import type { AdminApi } from './adminApi';
import {
  Button, DataTable, FilterChip, PageHeader, ReasonModal, StatusPill, TimeCell, withToast,
} from './ui';

interface DisputeRow { id: string; user_id: string; payment_reference: string; notes: string | null; status: string; operator_note: string | null; created_at: string; resolved_at: string | null }

export const DisputesTab: React.FC<{ api: AdminApi; onOpenPurchase: (trxId: string) => void }> = ({ api, onOpenPurchase }) => {
  const [rows, setRows] = useState<DisputeRow[] | null>(null);
  const [statusFilter, setStatusFilter] = useState<'open' | 'resolved' | 'rejected'>('open');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [acting, setActing] = useState<null | { row: DisputeRow; resolution: 'resolved' | 'rejected' }>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    setLoading(true);
    setErr(null);
    api.call<{ rows: DisputeRow[] }>('disputes', { query: { status: statusFilter } })
      .then((r) => setRows(r.rows))
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [api, statusFilter]);

  useEffect(() => { refresh(); }, [refresh]);

  const submit = async (note: string) => {
    if (!acting) return;
    setBusy(true);
    try {
      await withToast(api.call('resolve-dispute', { method: 'POST', body: { disputeId: acting.row.id, resolution: acting.resolution, operatorNote: note } }),
        { success: acting.resolution === 'resolved' ? 'Dispute resolved.' : 'Dispute rejected.' });
      setActing(null);
      refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow="Operations"
        title="Disputes"
        description="Customer-filed disputes. Resolve or reject with a private operator note that lands in the audit log."
      />

      <div className="mb-3 flex items-center gap-2">
        {(['open', 'resolved', 'rejected'] as const).map(s => (
          <FilterChip key={s} active={statusFilter === s} onClick={() => setStatusFilter(s)}>{s}</FilterChip>
        ))}
      </div>

      <DataTable<DisputeRow>
        columns={[
          { key: 't', header: 'Filed', width: 'w-44', render: (r) => <TimeCell iso={r.created_at} /> },
          { key: 'trx', header: 'TrxID', width: 'w-44', render: (r) => (
            <button type="button" onClick={(e) => { e.stopPropagation(); onOpenPurchase(r.payment_reference); }} className="font-mono text-[12px] text-brand-700 hover:underline break-all">{r.payment_reference}</button>
          ) },
          { key: 'notes', header: 'Customer notes', render: (r) => (
            <div className="max-w-md">
              <div className="text-[13px] whitespace-pre-wrap">{r.notes}</div>
              {r.operator_note && <div className="mt-1 text-[12px] text-accent-700 italic">op: "{r.operator_note}"</div>}
            </div>
          ) },
          { key: 'do', header: '', width: 'w-44', align: 'right', render: (r) => (
            r.status === 'open' ? (
              <div className="flex items-center justify-end gap-1.5">
                <Button size="sm" variant="primary" onClick={(e) => { e.stopPropagation(); setActing({ row: r, resolution: 'resolved' }); }}>Resolve</Button>
                <Button size="sm" variant="secondary" onClick={(e) => { e.stopPropagation(); setActing({ row: r, resolution: 'rejected' }); }}>Reject</Button>
              </div>
            ) : <StatusPill status={r.status} />
          ) },
        ]}
        rows={rows}
        loading={loading}
        error={err}
        onRetry={refresh}
        keyForRow={(r) => r.id}
        empty={{
          title: statusFilter === 'open' ? 'No open disputes' : `No ${statusFilter} disputes`,
          description: statusFilter === 'open' ? 'When customers file disputes from the in-app banner, they\'ll appear here.' : undefined,
        }}
      />

      <ReasonModal
        open={acting !== null}
        title={acting?.resolution === 'resolved' ? 'Resolve dispute' : 'Reject dispute'}
        subtitle="Operator note — internal audit only, never shown to customer."
        confirmVariant={acting?.resolution === 'rejected' ? 'danger' : 'primary'}
        busy={busy}
        onConfirm={submit}
        onClose={() => setActing(null)}
      />
    </div>
  );
};
