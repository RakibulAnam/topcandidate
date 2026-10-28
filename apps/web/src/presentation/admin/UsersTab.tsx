// Users — list + search + drill-into-detail.
//
// Each row carries the user's activation stage from v_admin_user_funnel
// (migration 031): signed up → profile started → profile complete → General
// Resume → tailored resume → paid. The funnel strip above the table counts
// users who REACHED each step; clicking a step filters to users stuck AT it.
//
// Search is debounced (250ms) and shows an inline spinner inside the input
// while a query is in flight. Errors surface the real Supabase message
// with a retry button (the source of the old opaque "Query failed").
//
// UserDetail renders inline (no router); back is setState.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { formatDistanceToNowStrict } from 'date-fns';
import type { AdminApi } from './adminApi';
import { taka } from './adminApi';
import {
  Button, Card, ContentGrid, DataTable, EmptyState, ErrorState, FilterChip,
  JsonDiff, KeyValue, PageHeader, ReasonModal, SearchInput, Section, Skeleton,
  StatusPill, TimeCell, focusRing, toastOk, toastSuccess, useDebounced,
} from './ui';

interface UserRow {
  id: string;
  email: string;            // profiles.email (app-managed, can drift)
  loginEmail: string | null; // auth.users.email — the real login (source of truth)
  emailMismatch?: boolean;
  full_name: string | null;
  toolkit_credits: number;
  flagged_at: string | null;
  created_at: string;
  onboarding_complete: boolean;
  user_type: string | null;
  utm_source: string | null;
  signup_referrer: string | null;
  headline_role: string | null;
  headline_company: string | null;
  experience_count: number;
  education_count: number;
  skill_count: number;
  project_count: number;
  general_at: string | null;
  tailored_count: number;
  paid_count: number;
  last_active_at: string | null;
  stage: Stage;
  legacy_pricing?: boolean;
  master_price_taka?: number | null;
  master_offer_taka?: number;
  master_resume_unlocked_at?: string | null;
}

type Offer = 'legacy' | 'standard' | 'custom' | 'unlocked';

const OFFERS: { key: Offer; label: string }[] = [
  { key: 'legacy', label: '৳50 (legacy account)' },
  { key: 'standard', label: '৳99 (standard)' },
  { key: 'custom', label: 'Custom price' },
  { key: 'unlocked', label: 'Already unlocked' },
];

/** Master-resume price for a locked account and where it comes from. */
const offerOf = (p: { legacy_pricing?: boolean; master_price_taka?: number | null }): { taka: number; source: string } =>
  p.master_price_taka != null
    ? { taka: p.master_price_taka, source: 'custom' }
    : p.legacy_pricing ? { taka: 50, source: 'legacy' } : { taka: 99, source: 'standard' };

type Stage = 'signed_up' | 'profile_started' | 'profile_complete' | 'general_resume' | 'tailored' | 'paid';

const STAGES: { key: Stage; label: string; stuck: string }[] = [
  { key: 'signed_up', label: 'Signed up', stuck: 'Signed up, profile empty' },
  { key: 'profile_started', label: 'Profile started', stuck: 'Started profile, not finished' },
  { key: 'profile_complete', label: 'Profile done', stuck: 'Profile done, no resume yet' },
  { key: 'general_resume', label: 'General resume', stuck: 'Has General Resume, no tailored one' },
  { key: 'tailored', label: 'Tailored resume', stuck: 'Generated tailored, never paid' },
  { key: 'paid', label: 'Paid', stuck: 'Paying customers' },
];

const STAGE_TONE: Record<Stage, 'pending' | 'review' | 'info' | 'success'> = {
  signed_up: 'pending',
  profile_started: 'review',
  profile_complete: 'info',
  general_resume: 'info',
  tailored: 'success',
  paid: 'success',
};

const stageLabel = (s: Stage) => STAGES.find((x) => x.key === s)?.label ?? s;

export const StagePill: React.FC<{ stage: Stage }> = ({ stage }) => (
  <StatusPill status={stage} tone={STAGE_TONE[stage]} label={stageLabel(stage)} />
);

/** "3h ago" with the exact time on hover. */
const Ago: React.FC<{ iso: string | null | undefined }> = ({ iso }) => {
  if (!iso) return <span className="text-charcoal-400">—</span>;
  return <time dateTime={iso} title={new Date(iso).toLocaleString()} className="whitespace-nowrap">{formatDistanceToNowStrict(new Date(iso), { addSuffix: true })}</time>;
};

/** utm_source, else the referrer's host, else "direct". */
const sourceOf = (utm: string | null, referrer: string | null): string => {
  if (utm) return utm;
  if (referrer) {
    try { return new URL(referrer).hostname.replace(/^www\./, ''); } catch { return referrer; }
  }
  return 'direct';
};

interface UsersResp {
  rows: UserRow[];
  total: number;
  page: number;
  pageSize: number;
  funnel?: { reached: Record<Stage, number>; atStage: Record<Stage, number> };
  offers?: Record<Offer, number>;
}

