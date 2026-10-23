// Job applications — which jobs people build kits for (company + role per
// tailored kit), the most common roles and companies, and the pasted job post
// behind each one. Backed by /api/admin/job-applications.
//
// "Hide account" removes your own and test accounts from the list and the
// tallies. The hidden set lives in this browser's localStorage only — the repo
// is public, so internal emails are never written into code or config.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { AdminApi } from './adminApi';
import {
  Button, ContentGrid, DataTable, ErrorState, FilterChip, PageHeader, Section, TimeCell, type ColumnDef,
} from './ui';
import { HBarChart, KpiCard } from './charts';

type Range = 'week' | 'month' | 'all';
const RANGE_LABEL: Record<Range, string> = { week: 'Last 7 days', month: 'Last 30 days', all: 'All time' };
const HIDDEN_KEY = 'topcandidate.admin.hiddenKitAccounts';

interface Kit {
  id: string;
  createdAt: string;
  userId: string;
  email: string | null;
  fullName: string | null;
  company: string;
  role: string;
  roleSource: 'typed' | 'job_post' | 'none';
  jdExcerpt: string;
  jdLength: number;
  kitNumber: number;
  userHasPaid: boolean;
}

const readHidden = (): string[] => {
  try { return JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? '[]') as string[]; } catch { return []; }
};
const writeHidden = (ids: string[]) => {
  try { localStorage.setItem(HIDDEN_KEY, JSON.stringify(ids)); } catch { /* storage blocked — filter just won't persist */ }
};

