// Users — list + search + drill-into-detail.
//
// Search is debounced (250ms) and shows an inline spinner inside the input
// while a query is in flight. Errors surface the real Supabase message
// with a retry button (the source of the old opaque "Query failed").
//
// UserDetail renders inline (no router); back is setState.

import React, { useCallback, useEffect, useState } from 'react';
import type { AdminApi } from './adminApi';
import { taka } from './adminApi';
import {
  Button, Card, ContentGrid, DataTable, EmptyState, ErrorState, FilterChip,
  JsonDiff, KeyValue, PageHeader, ReasonModal, SearchInput, Section, Skeleton,
  StatusPill, TimeCell, focusRing, toastSuccess, useDebounced, withToast,
} from './ui';

interface UserRow {
  id: string;
  email: string;
  full_name: string | null;
  toolkit_credits: number;
  flagged_at: string | null;
  created_at: string;
}

interface UsersResp { rows: UserRow[]; total: number; page: number; pageSize: number }

export const UsersTab: React.FC<{ api: AdminApi; initialUserId?: string | null; onClearInitial?: () => void }> = ({ api, initialUserId, onClearInitial }) => {
  const [q, setQ] = useState('');
  const debouncedQ = useDebounced(q, 250);
  const [page, setPage] = useState(0);
  const [data, setData] = useState<UsersResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(initialUserId ?? null);

  useEffect(() => { setPage(0); }, [debouncedQ]);

  const refresh = useCallback(() => {
    setLoading(true);
    setErr(null);
    api.call<UsersResp>('users', { query: { q: debouncedQ, page } })
      .then((r) => setData(r))
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [api, debouncedQ, page]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    if (initialUserId) {
      setSelected(initialUserId);
      onClearInitial?.();
    }
  }, [initialUserId, onClearInitial]);

  if (selected) {
    return <UserDetail api={api} userId={selected} onBack={() => setSelected(null)} />;
  }

  return (
    <div>
      <PageHeader
        eyebrow="Records"
        title="Users"
        description="Search by email substring or paste a full user UUID."
      />

      <div className="mb-4 max-w-md">
        <SearchInput
          value={q}
          onChange={setQ}
          loading={loading && q.length > 0}
          placeholder="Search by email or paste user UUID…"
          ariaLabel="Search users"
        />
      </div>

      <DataTable<UserRow>
        columns={[
          { key: 'email', header: 'Email', render: (u) => <span className="font-mono text-[12px] break-all">{u.email}</span> },
          { key: 'name', header: 'Name', render: (u) => <span>{u.full_name ?? <span className="text-charcoal-400">—</span>}</span> },
          { key: 'credits', header: 'Credits', width: 'w-24', align: 'right', render: (u) => <span className={u.toolkit_credits < 0 ? 'text-red-700 font-semibold' : ''}>{u.toolkit_credits}</span> },
          { key: 'flagged', header: 'Status', width: 'w-28', render: (u) => u.flagged_at ? <StatusPill status="flagged" tone="danger" label="flagged" /> : <span className="text-charcoal-400 text-[12px]">—</span> },
          { key: 'joined', header: 'Joined', width: 'w-44', render: (u) => <TimeCell iso={u.created_at} /> },
        ]}
        rows={data?.rows ?? null}
        loading={loading}
        error={err}
        onRetry={refresh}
        keyForRow={(u) => u.id}
        onRowClick={(u) => setSelected(u.id)}
        empty={{
          title: q ? `No users match "${q}"` : 'No users yet',
          description: q ? 'Try a shorter substring of the email, or paste the full UUID.' : 'Users will appear here as soon as someone signs up.',
        }}
      />

      {data && (
        <FooterPagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} />
      )}
    </div>
  );
};

// ─── footer pagination ──────────────────────────────────────────────────

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

// ─── user detail ────────────────────────────────────────────────────────

