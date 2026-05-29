// Purchases — filterable list + click-through to detail.
//
// Filters use a segmented status-multi-select + age single-select. The
// detail subview shows a lifecycle timeline, an audit list with diffs,
// and a state-driven action panel (only the right actions for the row's
// current state are offered).

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { AdminApi } from './adminApi';
import { ageMin, taka } from './adminApi';
import {
  Button, Card, DataTable, EmptyState, ErrorState, FilterChip, JsonDiff,
  KeyValue, PageHeader, ReasonModal, SearchInput, Section, Skeleton,
  StatusPill, TimeCell, useDebounced, withToast, type ButtonProps,
} from './ui';

interface PurchaseRow {
  id: string;
  user_id: string;
  email: string | null;
  payment_reference: string | null;
  amount_taka: number;
  observed_amount_taka: number | null;
  sender_msisdn: string | null;
  status: string;
  credits_granted: number;
  created_at: string;
}

interface PurchasesResp { rows: PurchaseRow[]; total: number; page: number; pageSize: number }

const ALL_STATUSES = ['pending', 'completed', 'failed', 'expired', 'underpaid', 'msisdn_mismatch_review', 'refunded'] as const;
type Status = (typeof ALL_STATUSES)[number];

export const PurchasesTab: React.FC<{ api: AdminApi; initialPurchase?: { id?: string; trxId?: string } | null; onClearInitial?: () => void; onOpenUser: (userId: string) => void }> = ({ api, initialPurchase, onClearInitial, onOpenUser }) => {
  const [q, setQ] = useState('');
  const debouncedQ = useDebounced(q, 250);
  const [statuses, setStatuses] = useState<Set<Status>>(() => new Set(ALL_STATUSES.filter(s => s !== 'completed') as Status[]));
  const [age, setAge] = useState<'24h' | '7d' | '30d' | 'all'>('30d');
  const [page, setPage] = useState(0);
  const [data, setData] = useState<PurchasesResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ id?: string; trxId?: string } | null>(initialPurchase ?? null);

  useEffect(() => { setPage(0); }, [debouncedQ, age, statuses]);

  const refresh = useCallback(() => {
    setLoading(true);
    setErr(null);
    api.call<PurchasesResp>('purchases', { query: {
      q: debouncedQ, age, page,
      status: Array.from(statuses).join(','),
    } })
      .then(setData)
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [api, debouncedQ, age, page, statuses]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    if (initialPurchase) {
      setSelected(initialPurchase);
      onClearInitial?.();
    }
  }, [initialPurchase, onClearInitial]);

  if (selected) {
    return <PurchaseDetail api={api} sel={selected} onBack={() => setSelected(null)} onOpenUser={onOpenUser} />;
  }

  const toggleStatus = (s: Status) => {
    setStatuses((cur) => {
      const next = new Set(cur);
      if (next.has(s)) next.delete(s); else next.add(s);
      return next;
    });
  };

  return (
    <div>
      <PageHeader
        eyebrow="Records"
        title="Purchases"
        description="Every bKash purchase across all states. Default view hides completed; toggle the chip to include them."
      />

      <div className="mb-4 max-w-md">
        <SearchInput
          value={q}
          onChange={setQ}
          loading={loading && q.length > 0}
          placeholder="Search TrxID or customer email…"
          ariaLabel="Search purchases"
        />
      </div>

      <div className="mb-4 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10.5px] uppercase tracking-[0.18em] text-charcoal-500 font-bold mr-1">Status</span>
          {ALL_STATUSES.map(s => (
            <FilterChip key={s} active={statuses.has(s)} onClick={() => toggleStatus(s)}>{s.replace(/_/g, ' ')}</FilterChip>
          ))}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10.5px] uppercase tracking-[0.18em] text-charcoal-500 font-bold mr-1">Age</span>
          {(['24h', '7d', '30d', 'all'] as const).map(a => (
            <FilterChip key={a} active={age === a} onClick={() => setAge(a)}>{a}</FilterChip>
          ))}
        </div>
      </div>

      <DataTable<PurchaseRow>
        columns={[
          { key: 'age', header: 'Age', width: 'w-20', render: (r) => <span className="text-charcoal-600">{ageMin(r.created_at)}</span> },
          { key: 'trx', header: 'TrxID', render: (r) => <span className="font-mono text-[12px] break-all">{r.payment_reference}</span> },
          { key: 'customer', header: 'Customer', render: (r) => <span className="font-mono text-[12px] break-all">{r.email ?? r.user_id.slice(0, 8)}…</span> },
          { key: 'amount', header: 'Amount', width: 'w-32', align: 'right', render: (r) => (
            <div className="whitespace-nowrap">
              {taka(r.amount_taka)}
              {r.observed_amount_taka != null && r.observed_amount_taka !== r.amount_taka && <span className="block text-[11px] text-accent-600">obs {taka(r.observed_amount_taka)}</span>}
            </div>
          ) },
          { key: 'status', header: 'Status', width: 'w-44', render: (r) => <StatusPill status={r.status} /> },
        ]}
        rows={data?.rows ?? null}
        loading={loading}
        error={err}
        onRetry={refresh}
        keyForRow={(r) => r.id}
        onRowClick={(r) => setSelected({ id: r.id })}
        empty={{
          title: q ? `No purchases match "${q}"` : 'No purchases yet',
          description: q ? 'Try a different TrxID prefix or email substring, or widen the status filter.' : 'When customers buy credit packs, they\'ll appear here.',
        }}
      />

      {data && <FooterPagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} />}
    </div>
  );
};

