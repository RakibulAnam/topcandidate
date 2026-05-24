// AdminScreen — operator-only single-page admin panel mounted at /admin.
//
// AUTH MODEL (single operator):
//   - On first visit, shows a "paste admin key" gate.
//   - Stores the key in localStorage under ADMIN_KEY_STORAGE.
//   - All fetches include `X-Admin-Key`. On 401 we clear the key and bounce
//     back to the gate.
//   - There is no Supabase auth here. The operator does not sign in via
//     Supabase to use this — the ADMIN_API_KEY is the only credential.
//
// SCOPE:
//   Four tabs — Pending, Orphans, Disputes, Parser failures.
//   English-only (operator surface; not run through i18n).

import React, { useCallback, useEffect, useMemo, useState } from 'react';

const ADMIN_KEY_STORAGE = 'topcandidate.adminKey';

interface FetchOpts {
  method?: 'GET' | 'POST';
  body?: unknown;
}

class AdminApi {
  constructor(private key: string, private on401: () => void) {}
  async call<T = unknown>(path: string, opts: FetchOpts = {}): Promise<T> {
    const res = await fetch(path, {
      method: opts.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Key': this.key,
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (res.status === 401) {
      this.on401();
      throw new Error('Admin key rejected.');
    }
    const text = await res.text();
    const data = text ? (JSON.parse(text) as unknown) : null;
    if (!res.ok) {
      const err = (data as { error?: string })?.error ?? `HTTP ${res.status}`;
      throw new Error(err);
    }
    return data as T;
  }
}

export const AdminScreen: React.FC = () => {
  const [key, setKey] = useState<string | null>(() => {
    try { return localStorage.getItem(ADMIN_KEY_STORAGE); } catch { return null; }
  });
  const [tab, setTab] = useState<'pending' | 'orphans' | 'disputes' | 'parser'>('pending');

  const lock = useCallback(() => {
    try { localStorage.removeItem(ADMIN_KEY_STORAGE); } catch { /* ignore */ }
    setKey(null);
  }, []);

  const api = useMemo(() => (key ? new AdminApi(key, lock) : null), [key, lock]);

  if (!key || !api) {
    return <Gate onUnlock={(k) => {
      try { localStorage.setItem(ADMIN_KEY_STORAGE, k); } catch { /* ignore */ }
      setKey(k);
    }} />;
  }

  return (
    <div className="min-h-screen bg-charcoal-50 text-brand-700">
      <header className="bg-white border-b border-charcoal-200 sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-baseline gap-1.5">
            <span className="font-display text-lg font-semibold tracking-tight text-brand-700">TOP</span>
            <span className="font-display text-lg font-semibold tracking-tight text-accent-500">CANDIDATE</span>
            <span className="ml-2 text-[11px] uppercase tracking-[0.22em] text-charcoal-500 font-bold">Admin</span>
          </div>
          <nav className="flex items-center gap-1 text-sm">
            <TabButton active={tab === 'pending'} onClick={() => setTab('pending')}>Pending</TabButton>
            <TabButton active={tab === 'orphans'} onClick={() => setTab('orphans')}>Orphans</TabButton>
            <TabButton active={tab === 'disputes'} onClick={() => setTab('disputes')}>Disputes</TabButton>
            <TabButton active={tab === 'parser'} onClick={() => setTab('parser')}>Parser failures</TabButton>
            <button
              type="button"
              onClick={lock}
              className="ml-2 px-3 py-1.5 rounded-full text-xs font-semibold text-charcoal-500 hover:text-brand-700"
            >Lock</button>
          </nav>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6">
        <DashboardTiles api={api} />
        {tab === 'pending' && <PendingTab api={api} />}
        {tab === 'orphans' && <OrphansTab api={api} />}
        {tab === 'disputes' && <DisputesTab api={api} />}
        {tab === 'parser' && <ParserFailuresTab api={api} />}
      </main>
    </div>
  );
};

// ─── gate ────────────────────────────────────────────────────────────────

const Gate: React.FC<{ onUnlock: (key: string) => void }> = ({ onUnlock }) => {
  const [val, setVal] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    setErr(null);
    if (val.trim().length < 16) {
      setErr('Key looks too short.');
      return;
    }
    // Round-trip the key against /api/admin/dashboard to validate before
    // storing — saves the operator from typoed keys silently failing later.
    try {
      const res = await fetch('/api/admin/dashboard', { headers: { 'X-Admin-Key': val.trim() } });
      if (res.status === 401) {
        setErr('Key rejected.');
        return;
      }
      if (!res.ok) {
        setErr(`Server returned ${res.status}.`);
        return;
      }
      onUnlock(val.trim());
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Network error.');
    }
  };
  return (
    <div className="min-h-screen flex items-center justify-center bg-charcoal-50 px-6">
      <div className="w-full max-w-md bg-white border border-charcoal-200 rounded-2xl p-6 shadow-sm">
        <div className="flex items-baseline gap-1.5">
          <span className="font-display text-lg font-semibold tracking-tight text-brand-700">TOP</span>
          <span className="font-display text-lg font-semibold tracking-tight text-accent-500">CANDIDATE</span>
        </div>
        <h1 className="mt-3 font-display text-xl font-semibold text-brand-700">Admin</h1>
        <p className="mt-1 text-sm text-charcoal-500">Paste your admin key to continue. The key is stored in this browser only.</p>
        <input
          type="password"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
          className="mt-4 block w-full px-3 py-2 rounded-xl border border-charcoal-300 font-mono text-sm focus:outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-200"
          placeholder="ADMIN_API_KEY"
          autoFocus
        />
        {err && <div className="mt-2 text-[12px] text-red-700">{err}</div>}
        <button
          type="button"
          onClick={() => void submit()}
          className="mt-4 w-full px-4 py-2.5 rounded-full bg-brand-700 hover:bg-brand-800 text-white text-sm font-semibold"
        >Unlock</button>
      </div>
    </div>
  );
};

// ─── shared bits ────────────────────────────────────────────────────────

const TabButton: React.FC<{ active: boolean; onClick: () => void; children: React.ReactNode }> = ({ active, onClick, children }) => (
  <button
    type="button"
    onClick={onClick}
    className={[
      'px-3 py-1.5 rounded-full text-sm font-semibold transition-colors',
      active ? 'bg-brand-700 text-white' : 'text-charcoal-500 hover:text-brand-700 hover:bg-charcoal-100',
    ].join(' ')}
  >{children}</button>
);

const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const cls =
    status === 'completed' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
    status === 'pending' ? 'bg-charcoal-100 text-brand-700 border-charcoal-300' :
    status === 'underpaid' || status === 'msisdn_mismatch_review' ? 'bg-accent-50 text-brand-700 border-accent-200' :
    'bg-red-50 text-red-700 border-red-200';
  return <span className={['inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border', cls].join(' ')}>{status}</span>;
};