interface UserDetailResp {
  profile: { id: string; email: string; full_name: string | null; phone: string | null; toolkit_credits: number; flagged_at: string | null; created_at: string };
  lifetimePaid: number;
  purchases: Array<{ id: string; payment_reference: string; amount_taka: number; observed_amount_taka: number | null; status: string; credits_granted: number; created_at: string }>;
  resumes: Array<{ id: string; title: string; company: string | null; created_at: string }>;
  aiCalls30d: number;
  notes: Array<{ id: string; note: string; created_at: string }>;
  audit: Array<{ id: string; action: string; before_state: unknown; after_state: unknown; reason: string | null; created_at: string }>;
}

type DetailTab = 'purchases' | 'resumes' | 'audit' | 'notes';

const UserDetail: React.FC<{ api: AdminApi; userId: string; onBack: () => void }> = ({ api, userId, onBack }) => {
  const [data, setData] = useState<UserDetailResp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<DetailTab>('purchases');
  const [modal, setModal] = useState<null | { kind: 'grant' | 'deduct'; amount: number } | { kind: 'flag' | 'unflag' } | { kind: 'note' }>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    setLoading(true);
    setErr(null);
    api.call<UserDetailResp>('user-detail', { query: { id: userId } })
      .then(setData)
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [api, userId]);

  useEffect(() => { refresh(); }, [refresh]);

  const submit = async (reason: string) => {
    if (!modal) return;
    setBusy(true);
    try {
      if (modal.kind === 'grant') {
        await withToast(api.call('grant-credits', { method: 'POST', body: { userId, amount: modal.amount, reason } }), { success: `Granted ${modal.amount} credit(s).` });
      } else if (modal.kind === 'deduct') {
        await withToast(api.call('deduct-credits', { method: 'POST', body: { userId, amount: modal.amount, reason } }), { success: `Deducted ${modal.amount} credit(s).` });
      } else if (modal.kind === 'flag' || modal.kind === 'unflag') {
        await withToast(api.call('flag-user', { method: 'POST', body: { userId, flagged: modal.kind === 'flag', reason } }), { success: modal.kind === 'flag' ? 'User flagged.' : 'User unflagged.' });
      } else if (modal.kind === 'note') {
        await withToast(api.call('user-note', { method: 'POST', body: { userId, note: reason } }), { success: 'Note added.' });
      }
      setModal(null);
      refresh();
    } finally {
      setBusy(false);
    }
  };

  if (err && !data) {
    return (
      <div>
        <Button variant="ghost" size="sm" onClick={onBack} className="mb-3">← Back to users</Button>
        <ErrorState error={err} onRetry={refresh} />
      </div>
    );
  }
  if (loading || !data) {
    return (
      <div>
        <Button variant="ghost" size="sm" onClick={onBack} className="mb-3">← Back to users</Button>
        <Card><div className="space-y-3"><Skeleton className="h-4 w-32" /><Skeleton className="h-8 w-64" /><Skeleton className="h-3 w-48" /></div></Card>
      </div>
    );
  }

  return (
    <div>
      <Button variant="ghost" size="sm" onClick={onBack} className="mb-3">← Back to users</Button>

      <Card className="mb-5">
        <div className="flex items-start justify-between flex-wrap gap-5">
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-2xl font-semibold text-brand-700 leading-tight">{data.profile.full_name ?? data.profile.email}</h2>
            <div className="text-sm text-charcoal-500 mt-1">
              <span className="font-mono">{data.profile.email}</span>
              {data.profile.phone && <span> · {data.profile.phone}</span>}
            </div>
            <div className="font-mono text-[11px] text-charcoal-400 mt-1">{data.profile.id}</div>
            <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4">
              <KeyValue label="Joined">{new Date(data.profile.created_at).toLocaleDateString()}</KeyValue>
              <KeyValue label="Lifetime paid">{taka(data.lifetimePaid)}</KeyValue>
              <KeyValue label="AI calls (30d)">{data.aiCalls30d}</KeyValue>
              <KeyValue label="Flagged">{data.profile.flagged_at ? <StatusPill status="flagged" tone="danger" label="flagged" /> : <span className="text-charcoal-400">—</span>}</KeyValue>
            </div>
          </div>
          <div className="text-right shrink-0 min-w-[160px]">
            <div className="text-[10.5px] uppercase tracking-[0.18em] text-charcoal-500 font-bold">Credits</div>
            <div className={`font-display text-4xl font-semibold ${data.profile.toolkit_credits < 0 ? 'text-red-700' : 'text-brand-700'} leading-none mt-1`}>{data.profile.toolkit_credits}</div>
            <div className="mt-3 flex flex-col items-end gap-1.5">
              <CreditAdjuster label="Grant" variant="primary" onSubmit={(n) => setModal({ kind: 'grant', amount: n })} />
              <CreditAdjuster label="Deduct" variant="danger" onSubmit={(n) => setModal({ kind: 'deduct', amount: n })} />
            </div>
          </div>
        </div>
        <div className="mt-5 pt-5 border-t border-charcoal-100 flex items-center gap-2 flex-wrap">
          <Button variant="secondary" size="sm" onClick={() => setModal({ kind: 'note' })}>+ Note</Button>
          {data.profile.flagged_at ? (
            <Button variant="danger" size="sm" onClick={() => setModal({ kind: 'unflag' })}>Unflag user</Button>
          ) : (
            <Button variant="secondary" size="sm" onClick={() => setModal({ kind: 'flag' })}>Flag user</Button>
          )}
          <a href={`mailto:${data.profile.email}`} className={['inline-flex items-center h-7 px-2.5 rounded-full text-[11px] font-semibold border bg-white hover:bg-charcoal-50 text-brand-700 border-charcoal-300', focusRing].join(' ')}>Email customer</a>
        </div>
      </Card>

      <div className="flex items-center gap-1 mb-3">
        {(['purchases', 'resumes', 'audit', 'notes'] as const).map((t) => (
          <FilterChip key={t} active={tab === t} onClick={() => setTab(t)}>{t}</FilterChip>
        ))}
      </div>

      <Card padded={false}>
        {tab === 'purchases' && <PurchaseTable rows={data.purchases} />}
        {tab === 'resumes' && <ResumeTable rows={data.resumes} />}
        {tab === 'audit' && <AuditList rows={data.audit} />}
        {tab === 'notes' && <NotesList rows={data.notes} />}
      </Card>

      <ReasonModal
        open={modal !== null}
        title={
          modal?.kind === 'grant' ? `Grant ${modal.amount} credit${modal.amount === 1 ? '' : 's'}` :
          modal?.kind === 'deduct' ? `Deduct ${modal.amount} credit${modal.amount === 1 ? '' : 's'}` :
          modal?.kind === 'flag' ? 'Flag user' :
          modal?.kind === 'unflag' ? 'Unflag user' :
          modal?.kind === 'note' ? 'Add note' : ''
        }
        subtitle={modal?.kind === 'note' ? 'Note is private to the admin panel and also serves as an audit entry.' : undefined}
        confirmVariant={modal?.kind === 'deduct' || modal?.kind === 'flag' ? 'danger' : 'primary'}
        busy={busy}
        onConfirm={submit}
        onClose={() => setModal(null)}
      />
    </div>
  );
};