const FooterPagination: React.FC<{ page: number; pageSize: number; total: number; onChange: (p: number) => void }> = ({ page, pageSize, total, onChange }) => {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = total === 0 ? 0 : page * pageSize + 1;
  const end = Math.min(total, page * pageSize + pageSize);
  return (
    <div className="flex items-center justify-between mt-3 text-[12px] text-charcoal-500">
      <span>{total === 0 ? 'No results' : `${start}–${end} of ${total}`}</span>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => onChange(page - 1)}>← Prev</Button>
        <span className="font-mono text-[11px]">{page + 1} / {totalPages}</span>
        <Button size="sm" variant="ghost" disabled={page + 1 >= totalPages} onClick={() => onChange(page + 1)}>Next →</Button>
      </div>
    </div>
  );
};

// ─── purchase detail ────────────────────────────────────────────────────

interface PurchaseDetailResp {
  purchase: { id: string; user_id: string; payment_reference: string; amount_taka: number; observed_amount_taka: number | null; sender_msisdn: string | null; status: string; credits_granted: number; created_at: string };
  customer: { id: string; email: string; full_name: string | null; toolkit_credits: number; flagged_at: string | null } | null;
  stateChanges: Array<{ id: string; from_status: string | null; to_status: string; actor: string; reason: string | null; created_at: string }>;
  topups: Array<{ id: string; payment_reference: string; sender_msisdn: string | null; amount_taka: number; created_at: string }>;
  overpayments: Array<{ id: string; surplus_taka: number; resolution: string; created_at: string }>;
  linkedSms: Array<{ id: string; payment_reference: string; sender_msisdn: string | null; raw_body: string | null; sms_timestamp: string }>;
  audit: Array<{ id: string; action: string; before_state: unknown; after_state: unknown; reason: string | null; created_at: string }>;
}

type Action = 'confirm' | 'refund' | 'expire' | 'reopen' | 'grant-override' | 'note';

const ACTION_META: Record<Action, { title: string; subtitle?: string; toast: string; confirmVariant?: ButtonProps['variant'] }> = {
  'confirm':        { title: 'Confirm purchase', toast: 'Purchase confirmed.', confirmVariant: 'primary' },
  'refund':         { title: 'Refund purchase', subtitle: 'Reduces the customer\'s credit balance. Process the bKash refund out-of-band.', toast: 'Purchase refunded.', confirmVariant: 'danger' },
  'expire':         { title: 'Force expire', subtitle: 'Marks the row terminal. Use when the customer says "ignore that one, I\'ll resubmit".', toast: 'Purchase expired.', confirmVariant: 'danger' },
  'reopen':         { title: 'Reopen purchase', subtitle: 'Flips back to pending and resets the 24h TTL clock.', toast: 'Purchase reopened.', confirmVariant: 'primary' },
  'grant-override': { title: 'Grant pack anyway', subtitle: 'Grants the full credit pack despite the underpayment / mismatch / expiry.', toast: 'Override granted.', confirmVariant: 'primary' },
  'note':           { title: 'Add note', subtitle: 'Audit-only — does not change the purchase state.', toast: 'Note added.' },
};

