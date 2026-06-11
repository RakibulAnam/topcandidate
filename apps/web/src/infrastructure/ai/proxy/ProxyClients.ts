// Client-side proxy adapters — implement each AI interface by POSTing to
// /api/* on the same Vercel deployment. No API keys ever enter the client
// bundle; the server holds them.
//
// Same `IXxx` interfaces are honored, so ResumeService is unchanged.
//
// Auth: every request carries the user's Supabase access token in the
// Authorization header. Calls fail with 401 if the user isn't signed in.
// Calls fail with 429 if the user is over their daily cap (default 20/day).

import { supabase } from '../../supabase/client';
import {
  ResumeData,
  OptimizedResumeData,
  GeneratedToolkit,
  OutreachEmail,
  InterviewQuestion,
} from '../../../domain/entities/Resume';
import { IResumeOptimizer } from '../../../domain/usecases/OptimizeResumeUseCase';
import { IToolkitGenerator } from '../../../domain/usecases/GenerateToolkitUseCase';
import { ICoverLetterGenerator } from '../../../domain/usecases/GenerateCoverLetterUseCase';
import { IOutreachEmailGenerator } from '../../../domain/usecases/GenerateOutreachEmailUseCase';
import { ILinkedInMessageGenerator } from '../../../domain/usecases/GenerateLinkedInMessageUseCase';
import { IInterviewQuestionsGenerator } from '../../../domain/usecases/GenerateInterviewQuestionsUseCase';
import { ExtractedProfileData, IResumeExtractor } from '../../../domain/usecases/ExtractResumeUseCase';

// ────────────────────────────────────────────────
// Shared fetch helper
// ────────────────────────────────────────────────
async function getAccessToken(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error('Not authenticated. Please sign in.');
  return token;
}

interface ApiError {
  error: string;
  code?: string;
  used?: number;
  cap?: number;
}

// Carries the structured error payload from /api/* failures so callers can
// switch on `code` (e.g. open the purchase modal on 'insufficient_credits')
// without having to string-match the friendly message.
export class ApiCallError extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message);
    this.name = 'ApiCallError';
  }
}

// Client-side wall clock for any /api/* call. Vercel kills functions at 60s
// (vercel.json maxDuration), so anything still pending at 90s is a hung
// connection, not a slow server — abort and surface a retryable error instead
// of spinning forever.
const CLIENT_TIMEOUT_MS = 90_000;

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const token = await getAccessToken();
  const t0 = performance.now();
  console.info(`[proxy] POST ${path}`);
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), CLIENT_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      signal: abort.signal,
    });
  } catch (err) {
    const elapsedMs = Math.round(performance.now() - t0);
    if (abort.signal.aborted) {
      console.error(`[proxy] ${path} client-timeout after ${elapsedMs}ms`);
      throw new ApiCallError(
        'The request took too long and was cancelled. Please try again.',
        408,
        'client_timeout',
      );
    }
    console.error(`[proxy] ${path} network error after ${elapsedMs}ms`, err);
    throw new ApiCallError(
      'Could not reach the server. Check your connection and try again.',
      0,
      'network_error',
    );
  } finally {
    clearTimeout(timer);
  }

  const elapsed = Math.round(performance.now() - t0);
  // Server-side handlers stamp x-request-id on every response — surface it
  // so client logs can be correlated against Vercel function logs.
  const rid = res.headers.get('x-request-id') ?? '-';

  if (!res.ok) {
    let errorBody: ApiError | null = null;
    try { errorBody = await res.json() as ApiError; } catch { /* leave null */ }
    const friendly = errorBody?.error
      ?? `Request failed: ${res.status} ${res.statusText}`;
    console.error(`[proxy] ${path} ${res.status} rid=${rid} ${elapsed}ms code=${errorBody?.code ?? '-'} msg="${friendly}"`);
    // 429s carry a server-built message that already names the limit that was
    // hit (overall daily cap vs the stricter free-resume cap) — pass it
    // through rather than rebuilding a generic one here.
    throw new ApiCallError(friendly, res.status, errorBody?.code);
  }

  console.info(`[proxy] ${path} 200 rid=${rid} ${elapsed}ms`);
  return res.json() as Promise<T>;
}