export const UsersTab: React.FC<{ api: AdminApi; initialUserId?: string | null; onClearInitial?: () => void }> = ({ api, initialUserId, onClearInitial }) => {
  const [q, setQ] = useState('');
  const [stage, setStage] = useState<Stage | null>(null);
  const [offer, setOffer] = useState<Offer | null>(null);
  const debouncedQ = useDebounced(q, 250);
  // Page is keyed to the filter so a filter change lands on page 0 in the same render (no stale-page fetch).
  const filterKey = `${debouncedQ}|${stage ?? ''}|${offer ?? ''}`;
  const [pageState, setPageState] = useState({ key: filterKey, page: 0 });
  const page = pageState.key === filterKey ? pageState.page : 0;
  const setPage = (p: number) => setPageState({ key: filterKey, page: p });
  const [data, setData] = useState<UsersResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(initialUserId ?? null);
  const reqId = useRef(0);

  const refresh = useCallback(() => {
    const id = ++reqId.current;
    setLoading(true);
    setErr(null);
    api.call<UsersResp>('users', { query: { q: debouncedQ, page, ...(stage ? { stage } : {}), ...(offer ? { offer } : {}) } })
      .then((r) => { if (id === reqId.current) setData(r); })
      .catch((e: unknown) => { if (id === reqId.current) setErr(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (id === reqId.current) setLoading(false); });
  }, [api, debouncedQ, page, stage, offer]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    if (initialUserId) {
      setSelected(initialUserId);
      onClearInitial?.();
    }
  }, [initialUserId, onClearInitial]);

  if (selected) {
    return <UserDetail api={api} userId={selected} onBack={() => { setSelected(null); refresh(); }} onDeleted={() => { setSelected(null); refresh(); }} />;
  }

  return (
    <div>
      <PageHeader
        eyebrow="Records"
        title="Users"
        description="Where each user got to: profile, General Resume, tailored resume, payment. Search by email, name, job title or company, or paste a full user UUID."
      />

      {data?.funnel && <FunnelStrip funnel={data.funnel} active={stage} onPick={(s) => setStage((cur) => (cur === s ? null : s))} />}

      {data?.offers && (
        <div className="mb-4 flex items-center gap-1.5 flex-wrap">
          <span className="text-[10.5px] uppercase tracking-[0.14em] font-bold text-charcoal-500 mr-1">Master resume offer</span>
          {OFFERS.map((o) => (
            <FilterChip key={o.key} active={offer === o.key} onClick={() => setOffer((cur) => (cur === o.key ? null : o.key))}>
              {o.label} · {data.offers![o.key] ?? 0}
            </FilterChip>
          ))}
        </div>
      )}

      <div className="mb-4 max-w-md">
        <SearchInput
          value={q}
          onChange={setQ}
          loading={loading && q.length > 0}
          placeholder="Email, name, job title, company or UUID…"
          ariaLabel="Search users"
        />
      </div>

      <DataTable<UserRow>
        columns={[
          { key: 'email', header: 'User', render: (u) => (
            <div className="min-w-0">
              <div className="font-mono text-[12px] break-all">{u.loginEmail ?? u.email}</div>
              {u.emailMismatch && (
                <span className="block text-[10.5px] text-accent-600" title="The profile email differs from the real login email">
                  profile: {u.email}
                </span>
              )}
              <div className="text-[11.5px] text-charcoal-500">
                {u.full_name ?? <span className="text-charcoal-400">no name</span>}
                {u.user_type && <span> · {u.user_type}</span>}
                {u.flagged_at && <span className="ml-1.5"><StatusPill status="flagged" tone="danger" label="flagged" /></span>}
              </div>
              {u.headline_role && (
                <div className="text-[11.5px] text-brand-700 font-semibold">
                  {u.headline_role}{u.headline_company && <span className="font-normal text-charcoal-500"> at {u.headline_company}</span>}
                </div>
              )}
            </div>
          ) },
          { key: 'stage', header: 'Stage', width: 'w-36', render: (u) => <StagePill stage={u.stage} /> },
          { key: 'profile', header: 'Profile', width: 'w-40', render: (u) => <ProfileCell u={u} /> },
          { key: 'resumes', header: 'Resumes', width: 'w-36', render: (u) => (
            <div className="text-[12px] leading-tight">
              <div>{u.general_at ? <span className="text-emerald-700 font-semibold">General ✓</span> : <span className="text-charcoal-400">No general</span>}</div>
              <div className={u.tailored_count > 0 ? 'text-brand-700' : 'text-charcoal-400'}>{u.tailored_count} tailored</div>
            </div>
          ) },
          { key: 'offer', header: 'Master offer', width: 'w-28', render: (u) => {
            if (u.master_resume_unlocked_at) return <span className="text-[12px] text-emerald-700 font-semibold">Unlocked</span>;
            if (u.legacy_pricing === undefined) return <span className="text-charcoal-400">—</span>;
            const o = offerOf(u);
            return <span className="text-[12px]"><span className="font-semibold text-brand-700">{taka(o.taka)}</span> <span className="text-charcoal-500">{o.source}</span></span>;
          } },
          { key: 'credits', header: 'Credits', width: 'w-20', align: 'right', render: (u) => <span className={u.toolkit_credits < 0 ? 'text-red-700 font-semibold' : ''}>{u.toolkit_credits}</span> },
          { key: 'source', header: 'Source', width: 'w-28', render: (u) => <span className="text-[12px] text-charcoal-600 break-all">{sourceOf(u.utm_source, u.signup_referrer)}</span> },
          { key: 'active', header: 'Last active', width: 'w-32', render: (u) => <span className="text-[12px]"><Ago iso={u.last_active_at} /></span> },
          { key: 'joined', header: 'Joined', width: 'w-32', render: (u) => <span className="text-[12px]"><Ago iso={u.created_at} /></span> },
        ]}
        rows={data?.rows ?? null}
        loading={loading}
        error={err}
        onRetry={refresh}
        keyForRow={(u) => u.id}
        onRowClick={(u) => setSelected(u.id)}
        empty={{
          title: q ? `No users match "${q}"` : stage ? `No users at "${stageLabel(stage)}"` : 'No users yet',
          description: q ? 'Try a shorter word. Search matches email, name, job title and company.' : stage ? 'Clear the stage filter to see everyone.' : 'Users will appear here as soon as someone signs up.',
        }}
      />

      {data && (
        <FooterPagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} />
      )}
    </div>
  );
};

