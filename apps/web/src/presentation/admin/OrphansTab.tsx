// Orphans — unmatched SMS waiting for the operator to match or ignore.

import React, { useCallback, useEffect, useState } from 'react';
import type { AdminApi } from './adminApi';
import { taka } from './adminApi';
import {
  Button, DataTable, PageHeader, ReasonModal, StatusPill, TimeCell, withToast,
} from './ui';

interface OrphanRow { id: string; payment_reference: string; sender_msisdn: string | null; amount_taka: number; raw_body: string | null; sms_timestamp: string; created_at: string }
interface PendingMatchRow { id: string; payment_reference: string | null; amount_taka: number; status: string }

export const OrphansTab: React.FC<{ api: AdminApi }> = ({ api }) => {
  const [rows, setRows] = useState<OrphanRow[] | null>(null);
  const [pending, setPending] = useState<PendingMatchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [action, setAction] = useState<null | { kind: 'match'; smsId: string; purchaseId: string } | { kind: 'ignore'; smsId: string }>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    setLoading(true);
    setErr(null);
    api.call<{ rows: OrphanRow[]; pending: PendingMatchRow[] }>('orphans')
      .then((r) => { setRows(r.rows); setPending(r.pending); })
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [api]);

  useEffect(() => { refresh(); }, [refresh]);

  const submit = async (reason: string) => {
    if (!action) return;
    setBusy(true);
    try {
      if (action.kind === 'match') {
        await withToast(api.call('match-orphan', { method: 'POST', body: { smsId: action.smsId, purchaseId: action.purchaseId, reason } }), { success: 'SMS matched to pending purchase.' });
      } else {
        await withToast(api.call('orphan-mark-ignored', { method: 'POST', body: { smsId: action.smsId, reason } }), { success: 'SMS marked ignored.' });
      }
      setAction(null);
      refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow="Operations"
        title="Orphan SMS"
        description="bKash SMS the watcher couldn't match to a pending purchase. Match to a pending row, or mark ignored if personal."
        actions={<Button variant="secondary" size="sm" onClick={refresh}>Refresh</Button>}
      />

      <DataTable<OrphanRow>
        columns={[
          { key: 't', header: 'SMS time', width: 'w-44', render: (r) => <TimeCell iso={r.sms_timestamp} /> },
          { key: 'trx', header: 'TrxID', render: (r) => <span className="font-mono text-[12px] break-all">{r.payment_reference}</span> },
          { key: 'sender', header: 'Sender', width: 'w-36', render: (r) => <span className="font-mono text-[12px]">{r.sender_msisdn ?? '—'}</span> },
          { key: 'amount', header: 'Amount', width: 'w-24', align: 'right', render: (r) => <span className="whitespace-nowrap">{taka(r.amount_taka)}</span> },
          { key: 'match', header: 'Match to pending', render: (r) => (
            <select
              defaultValue=""
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => { e.stopPropagation(); if (e.target.value) setAction({ kind: 'match', smsId: r.id, purchaseId: e.target.value }); }}
              className="h-7 px-2 rounded-md border border-charcoal-300 text-sm bg-white"
            >
              <option value="">Choose…</option>
              {pending.map(p => (
                <option key={p.id} value={p.id}>{p.payment_reference} · {taka(p.amount_taka)} · {p.status}</option>
              ))}
            </select>
          ) },
          { key: 'or', header: '', width: 'w-32', align: 'right', render: (r) => (
            <Button size="sm" variant="danger" onClick={(e) => { e.stopPropagation(); setAction({ kind: 'ignore', smsId: r.id }); }}>Mark ignored</Button>
          ) },
        ]}
        rows={rows}
        loading={loading}
        error={err}
        onRetry={refresh}
        keyForRow={(r) => r.id}
        empty={{
          title: 'No orphan SMS',
          description: 'When the watcher receives a bKash SMS it can\'t match, it lands here.',
        }}
      />

      <ReasonModal
        open={action !== null}
        title={action?.kind === 'match' ? 'Match orphan to pending' : 'Mark orphan ignored'}
        subtitle={action?.kind === 'ignore' ? 'Use only for personal SMS that snuck through.' : undefined}
        confirmVariant={action?.kind === 'ignore' ? 'danger' : 'primary'}
        busy={busy}
        onConfirm={submit}
        onClose={() => setAction(null)}
      />
    </div>
  );
};