/** Count case-insensitively, show the most common spelling. */
function tally(values: string[], limit = 8): { label: string; value: number }[] {
  const groups = new Map<string, { count: number; spellings: Map<string, number> }>();
  for (const v of values) {
    const key = v.toLowerCase();
    const g = groups.get(key) ?? { count: 0, spellings: new Map<string, number>() };
    g.count += 1;
    g.spellings.set(v, (g.spellings.get(v) ?? 0) + 1);
    groups.set(key, g);
  }
  return [...groups.values()]
    .map((g) => ({ label: [...g.spellings.entries()].sort((a, b) => b[1] - a[1])[0][0], value: g.count }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

export const JobApplicationsTab: React.FC<{ api: AdminApi; onOpenUser: (id: string) => void }> = ({ api, onOpenUser }) => {
  const [range, setRange] = useState<Range>('all');
  const [kits, setKits] = useState<Kit[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [hidden, setHidden] = useState<string[]>(readHidden);
  const [showHidden, setShowHidden] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    setErr(null);
    api.call('job-applications', { query: { range } })
      .then((d) => setKits((d as { kits: Kit[] }).kits))
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [api, range]);
  useEffect(() => { refresh(); }, [refresh]);

  const toggleHidden = (userId: string) => {
    const next = hidden.includes(userId) ? hidden.filter((id) => id !== userId) : [...hidden, userId];
    setHidden(next);
    writeHidden(next);
  };

  const visible = useMemo(
    () => (kits ?? []).filter((k) => showHidden || !hidden.includes(k.userId)),
    [kits, hidden, showHidden],
  );
  const hiddenCount = (kits ?? []).filter((k) => hidden.includes(k.userId)).length;

  const stats = useMemo(() => {
    const people = new Set(visible.map((k) => k.userId));
    const repeat = new Set(visible.filter((k) => k.kitNumber > 1).map((k) => k.userId));
    return {
      kits: visible.length,
      people: people.size,
      repeat: repeat.size,
      noTitle: visible.filter((k) => k.roleSource !== 'typed').length,
      roles: tally(visible.map((k) => k.role).filter(Boolean)),
      companies: tally(visible.map((k) => k.company).filter(Boolean)),
    };
  }, [visible]);

  const columns: ColumnDef<Kit>[] = [
    { key: 'when', header: 'Built', width: 'w-28', render: (k) => <TimeCell iso={k.createdAt} /> },
    {
      key: 'role', header: 'Role', render: (k) => (
        <div className="min-w-[180px] max-w-[320px]">
          <div className="font-semibold text-brand-700 truncate" title={k.role}>{k.role || <span className="text-charcoal-400 font-normal">No title</span>}</div>
          {k.roleSource === 'job_post' && <div className="text-[11px] text-accent-700">From the job post's first line</div>}
        </div>
      ),
    },
    { key: 'company', header: 'Company', render: (k) => k.company ? <span className="text-charcoal-700">{k.company}</span> : <span className="text-charcoal-400">Not entered</span> },
    {
      key: 'user', header: 'User', render: (k) => (
        <div className="min-w-[160px]">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onOpenUser(k.userId); }}
            className="text-left text-brand-700 hover:underline"
          >
            {k.fullName || k.email || k.userId.slice(0, 8)}
          </button>
          {k.fullName && k.email && <div className="text-[11.5px] font-mono text-charcoal-500 truncate max-w-[220px]">{k.email}</div>}
        </div>
      ),
    },
    {
      key: 'kit', header: 'Kit #', width: 'w-20', align: 'center', render: (k) => (
        <span title={k.kitNumber === 1 ? 'Their first kit' : `Their kit number ${k.kitNumber}`} className="tabular-nums">{k.kitNumber}</span>
      ),
    },
    {
      key: 'paid', header: 'Paid user', width: 'w-24', align: 'center', render: (k) => k.userHasPaid
        ? <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11.5px] font-semibold text-emerald-700">Paid</span>
        : <span className="text-[11.5px] text-charcoal-400">Never</span>,
    },
    {
      key: 'hide', header: '', width: 'w-28', align: 'right', render: (k) => (
        <Button size="sm" variant="secondary" onClick={(e) => { e.stopPropagation(); toggleHidden(k.userId); }}>
          {hidden.includes(k.userId) ? 'Unhide' : 'Hide account'}
        </Button>
      ),
    },
  ];

  const openKit = visible.find((k) => k.id === open) ?? null;

  return (
    <div>
      <PageHeader
        eyebrow="Analytics"
        title="Job applications"
        description="The jobs people build kits for: role, company and the job post they pasted. Click a row to read the post."
        actions={<Button variant="secondary" size="sm" onClick={refresh}>Refresh</Button>}
      />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        {(Object.keys(RANGE_LABEL) as Range[]).map((r) => (
          <FilterChip key={r} active={range === r} onClick={() => setRange(r)}>{RANGE_LABEL[r]}</FilterChip>
        ))}
        {hiddenCount > 0 && (
          <span className="ml-auto flex items-center gap-2 text-[12.5px] text-charcoal-500">
            {hiddenCount} kit{hiddenCount === 1 ? '' : 's'} from hidden accounts
            <FilterChip active={showHidden} onClick={() => setShowHidden((v) => !v)}>{showHidden ? 'Showing them' : 'Show them'}</FilterChip>
          </span>
        )}
      </div>

      {err ? <ErrorState error={err} onRetry={refresh} /> : (
        <>
          <ContentGrid cols={4} className="mb-6">
            <KpiCard label="Kits built" value={loading && !kits ? '…' : String(stats.kits)} />
            <KpiCard label="People" value={loading && !kits ? '…' : String(stats.people)} sub="built at least one kit" />
            <KpiCard label="Came back" value={loading && !kits ? '…' : String(stats.repeat)} sub="built a second kit or more" tone={stats.repeat > 0 ? 'brand' : 'neutral'} />
            <KpiCard label="No role typed" value={loading && !kits ? '…' : String(stats.noTitle)} sub="pasted only the job post" tone={stats.noTitle > 0 ? 'warn' : 'neutral'} />
          </ContentGrid>

          <ContentGrid cols={2} className="mb-6">
            <Section title="Top roles" description="Case-insensitive; the most common spelling is shown.">
              <HBarChart data={stats.roles} />
            </Section>
            <Section title="Top companies" description="Only kits where the company was entered.">
              <HBarChart data={stats.companies} />
            </Section>
          </ContentGrid>

          {openKit && (
            <Section
              title={`${openKit.role || 'No title'}${openKit.company ? ` · ${openKit.company}` : ''}`}
              description={`Job post pasted by ${openKit.fullName || openKit.email || 'this user'} · ${openKit.jdLength.toLocaleString()} characters${openKit.jdLength > openKit.jdExcerpt.length ? ' (first part shown)' : ''}`}
              actions={<Button size="sm" variant="secondary" onClick={() => setOpen(null)}>Close</Button>}
              className="mb-6"
            >
              <pre className="whitespace-pre-wrap break-words rounded-xl bg-charcoal-50 p-4 text-[13px] leading-relaxed text-charcoal-700 font-sans">
                {openKit.jdExcerpt || 'No job post was saved with this kit.'}
                {openKit.jdLength > openKit.jdExcerpt.length ? '…' : ''}
              </pre>
            </Section>
          )}

          <DataTable
            columns={columns}
            rows={kits ? visible : null}
            loading={loading}
            keyForRow={(k) => k.id}
            onRowClick={(k) => setOpen((cur) => (cur === k.id ? null : k.id))}
            empty={{ title: 'No kits in this range', description: 'Kits appear here as soon as someone builds one.' }}
          />
        </>
      )}
    </div>
  );
};