const ReasonPromptModal: React.FC<{
  title: string;
  busy?: boolean;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}> = ({ title, busy, onConfirm, onCancel }) => {
  const [reason, setReason] = useState('');
  const ok = reason.trim().length > 0 && !busy;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-brand-900/60 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative w-full max-w-md bg-white rounded-2xl p-5 shadow-xl">
        <h3 className="font-display text-base font-semibold text-brand-700">{title}</h3>
        <p className="mt-1 text-[12px] text-charcoal-500">A reason is required for the audit log.</p>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={4}
          className="mt-3 block w-full px-3 py-2 rounded-xl border border-charcoal-300 text-sm focus:outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-200"
          placeholder="Why are you doing this?"
          autoFocus
        />
        <div className="mt-4 flex items-center justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={busy} className="px-3 py-1.5 rounded-full text-sm font-semibold text-charcoal-500">Cancel</button>
          <button type="button" disabled={!ok} onClick={() => onConfirm(reason.trim())} className="px-4 py-1.5 rounded-full text-sm font-semibold bg-brand-700 hover:bg-brand-800 text-white disabled:opacity-50">
            {busy ? 'Working…' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── dashboard tiles ─────────────────────────────────────────────────────

interface DashboardStats {
  pending: number;
  completedToday: number;
  completedTodayTaka: number;
  openDisputes: number;
  expired24h: number;
  orphanSms: number;
  oldestPendingCreatedAt: string | null;
}

const DashboardTiles: React.FC<{ api: AdminApi }> = ({ api }) => {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  useEffect(() => {
    let cancelled = false;
    const run = () => api.call<DashboardStats>('/api/admin/dashboard').then((s) => { if (!cancelled) setStats(s); }).catch(() => {});
    void run();
    const id = setInterval(run, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [api]);
  if (!stats) return null;
  const oldestAgeMin = stats.oldestPendingCreatedAt ? Math.floor((Date.now() - new Date(stats.oldestPendingCreatedAt).getTime()) / 60_000) : null;
  const pendingTone = oldestAgeMin == null ? 'neutral' : oldestAgeMin > 12 * 60 ? 'bad' : oldestAgeMin > 30 ? 'warn' : 'neutral';
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
      <Tile label="Pending" value={String(stats.pending)} sub={oldestAgeMin == null ? 'none' : `oldest ${oldestAgeMin}m`} tone={pendingTone} />
      <Tile label="Completed today" value={String(stats.completedToday)} sub={`৳${stats.completedTodayTaka}`} tone="neutral" />
      <Tile label="Open disputes" value={String(stats.openDisputes)} sub="" tone={stats.openDisputes > 0 ? 'bad' : 'neutral'} />
      <Tile label="Orphan SMS" value={String(stats.orphanSms)} sub={`${stats.expired24h} expired 24h`} tone={stats.orphanSms > 0 ? 'warn' : 'neutral'} />
    </div>
  );
};

const Tile: React.FC<{ label: string; value: string; sub: string; tone: 'neutral' | 'warn' | 'bad' }> = ({ label, value, sub, tone }) => {
  const accent =
    tone === 'bad' ? 'text-red-700' :
    tone === 'warn' ? 'text-accent-600' :
    'text-brand-700';
  return (
    <div className="bg-white border border-charcoal-200 rounded-2xl px-4 py-3">
      <div className="text-[10.5px] uppercase tracking-[0.18em] text-charcoal-500 font-bold">{label}</div>
      <div className={`mt-1 font-display text-3xl font-semibold ${accent} leading-none`}>{value}</div>
      {sub && <div className="mt-1 text-[12px] text-charcoal-500">{sub}</div>}
    </div>
  );
};

// ─── Pending tab ────────────────────────────────────────────────────────

interface PendingRow {
  id: string;
  user_id: string;
  payment_reference: string | null;
  sender_msisdn: string | null;
  amount_taka: number;
  observed_amount_taka: number | null;
  status: string;
  created_at: string;
}

const PendingTab: React.FC<{ api: AdminApi }> = ({ api }) => {
  const [rows, setRows] = useState<PendingRow[]>([]);
  const [olderThanMin, setOlderThanMin] = useState(10);
  const [action, setAction] = useState<{ kind: 'confirm' | 'refund'; row: PendingRow; overrideMsisdn?: boolean; overrideAmount?: boolean } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(() => {
    api.call<{ rows: PendingRow[] }>(`/api/admin/pending?olderThanMin=${olderThanMin}`)
      .then((r) => setRows(r.rows))
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, [api, olderThanMin]);

  useEffect(() => { refresh(); }, [refresh]);

  const onConfirmAction = async (reason: string) => {
    if (!action) return;
    try {
      const path = action.kind === 'confirm' ? '/api/admin/confirm-purchase' : '/api/admin/refund-purchase';
      const body =
        action.kind === 'confirm'
          ? {
              transactionId: action.row.payment_reference,
              reason,
              overrideMsisdnCheck: !!action.overrideMsisdn,
              overrideAmountCheck: !!action.overrideAmount,
            }
          : { transactionId: action.row.payment_reference, reason };
      await api.call(path, { method: 'POST', body });
      setAction(null);
      refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setAction(null);
    }
  };

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-display text-lg font-semibold">Pending purchases</h2>
        <label className="text-sm text-charcoal-500 flex items-center gap-2">
          Older than
          <input
            type="number"
            min={0}
            value={olderThanMin}
            onChange={(e) => setOlderThanMin(Math.max(0, Number(e.target.value) || 0))}
            className="w-20 px-2 py-1 rounded-md border border-charcoal-300 text-sm"
          />
          min
          <button type="button" onClick={refresh} className="ml-2 px-3 py-1 rounded-full bg-brand-700 hover:bg-brand-800 text-white text-xs font-semibold">Refresh</button>
        </label>
      </div>
      {err && <div className="mb-2 text-[12px] text-red-700">{err}</div>}
      <div className="bg-white border border-charcoal-200 rounded-2xl overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-charcoal-50 text-[11px] uppercase tracking-[0.18em] text-charcoal-500 font-bold">
            <tr>
              <th className="px-3 py-2 text-left">Age</th>
              <th className="px-3 py-2 text-left">TrxID</th>
              <th className="px-3 py-2 text-left">Amount</th>
              <th className="px-3 py-2 text-left">Observed</th>
              <th className="px-3 py-2 text-left">Sender</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-charcoal-500 text-sm">No stuck pending purchases. Nice.</td></tr>
            )}
            {rows.map((r) => {
              const ageMin = Math.floor((Date.now() - new Date(r.created_at).getTime()) / 60_000);
              return (
                <tr key={r.id} className="border-t border-charcoal-100 align-middle">
                  <td className="px-3 py-2">{ageMin}m</td>
                  <td className="px-3 py-2 font-mono text-[12px]">{r.payment_reference}</td>
                  <td className="px-3 py-2">৳{r.amount_taka}</td>
                  <td className="px-3 py-2">{r.observed_amount_taka != null ? `৳${r.observed_amount_taka}` : '—'}</td>
                  <td className="px-3 py-2 font-mono text-[12px]">{r.sender_msisdn ?? '—'}</td>
                  <td className="px-3 py-2"><StatusBadge status={r.status} /></td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => setAction({ kind: 'confirm', row: r, overrideAmount: r.status === 'underpaid', overrideMsisdn: r.status === 'msisdn_mismatch_review' })}
                      className="px-2.5 py-1 rounded-full bg-brand-700 hover:bg-brand-800 text-white text-[11px] font-semibold"
                    >Confirm</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {action && (
        <ReasonPromptModal
          title={`${action.kind === 'confirm' ? 'Confirm' : 'Refund'} ${action.row.payment_reference}`}
          onCancel={() => setAction(null)}
          onConfirm={onConfirmAction}
        />
      )}
    </section>
  );
};

// ─── Orphans tab ────────────────────────────────────────────────────────

interface OrphanRow {
  id: string;
  payment_reference: string;
  sender_msisdn: string | null;
  amount_taka: number;
  raw_body: string | null;
  sms_timestamp: string;
  created_at: string;
}

interface PendingMatchRow {
  id: string;
  payment_reference: string | null;
  amount_taka: number;
  status: string;
}

const OrphansTab: React.FC<{ api: AdminApi }> = ({ api }) => {
  const [rows, setRows] = useState<OrphanRow[]>([]);
  const [pending, setPending] = useState<PendingMatchRow[]>([]);
  const [matching, setMatching] = useState<{ smsId: string; purchaseId: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(() => {
    api.call<{ rows: OrphanRow[]; pending: PendingMatchRow[] }>('/api/admin/orphans')
      .then((r) => { setRows(r.rows); setPending(r.pending); })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, [api]);

  useEffect(() => { refresh(); }, [refresh]);

  const onMatch = async (reason: string) => {
    if (!matching) return;
    try {
      await api.call('/api/admin/match-orphan', { method: 'POST', body: { smsId: matching.smsId, purchaseId: matching.purchaseId, reason } });
      setMatching(null);
      refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setMatching(null);
    }
  };

  return (
    <section>
      <h2 className="font-display text-lg font-semibold mb-3">Orphan SMS</h2>
      {err && <div className="mb-2 text-[12px] text-red-700">{err}</div>}
      <div className="bg-white border border-charcoal-200 rounded-2xl overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-charcoal-50 text-[11px] uppercase tracking-[0.18em] text-charcoal-500 font-bold">
            <tr>
              <th className="px-3 py-2 text-left">SMS time</th>
              <th className="px-3 py-2 text-left">TrxID</th>
              <th className="px-3 py-2 text-left">Sender</th>
              <th className="px-3 py-2 text-left">Amount</th>
              <th className="px-3 py-2 text-left">Match to pending</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-charcoal-500 text-sm">No orphan SMS. Clean.</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-charcoal-100 align-top">
                <td className="px-3 py-2 whitespace-nowrap">{new Date(r.sms_timestamp).toLocaleString()}</td>
                <td className="px-3 py-2 font-mono text-[12px] break-all">{r.payment_reference}</td>
                <td className="px-3 py-2 font-mono text-[12px]">{r.sender_msisdn ?? '—'}</td>
                <td className="px-3 py-2">৳{r.amount_taka}</td>
                <td className="px-3 py-2">
                  <select
                    defaultValue=""
                    onChange={(e) => { if (e.target.value) setMatching({ smsId: r.id, purchaseId: e.target.value }); }}
                    className="px-2 py-1 rounded-md border border-charcoal-300 text-sm"
                  >
                    <option value="">Choose…</option>
                    {pending.map((p) => (
                      <option key={p.id} value={p.id}>{p.payment_reference} · ৳{p.amount_taka} · {p.status}</option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {matching && (
        <ReasonPromptModal
          title="Match orphan SMS to pending"
          onCancel={() => setMatching(null)}
          onConfirm={onMatch}
        />
      )}
    </section>
  );
};

// ─── Disputes tab ───────────────────────────────────────────────────────

interface DisputeRow {
  id: string;
  user_id: string;
  payment_reference: string;
  notes: string | null;
  status: string;
  operator_note: string | null;
  created_at: string;
  resolved_at: string | null;
}

const DisputesTab: React.FC<{ api: AdminApi }> = ({ api }) => {
  const [rows, setRows] = useState<DisputeRow[]>([]);
  const [statusFilter, setStatusFilter] = useState<'open' | 'resolved' | 'rejected'>('open');
  const [acting, setActing] = useState<{ row: DisputeRow; resolution: 'resolved' | 'rejected' } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(() => {
    api.call<{ rows: DisputeRow[] }>(`/api/admin/disputes?status=${statusFilter}`)
      .then((r) => setRows(r.rows))
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, [api, statusFilter]);

  useEffect(() => { refresh(); }, [refresh]);

  const onResolve = async (note: string) => {
    if (!acting) return;
    try {
      await api.call('/api/admin/resolve-dispute', {
        method: 'POST',
        body: { disputeId: acting.row.id, resolution: acting.resolution, operatorNote: note },
      });
      setActing(null);
      refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setActing(null);
    }
  };

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-display text-lg font-semibold">Disputes</h2>
        <div className="flex items-center gap-1">
          {(['open', 'resolved', 'rejected'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter(s)}
              className={[
                'px-3 py-1 rounded-full text-xs font-semibold',
                statusFilter === s ? 'bg-brand-700 text-white' : 'text-charcoal-500 hover:bg-charcoal-100',
              ].join(' ')}
            >{s}</button>
          ))}
        </div>
      </div>
      {err && <div className="mb-2 text-[12px] text-red-700">{err}</div>}
      <div className="bg-white border border-charcoal-200 rounded-2xl overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-charcoal-50 text-[11px] uppercase tracking-[0.18em] text-charcoal-500 font-bold">
            <tr>
              <th className="px-3 py-2 text-left">Filed</th>
              <th className="px-3 py-2 text-left">User</th>
              <th className="px-3 py-2 text-left">TrxID</th>
              <th className="px-3 py-2 text-left">Notes</th>
              <th className="px-3 py-2 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-charcoal-500 text-sm">Nothing here.</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-charcoal-100 align-top">
                <td className="px-3 py-2 whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</td>
                <td className="px-3 py-2 font-mono text-[11px] break-all">{r.user_id.slice(0, 8)}…</td>
                <td className="px-3 py-2 font-mono text-[12px] break-all">{r.payment_reference}</td>
                <td className="px-3 py-2 text-[13px] max-w-md">{r.notes}</td>
                <td className="px-3 py-2 text-right">
                  {r.status === 'open' ? (
                    <div className="flex items-center justify-end gap-1">
                      <button type="button" onClick={() => setActing({ row: r, resolution: 'resolved' })} className="px-2.5 py-1 rounded-full bg-brand-700 hover:bg-brand-800 text-white text-[11px] font-semibold">Resolve</button>
                      <button type="button" onClick={() => setActing({ row: r, resolution: 'rejected' })} className="px-2.5 py-1 rounded-full bg-charcoal-200 hover:bg-charcoal-300 text-brand-700 text-[11px] font-semibold">Reject</button>
                    </div>
                  ) : <span className="text-[12px] text-charcoal-500">{r.status}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {acting && (
        <ReasonPromptModal
          title={`${acting.resolution === 'resolved' ? 'Resolve' : 'Reject'} dispute`}
          onCancel={() => setActing(null)}
          onConfirm={onResolve}
        />
      )}
    </section>
  );
};

// ─── Parser failures tab ────────────────────────────────────────────────

interface ParserRow {
  id: string;
  payment_reference: string;
  sender_msisdn: string | null;
  raw_body: string | null;
  sms_timestamp: string;
  created_at: string;
}

const ParserFailuresTab: React.FC<{ api: AdminApi }> = ({ api }) => {
  const [rows, setRows] = useState<ParserRow[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.call<{ rows: ParserRow[] }>('/api/admin/parser-failures')
      .then((r) => setRows(r.rows))
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, [api]);

  return (
    <section>
      <h2 className="font-display text-lg font-semibold mb-3">Parser failures</h2>
      <p className="text-sm text-charcoal-500 mb-3">SMS the Flutter watcher could not classify. Use these to update the parser when bKash changes its SMS format.</p>
      {err && <div className="mb-2 text-[12px] text-red-700">{err}</div>}
      <div className="space-y-2">
        {rows.length === 0 && <div className="text-sm text-charcoal-500">No parser failures recorded.</div>}
        {rows.map((r) => (
          <div key={r.id} className="bg-white border border-charcoal-200 rounded-xl p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] uppercase tracking-[0.18em] text-charcoal-500 font-bold">{new Date(r.sms_timestamp).toLocaleString()}</span>
              <span className="font-mono text-[11px] text-charcoal-500">{r.payment_reference}</span>
            </div>
            <pre className="mt-1 whitespace-pre-wrap font-mono text-[12px] text-brand-700 break-all">{r.raw_body}</pre>
          </div>
        ))}
      </div>
    </section>
  );
};