const PurchaseDetail: React.FC<{ api: AdminApi; sel: { id?: string; trxId?: string }; onBack: () => void; onOpenUser: (userId: string) => void }> = ({ api, sel, onBack, onOpenUser }) => {
  const [data, setData] = useState<PurchaseDetailResp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    setLoading(true);
    setErr(null);
    const q: Record<string, string> = {};
    if (sel.id) q.id = sel.id;
    if (sel.trxId) q.trxId = sel.trxId;
    api.call<PurchaseDetailResp>('purchase-detail', { query: q })
      .then(setData)
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [api, sel]);

  useEffect(() => { refresh(); }, [refresh]);

  const actions = useMemo<Action[]>(() => {
    if (!data) return [];
    const s = data.purchase.status;
    const out: Action[] = [];
    if (s === 'pending') out.push('confirm', 'expire');
    if (s === 'underpaid') out.push('confirm', 'grant-override', 'expire');
    if (s === 'msisdn_mismatch_review') out.push('confirm', 'expire');
    if (s === 'completed') out.push('refund');
    if (s === 'expired' || s === 'failed') out.push('reopen', 'grant-override');
    out.push('note');
    return out;
  }, [data]);

  const submit = async (reason: string) => {
    if (!action || !data) return;
    setBusy(true);
    try {
      const id = data.purchase.id;
      const trxId = data.purchase.payment_reference;
      const meta = ACTION_META[action];
      let promise: Promise<unknown> | null = null;
      if (action === 'confirm') {
        promise = api.call('confirm-purchase', { method: 'POST', body: { transactionId: trxId, reason, overrideMsisdnCheck: data.purchase.status === 'msisdn_mismatch_review', overrideAmountCheck: data.purchase.status === 'underpaid' } });
      } else if (action === 'refund') {
        promise = api.call('refund-purchase', { method: 'POST', body: { transactionId: trxId, reason } });
      } else if (action === 'expire') {
        promise = api.call('expire-purchase', { method: 'POST', body: { purchaseId: id, reason } });
      } else if (action === 'reopen') {
        promise = api.call('reopen-purchase', { method: 'POST', body: { purchaseId: id, reason } });
      } else if (action === 'grant-override') {
        promise = api.call('grant-override', { method: 'POST', body: { purchaseId: id, reason } });
      } else if (action === 'note') {
        promise = api.call('purchase-note', { method: 'POST', body: { purchaseId: id, note: reason } });
      }
      if (promise) await withToast(promise, { success: meta.toast });
      setAction(null);
      refresh();
    } finally {
      setBusy(false);
    }
  };

  if (err && !data) {
    return (
      <div>
        <Button variant="ghost" size="sm" onClick={onBack} className="mb-3">← Back to purchases</Button>
        <ErrorState error={err} onRetry={refresh} />
      </div>
    );
  }
  if (loading || !data) {
    return (
      <div>
        <Button variant="ghost" size="sm" onClick={onBack} className="mb-3">← Back to purchases</Button>
        <Card><div className="space-y-3"><Skeleton className="h-4 w-32" /><Skeleton className="h-8 w-64" /><Skeleton className="h-3 w-48" /></div></Card>
      </div>
    );
  }

  const p = data.purchase;
  return (
    <div>
      <Button variant="ghost" size="sm" onClick={onBack} className="mb-3">← Back to purchases</Button>

      <Card className="mb-5">
        <div className="flex items-start justify-between flex-wrap gap-5">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap"><StatusPill status={p.status} /><span className="font-mono text-sm text-charcoal-500">{p.payment_reference}</span></div>
            <h2 className="font-display text-3xl font-semibold text-brand-700 mt-2">{taka(p.amount_taka)}</h2>
            {p.observed_amount_taka != null && p.observed_amount_taka !== p.amount_taka && <div className="text-sm text-accent-700 mt-0.5">Observed: {taka(p.observed_amount_taka)}</div>}
            {data.customer && (
              <button type="button" onClick={() => onOpenUser(data.customer!.id)} className="mt-2 text-sm text-brand-700 hover:underline font-mono">{data.customer.email}</button>
            )}
            <div className="mt-4 grid grid-cols-2 md:grid-cols-3 gap-4">
              <KeyValue label="Created">{new Date(p.created_at).toLocaleString()}</KeyValue>
              <KeyValue label="Claimed sender" mono>{p.sender_msisdn ?? '—'}</KeyValue>
              <KeyValue label="Credits granted">{p.credits_granted}</KeyValue>
            </div>
          </div>
          <div className="shrink-0 min-w-[200px]">
            <div className="text-[10.5px] uppercase tracking-[0.18em] text-charcoal-500 font-bold mb-2">Actions</div>
            <div className="flex flex-col gap-1.5">
              {actions.map((a) => (
                <Button key={a} variant={ACTION_META[a].confirmVariant ?? 'secondary'} size="sm" onClick={() => setAction(a)}>{ACTION_META[a].title}</Button>
              ))}
            </div>
          </div>
        </div>
      </Card>

      <div className="grid md:grid-cols-2 gap-4">
        <Card padded={false}>
          <div className="px-5 pt-4 pb-2 text-[10.5px] uppercase tracking-[0.18em] text-charcoal-500 font-bold border-b border-charcoal-100">Lifecycle</div>
          <Timeline events={data.stateChanges} />
        </Card>
        <Card padded={false}>
          <div className="px-5 pt-4 pb-2 text-[10.5px] uppercase tracking-[0.18em] text-charcoal-500 font-bold border-b border-charcoal-100">Operator actions</div>
          {data.audit.length === 0 ? <EmptyState title="No operator actions" description="Nothing has been done manually on this purchase yet." /> : (
            <ul className="divide-y divide-charcoal-100">
              {data.audit.map((a) => (
                <li key={a.id} className="px-5 py-3">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="font-mono text-[12px] font-semibold text-brand-700">{a.action}</span>
                    <TimeCell iso={a.created_at} />
                  </div>
                  {a.reason && <div className="mt-1 text-[12px] text-charcoal-600 italic">"{a.reason}"</div>}
                  <JsonDiff before={a.before_state} after={a.after_state} />
                </li>
              ))}
            </ul>
          )}
        </Card>
        {(data.topups.length > 0 || data.overpayments.length > 0 || data.linkedSms.length > 0) && (
          <Card padded={false} className="md:col-span-2">
            <div className="px-5 pt-4 pb-2 text-[10.5px] uppercase tracking-[0.18em] text-charcoal-500 font-bold border-b border-charcoal-100">SMS reconciliation</div>
            <div className="grid md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-charcoal-100">
              <div className="px-5 py-3">
                <div className="text-[10px] uppercase tracking-[0.18em] text-charcoal-500 font-bold mb-2">Top-ups</div>
                {data.topups.length === 0 ? <span className="text-[12px] text-charcoal-400">None</span> : (
                  <ul className="text-[12px] space-y-1">{data.topups.map(t => (<li key={t.id} className="font-mono">{taka(t.amount_taka)} · {t.payment_reference}</li>))}</ul>
                )}
              </div>
              <div className="px-5 py-3">
                <div className="text-[10px] uppercase tracking-[0.18em] text-charcoal-500 font-bold mb-2">Overpayments</div>
                {data.overpayments.length === 0 ? <span className="text-[12px] text-charcoal-400">None</span> : (
                  <ul className="text-[12px] space-y-1">{data.overpayments.map(o => (<li key={o.id}>Surplus {taka(o.surplus_taka)} — {o.resolution}</li>))}</ul>
                )}
              </div>
              <div className="px-5 py-3">
                <div className="text-[10px] uppercase tracking-[0.18em] text-charcoal-500 font-bold mb-2">Linked SMS</div>
                {data.linkedSms.length === 0 ? <span className="text-[12px] text-charcoal-400">None</span> : (
                  <ul className="text-[12px] space-y-2">{data.linkedSms.map(s => (
                    <li key={s.id}>
                      <span className="font-mono">{s.sender_msisdn ?? '—'} · {s.payment_reference}</span>
                      {s.raw_body && <div className="mt-0.5 text-charcoal-500 whitespace-pre-wrap font-mono text-[11px]">{s.raw_body.slice(0, 200)}{s.raw_body.length > 200 ? '…' : ''}</div>}
                    </li>
                  ))}</ul>
                )}
              </div>
            </div>
          </Card>
        )}
      </div>

      <ReasonModal
        open={action !== null}
        title={action ? ACTION_META[action].title : ''}
        subtitle={action ? ACTION_META[action].subtitle : undefined}
        confirmVariant={action ? ACTION_META[action].confirmVariant : 'primary'}
        busy={busy}
        onConfirm={submit}
        onClose={() => setAction(null)}
      />
    </div>
  );
};

const Timeline: React.FC<{ events: PurchaseDetailResp['stateChanges'] }> = ({ events }) => {
  if (events.length === 0) return <EmptyState title="No state changes" description="State transitions will appear here as the purchase moves through the flow." />;
  return (
    <ol className="px-5 py-3 space-y-3">
      {events.map((e, i) => (
        <li key={e.id} className="relative pl-6">
          <span className="absolute left-0 top-1.5 w-2 h-2 rounded-full bg-accent-500" aria-hidden="true" />
          {i < events.length - 1 && <span className="absolute left-[3.5px] top-3 bottom-[-10px] w-px bg-charcoal-200" aria-hidden="true" />}
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="text-sm font-semibold text-brand-700">
              {e.from_status ?? <span className="text-charcoal-400">(initial)</span>} → <span className="text-brand-700">{e.to_status}</span>
            </div>
            <TimeCell iso={e.created_at} />
          </div>
          <div className="text-[12px] text-charcoal-500 mt-0.5">by <span className="font-mono">{e.actor}</span>{e.reason && <span className="italic"> · "{e.reason}"</span>}</div>
        </li>
      ))}
    </ol>
  );
};