// ────────────────────────────────────────────────
// Optimizer + combined toolkit (the hot path)
// ────────────────────────────────────────────────
//
// Since the 2026-06-11 split, the optimizer (/api/optimize, charges the
// credit) and the combined toolkit bundle (/api/toolkit, free) are separate
// requests on separate function invocations. The builder fires both in
// parallel and renders the resume as soon as the optimizer resolves; the
// toolkit fills its tabs in when its own request completes. The old
// in-flight WeakMap dedupe is gone with the combined request — each proxy
// posts exactly one request, so there is no double-charge surface left here
// (only /api/optimize touches credits at all).

export class ProxyResumeOptimizer implements IResumeOptimizer {
  async optimize(data: ResumeData): Promise<OptimizedResumeData> {
    const r = await postJson<{ optimized: OptimizedResumeData }>('/api/optimize', { data });
    return r.optimized;
  }
}

// Calls /api/optimize-general — free, no credit gate, optimizer only.
// Used exclusively for the General Resume feature.
export class ProxyGeneralResumeOptimizer implements IResumeOptimizer {
  async optimize(data: ResumeData): Promise<OptimizedResumeData> {
    const r = await postJson<{ optimized: OptimizedResumeData }>('/api/optimize-general', { data });
    return r.optimized;
  }
}

export class ProxyToolkitGenerator implements IToolkitGenerator {
  async generate(data: ResumeData): Promise<GeneratedToolkit> {
    // The server always returns a toolkit object on 200: either populated, or
    // with an `errors` map describing why each slot failed validation. The
    // service layer merges partial artifacts + errors into `JobToolkit` and
    // the UI renders per-card "failed" states with retry buttons.
    const r = await postJson<{ toolkit: GeneratedToolkit }>('/api/toolkit', { data });
    return r.toolkit;
  }
}

// ────────────────────────────────────────────────
// Single-item regenerate (per-item retry buttons)
// ────────────────────────────────────────────────
type ToolkitItemKind = 'coverLetter' | 'outreachEmail' | 'linkedInMessage' | 'interviewQuestions';

async function regenerateItem<T>(kind: ToolkitItemKind, data: ResumeData): Promise<T> {
  const { result } = await postJson<{ result: T }>('/api/toolkit-item', { kind, data });
  return result;
}

export class ProxyCoverLetterGenerator implements ICoverLetterGenerator {
  generate(data: ResumeData): Promise<string> {
    return regenerateItem<string>('coverLetter', data);
  }
}

export class ProxyOutreachEmailGenerator implements IOutreachEmailGenerator {
  generate(data: ResumeData): Promise<OutreachEmail> {
    return regenerateItem<OutreachEmail>('outreachEmail', data);
  }
}

export class ProxyLinkedInMessageGenerator implements ILinkedInMessageGenerator {
  generate(data: ResumeData): Promise<string> {
    return regenerateItem<string>('linkedInMessage', data);
  }
}

export class ProxyInterviewQuestionsGenerator implements IInterviewQuestionsGenerator {
  generate(data: ResumeData): Promise<InterviewQuestion[]> {
    return regenerateItem<InterviewQuestion[]>('interviewQuestions', data);
  }
}

// ────────────────────────────────────────────────
// Resume extractor (PDF/Word import in profile setup)
// ────────────────────────────────────────────────
export class ProxyResumeExtractor implements IResumeExtractor {
  async extract(fileData: string, mimeType: string): Promise<ExtractedProfileData> {
    const { result } = await postJson<{ result: ExtractedProfileData }>(
      '/api/extract-resume',
      { fileData, mimeType }
    );
    return result;
  }
}
