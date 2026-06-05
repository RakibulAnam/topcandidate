// Marketing — acquisition funnel, channel CAC/ROAS, and ad-spend logging.
// Range-scoped with Refresh. Writes (log/delete spend) post a toast and refresh.

import React, { useCallback, useEffect, useState } from 'react';
import type { AdminApi } from './adminApi';
import { taka } from './adminApi';
import {
  Button, Card, DataTable, ErrorState, PageHeader, Section, Skeleton, focusRing, withToast,
} from './ui';
import { FunnelChart, HBarChart } from './charts';

type Range = 'day' | 'week' | 'month' | 'all';
const RANGE_SHORT: Record<Range, string> = { day: 'Day', week: 'Week', month: 'Month', all: 'All' };

// Funnel step → human label.
const STEP_LABEL: Record<string, string> = {
  landing_viewed: 'Visited',
  signup_completed: 'Signed up',
  profile_setup_completed: 'Profile done',
  resume_generation_completed: 'Generated',
  purchase_modal_opened: 'Opened checkout',
  purchase_confirmed: 'Purchased',
};

interface SpendRow { id: string; spendDate: string; channel: string; campaign: string; amountTaka: number; clicks: number | null; impressions: number | null; notes: string | null }
interface ChannelRow { channel: string; spendTaka: number; signups: number; revenueTaka: number; cacTaka: number; roas: number }

interface MarketingData {
  range: Range;
  acquisition: { source: string; signups: number }[];
  funnel: { step: string; count: number }[];
  channels: ChannelRow[];
  spendRows: SpendRow[];
}

export const MarketingTab: React.FC<{ api: AdminApi }> = ({ api }) => {
  const [range, setRange] = useState<Range>('month');
  const [data, setData] = useState<MarketingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    setErr(null);
    api.call<MarketingData>('marketing', { query: { range } })
      .then(setData)
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [api, range]);

  useEffect(() => { refresh(); }, [refresh]);

  const deleteSpend = async (id: string) => {
    await withToast(api.call('marketing-spend', { method: 'DELETE', query: { id, reason: 'removed via admin' } }), { success: 'Spend entry removed.' });
    refresh();
  };

  return (
    <div>
      <PageHeader
        eyebrow="Analytics"
        title="Marketing"
        description="Acquisition funnel, channel economics (CAC / ROAS), and ad-spend logging."
        actions={<Button variant="secondary" size="sm" onClick={refresh}>Refresh</Button>}
      />

      <Section title="Acquisition funnel" actions={<RangeToggle value={range} onChange={setRange} />}>
        <Card>
          {err ? <ErrorState error={err} onRetry={refresh} /> : data ? (
            <FunnelChart steps={data.funnel.map((f) => ({ label: STEP_LABEL[f.step] ?? f.step, value: f.count }))} />
          ) : <Skeleton className="h-40 w-full" />}
        </Card>
      </Section>

      <div className="mt-6">
        <Section title="Signups by source">
          <Card>
            {data ? (
              <HBarChart data={data.acquisition.map((a) => ({ label: a.source, value: a.signups }))} formatValue={(n) => String(n)} />
            ) : <Skeleton className="h-32 w-full" />}
          </Card>
        </Section>
      </div>

      <div className="mt-6">
        <Section title="Channels" description="Spend, attributed signups, revenue, CAC and ROAS per channel.">
          <DataTable<ChannelRow>
            columns={[
              { key: 'channel', header: 'Channel', render: (r) => <span className="font-semibold text-brand-700">{r.channel}</span> },
              { key: 'spend', header: 'Spend', align: 'right', render: (r) => taka(r.spendTaka) },
              { key: 'signups', header: 'Signups', width: 'w-24', align: 'right', render: (r) => r.signups },
              { key: 'revenue', header: 'Revenue', align: 'right', render: (r) => taka(r.revenueTaka) },
              { key: 'cac', header: 'CAC', align: 'right', render: (r) => taka(r.cacTaka) },
              { key: 'roas', header: 'ROAS', width: 'w-24', align: 'right', render: (r) => <span className={r.roas >= 1 ? 'text-emerald-700 font-semibold' : 'text-charcoal-600'}>{r.roas.toFixed(2)}×</span> },
            ]}
            rows={data?.channels ?? null}
            loading={loading}
            keyForRow={(r) => r.channel}
            empty={{ title: 'No channel data yet', description: 'Log ad spend and acquire users to see channel economics.' }}
          />
        </Section>
      </div>

      <div className="mt-6">
        <Section title="Ad spend">
          <Card className="mb-4"><SpendForm api={api} onSaved={refresh} /></Card>
          <DataTable<SpendRow>
            columns={[
              { key: 'date', header: 'Date', width: 'w-28', render: (r) => <span className="whitespace-nowrap">{r.spendDate}</span> },
              { key: 'channel', header: 'Channel', render: (r) => <span className="font-semibold text-brand-700">{r.channel}</span> },
              { key: 'campaign', header: 'Campaign', render: (r) => r.campaign || <span className="text-charcoal-400">—</span> },
              { key: 'amount', header: 'Amount', align: 'right', render: (r) => taka(r.amountTaka) },
              { key: 'clicks', header: 'Clicks', width: 'w-20', align: 'right', render: (r) => r.clicks ?? '—' },
              { key: 'impr', header: 'Impr.', width: 'w-24', align: 'right', render: (r) => r.impressions ?? '—' },
              { key: 'notes', header: 'Notes', render: (r) => r.notes || <span className="text-charcoal-400">—</span> },
              { key: 'del', header: '', width: 'w-20', align: 'right', render: (r) => <Button size="sm" variant="danger" onClick={() => void deleteSpend(r.id)}>Delete</Button> },
            ]}
            rows={data?.spendRows ?? null}
            loading={loading}
            keyForRow={(r) => r.id}
            empty={{ title: 'No spend logged', description: 'Use the form above to record ad spend per channel and campaign.' }}
          />
        </Section>
      </div>
    </div>
  );
};

