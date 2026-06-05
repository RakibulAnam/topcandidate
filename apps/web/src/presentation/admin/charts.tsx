// Dependency-free, on-brand SVG chart primitives for the admin panel.
// No charting library — keeps the bundle lean and the visuals fully under our
// brand system (warm-stone neutrals + saffron accent, NO gradients/blue/purple).
// Colors are pulled from the CSS custom properties defined in src/index.css so
// they stay in sync with the design tokens automatically.
//
// All charts are responsive (viewBox + width:100%) and render server-data
// shaped as simple arrays. Tooltips are native <title> for zero-JS hover.

import React from 'react';

// Categorical palette — brand/accent/charcoal shades only (on-brand, distinct).
export const SERIES_COLORS = [
  'var(--color-accent-500)',
  'var(--color-brand-700)',
  'var(--color-accent-300)',
  'var(--color-charcoal-400)',
  'var(--color-brand-400)',
  'var(--color-accent-700)',
  'var(--color-charcoal-600)',
];

const AXIS = 'var(--color-charcoal-300)';
const GRID = 'var(--color-charcoal-200)';
const MUTED = 'var(--color-charcoal-500)';

const niceNum = (n: number): string => {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
};

// ─── Sparkline ─────────────────────────────────────────────────────────────
export const Sparkline: React.FC<{ data: number[]; color?: string; className?: string; height?: number }> = ({
  data, color = 'var(--color-accent-500)', className = '', height = 36,
}) => {
  if (!data.length) return <div className={className} style={{ height }} />;
  const w = 120, h = height, max = Math.max(...data, 1), min = Math.min(...data, 0);
  const span = max - min || 1;
  const pts = data.map((v, i) => {
    const x = data.length === 1 ? w : (i / (data.length - 1)) * w;
    const y = h - ((v - min) / span) * (h - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className={className} style={{ width: '100%', height }}>
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
};

// ─── Time-series line + soft area (no gradient — flat fill at low opacity) ──
export interface TimePoint { day: string; value: number }
export const TimeSeriesChart: React.FC<{
  data: TimePoint[];
  color?: string;
  height?: number;
  formatValue?: (n: number) => string;
}> = ({ data, color = 'var(--color-accent-500)', height = 200, formatValue = niceNum }) => {
  if (!data.length) return <EmptyChart height={height} />;
  const w = 600, h = height, padL = 44, padB = 22, padT = 8, padR = 8;
  const innerW = w - padL - padR, innerH = h - padB - padT;
  const max = Math.max(...data.map((d) => d.value), 1);
  const x = (i: number) => (data.length === 1 ? padL + innerW / 2 : padL + (i / (data.length - 1)) * innerW);
  const y = (v: number) => padT + innerH - (v / max) * innerH;
  const line = data.map((d, i) => `${x(i).toFixed(1)},${y(d.value).toFixed(1)}`);
  const area = `${padL},${padT + innerH} ${line.join(' ')} ${(x(data.length - 1)).toFixed(1)},${padT + innerH}`;
  const ticks = [0, 0.5, 1].map((t) => Math.round(max * t));
  const labelEvery = Math.ceil(data.length / 6);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: '100%', height }} role="img">
      {ticks.map((t, i) => {
        const yy = y(t);
        return (
          <g key={i}>
            <line x1={padL} y1={yy} x2={w - padR} y2={yy} stroke={GRID} strokeWidth="1" />
            <text x={padL - 6} y={yy + 3} textAnchor="end" fontSize="10" fill={MUTED}>{formatValue(t)}</text>
          </g>
        );
      })}
      <polygon points={area} fill={color} fillOpacity="0.10" />
      <polyline points={line.join(' ')} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      {data.map((d, i) => (
        <g key={i}>
          <circle cx={x(i)} cy={y(d.value)} r="2.5" fill={color} />
          <title>{`${d.day}: ${formatValue(d.value)}`}</title>
        </g>
      ))}
      {data.map((d, i) => (i % labelEvery === 0 || i === data.length - 1) ? (
        <text key={`l${i}`} x={x(i)} y={h - 6} textAnchor="middle" fontSize="9.5" fill={MUTED}>{d.day.slice(5)}</text>
      ) : null)}
    </svg>
  );
};

