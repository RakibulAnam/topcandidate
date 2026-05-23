// Infrastructure — Provider router for IResumeOptimizer.
//
// Tries the primary provider; on quota/rate/availability errors, falls
// through to the next provider. Sticky-failure (in-memory) avoids hammering
// a provider that just returned a 429.
//
// **Cooldown is rate-class aware.** TPM (token-per-minute) errors recover in
// seconds — short cooldown. RPD (request-per-day) errors recover only at the
// daily window — long cooldown. Treating them the same wastes capacity (a
// 10-min cooldown for a TPM dip burns 9 minutes of perfectly good free quota).
//
// Used for the resume optimizer hot path. Keeps the existing
// `IResumeOptimizer` interface — callers don't change.

import { ResumeData, OptimizedResumeData } from '../../domain/entities/Resume.js';
import { IResumeOptimizer } from '../../domain/usecases/OptimizeResumeUseCase.js';

export interface NamedOptimizer {
  name: string;          // e.g. "groq", "gemini" — for logs
  optimizer: IResumeOptimizer;
}

type ErrorKind = 'tpm' | 'daily' | 'transient' | 'other';

export class MultiProviderResumeOptimizer implements IResumeOptimizer {
  private readonly providers: NamedOptimizer[];
  private readonly tpmCooldownMs: number;
  private readonly dailyCooldownMs: number;
  private readonly transientCooldownMs: number;
  // Per-provider "skip until" timestamps. Set when we observe a quota/rate
  // failure so we don't keep paying that latency on every subsequent call.
  private readonly skipUntil = new Map<string, number>();

  constructor(
    providers: NamedOptimizer[],
    opts: {
      tpmCooldownMs?: number;
      dailyCooldownMs?: number;
      transientCooldownMs?: number;
    } = {}
  ) {
    if (!providers.length) throw new Error('At least one provider is required');
    this.providers = providers;
    // 65s — Groq's TPM window is 60s; +5s of safety margin so we re-try just
    // after the bucket resets, not just before.
    this.tpmCooldownMs = opts.tpmCooldownMs ?? 65 * 1000;
    // 30 minutes — for daily RPD exhaustion. Not the full 24h because we want
    // periodic retries in case quota was project-shared and partially recovered.
    this.dailyCooldownMs = opts.dailyCooldownMs ?? 30 * 60 * 1000;
    // 30s — for 503 / timeout / network blips. Recovers fast, retry sooner.
    this.transientCooldownMs = opts.transientCooldownMs ?? 30 * 1000;
  }

  async optimize(data: ResumeData): Promise<OptimizedResumeData> {
    const now = Date.now();
    const candidates = this.providers.filter(p => (this.skipUntil.get(p.name) ?? 0) <= now);
    // If everyone is in cooldown, try them all anyway — better to pay the
    // latency than to hard-fail.
    const order = candidates.length > 0 ? candidates : this.providers;

    let lastError: unknown;
    for (const { name, optimizer } of order) {
      try {
        const result = await optimizer.optimize(data);
        // Successful call — clear any stale cooldown for this provider.
        this.skipUntil.delete(name);
        return result;
      } catch (err) {
        lastError = err;
        const msg = err instanceof Error ? err.message : String(err);
        const kind = classifyError(msg);
        const cooldown = this.cooldownForKind(kind);
        if (cooldown > 0) {
          this.skipUntil.set(name, Date.now() + cooldown);
          console.warn(
            `[multi-provider] "${name}" failed (${kind}) — cooling down ${Math.round(cooldown / 1000)}s. Falling through.`
          );
        } else {
          console.warn(`[multi-provider] "${name}" failed (${kind}):`, msg);
        }
      }
    }

    if (lastError instanceof Error) throw lastError;
    throw new Error('All resume optimizer providers failed');
  }

  private cooldownForKind(kind: ErrorKind): number {
    switch (kind) {
      case 'tpm': return this.tpmCooldownMs;
      case 'daily': return this.dailyCooldownMs;
      case 'transient': return this.transientCooldownMs;
      case 'other': return 0; // not a quota/availability issue — don't cooldown
    }
  }
}

// Pure error classifier — string-matches provider error messages into one of
// four buckets. Exposed for tests if we need them.
export function classifyError(msg: string): ErrorKind {
  // TPM = token-per-minute exhaustion. Recovers in ≤60s.
  if (/tokens per minute|TPM|tokens.?per.?min/i.test(msg)) return 'tpm';
  // Daily quota / RPD / RPM-day exhaustion. Recovers at the next window.
  if (/per day|RPD|requests per day|generate_content_free_tier_requests|resource.?exhausted/i.test(msg)) return 'daily';
  // 429 without an explicit "per day" hint usually means short-term rate limit.
  if (/429/.test(msg)) return 'tpm';
  // 503 / timeout / network — transient.
  if (/503|unavailable|timeout|ECONNRESET|ENOTFOUND|fetch failed/i.test(msg)) return 'transient';
  return 'other';
}
