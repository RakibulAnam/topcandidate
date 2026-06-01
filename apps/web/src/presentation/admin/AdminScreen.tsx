// AdminScreen — operator-only admin panel mounted at /admin.
//
// UX MODEL (post-redesign)
// ========================
// Left rail (collapses to icons at <lg; off-canvas drawer on <md) + top bar
// + scrollable main. No router — single tab + selected-entity state lives
// here; subviews (UserDetail, PurchaseDetail) are rendered by their parent
// tab. Cross-tab jumps (e.g. Dashboard "View" → Purchases tab → purchase
// detail) are handled by passing initial selection through props.
//
// AUTH MODEL (unchanged)
// ======================
// Single operator. ADMIN_API_KEY pasted into the gate → stored in
// localStorage → included on every API call as X-Admin-Key. 401 → clear
// the key and bounce to the gate.
//
// TOASTS
// ======
// We mount our own <Toaster /> here. The customer-facing tree has its own
// Toaster in App.tsx; this one is independent (admin path short-circuits
// before the customer providers). Every write action posts a success/
// failure toast via toastSuccess/toastError.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Toaster } from 'sonner';
import { AdminApi, ADMIN_KEY_STORAGE } from './adminApi';
import { Button, focusRing } from './ui';
import { DashboardTab } from './DashboardTab';
import { UsersTab } from './UsersTab';
import { PurchasesTab } from './PurchasesTab';
import { OrphansTab } from './OrphansTab';
import { DisputesTab } from './DisputesTab';
import { ParserFailuresTab } from './ParserFailuresTab';
import { AuditLogTab } from './AuditLogTab';
import { SettingsTab } from './SettingsTab';

type TabKey = 'dashboard' | 'users' | 'purchases' | 'orphans' | 'disputes' | 'parser' | 'audit' | 'settings';

interface NavItem {
  key: TabKey;
  label: string;
  icon: React.ReactNode;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

// Sidebar grouping — modeled after Stripe / Linear / Vercel admin layouts:
// Overview (the single most-used view) sits at top, operational workflows
// next, records-style browses below, and system at the bottom.
const NAV: NavSection[] = [
  {
    title: 'Overview',
    items: [
      { key: 'dashboard', label: 'Dashboard', icon: <Icon path="M3 12 12 4l9 8M5 10v10h14V10" /> },
    ],
  },
  {
    title: 'Operations',
    items: [
      { key: 'disputes', label: 'Disputes', icon: <Icon path="M3 21v-1a8 8 0 0 1 16 0v1M11 3h8v6h-8z" /> },
      { key: 'orphans', label: 'Orphan SMS', icon: <Icon path="M4 4h16v12H5l-1 4z" /> },
      { key: 'parser', label: 'Parser failures', icon: <Icon path="M5 5h14v14H5z M9 9l6 6 M15 9l-6 6" /> },
    ],
  },
  {
    title: 'Records',
    items: [
      { key: 'users', label: 'Users', icon: <Icon path="M16 11a4 4 0 1 0-8 0 4 4 0 0 0 8 0 z M3 21a9 9 0 0 1 18 0" /> },
      { key: 'purchases', label: 'Purchases', icon: <Icon path="M3 7h18l-2 12H5z M8 7V5a4 4 0 0 1 8 0v2" /> },
      { key: 'audit', label: 'Audit log', icon: <Icon path="M9 4h6l5 5v11H4V4z M14 4v5h5" /> },
    ],
  },
  {
    title: 'System',
    items: [
      { key: 'settings', label: 'Settings', icon: <Icon path="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 z M19 12a7 7 0 0 0-.4-2.3l2-1.5-2-3.4-2.3 1A7 7 0 0 0 14 4.4L13.6 2h-3.2L10 4.4a7 7 0 0 0-2.3 1.3l-2.3-1-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .8.1 1.6.4 2.3l-2 1.5 2 3.4 2.3-1A7 7 0 0 0 10 19.6L10.4 22h3.2l.4-2.4a7 7 0 0 0 2.3-1.3l2.3 1 2-3.4-2-1.5c.3-.7.4-1.5.4-2.3z" /> },
    ],
  },
];

const ALL_TABS = NAV.flatMap((s) => s.items.map((i) => i.key));

const TAB_META: Record<TabKey, { title: string; description?: string }> = {
  dashboard: { title: 'Dashboard', description: 'At-a-glance state of pending payments, disputes, and SMS reconciliation.' },
  users: { title: 'Users', description: 'Customer profiles, credits, history, and operator notes.' },
  purchases: { title: 'Purchases', description: 'Every bKash purchase across all states.' },
  orphans: { title: 'Orphan SMS', description: 'Inbound bKash SMS the watcher could not match to a pending purchase.' },
  disputes: { title: 'Disputes', description: 'Customer-filed disputes awaiting resolution.' },
  parser: { title: 'Parser failures', description: 'SMS the watcher could not classify. Mark reviewed, then export as parser test corpus.' },
  audit: { title: 'Audit log', description: 'Append-only operator action log.' },
  settings: { title: 'Settings', description: 'Environment health, recent activity, manual cron trigger.' },
};

export const AdminScreen: React.FC = () => {
  const [key, setKey] = useState<string | null>(() => {
    try { return localStorage.getItem(ADMIN_KEY_STORAGE); } catch { return null; }
  });
  const [tab, setTab] = useState<TabKey>('dashboard');
  const [openPurchase, setOpenPurchase] = useState<{ id?: string; trxId?: string } | null>(null);
  const [openUserId, setOpenUserId] = useState<string | null>(null);
  const [palette, setPalette] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const lock = useCallback(() => {
    try { localStorage.removeItem(ADMIN_KEY_STORAGE); } catch { /* ignore */ }
    setKey(null);
  }, []);

  const api = useMemo(() => (key ? new AdminApi(key, lock) : null), [key, lock]);

  // ⌘K palette / Esc close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette((v) => !v);
      } else if (e.key === 'Escape') {
        setPalette(false);
        setDrawerOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!key || !api) {
    return (
      <>
        <Gate onUnlock={(k) => {
          try { localStorage.setItem(ADMIN_KEY_STORAGE, k); } catch { /* ignore */ }
          setKey(k);
        }} />
        <Toaster richColors position="top-right" />
      </>
    );
  }