// ─── Vertical bar chart ──────────────────────────────────────────────────
export const BarChart: React.FC<{
  data: { label: string; value: number }[];
  color?: string;
  height?: number;
  formatValue?: (n: number) => string;
}> = ({ data, color = 'var(--color-brand-700)', height = 200, formatValue = niceNum }) => {
  if (!data.length) return <EmptyChart height={height} />;
  const w = 600, h = height, padL = 40, padB = 24, padT = 10, padR = 8;
  const innerW = w - padL - padR, innerH = h - padB - padT;
  const max = Math.max(...data.map((d) => d.value), 1);
  const bw = innerW / data.length;
  const labelEvery = Math.ceil(data.length / 8);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: '100%', height }} role="img">
      {[0, 0.5, 1].map((t, i) => {
        const yy = padT + innerH - t * innerH;
        return <g key={i}><line x1={padL} y1={yy} x2={w - padR} y2={yy} stroke={GRID} strokeWidth="1" /><text x={padL - 6} y={yy + 3} textAnchor="end" fontSize="10" fill={MUTED}>{formatValue(Math.round(max * t))}</text></g>;
      })}
      {data.map((d, i) => {
        const bh = (d.value / max) * innerH;
        const bx = padL + i * bw + bw * 0.15;
        const by = padT + innerH - bh;
        return (
          <g key={i}>
            <rect x={bx} y={by} width={bw * 0.7} height={Math.max(bh, 0)} rx="2" fill={color} />
            <title>{`${d.label}: ${formatValue(d.value)}`}</title>
            {(i % labelEvery === 0 || i === data.length - 1) && (
              <text x={padL + i * bw + bw / 2} y={h - 8} textAnchor="middle" fontSize="9.5" fill={MUTED}>{d.label.slice(5)}</text>
            )}
          </g>
        );
      })}
    </svg>
  );
};

// ─── Horizontal bars (breakdowns, funnels, leaderboards) ────────────────────
export const HBarChart: React.FC<{
  data: { label: string; value: number; sub?: string; color?: string }[];
  formatValue?: (n: number) => string;
  max?: number;
}> = ({ data, formatValue = niceNum, max }) => {
  if (!data.length) return <EmptyChart height={80} />;
  const m = max ?? Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="space-y-2">
      {data.map((d, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="w-32 shrink-0 text-[12px] text-charcoal-600 truncate" title={d.label}>{d.label}</div>
          <div className="flex-1 h-5 rounded-md bg-charcoal-100 overflow-hidden">
            <div className="h-full rounded-md" style={{ width: `${Math.max((d.value / m) * 100, d.value > 0 ? 2 : 0)}%`, backgroundColor: d.color ?? SERIES_COLORS[i % SERIES_COLORS.length] }} />
          </div>
          <div className="w-24 shrink-0 text-right text-[12px] font-semibold text-brand-700 tabular-nums">
            {formatValue(d.value)}{d.sub && <span className="ml-1 font-normal text-charcoal-400">{d.sub}</span>}
          </div>
        </div>
      ))}
    </div>
  );
};

// ─── Funnel (stepped horizontal bars with step conversion %) ────────────────
export const FunnelChart: React.FC<{ steps: { label: string; value: number }[] }> = ({ steps }) => {
  if (!steps.length) return <EmptyChart height={80} />;
  const top = Math.max(steps[0]?.value ?? 1, 1);
  return (
    <div className="space-y-1.5">
      {steps.map((s, i) => {
        const prev = i === 0 ? null : steps[i - 1].value;
        const stepPct = prev && prev > 0 ? (s.value / prev) * 100 : null;
        const overallPct = (s.value / top) * 100;
        return (
          <div key={i} className="flex items-center gap-3">
            <div className="w-40 shrink-0 text-[12px] text-charcoal-600">{s.label}</div>
            <div className="flex-1 h-7 rounded-md bg-charcoal-100 overflow-hidden relative">
              <div className="h-full rounded-md flex items-center px-2" style={{ width: `${Math.max(overallPct, 6)}%`, backgroundColor: SERIES_COLORS[i % SERIES_COLORS.length] }}>
                <span className="text-[11px] font-semibold text-white tabular-nums">{s.value.toLocaleString()}</span>
              </div>
            </div>
            <div className="w-16 shrink-0 text-right text-[11px] text-charcoal-500 tabular-nums">
              {stepPct != null ? `${stepPct.toFixed(0)}%` : '—'}
            </div>
          </div>
        );
      })}
    </div>
  );
};

