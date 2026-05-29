// Admin UI primitives — small, opinionated, no external deps beyond the
// project's existing Tailwind palette + Sonner (already in package.json).
//
// Why one file
// ============
// The admin SPA has ~10 screens. A `ui/` folder with one component per
// file would create more import noise than the primitives' size justifies.
// Each primitive here is short (≤ 60 lines) and tightly scoped. If any one
// grows past that, split it out.
//
// What's in here
// ==============
// - Layout:      Card, Section, PageHeader, ContentGrid
// - Inputs:      Button, SearchInput, FilterChip, NumberFieldInline
// - Feedback:    Skeleton, SkeletonRow, EmptyState, ErrorState, StatusPill
// - Data display: DataTable, KeyValue, JsonDiff
// - Overlay:    ReasonModal (replaces the old ReasonPromptModal)
// - Toast helpers: toastSuccess, toastError
//
// All are accessible by default — buttons have focus rings, modals trap
// focus, search input is labelled. Brand-compliant: no blue/indigo/purple.

import React, { forwardRef, useCallback, useEffect, useId, useRef, useState } from 'react';
import { toast } from 'sonner';

// ─── tokens ──────────────────────────────────────────────────────────────

const focusRing = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 focus-visible:ring-offset-2 focus-visible:ring-offset-charcoal-50';

// ─── layout ─────────────────────────────────────────────────────────────

export const Card: React.FC<React.PropsWithChildren<{ className?: string; padded?: boolean }>> = ({ children, className = '', padded = true }) => (
  <div className={['bg-white border border-charcoal-200 rounded-2xl shadow-sm/0', padded ? 'p-5' : '', className].join(' ')}>
    {children}
  </div>
);

export const Section: React.FC<React.PropsWithChildren<{ title?: string; description?: string; actions?: React.ReactNode; className?: string }>> = ({ title, description, actions, children, className = '' }) => (
  <section className={['space-y-3', className].join(' ')}>
    {(title || actions) && (
      <header className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          {title && <h2 className="font-display text-base font-semibold text-brand-700">{title}</h2>}
          {description && <p className="text-[12px] text-charcoal-500 mt-0.5">{description}</p>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </header>
    )}
    {children}
  </section>
);

export const PageHeader: React.FC<{ eyebrow?: string; title: string; description?: string; actions?: React.ReactNode }> = ({ eyebrow, title, description, actions }) => (
  <header className="mb-6">
    <div className="flex items-start justify-between gap-3 flex-wrap">
      <div className="min-w-0">
        {eyebrow && <div className="text-[10.5px] uppercase tracking-[0.22em] text-charcoal-500 font-bold mb-1">{eyebrow}</div>}
        <h1 className="font-display text-2xl font-semibold text-brand-700 leading-tight">{title}</h1>
        {description && <p className="text-sm text-charcoal-500 mt-1 max-w-2xl">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  </header>
);

export const ContentGrid: React.FC<React.PropsWithChildren<{ cols?: 1 | 2 | 3 | 4; className?: string }>> = ({ children, cols = 2, className = '' }) => {
  const map = { 1: 'grid-cols-1', 2: 'grid-cols-1 md:grid-cols-2', 3: 'grid-cols-1 md:grid-cols-3', 4: 'grid-cols-2 md:grid-cols-4' }[cols];
  return <div className={[`grid ${map} gap-3`, className].join(' ')}>{children}</div>;
};

// ─── button ─────────────────────────────────────────────────────────────

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'subtle';
type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  iconLeft?: React.ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = 'secondary', size = 'md', loading, iconLeft, disabled, children, className = '', ...rest }, ref) {
  const variants: Record<ButtonVariant, string> = {
    primary: 'bg-brand-700 hover:bg-brand-800 text-white border-transparent',
    secondary: 'bg-white hover:bg-charcoal-50 text-brand-700 border-charcoal-300',
    danger: 'bg-red-50 hover:bg-red-100 text-red-700 border-red-200',
    ghost: 'bg-transparent hover:bg-charcoal-100 text-charcoal-600 border-transparent',
    subtle: 'bg-charcoal-100 hover:bg-charcoal-200 text-brand-700 border-transparent',
  };
  const sizes: Record<ButtonSize, string> = {
    sm: 'h-7 px-2.5 text-[11px] gap-1',
    md: 'h-9 px-3.5 text-[13px] gap-1.5',
  };
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled || loading}
      className={[
        'inline-flex items-center justify-center rounded-full font-semibold border transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap',
        variants[variant], sizes[size], focusRing, className,
      ].join(' ')}
      {...rest}
    >
      {loading ? <Spinner size={size === 'sm' ? 12 : 14} /> : iconLeft}
      {children}
    </button>
  );
});