// ─── funnel strip ───────────────────────────────────────────────────────

const FunnelStrip: React.FC<{ funnel: NonNullable<UsersResp['funnel']>; active: Stage | null; onPick: (s: Stage) => void }> = ({ funnel, active, onPick }) => {
  const top = funnel.reached.signed_up || 0;
  return (
    <div className="mb-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        {STAGES.map((s, i) => {
          const n = funnel.reached[s.key] ?? 0;
          const prev = i === 0 ? n : funnel.reached[STAGES[i - 1].key] ?? 0;
          const isActive = active === s.key;
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => onPick(s.key)}
              aria-pressed={isActive}
              title={`${funnel.atStage[s.key] ?? 0} stuck here — ${s.stuck}. Click to filter.`}
              className={[
                'text-left rounded-xl border px-3 py-2.5 transition-colors',
                isActive ? 'bg-brand-700 border-brand-700 text-white' : 'bg-white border-charcoal-200 hover:border-charcoal-400',
                focusRing,
              ].join(' ')}
            >
              <div className={['text-[10.5px] uppercase tracking-[0.14em] font-bold', isActive ? 'text-white/80' : 'text-charcoal-500'].join(' ')}>{s.label}</div>
              <div className={['font-display text-2xl font-semibold leading-tight', isActive ? 'text-white' : 'text-brand-700'].join(' ')}>{n}</div>
              <div className={['text-[11px]', isActive ? 'text-white/80' : 'text-charcoal-500'].join(' ')}>
                {top ? `${Math.round((n / top) * 100)}% of signups` : '—'}
                {i > 0 && prev > 0 && <span> · {Math.round((n / prev) * 100)}% from prev</span>}
              </div>
              <div className={['text-[11px] mt-0.5', isActive ? 'text-white' : 'text-accent-600'].join(' ')}>{funnel.atStage[s.key] ?? 0} stuck here</div>
            </button>
          );
        })}
      </div>
      {active && (
        <div className="mt-2 text-[12px] text-charcoal-600">
          Showing: <span className="font-semibold text-brand-700">{STAGES.find((s) => s.key === active)?.stuck}</span>
          <button type="button" onClick={() => onPick(active)} className={['ml-2 underline text-charcoal-500 hover:text-brand-700', focusRing].join(' ')}>clear</button>
        </div>
      )}
    </div>
  );
};

