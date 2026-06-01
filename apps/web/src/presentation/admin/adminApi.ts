// AdminApi — fetch wrapper that attaches X-Admin-Key and surfaces a 401
// callback so the shell can drop the operator back to the gate.
//
// Single instance per session. Operators never call /api/admin/* without
// going through this class — every call needs the header, and centralising
// the 401 path keeps the lock UX consistent.

export const ADMIN_KEY_STORAGE = 'topcandidate.adminKey';

export interface FetchOpts {
  method?: 'GET' | 'POST' | 'DELETE' | 'PATCH';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  raw?: boolean; // return raw Response (for downloads)
}

export class AdminApi {
  constructor(private readonly key: string, private readonly on401: () => void) {}

  async call<T = unknown>(action: string, opts: FetchOpts = {}): Promise<T> {
    const url = new URL(`/api/admin/${action}`, window.location.origin);
    if (opts.query) {
      for (const [k, v] of Object.entries(opts.query)) {
        if (v == null) continue;
        url.searchParams.set(k, String(v));
      }
    }
    const res = await fetch(url.toString(), {
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
    if (opts.raw) return res as unknown as T;
    const text = await res.text();
    const data = text ? (JSON.parse(text) as unknown) : null;
    if (!res.ok) {
      const err = (data as { error?: string })?.error ?? `HTTP ${res.status}`;
      throw new Error(err);
    }
    return data as T;
  }

  /** Download a file (parser-export). Bypasses JSON parsing. */
  async download(action: string, query?: Record<string, string>): Promise<void> {
    const res = await this.call<Response>(action, { raw: true, query });
    const blob = await res.blob();
    const cd = res.headers.get('Content-Disposition') ?? '';
    const m = cd.match(/filename="([^"]+)"/);
    const filename = m?.[1] ?? `${action}.json`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}

/** ৳200 — BDT prefix, no decimals. */
export const taka = (n: number | null | undefined): string =>
  n == null ? '—' : `৳${Number(n).toLocaleString('en-BD', { maximumFractionDigits: 0 })}`;

/** Minute-resolution age string for tables. */
export const ageMin = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
};