const Spinner: React.FC<{ size?: number }> = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" className="animate-spin" aria-hidden="true">
    <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="3" opacity="0.2" />
    <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
  </svg>
);

// ─── search input ───────────────────────────────────────────────────────

export interface SearchInputProps {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  loading?: boolean;
  /** Focus when `/` is pressed anywhere on the page. */
  enableSlashFocus?: boolean;
  className?: string;
  ariaLabel?: string;
}

export const SearchInput: React.FC<SearchInputProps> = ({ value, onChange, placeholder, loading, enableSlashFocus = true, className = '', ariaLabel }) => {
  const ref = useRef<HTMLInputElement>(null);
  const id = useId();

  useEffect(() => {
    if (!enableSlashFocus) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enableSlashFocus]);

  return (
    <div className={['relative flex items-center', className].join(' ')}>
      <span className="absolute left-3 text-charcoal-400" aria-hidden="true">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m20 20-3-3" /></svg>
      </span>
      <input
        ref={ref}
        id={id}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder ?? 'Search'}
        className={[
          'w-full h-9 pl-9 pr-9 rounded-full border border-charcoal-300 text-sm bg-white',
          'placeholder:text-charcoal-400 focus:border-accent-500',
          focusRing,
        ].join(' ')}
      />
      <div className="absolute right-2.5 flex items-center gap-1">
        {loading && <Spinner size={14} />}
        {value && !loading && (
          <button type="button" onClick={() => onChange('')} aria-label="Clear search" className={['rounded-full p-0.5 text-charcoal-400 hover:text-brand-700 hover:bg-charcoal-100', focusRing].join(' ')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        )}
      </div>
    </div>
  );
};

// ─── filter chip ────────────────────────────────────────────────────────

export const FilterChip: React.FC<{ active: boolean; onClick: () => void; children: React.ReactNode; size?: 'sm' | 'md' }> = ({ active, onClick, children, size = 'sm' }) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={active}
    className={[
      'inline-flex items-center rounded-full border font-semibold transition-colors',
      size === 'sm' ? 'h-7 px-2.5 text-[11px]' : 'h-8 px-3 text-[12px]',
      active ? 'bg-brand-700 text-white border-brand-700' : 'bg-white text-charcoal-500 border-charcoal-300 hover:text-brand-700 hover:border-charcoal-400',
      focusRing,
    ].join(' ')}
  >{children}</button>
);

// ─── status pill ────────────────────────────────────────────────────────

type StatusTone = 'success' | 'pending' | 'review' | 'danger' | 'info';

const STATUS_TONE: Record<string, StatusTone> = {
  completed: 'success',
  resolved: 'success',
  pending: 'pending',
  open: 'pending',
  underpaid: 'review',
  msisdn_mismatch_review: 'review',
  expired: 'danger',
  failed: 'danger',
  refunded: 'danger',
  rejected: 'danger',
};