  const goPurchase = (sel: { id?: string; trxId?: string }) => {
    setOpenPurchase(sel);
    setTab('purchases');
    setDrawerOpen(false);
  };
  const goUser = (id: string) => {
    setOpenUserId(id);
    setTab('users');
    setDrawerOpen(false);
  };
  const goTab = (t: TabKey) => {
    setTab(t);
    setDrawerOpen(false);
  };

  return (
    <div className="min-h-screen bg-charcoal-50 text-brand-700 lg:flex">
      {/* Mobile backdrop */}
      {drawerOpen && <div className="lg:hidden fixed inset-0 z-30 bg-brand-900/60 backdrop-blur-sm" onClick={() => setDrawerOpen(false)} aria-hidden="true" />}

      {/* Sidebar */}
      <aside className={[
        'fixed lg:sticky lg:top-0 inset-y-0 left-0 z-40 lg:z-auto',
        'w-64 lg:w-60 bg-white border-r border-charcoal-200',
        'transform transition-transform lg:transform-none',
        drawerOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
        'flex flex-col h-screen',
      ].join(' ')}>
        <div className="px-5 pt-5 pb-3 flex items-center justify-between">
          <div className="flex items-baseline gap-1.5">
            <span className="font-display text-lg font-semibold tracking-tight text-brand-700">TOP</span>
            <span className="font-display text-lg font-semibold tracking-tight text-accent-500">CANDIDATE</span>
          </div>
          <button type="button" onClick={() => setDrawerOpen(false)} className="lg:hidden p-1 text-charcoal-500 hover:text-brand-700" aria-label="Close menu">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="px-5 pb-4 text-[10.5px] uppercase tracking-[0.22em] text-charcoal-500 font-bold">Admin</div>

        <nav className="flex-1 overflow-y-auto px-3 pb-4 space-y-5">
          {NAV.map((section) => (
            <div key={section.title}>
              <div className="px-2 mb-1 text-[10px] uppercase tracking-[0.22em] text-charcoal-400 font-bold">{section.title}</div>
              <ul className="space-y-0.5">
                {section.items.map((item) => {
                  const active = tab === item.key;
                  return (
                    <li key={item.key}>
                      <button
                        type="button"
                        onClick={() => goTab(item.key)}
                        aria-current={active ? 'page' : undefined}
                        className={[
                          'w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-[13px] font-semibold transition-colors',
                          active ? 'bg-brand-700 text-white' : 'text-charcoal-600 hover:text-brand-700 hover:bg-charcoal-100',
                          focusRing,
                        ].join(' ')}
                      >
                        <span aria-hidden="true">{item.icon}</span>
                        <span className="flex-1 text-left">{item.label}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="border-t border-charcoal-200 px-3 py-3 space-y-1">
          <Button variant="ghost" size="sm" onClick={() => setPalette(true)} className="w-full justify-start">
            <Icon path="M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16zM21 21l-4-4" />
            <span className="flex-1 text-left">Search</span>
            <kbd className="text-[10px] font-mono text-charcoal-400">⌘K</kbd>
          </Button>
          <Button variant="ghost" size="sm" onClick={lock} className="w-full justify-start">
            <Icon path="M5 11h14v10H5z M8 11V7a4 4 0 0 1 8 0v4" />
            Lock session
          </Button>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex-1 min-w-0 flex flex-col min-h-screen">
        {/* Top bar */}
        <header className="sticky top-0 z-20 bg-charcoal-50/80 backdrop-blur border-b border-charcoal-200">
          <div className="px-4 lg:px-8 py-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <button type="button" onClick={() => setDrawerOpen(true)} className="lg:hidden p-1.5 -ml-1 text-charcoal-600" aria-label="Open menu">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
              </button>
              <div className="min-w-0">
                <div className="text-[11px] uppercase tracking-[0.22em] text-charcoal-500 font-bold">Admin</div>
                <h1 className="font-display text-lg font-semibold text-brand-700 truncate">{TAB_META[tab].title}</h1>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => setPalette(true)} className="hidden md:inline-flex">
                <Icon path="M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16zM21 21l-4-4" />
                <span className="text-charcoal-500">Quick jump…</span>
                <kbd className="ml-2 text-[10px] font-mono text-charcoal-400">⌘K</kbd>
              </Button>
            </div>
          </div>
        </header>

        <main className="flex-1 px-4 lg:px-8 py-6 max-w-7xl w-full mx-auto">
          {tab === 'dashboard' && <DashboardTab api={api} onOpenPurchase={goPurchase} onOpenDisputes={() => goTab('disputes')} onOpenOrphans={() => goTab('orphans')} />}
          {tab === 'users' && <UsersTab api={api} initialUserId={openUserId} onClearInitial={() => setOpenUserId(null)} />}
          {tab === 'purchases' && <PurchasesTab api={api} initialPurchase={openPurchase} onClearInitial={() => setOpenPurchase(null)} onOpenUser={goUser} />}
          {tab === 'orphans' && <OrphansTab api={api} />}
          {tab === 'disputes' && <DisputesTab api={api} onOpenPurchase={(trxId) => goPurchase({ trxId })} />}
          {tab === 'parser' && <ParserFailuresTab api={api} />}
          {tab === 'audit' && <AuditLogTab api={api} />}
          {tab === 'settings' && <SettingsTab api={api} onLock={lock} />}
        </main>
      </div>

      {palette && <CommandPalette onPick={(sel) => {
        setPalette(false);
        if (sel.kind === 'purchase') goPurchase({ trxId: sel.value });
        else if (sel.kind === 'user') goUser(sel.value);
        else if (sel.kind === 'tab') goTab(sel.value as TabKey);
      }} onClose={() => setPalette(false)} />}

      <Toaster richColors position="top-right" />
    </div>
  );
};

// ─── icon helper ────────────────────────────────────────────────────────

function Icon({ path }: { path: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

// ─── gate ────────────────────────────────────────────────────────────────

const Gate: React.FC<{ onUnlock: (key: string) => void }> = ({ onUnlock }) => {
  const [val, setVal] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setErr(null);
    if (val.trim().length < 16) { setErr('Key looks too short.'); return; }
    setBusy(true);
    try {
      const res = await fetch('/api/admin/dashboard', { headers: { 'X-Admin-Key': val.trim() } });
      if (res.status === 401) { setErr('Key rejected.'); return; }
      if (!res.ok) { setErr(`Server returned ${res.status}.`); return; }
      onUnlock(val.trim());
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Network error.');
    } finally {
      setBusy(false);
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
          className={['mt-4 block w-full px-3 py-2 rounded-xl border border-charcoal-300 font-mono text-sm', focusRing, 'focus:border-accent-500'].join(' ')}
          placeholder="ADMIN_API_KEY"
          autoFocus
          aria-label="Admin key"
        />
        {err && <div className="mt-2 text-[12px] text-red-700" role="alert">{err}</div>}
        <Button variant="primary" onClick={() => void submit()} loading={busy} className="mt-4 w-full">Unlock</Button>
      </div>
    </div>
  );
};

// ─── ⌘K palette ─────────────────────────────────────────────────────────

interface PaletteOption { kind: 'tab' | 'purchase' | 'user'; label: string; sub?: string; value: string }

const CommandPalette: React.FC<{ onPick: (o: PaletteOption) => void; onClose: () => void }> = ({ onPick, onClose }) => {
  const [q, setQ] = useState('');
  const trimmed = q.trim();
  const looksLikeUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed);
  const looksLikeTrxId = !looksLikeUuid && /^[A-Z0-9]{6,}$/i.test(trimmed);
  const [highlight, setHighlight] = useState(0);

  const options: PaletteOption[] = useMemo(() => {
    const out: PaletteOption[] = [];
    if (looksLikeTrxId) out.push({ kind: 'purchase', label: trimmed, sub: 'Open purchase by TrxID', value: trimmed });
    if (looksLikeUuid) out.push({ kind: 'user', label: trimmed, sub: 'Open user by id', value: trimmed });
    for (const k of ALL_TABS) {
      const label = TAB_META[k].title;
      if (!trimmed || label.toLowerCase().includes(trimmed.toLowerCase())) {
        out.push({ kind: 'tab', label, sub: 'Jump to tab', value: k });
      }
    }
    return out;
  }, [trimmed, looksLikeUuid, looksLikeTrxId]);

  useEffect(() => { setHighlight(0); }, [trimmed]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[15vh]" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-brand-900/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-xl border border-charcoal-200 overflow-hidden">
        <div className="flex items-center px-4 border-b border-charcoal-200">
          <span className="text-charcoal-400" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m20 20-3-3" /></svg>
          </span>
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight((h) => Math.min(options.length - 1, h + 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight((h) => Math.max(0, h - 1)); }
              else if (e.key === 'Enter' && options[highlight]) onPick(options[highlight]);
            }}
            placeholder="Search a TrxID, paste a user UUID, or jump to a tab"
            className="flex-1 px-3 py-3 text-sm focus:outline-none bg-transparent"
            autoFocus
          />
        </div>
        <ul className="max-h-80 overflow-y-auto py-1" role="listbox">
          {options.length === 0 && <li className="px-4 py-3 text-sm text-charcoal-500">No matches.</li>}
          {options.map((o, i) => (
            <li key={`${o.kind}:${o.value}:${i}`} role="option" aria-selected={i === highlight}>
              <button
                type="button"
                onMouseEnter={() => setHighlight(i)}
                onClick={() => onPick(o)}
                className={['w-full text-left px-4 py-2 flex items-center justify-between', i === highlight ? 'bg-charcoal-100' : 'hover:bg-charcoal-50'].join(' ')}
              >
                <span className="text-sm font-semibold text-brand-700 truncate mr-2">{o.label}</span>
                {o.sub && <span className="text-[11px] text-charcoal-500 shrink-0">{o.sub}</span>}
              </button>
            </li>
          ))}
        </ul>
        <div className="border-t border-charcoal-200 px-4 py-2 flex items-center justify-between text-[11px] text-charcoal-500">
          <span><kbd className="font-mono">↑↓</kbd> to navigate · <kbd className="font-mono">↵</kbd> to open</span>
          <span><kbd className="font-mono">esc</kbd> to close</span>
        </div>
      </div>
    </div>
  );
};