// ─── sub-tables for UserDetail ──────────────────────────────────────────

const PurchaseTable: React.FC<{ rows: UserDetailResp['purchases'] }> = ({ rows }) => {
  if (rows.length === 0) return <EmptyState title="No purchases yet" description="When the customer pays via bKash, their purchases will appear here." />;
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="text-[11px] uppercase tracking-[0.18em] text-charcoal-500 font-bold">
          <tr>
            <th className="text-left px-4 py-3">TrxID</th>
            <th className="text-left px-4 py-3">Status</th>
            <th className="text-right px-4 py-3">Amount</th>
            <th className="text-right px-4 py-3">Credits</th>
            <th className="text-left px-4 py-3">Created</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id} className="border-t border-charcoal-100">
              <td className="px-4 py-2.5 font-mono text-[12px] break-all">{p.payment_reference}</td>
              <td className="px-4 py-2.5"><StatusPill status={p.status} /></td>
              <td className="px-4 py-2.5 text-right whitespace-nowrap">{taka(p.amount_taka)}{p.observed_amount_taka != null && p.observed_amount_taka !== p.amount_taka && <span className="block text-[11px] text-accent-600">obs {taka(p.observed_amount_taka)}</span>}</td>
              <td className="px-4 py-2.5 text-right">{p.credits_granted}</td>
              <td className="px-4 py-2.5"><TimeCell iso={p.created_at} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const ResumeTable: React.FC<{ rows: UserDetailResp['resumes'] }> = ({ rows }) => {
  if (rows.length === 0) return <EmptyState title="No generated resumes" description="Read-only context — the customer hasn't generated anything yet." />;
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="text-[11px] uppercase tracking-[0.18em] text-charcoal-500 font-bold">
          <tr><th className="text-left px-4 py-3">Title</th><th className="text-left px-4 py-3">Company</th><th className="text-left px-4 py-3">Created</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-charcoal-100">
              <td className="px-4 py-2.5">{r.title}</td>
              <td className="px-4 py-2.5">{r.company ?? <span className="text-charcoal-400">—</span>}</td>
              <td className="px-4 py-2.5"><TimeCell iso={r.created_at} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const AuditList: React.FC<{ rows: UserDetailResp['audit'] }> = ({ rows }) => {
  if (rows.length === 0) return <EmptyState title="No admin actions yet" description="When you grant credits, flag, or otherwise act on this user, it will show up here." />;
  return (
    <ul className="divide-y divide-charcoal-100">
      {rows.map((a) => (
        <li key={a.id} className="px-4 py-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <span className="font-mono text-[12px] font-semibold text-brand-700">{a.action}</span>
            <TimeCell iso={a.created_at} />
          </div>
          {a.reason && <div className="mt-1 text-[12px] text-charcoal-600 italic">"{a.reason}"</div>}
          <div className="mt-1"><JsonDiff before={a.before_state} after={a.after_state} /></div>
        </li>
      ))}
    </ul>
  );
};

const NotesList: React.FC<{ rows: UserDetailResp['notes'] }> = ({ rows }) => {
  if (rows.length === 0) return <EmptyState title="No notes yet" description="Add a note to keep a private breadcrumb on this user — visible only inside the admin panel." />;
  return (
    <ul className="divide-y divide-charcoal-100">
      {rows.map((n) => (
        <li key={n.id} className="px-4 py-3">
          <div className="text-[11px] text-charcoal-500"><TimeCell iso={n.created_at} /></div>
          <div className="mt-1 text-sm whitespace-pre-wrap">{n.note}</div>
        </li>
      ))}
    </ul>
  );
};

// ─── credit adjuster ────────────────────────────────────────────────────

const CreditAdjuster: React.FC<{ label: string; variant: 'primary' | 'danger'; onSubmit: (n: number) => void }> = ({ label, variant, onSubmit }) => {
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState('');
  if (!open) {
    return <Button size="sm" variant={variant === 'primary' ? 'subtle' : 'secondary'} onClick={() => setOpen(true)}>{label}</Button>;
  }
  return (
    <div className="flex items-center gap-1">
      <input
        type="number"
        min={1}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        placeholder="N"
        className={['w-16 h-7 px-2 rounded-md border border-charcoal-300 text-sm', focusRing, 'focus:border-accent-500'].join(' ')}
        autoFocus
      />
      <Button size="sm" variant={variant} onClick={() => { const n = Math.max(1, Math.floor(Number(val) || 0)); if (n > 0) { onSubmit(n); setOpen(false); setVal(''); } }}>{label}</Button>
      <Button size="sm" variant="ghost" onClick={() => { setOpen(false); setVal(''); }}>×</Button>
    </div>
  );
};