const TONE_STYLES: Record<StatusTone, { dot: string; bg: string; text: string; border: string }> = {
  success: { dot: 'bg-emerald-500', bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
  pending: { dot: 'bg-charcoal-500', bg: 'bg-charcoal-100', text: 'text-brand-700', border: 'border-charcoal-300' },
  review: { dot: 'bg-accent-500', bg: 'bg-accent-50', text: 'text-brand-700', border: 'border-accent-200' },
  danger: { dot: 'bg-red-500', bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200' },
  info: { dot: 'bg-brand-500', bg: 'bg-charcoal-100', text: 'text-brand-700', border: 'border-charcoal-300' },
};

export const StatusPill: React.FC<{ status: string; tone?: StatusTone; label?: string }> = ({ status, tone, label }) => {
  const t = tone ?? STATUS_TONE[status] ?? 'info';
  const s = TONE_STYLES[t];
  return (
    <span className={['inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold border', s.bg, s.text, s.border].join(' ')}>
      <span className={['inline-block w-1.5 h-1.5 rounded-full', s.dot].join(' ')} />
      {label ?? status}
    </span>
  );
};

// ─── skeleton ───────────────────────────────────────────────────────────

export const Skeleton: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div className={['animate-pulse bg-charcoal-200/70 rounded-md', className].join(' ')} aria-hidden="true" />
);

export const SkeletonRow: React.FC<{ cols: number }> = ({ cols }) => (
  <tr className="border-t border-charcoal-100">
    {Array.from({ length: cols }).map((_, i) => (
      <td key={i} className="px-3 py-2.5"><Skeleton className="h-3.5 w-full" /></td>
    ))}
  </tr>
);

// ─── empty / error states ───────────────────────────────────────────────

export const EmptyState: React.FC<{ icon?: React.ReactNode; title: string; description?: string; action?: React.ReactNode }> = ({ icon, title, description, action }) => (
  <div className="text-center py-10 px-4">
    {icon && <div className="mx-auto mb-3 w-10 h-10 rounded-full bg-charcoal-100 flex items-center justify-center text-charcoal-500">{icon}</div>}
    <div className="font-display text-sm font-semibold text-brand-700">{title}</div>
    {description && <p className="text-[12px] text-charcoal-500 mt-1 max-w-sm mx-auto">{description}</p>}
    {action && <div className="mt-4 flex justify-center">{action}</div>}
  </div>
);

export const ErrorState: React.FC<{ error: string; onRetry?: () => void }> = ({ error, onRetry }) => (
  <div className="bg-red-50 border border-red-200 rounded-2xl p-4 flex items-start gap-3" role="alert">
    <div className="text-red-700 mt-0.5" aria-hidden="true">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" /></svg>
    </div>
    <div className="flex-1 min-w-0">
      <div className="text-sm font-semibold text-red-700">Something went wrong</div>
      <div className="text-[12px] text-red-700/80 mt-0.5 break-words whitespace-pre-wrap">{error}</div>
      {onRetry && <button type="button" onClick={onRetry} className={['mt-2 inline-flex items-center text-[12px] font-semibold text-red-700 hover:text-red-800 underline-offset-2 hover:underline', focusRing].join(' ')}>Retry</button>}
    </div>
  </div>
);

// ─── data table ─────────────────────────────────────────────────────────

export interface ColumnDef<T> {
  key: string;
  header: React.ReactNode;
  /** Tailwind width class, e.g. "w-32" */
  width?: string;
  align?: 'left' | 'right' | 'center';
  render: (row: T) => React.ReactNode;
}

export interface DataTableProps<T> {
  columns: ColumnDef<T>[];
  rows: T[] | null;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  empty?: { title: string; description?: string; icon?: React.ReactNode; action?: React.ReactNode };
  onRowClick?: (row: T) => void;
  keyForRow: (row: T) => string;
  skeletonRows?: number;
}

export function DataTable<T>({ columns, rows, loading, error, onRetry, empty, onRowClick, keyForRow, skeletonRows = 6 }: DataTableProps<T>) {
  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  return (
    <div className="bg-white border border-charcoal-200 rounded-2xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-charcoal-50 text-[11px] uppercase tracking-[0.18em] text-charcoal-500 font-bold sticky top-0">
            <tr>
              {columns.map((c) => (
                <th key={c.key} className={['px-3 py-2.5', c.width ?? '', c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left'].join(' ')}>{c.header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && (rows == null || rows.length === 0) && Array.from({ length: skeletonRows }).map((_, i) => <SkeletonRow key={i} cols={columns.length} />)}
            {!loading && rows != null && rows.length === 0 && empty && (
              <tr><td colSpan={columns.length}><EmptyState {...empty} /></td></tr>
            )}
            {rows?.map((row) => (
              <tr
                key={keyForRow(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={['border-t border-charcoal-100 align-middle', onRowClick ? 'cursor-pointer hover:bg-charcoal-50' : ''].join(' ')}
              >
                {columns.map((c) => (
                  <td key={c.key} className={['px-3 py-2.5', c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left'].join(' ')}>
                    {c.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── key-value (for detail headers) ─────────────────────────────────────

export const KeyValue: React.FC<{ label: string; children: React.ReactNode; mono?: boolean }> = ({ label, children, mono }) => (
  <div>
    <div className="text-[10.5px] uppercase tracking-[0.18em] text-charcoal-500 font-bold">{label}</div>
    <div className={['text-sm text-brand-700 mt-0.5', mono ? 'font-mono text-[12px] break-all' : ''].join(' ')}>{children}</div>
  </div>
);

// ─── JSON diff (collapsible) ────────────────────────────────────────────

export const JsonDiff: React.FC<{ before: unknown; after: unknown }> = ({ before, after }) => {
  const [open, setOpen] = useState(false);
  if (before == null && after == null) return <span className="text-[12px] text-charcoal-400">—</span>;
  return (
    <div>
      <button type="button" onClick={() => setOpen((v) => !v)} className={['text-[11px] font-semibold text-charcoal-500 hover:text-brand-700', focusRing].join(' ')}>
        {open ? '▾' : '▸'} {open ? 'hide' : 'show'} diff
      </button>
      {open && (
        <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-charcoal-500 font-bold mb-1">before</div>
            <pre className="bg-charcoal-50 rounded-lg p-2 text-[11px] overflow-x-auto whitespace-pre-wrap break-all">{JSON.stringify(before, null, 2)}</pre>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-accent-600 font-bold mb-1">after</div>
            <pre className="bg-accent-50 rounded-lg p-2 text-[11px] overflow-x-auto whitespace-pre-wrap break-all">{JSON.stringify(after, null, 2)}</pre>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── reason modal ───────────────────────────────────────────────────────

export const ReasonModal: React.FC<{
  open: boolean;
  title: string;
  subtitle?: string;
  confirmLabel?: string;
  confirmVariant?: ButtonVariant;
  busy?: boolean;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}> = ({ open, title, subtitle, confirmLabel = 'Confirm', confirmVariant = 'primary', busy, onConfirm, onClose }) => {
  const [reason, setReason] = useState('');
  const taRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!open) setReason('');
    else setTimeout(() => taRef.current?.focus(), 50);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  const ok = reason.trim().length > 0 && !busy;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="reason-title">
      <div className="absolute inset-0 bg-brand-900/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white rounded-2xl p-5 shadow-xl">
        <h3 id="reason-title" className="font-display text-base font-semibold text-brand-700">{title}</h3>
        <p className="mt-1 text-[12px] text-charcoal-500">{subtitle ?? 'A reason is required for the audit log.'}</p>
        <textarea
          ref={taRef}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && ok) onConfirm(reason.trim()); }}
          rows={4}
          className={['mt-3 block w-full px-3 py-2 rounded-xl border border-charcoal-300 text-sm', focusRing, 'focus:border-accent-500'].join(' ')}
          placeholder="Why are you doing this? (⌘↵ to submit)"
        />
        <div className="mt-4 flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant={confirmVariant} disabled={!ok} loading={busy} onClick={() => onConfirm(reason.trim())}>{confirmLabel}</Button>
        </div>
      </div>
    </div>
  );
};

// ─── toast helpers ──────────────────────────────────────────────────────

export const toastSuccess = (message: string, description?: string) => toast.success(message, { description });
export const toastError = (message: string, description?: string) => toast.error(message, { description });
export const toastInfo = (message: string, description?: string) => toast(message, { description });

// ─── small composed helpers ─────────────────────────────────────────────

/** Used in tables / detail rows — formats UTC ISO into "local · UTC" hover. */
export const TimeCell: React.FC<{ iso: string | null | undefined }> = ({ iso }) => {
  if (!iso) return <span className="text-charcoal-400">—</span>;
  const d = new Date(iso);
  return <time dateTime={iso} title={iso} className="whitespace-nowrap">{d.toLocaleString()}</time>;
};

/** Debounce a value. Used by SearchInput consumers to delay queries. */
export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

/** Promise wrapper that surfaces success/failure as toasts. */
export async function withToast<T>(p: Promise<T>, opts: { success: string; failure?: string }): Promise<T | null> {
  try {
    const r = await p;
    toastSuccess(opts.success);
    return r;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    toastError(opts.failure ?? 'Action failed', msg);
    return null;
  }
}

// Re-export the focusRing token for screens that need to style inputs.
export { focusRing };
