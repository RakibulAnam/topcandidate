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

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const token = await getAccessToken();
  const t0 = performance.now();
  console.info(`[proxy] POST ${path}`);
  const res = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

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
    if (res.status === 429 && errorBody?.used != null && errorBody?.cap != null) {
      throw new ApiCallError(
        `Daily limit reached (${errorBody.used}/${errorBody.cap}). Try again tomorrow.`,
        res.status,
        errorBody.code,
      );
    }
    throw new ApiCallError(friendly, res.status, errorBody?.code);
  }

  console.info(`[proxy] ${path} 200 rid=${rid} ${elapsed}ms`);
  return res.json() as Promise<T>;
}

// ────────────────────────────────────────────────
// Optimizer + combined toolkit (the hot path)
// ────────────────────────────────────────────────
//
// /api/optimize runs BOTH the optimizer and the toolkit generator on the
// server in parallel and returns both results plus per-item errors. To keep
// the existing `IResumeOptimizer` + `IToolkitGenerator` separation on the
// client, we cache the response in-flight: the first of the two calls
// (whichever ResumeService makes first) triggers the network request; the
// second reuses the same Promise.
//
// Cache key: the ResumeData reference. Cleared after both halves resolve or
// either errors. ResumeService calls them inside the same allSettled, so the
// references are identical and cache hits.
//
// `toolkit` is always present in the response since per-artifact validation
// landed — even when every slot failed validation, the server returns the
// errors map so the client can render four "failed" cards rather than
// surfacing a single bundle-level failure.
type ApiOptimizeResponse = {
  optimized: OptimizedResumeData;
  toolkit: GeneratedToolkit;
};

const inflight = new WeakMap<ResumeData, Promise<ApiOptimizeResponse>>();
function callOptimize(data: ResumeData): Promise<ApiOptimizeResponse> {
  let p = inflight.get(data);
  if (!p) {
    console.info('[proxy] callOptimize cache MISS — issuing /api/optimize');
    p = postJson<ApiOptimizeResponse>('/api/optimize', { data })
      .finally(() => {
        // Best-effort cleanup; WeakMap entries also get GC'd naturally.
        inflight.delete(data);
      });
    inflight.set(data, p);
  } else {
    // Critical for the credit-double-charge guarantee: when both halves
    // (optimizer + toolkit) of ResumeService.optimizeResume hit callOptimize
    // with the SAME ResumeData reference, the second one MUST cache-hit. If
    // you ever see two MISS lines for a single Generate click, something
    // upstream is cloning the data and the server will charge twice.
    console.info('[proxy] callOptimize cache HIT — reusing in-flight /api/optimize');
  }
  return p;
}

export class ProxyResumeOptimizer implements IResumeOptimizer {
  async optimize(data: ResumeData): Promise<OptimizedResumeData> {
    const r = await callOptimize(data);
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
    const r = await callOptimize(data);
    // Server always returns a toolkit object now: either populated, or with
    // an `errors` map describing why each slot failed validation. The service
    // layer merges partial artifacts + errors into `JobToolkit` and the UI
    // renders per-card "failed" states with retry buttons.
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