// ─── Donut ──────────────────────────────────────────────────────────────
export const DonutChart: React.FC<{
  data: { label: string; value: number; color?: string }[];
  size?: number;
  centerLabel?: string;
  centerValue?: string;
}> = ({ data, size = 160, centerLabel, centerValue }) => {
  const total = data.reduce((s, d) => s + d.value, 0);
  const r = size / 2, stroke = size * 0.16, rad = r - stroke / 2, circ = 2 * Math.PI * rad;
  let offset = 0;
  return (
    <div className="flex items-center gap-5">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img">
        <circle cx={r} cy={r} r={rad} fill="none" stroke={GRID} strokeWidth={stroke} />
        {total > 0 && data.map((d, i) => {
          const frac = d.value / total, len = frac * circ;
          const el = (
            <circle key={i} cx={r} cy={r} r={rad} fill="none"
              stroke={d.color ?? SERIES_COLORS[i % SERIES_COLORS.length]} strokeWidth={stroke}
              strokeDasharray={`${len} ${circ - len}`} strokeDashoffset={-offset}
              transform={`rotate(-90 ${r} ${r})`}>
              <title>{`${d.label}: ${d.value} (${(frac * 100).toFixed(0)}%)`}</title>
            </circle>
          );
          offset += len;
          return el;
        })}
        {(centerValue || centerLabel) && (
          <text x={r} y={r} textAnchor="middle" dominantBaseline="middle">
            {centerValue && <tspan x={r} dy="-2" fontSize={size * 0.16} fontWeight="700" fill="var(--color-brand-700)">{centerValue}</tspan>}
            {centerLabel && <tspan x={r} dy={size * 0.13} fontSize={size * 0.075} fill={MUTED}>{centerLabel}</tspan>}
          </text>
        )}
      </svg>
      <ul className="space-y-1.5">
        {data.map((d, i) => (
          <li key={i} className="flex items-center gap-2 text-[12px]">
            <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: d.color ?? SERIES_COLORS[i % SERIES_COLORS.length] }} />
            <span className="text-charcoal-600">{d.label}</span>
            <span className="font-semibold text-brand-700 tabular-nums">{d.value.toLocaleString()}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};

// ─── KPI card (big number + optional delta + sparkline) ──────────────────
export const KpiCard: React.FC<{
  label: string;
  value: string;
  delta?: { pct: number; good?: boolean } | null;
  sub?: string;
  spark?: number[];
  tone?: 'neutral' | 'brand' | 'warn' | 'bad';
}> = ({ label, value, delta, sub, spark, tone = 'neutral' }) => {
  const valueColor = tone === 'bad' ? 'text-red-700' : tone === 'warn' ? 'text-accent-600' : 'text-brand-700';
  return (
    <div className="bg-white border border-charcoal-200 rounded-2xl p-5">
      <div className="text-[10.5px] uppercase tracking-[0.18em] text-charcoal-500 font-bold">{label}</div>
      <div className="mt-1 flex items-end justify-between gap-2">
        <div className={`font-display text-3xl font-semibold ${valueColor} leading-none tabular-nums`}>{value}</div>
        {delta != null && (
          <span className={`text-[12px] font-semibold ${delta.good === false ? 'text-red-700' : delta.pct >= 0 ? 'text-accent-600' : 'text-red-700'}`}>
            {delta.pct >= 0 ? '▲' : '▼'} {Math.abs(delta.pct).toFixed(0)}%
          </span>
        )}
      </div>
      {sub && <div className="mt-2 text-[12px] text-charcoal-500">{sub}</div>}
      {spark && spark.length > 1 && <div className="mt-2"><Sparkline data={spark} height={28} /></div>}
    </div>
  );
};

const EmptyChart: React.FC<{ height: number }> = ({ height }) => (
  <div className="flex items-center justify-center rounded-xl bg-charcoal-50 border border-dashed border-charcoal-200 text-[12px] text-charcoal-400" style={{ height }}>
    No data yet
  </div>
);