// ─── log spend form ───────────────────────────────────────────────────────

const SpendForm: React.FC<{ api: AdminApi; onSaved: () => void }> = ({ api, onSaved }) => {
  const today = new Date().toISOString().slice(0, 10);
  const [spendDate, setSpendDate] = useState(today);
  const [channel, setChannel] = useState('');
  const [campaign, setCampaign] = useState('');
  const [amount, setAmount] = useState('');
  const [clicks, setClicks] = useState('');
  const [impressions, setImpressions] = useState('');
  const [notes, setNotes] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const amountNum = Number(amount);
  const ok = spendDate && channel.trim() && amountNum > 0 && reason.trim();

  const submit = async () => {
    if (!ok) return;
    setBusy(true);
    try {
      const r = await withToast(
        api.call('marketing-spend', {
          method: 'POST',
          body: {
            spendDate,
            channel: channel.trim(),
            campaign: campaign.trim() || null,
            amountTaka: amountNum,
            clicks: clicks ? Math.max(0, Math.floor(Number(clicks))) : null,
            impressions: impressions ? Math.max(0, Math.floor(Number(impressions))) : null,
            notes: notes.trim() || null,
            reason: reason.trim(),
          },
        }),
        { success: 'Ad spend logged.' }
      );
      if (r !== null) {
        setChannel(''); setCampaign(''); setAmount(''); setClicks(''); setImpressions(''); setNotes(''); setReason('');
        onSaved();
      }
    } finally {
      setBusy(false);
    }
  };

  const inputCls = ['h-9 px-3 rounded-xl border border-charcoal-300 text-sm bg-white', focusRing, 'focus:border-accent-500'].join(' ');

  return (
    <div>
      <div className="text-sm font-semibold text-brand-700 mb-3">Log ad spend</div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <label className="flex flex-col gap-1"><span className="text-[11px] font-semibold text-charcoal-600">Date</span><input type="date" value={spendDate} onChange={(e) => setSpendDate(e.target.value)} className={inputCls} /></label>
        <label className="flex flex-col gap-1"><span className="text-[11px] font-semibold text-charcoal-600">Channel</span><input type="text" value={channel} onChange={(e) => setChannel(e.target.value)} placeholder="facebook" className={inputCls} /></label>
        <label className="flex flex-col gap-1"><span className="text-[11px] font-semibold text-charcoal-600">Campaign</span><input type="text" value={campaign} onChange={(e) => setCampaign(e.target.value)} placeholder="optional" className={inputCls} /></label>
        <label className="flex flex-col gap-1"><span className="text-[11px] font-semibold text-charcoal-600">Amount (৳)</span><input type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" className={inputCls} /></label>
        <label className="flex flex-col gap-1"><span className="text-[11px] font-semibold text-charcoal-600">Clicks</span><input type="number" min={0} value={clicks} onChange={(e) => setClicks(e.target.value)} placeholder="optional" className={inputCls} /></label>
        <label className="flex flex-col gap-1"><span className="text-[11px] font-semibold text-charcoal-600">Impressions</span><input type="number" min={0} value={impressions} onChange={(e) => setImpressions(e.target.value)} placeholder="optional" className={inputCls} /></label>
        <label className="flex flex-col gap-1 col-span-2"><span className="text-[11px] font-semibold text-charcoal-600">Notes</span><input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="optional" className={inputCls} /></label>
        <label className="flex flex-col gap-1 col-span-2 md:col-span-3"><span className="text-[11px] font-semibold text-charcoal-600">Reason (audit)</span><input type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="why are you logging this?" className={inputCls} /></label>
        <div className="flex items-end"><Button variant="primary" size="md" disabled={!ok} loading={busy} onClick={() => void submit()} className="w-full">Log spend</Button></div>
      </div>
    </div>
  );
};

const RangeToggle: React.FC<{ value: Range; onChange: (r: Range) => void }> = ({ value, onChange }) => (
  <div className="inline-flex rounded-xl border border-charcoal-200 bg-white p-0.5" role="tablist" aria-label="Period">
    {(['day', 'week', 'month', 'all'] as Range[]).map((r) => {
      const active = r === value;
      return (
        <button
          key={r}
          type="button"
          role="tab"
          aria-selected={active}
          onClick={() => onChange(r)}
          className={[
            'px-3 py-1.5 rounded-[10px] text-[12px] font-semibold transition-colors',
            active ? 'bg-brand-700 text-white' : 'text-charcoal-600 hover:text-brand-700 hover:bg-charcoal-100',
            focusRing,
          ].join(' ')}
        >
          {RANGE_SHORT[r]}
        </button>
      );
    })}
  </div>
);