const ProfileCell: React.FC<{ u: Pick<UserRow, 'onboarding_complete' | 'experience_count' | 'education_count' | 'skill_count' | 'project_count'> }> = ({ u }) => {
  const parts: [string, number][] = [['exp', u.experience_count], ['edu', u.education_count], ['skills', u.skill_count], ['proj', u.project_count]];
  return (
    <div className="text-[12px] leading-tight">
      <div>{u.onboarding_complete ? <span className="text-emerald-700 font-semibold">Complete</span> : <span className="text-accent-600 font-semibold">Incomplete</span>}</div>
      <div className="text-charcoal-500 text-[11px]">
        {parts.map(([k, n], i) => <span key={k} className={n > 0 ? 'text-brand-700' : 'text-charcoal-400'}>{i > 0 ? ' · ' : ''}{n} {k}</span>)}
      </div>
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
  profile: {
    id: string; email: string; full_name: string | null; phone: string | null; location: string | null;
    linkedin: string | null; github: string | null; website: string | null; user_type: string | null;
    toolkit_credits: number; flagged_at: string | null; master_resume_unlocked_at: string | null; created_at: string;
    legacy_pricing?: boolean; master_price_taka?: number | null;
  };
  background?: {
    experiences: Array<{ id: string; role: string | null; company: string | null; start_date: string | null; end_date: string | null; is_current: boolean | null }>;
    educations: Array<{ id: string; degree: string | null; field: string | null; school: string | null; start_date: string | null; end_date: string | null }>;
    skills: string[];
    projects: Array<{ id: string; name: string | null; technologies: string[] | string | null }>;
  };
  loginEmail: string | null;
  emailMismatch: boolean;
  lifetimePaid: number;
  purchases: Array<{ id: string; payment_reference: string; amount_taka: number; observed_amount_taka: number | null; status: string; credits_granted: number; is_test: boolean; created_at: string }>;
  resumes: Array<{ id: string; title: string; company: string | null; job_title: string | null; created_at: string }>;
  aiCalls30d: number;
  funnel: null | {
    stage: Stage; onboarding_complete: boolean; user_type: string | null; location: string | null;
    utm_source: string | null; utm_medium: string | null; utm_campaign: string | null; signup_referrer: string | null;
    experience_count: number; education_count: number; skill_count: number; project_count: number;
    general_at: string | null; tailored_count: number; first_tailored_at: string | null;
    paid_count: number; first_paid_at: string | null; last_active_at: string | null;
  };
  events: Array<{ id: number; event: string; props: Record<string, unknown> | null; path: string | null; created_at: string }>;
  notes: Array<{ id: string; note: string; created_at: string }>;
  audit: Array<{ id: string; action: string; before_state: unknown; after_state: unknown; reason: string | null; created_at: string }>;
}

type DetailTab = 'activity' | 'purchases' | 'resumes' | 'audit' | 'notes';

type UserModal =
  | { kind: 'grant' | 'deduct'; amount: number }
  | { kind: 'flag' | 'unflag' | 'note' | 'master' | 'delete' }
  | { kind: 'test'; purchaseId: string; isTest: boolean }
  | { kind: 'price'; price: number | null };

const UserDetail: React.FC<{ api: AdminApi; userId: string; onBack: () => void; onDeleted: () => void }> = ({ api, userId, onBack, onDeleted }) => {
  const [data, setData] = useState<UserDetailResp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<DetailTab>('activity');
  const [modal, setModal] = useState<UserModal | null>(null);
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

  const deleteEmail = data ? data.loginEmail ?? data.profile.email : '';
  // Same rule as admin_delete_user: any non-test purchase that involved (or may involve) real money.
  const MONEY_STATUSES = ['completed', 'refunded', 'underpaid', 'msisdn_mismatch_review', 'pending'];
  const realPaid = data ? data.purchases.filter((p) => MONEY_STATUSES.includes(p.status) && !p.is_test).length : 0;

  const submit = async (reason: string) => {
    if (!modal) return;
    setBusy(true);
    try {
      let ok = false;
      if (modal.kind === 'grant') {
        ok = await toastOk(api.call('grant-credits', { method: 'POST', body: { userId, amount: modal.amount, reason } }), { success: `Granted ${modal.amount} credit(s).` });
      } else if (modal.kind === 'deduct') {
        ok = await toastOk(api.call('deduct-credits', { method: 'POST', body: { userId, amount: modal.amount, reason } }), { success: `Deducted ${modal.amount} credit(s).` });
      } else if (modal.kind === 'flag' || modal.kind === 'unflag') {
        ok = await toastOk(api.call('flag-user', { method: 'POST', body: { userId, flagged: modal.kind === 'flag', reason } }), { success: modal.kind === 'flag' ? 'User flagged.' : 'User unflagged.' });
      } else if (modal.kind === 'note') {
        ok = await toastOk(api.call('user-note', { method: 'POST', body: { userId, note: reason } }), { success: 'Note added.' });
      } else if (modal.kind === 'master') {
        ok = await toastOk(api.call('grant-master-resume', { method: 'POST', body: { userId, reason } }), { success: 'Master resume unlocked.' });
      } else if (modal.kind === 'price') {
        ok = await toastOk(api.call('set-master-price', { method: 'POST', body: { userId, priceTaka: modal.price, reason } }), { success: modal.price == null ? 'Price back to the default.' : `Master resume price set to ৳${modal.price}.` });
      } else if (modal.kind === 'test') {
        ok = await toastOk(api.call('mark-test-purchase', { method: 'POST', body: { purchaseId: modal.purchaseId, isTest: modal.isTest, reason } }), { success: modal.isTest ? 'Marked as test payment.' : 'Counted as a real payment again.' });
      } else if (modal.kind === 'delete') {
        if (await toastOk(api.call('delete-user', { method: 'POST', body: { userId, confirmEmail: deleteEmail, reason } }), { success: 'User deleted.', failure: 'Delete failed' })) {
          setModal(null);
          onDeleted();
        }
        return;
      }
      if (!ok) return;
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
            <h2 className="font-display text-2xl font-semibold text-brand-700 leading-tight">{data.profile.full_name ?? data.loginEmail ?? data.profile.email}</h2>
            <div className="text-sm text-charcoal-500 mt-1">
              <span className="font-mono">{data.loginEmail ?? data.profile.email}</span>
              {data.profile.phone && <span> · {data.profile.phone}</span>}
            </div>
            {data.emailMismatch && (
              <div className="font-mono text-[11px] text-accent-600 mt-0.5" title="Profile email differs from the real login email">
                profile email: {data.profile.email}
              </div>
            )}
            <div className="font-mono text-[11px] text-charcoal-400 mt-1">{data.profile.id}</div>
            <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4">
              <KeyValue label="Joined">{new Date(data.profile.created_at).toLocaleDateString()}</KeyValue>
              <KeyValue label="Last active"><Ago iso={data.funnel?.last_active_at} /></KeyValue>
              <KeyValue label="Lifetime paid">{taka(data.lifetimePaid)}</KeyValue>
              <KeyValue label="AI calls (30d)">{data.aiCalls30d}</KeyValue>
              <KeyValue label="Type">{data.funnel?.user_type ?? <span className="text-charcoal-400">—</span>}</KeyValue>
              <KeyValue label="Location">{data.funnel?.location || <span className="text-charcoal-400">—</span>}</KeyValue>
              <KeyValue label="Source">
                {data.funnel ? sourceOf(data.funnel.utm_source, data.funnel.signup_referrer) : <span className="text-charcoal-400">—</span>}
                {data.funnel?.utm_campaign && <span className="block text-[11px] text-charcoal-500">{[data.funnel.utm_medium, data.funnel.utm_campaign].filter(Boolean).join(' · ')}</span>}
              </KeyValue>
              <KeyValue label="Flagged">{data.profile.flagged_at ? <StatusPill status="flagged" tone="danger" label="flagged" /> : <span className="text-charcoal-400">—</span>}</KeyValue>
              <KeyValue label="Master resume">
                {data.profile.master_resume_unlocked_at
                  ? <span className="text-emerald-700 font-semibold" title={new Date(data.profile.master_resume_unlocked_at).toLocaleString()}>Unlocked</span>
                  : <span className="text-charcoal-500">Locked</span>}
              </KeyValue>
              <KeyValue label="Master resume price">
                {data.profile.legacy_pricing === undefined ? <span className="text-charcoal-400">—</span> : (() => {
                  const o = offerOf(data.profile);
                  return (
                    <div>
                      <span className="font-semibold text-brand-700">{taka(o.taka)}</span> <span className="text-[11px] text-charcoal-500">{o.source}</span>
                      <div className="mt-1 flex items-center gap-1 flex-wrap">
                        <PriceSetter onSubmit={(n) => setModal({ kind: 'price', price: n })} />
                        {data.profile.master_price_taka != null && (
                          <Button size="sm" variant="ghost" onClick={() => setModal({ kind: 'price', price: null })}>Reset</Button>
                        )}
                      </div>
                    </div>
                  );
                })()}
              </KeyValue>
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
          {!data.profile.master_resume_unlocked_at && (
            <Button variant="secondary" size="sm" onClick={() => setModal({ kind: 'master' })}>Unlock master resume</Button>
          )}
          <a href={`mailto:${data.loginEmail ?? data.profile.email}`} className={['inline-flex items-center h-7 px-2.5 rounded-full text-[11px] font-semibold border bg-white hover:bg-charcoal-50 text-brand-700 border-charcoal-300', focusRing].join(' ')}>Email customer</a>
          <span className="ml-auto flex items-center gap-2">
            {realPaid > 0 && (
              <span className="text-[11px] text-charcoal-500">Mark its {realPaid} real purchase{realPaid === 1 ? '' : 's'} as test to delete</span>
            )}
            <Button
              variant="danger"
              size="sm"
              disabled={realPaid > 0}
              title={realPaid > 0 ? `Has ${realPaid} purchase${realPaid === 1 ? '' : 's'} with real money (paid, refunded, underpaid or pending). Mark them as test (Purchases tab below) before deleting.` : 'Permanently delete this account and all its data'}
              onClick={() => setModal({ kind: 'delete' })}
            >Delete user</Button>
          </span>
        </div>
      </Card>

      {data.background && <ProfileOverview data={data} />}

      {data.funnel ? (
        <Journey created={data.profile.created_at} f={data.funnel} />
      ) : (
        <Card className="mb-5"><div className="text-[12px] text-charcoal-500">Journey unavailable — run <span className="font-mono">supabase/migrations/031_admin_user_funnel.sql</span> in the Supabase SQL editor.</div></Card>
      )}

      <div className="flex items-center gap-1 mb-3">
        {(['activity', 'purchases', 'resumes', 'audit', 'notes'] as const).map((t) => (
          <FilterChip key={t} active={tab === t} onClick={() => setTab(t)}>{t}</FilterChip>
        ))}
      </div>

      <Card padded={false}>
        {tab === 'activity' && <ActivityList rows={data.events} />}
        {tab === 'purchases' && <PurchaseTable rows={data.purchases} onToggleTest={(p) => setModal({ kind: 'test', purchaseId: p.id, isTest: !p.is_test })} />}
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
          modal?.kind === 'note' ? 'Add note' :
          modal?.kind === 'master' ? 'Unlock master resume' :
          modal?.kind === 'price' ? (modal.price == null ? 'Reset master resume price' : `Set master resume price to ৳${modal.price}`) :
          modal?.kind === 'test' ? (modal.isTest ? 'Mark as test payment' : 'Count as real payment') :
          modal?.kind === 'delete' ? 'Delete user permanently' : ''
        }
        subtitle={
          modal?.kind === 'note' ? 'Note is private to the admin panel and also serves as an audit entry.' :
          modal?.kind === 'master' ? 'Lets this account build and download the master resume, same as a purchase would.' :
          modal?.kind === 'price' ? (modal.price == null ? `Back to the default: ৳${data.profile.legacy_pricing ? 50 : 99}.` : 'The user sees and pays this price from their next purchase. A payment already submitted keeps its amount.') :
          modal?.kind === 'test' ? (modal.isTest ? 'The payment still works for the user, but is left out of revenue and paying-user numbers.' : 'The payment counts in revenue and paying-user numbers again.') :
          modal?.kind === 'delete' ? 'Removes the login, profile, resumes, purchases, events and AI-call history. This cannot be undone.' : undefined
        }
        confirmLabel={modal?.kind === 'delete' ? 'Delete forever' : undefined}
        confirmText={modal?.kind === 'delete' ? deleteEmail : undefined}
        confirmVariant={modal?.kind === 'deduct' || modal?.kind === 'flag' || modal?.kind === 'delete' ? 'danger' : 'primary'}
        busy={busy}
        onConfirm={submit}
        onClose={() => setModal(null)}
      />
    </div>
  );
};

// ─── profile overview ("who is this user") ──────────────────────────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const YM = /^(\d{4})-(\d{2})/;

/** 'YYYY-MM' (MonthPicker) → 'Mar 2022'; anything else is shown as typed. */
const fmtMonth = (ym: string | null | undefined): string => {
  if (!ym) return '';
  const m = YM.exec(ym);
  return m && Number(m[2]) >= 1 && Number(m[2]) <= 12 ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : ym;
};

const toMonthIndex = (ym: string | null | undefined): number | null => {
  const m = ym ? YM.exec(ym) : null;
  return m ? Number(m[1]) * 12 + Number(m[2]) - 1 : null;
};

type Exp = NonNullable<UserDetailResp['background']>['experiences'][number];

/** Total months worked, with overlapping jobs merged so they aren't double-counted. */
const monthsOfExperience = (exps: Exp[]): number => {
  const now = new Date();
  const nowIdx = now.getFullYear() * 12 + now.getMonth();
  const spans = exps
    .map((e) => {
      const start = toMonthIndex(e.start_date);
      const end = e.is_current ? nowIdx : toMonthIndex(e.end_date);
      return start !== null && end !== null && end >= start ? ([start, end] as [number, number]) : null;
    })
    .filter((x): x is [number, number] => x !== null)
    .sort((a, b) => a[0] - b[0]);
  let total = 0;
  let cur: [number, number] | null = null;
  for (const [s, e] of spans) {
    if (!cur || s > cur[1] + 1) {
      if (cur) total += cur[1] - cur[0] + 1;
      cur = [s, e];
    } else cur[1] = Math.max(cur[1], e);
  }
  if (cur) total += cur[1] - cur[0] + 1;
  return total;
};

const fmtYears = (months: number): string => {
  if (months <= 0) return '';
  if (months < 12) return `${months} mo experience`;
  const y = Math.round((months / 12) * 10) / 10;
  return `${Number.isInteger(y) ? y.toFixed(0) : y.toFixed(1)} yrs experience`;
};

/** Current job first, then most recently ended. */
const sortExperiences = (exps: Exp[]): Exp[] =>
  [...exps].sort((a, b) => {
    if (Boolean(a.is_current) !== Boolean(b.is_current)) return a.is_current ? -1 : 1;
    const ae = a.end_date || '9999', be = b.end_date || '9999';
    if (ae !== be) return ae < be ? 1 : -1;
    return (a.start_date || '') < (b.start_date || '') ? 1 : -1;
  });

const Label: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="text-[10.5px] uppercase tracking-[0.18em] text-charcoal-500 font-bold mb-1.5">{children}</div>
);

