// AdminApi — fetch wrapper that attaches the Bearer session token and surfaces
// a 401 callback so the shell can drop the operator back to the login screen.
//
// Single instance per session. Operators never call /api/admin/* without
// going through this class — every call needs the token, and centralising
// the 401 path keeps the lock UX consistent.
//
// The token is obtained from POST /api/admin/login and held in sessionStorage
// (see AdminScreen) so it is dropped the moment the tab/browser closes.

// sessionStorage key — NOT localStorage, so closing the page logs out.
export const ADMIN_TOKEN_STORAGE = 'topcandidate.adminToken';

export interface FetchOpts {
  method?: 'GET' | 'POST' | 'DELETE' | 'PATCH';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  raw?: boolean; // return raw Response (for downloads)
}

export class AdminApi {
  constructor(private readonly token: string, private readonly on401: () => void) {}

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
        Authorization: `Bearer ${this.token}`,
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (res.status === 401) {
      this.on401();
      throw new Error('Admin key rejected.');
    }
    if (opts.raw) return res as unknown as T;
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      if (res.ok) throw new Error(`Bad response from ${action} (HTTP ${res.status}).`);
    }
    if (!res.ok) throw new Error(errorOf(data, res.status));
    return data as T;
  }

  /** Download a file (parser-export). Bypasses JSON parsing. */
  async download(action: string, query?: Record<string, string>): Promise<void> {
    const res = await this.call<Response>(action, { raw: true, query });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      let data: unknown = null;
      try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON error body */ }
      throw new Error(errorOf(data, res.status));
    }
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

const errorOf = (data: unknown, status: number): string => {
  const e = (data as { error?: unknown } | null)?.error;
  return typeof e === 'string' && e ? e : `HTTP ${status}`;
};

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