const SKILL_CAP = 24;

const ProfileOverview: React.FC<{ data: UserDetailResp }> = ({ data }) => {
  const bg = data.background!;
  const p = data.profile;
  const exps = sortExperiences(bg.experiences.filter((e) => e.role?.trim() || e.company?.trim()));
  const edus = [...bg.educations].sort((a, b) => ((a.end_date || '9999') < (b.end_date || '9999') ? 1 : -1));
  const eduLine = (e: typeof edus[number]) => [[e.degree, e.field].filter(Boolean).join(' in '), e.school].filter(Boolean).join(', ');
  const head = exps[0];
  const months = monthsOfExperience(bg.experiences);
  // Headline: what they do now (or last did); students / no-experience users fall back to education.
  const headline = head
    ? `${head.is_current ? '' : 'Last: '}${head.role || 'Role not set'}${head.company ? ` at ${head.company}` : ''}`
    : edus[0] ? `${p.user_type === 'student' ? 'Student' : 'No work experience yet'} · ${eduLine(edus[0])}` : null;
  const facts = [p.user_type, fmtYears(months), p.location].filter(Boolean).join(' · ');
  const empty = !headline && bg.skills.length === 0 && bg.projects.length === 0;
  const links = ([['LinkedIn', p.linkedin], ['GitHub', p.github], ['Website', p.website]] as const).filter(([, u]) => u && u.trim());

  // Plain-text card for pasting into a marketing sheet or email draft.
  const copySummary = () => {
    const text = [
      [p.full_name, data.loginEmail ?? p.email].filter(Boolean).join(' — '),
      headline,
      facts,
      bg.skills.length ? `Skills: ${bg.skills.slice(0, 12).join(', ')}` : '',
      p.linkedin ? `LinkedIn: ${p.linkedin}` : '',
    ].filter(Boolean).join('\n');
    navigator.clipboard?.writeText(text).then(() => toastSuccess('Profile summary copied.'), () => {});
  };

  return (
    <Card className="mb-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="min-w-0">
          <div className="text-[10.5px] uppercase tracking-[0.18em] text-charcoal-500 font-bold">Profile</div>
          {empty ? (
            <div className="mt-1 text-sm text-charcoal-500">Nothing filled in yet: no jobs, education or skills on the profile.</div>
          ) : (
            <>
              {headline && <div className="mt-1 font-display text-xl font-semibold text-brand-700 leading-snug">{headline}</div>}
              {facts && <div className="mt-1 text-[12.5px] text-charcoal-600">{facts}</div>}
            </>
          )}
        </div>
        {!empty && <Button size="sm" variant="secondary" onClick={copySummary}>Copy summary</Button>}
      </div>

      {!empty && (
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
          <div>
            <Label>Experience</Label>
            {exps.length === 0 ? <div className="text-[12.5px] text-charcoal-400">None</div> : (
              <ul className="space-y-1.5">
                {exps.map((e) => (
                  <li key={e.id} className="text-[12.5px] leading-snug">
                    <span className="font-semibold text-brand-700">{e.role || 'Role not set'}</span>
                    {e.company && <span className="text-charcoal-600"> · {e.company}</span>}
                    <span className="block text-[11px] text-charcoal-500">{[fmtMonth(e.start_date), e.is_current ? 'Present' : fmtMonth(e.end_date)].filter(Boolean).join(' – ')}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <Label>Education</Label>
            {edus.length === 0 ? <div className="text-[12.5px] text-charcoal-400">None</div> : (
              <ul className="space-y-1.5">
                {edus.map((e) => (
                  <li key={e.id} className="text-[12.5px] leading-snug">
                    <span className="font-semibold text-brand-700">{[e.degree, e.field].filter(Boolean).join(' in ') || 'Degree not set'}</span>
                    {e.school && <span className="text-charcoal-600"> · {e.school}</span>}
                    {(e.start_date || e.end_date) && <span className="block text-[11px] text-charcoal-500">{[fmtMonth(e.start_date), fmtMonth(e.end_date)].filter(Boolean).join(' – ')}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="md:col-span-2">
            <Label>Skills</Label>
            {bg.skills.length === 0 ? <div className="text-[12.5px] text-charcoal-400">None</div> : (
              <div className="flex flex-wrap gap-1.5">
                {bg.skills.slice(0, SKILL_CAP).map((sk, i) => (
                  <span key={`${sk}-${i}`} className="px-2 py-0.5 rounded-full text-[11.5px] bg-charcoal-100 text-brand-700 border border-charcoal-200">{sk}</span>
                ))}
                {bg.skills.length > SKILL_CAP && <span className="text-[11.5px] text-charcoal-500 self-center">+{bg.skills.length - SKILL_CAP} more</span>}
              </div>
            )}
          </div>
          {bg.projects.length > 0 && (
            <div className="md:col-span-2">
              <Label>Projects</Label>
              <ul className="text-[12.5px] space-y-1">
                {bg.projects.map((pr) => {
                  const tech = Array.isArray(pr.technologies) ? pr.technologies.slice(0, 6).join(', ') : String(pr.technologies ?? '');
                  return (
                    <li key={pr.id}>
                      <span className="text-brand-700">{pr.name || 'Untitled'}</span>
                      {tech && <span className="text-[11px] text-charcoal-500"> · {tech}</span>}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}

      {links.length > 0 && (
        <div className="mt-4 pt-3 border-t border-charcoal-100 flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
          {links.map(([label, u]) => (
            <a key={label} href={/^https?:\/\//i.test(u!) ? u! : `https://${u}`} target="_blank" rel="noopener noreferrer" className={['text-brand-700 underline underline-offset-2 hover:text-accent-600 break-all', focusRing].join(' ')}>{label}</a>
          ))}
        </div>
      )}
    </Card>
  );
};

// ─── journey (activation timeline) ──────────────────────────────────────

const Journey: React.FC<{ created: string; f: NonNullable<UserDetailResp['funnel']> }> = ({ created, f }) => {
  const reachedIdx = STAGES.findIndex((s) => s.key === f.stage);
  const profileStarted = f.experience_count + f.education_count + f.skill_count + f.project_count > 0;
  const steps: { label: string; done: boolean; when: string | null; detail?: string }[] = [
    { label: 'Signed up', done: true, when: created },
    { label: 'Profile started', done: profileStarted || reachedIdx >= 1, when: null, detail: `${f.experience_count} exp · ${f.education_count} edu · ${f.skill_count} skills · ${f.project_count} proj` },
    { label: 'Profile complete', done: f.onboarding_complete, when: null },
    { label: 'General resume', done: Boolean(f.general_at), when: f.general_at },
    { label: 'Tailored resume', done: f.tailored_count > 0, when: f.first_tailored_at, detail: f.tailored_count > 0 ? `${f.tailored_count} total` : undefined },
    { label: 'Paid', done: f.paid_count > 0, when: f.first_paid_at, detail: f.paid_count > 0 ? `${f.paid_count} purchase${f.paid_count === 1 ? '' : 's'}` : undefined },
  ];
  return (
    <Card className="mb-5">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <div className="text-[10.5px] uppercase tracking-[0.18em] text-charcoal-500 font-bold">Journey</div>
        <StagePill stage={f.stage} />
      </div>
      <ol className="grid grid-cols-2 md:grid-cols-6 gap-3">
        {steps.map((s) => (
          <li key={s.label} className={['rounded-xl border px-3 py-2', s.done ? 'border-emerald-200 bg-emerald-50' : 'border-charcoal-200 bg-white'].join(' ')}>
            <div className={['text-[12px] font-semibold', s.done ? 'text-emerald-700' : 'text-charcoal-400'].join(' ')}>{s.done ? '✓ ' : ''}{s.label}</div>
            <div className="text-[11px] text-charcoal-500 mt-0.5">{s.when ? <Ago iso={s.when} /> : s.done ? 'done' : 'not yet'}</div>
            {s.detail && <div className="text-[11px] text-charcoal-500">{s.detail}</div>}
          </li>
        ))}
      </ol>
    </Card>
  );
};

// ─── sub-tables for UserDetail ──────────────────────────────────────────

const EVENT_LABELS: Record<string, string> = {
  landing_viewed: 'Viewed landing page',
  page_view: 'Page view',
  signup_completed: 'Signed up',
  signin_started: 'Started sign-in',
  signin_completed: 'Signed in',
  profile_setup_completed: 'Finished profile setup',
  resume_generation_started: 'Started generating',
  resume_generation_completed: 'Generation finished',
  general_resume_fallback_used: 'General resume used fallback',
  purchase_modal_opened: 'Opened purchase modal',
  purchase_submitted: 'Submitted payment',
  purchase_pending: 'Payment pending',
  purchase_confirmed: 'Payment confirmed',
  purchase_problem: 'Payment problem',
  purchase_verify_verdict: 'Payment verify result',
  purchase_dispute_filed: 'Filed dispute',
  tutorial_video_played: 'Played tutorial video',
  job_search_link_clicked: 'Clicked job search link',
  jd_pasted_after_search_click: 'Pasted JD after job search',
};

/** Compact one-line summary of an event's props (skips ad click ids). */
const propsSummary = (props: Record<string, unknown> | null): string =>
  Object.entries(props ?? {})
    .filter(([k, v]) => k !== 'fbclid' && k !== 'ttclid' && v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join(' · ');

const ActivityList: React.FC<{ rows: UserDetailResp['events'] }> = ({ rows }) => {
  if (rows.length === 0) return <EmptyState title="No tracked activity" description="Product events (sign-in, profile setup, generations, purchase steps) will show up here." />;
  return (
    <ul className="divide-y divide-charcoal-100">
      {rows.map((e) => {
        const summary = propsSummary(e.props);
        const failed = e.props?.success === false;
        return (
          <li key={e.id} className="px-4 py-2.5 flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <div className={['text-sm', failed ? 'text-red-700' : 'text-brand-700'].join(' ')}>{EVENT_LABELS[e.event] ?? e.event}</div>
              {(summary || e.path) && <div className="text-[11px] text-charcoal-500 font-mono break-all">{[e.path, summary].filter(Boolean).join(' · ')}</div>}
            </div>
            <span className="text-[12px] text-charcoal-500"><Ago iso={e.created_at} /></span>
          </li>
        );
      })}
    </ul>
  );
};


const PurchaseTable: React.FC<{ rows: UserDetailResp['purchases']; onToggleTest: (p: UserDetailResp['purchases'][number]) => void }> = ({ rows, onToggleTest }) => {
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
            <th className="px-4 py-3"><span className="sr-only">Test payment</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id} className="border-t border-charcoal-100">
              <td className="px-4 py-2.5 font-mono text-[12px] break-all">{p.payment_reference}</td>
              <td className="px-4 py-2.5"><StatusPill status={p.status} />{p.is_test && <span className="ml-1.5"><StatusPill status="test" tone="pending" label="test" /></span>}</td>
              <td className="px-4 py-2.5 text-right whitespace-nowrap">{taka(p.amount_taka)}{p.observed_amount_taka != null && p.observed_amount_taka !== p.amount_taka && <span className="block text-[11px] text-accent-600">obs {taka(p.observed_amount_taka)}</span>}</td>
              <td className="px-4 py-2.5 text-right">{p.credits_granted}</td>
              <td className="px-4 py-2.5"><TimeCell iso={p.created_at} /></td>
              <td className="px-4 py-2.5 text-right">
                <Button size="sm" variant="ghost" onClick={() => onToggleTest(p)}>{p.is_test ? 'Count as real' : 'Mark as test'}</Button>
              </td>
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
          <tr><th className="text-left px-4 py-3">Title</th><th className="text-left px-4 py-3">Target role</th><th className="text-left px-4 py-3">Company</th><th className="text-left px-4 py-3">Created</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-charcoal-100">
              <td className="px-4 py-2.5">{r.title}</td>
              <td className="px-4 py-2.5">{r.job_title || <span className="text-charcoal-400">—</span>}</td>
              <td className="px-4 py-2.5">{r.company || <span className="text-charcoal-400">—</span>}</td>
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
  const n = Number(val);
  const valid = val.trim() !== '' && Number.isInteger(n) && n > 0;
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
        step={1}
        placeholder="N"
        aria-label={`Credits to ${label.toLowerCase()}`}
        aria-invalid={val !== '' && !valid}
        title={val !== '' && !valid ? 'Enter a whole number of 1 or more' : undefined}
        className={['w-16 h-7 px-2 rounded-md border text-sm', val !== '' && !valid ? 'border-red-400' : 'border-charcoal-300', focusRing, 'focus:border-accent-500'].join(' ')}
        autoFocus
      />
      <Button size="sm" variant={variant} disabled={!valid} title={valid ? undefined : 'Enter a whole number of 1 or more'} onClick={() => { if (!valid) return; onSubmit(n); setOpen(false); setVal(''); }}>{label}</Button>
      <Button size="sm" variant="ghost" onClick={() => { setOpen(false); setVal(''); }}>×</Button>
    </div>
  );
};

// ─── master-resume price setter ─────────────────────────────────────────

const PriceSetter: React.FC<{ onSubmit: (n: number) => void }> = ({ onSubmit }) => {
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState('');
  const n = Number(val);
  const valid = val.trim() !== '' && Number.isInteger(n) && n >= 1 && n <= 100000;
  if (!open) {
    return <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>Set price</Button>;
  }
  return (
    <div className="flex items-center gap-1">
      <span className="text-[12px] text-charcoal-500">৳</span>
      <input
        type="number"
        min={1}
        step={1}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        placeholder="99"
        aria-label="Master resume price in taka"
        aria-invalid={val !== '' && !valid}
        className={['w-20 h-7 px-2 rounded-md border text-sm', val !== '' && !valid ? 'border-red-400' : 'border-charcoal-300', focusRing, 'focus:border-accent-500'].join(' ')}
        autoFocus
      />
      <Button size="sm" variant="primary" disabled={!valid} title={valid ? undefined : 'Enter a whole number of taka (1 or more)'} onClick={() => { if (!valid) return; onSubmit(n); setOpen(false); setVal(''); }}>Set</Button>
      <Button size="sm" variant="ghost" onClick={() => { setOpen(false); setVal(''); }}>×</Button>
    </div>
  );
};
