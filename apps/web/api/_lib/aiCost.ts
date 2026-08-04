// AI cost estimation — turns token counts into an approximate USD cost.
//
// IMPORTANT: the per-token rates below are APPROXIMATE published list prices
// (USD per 1,000,000 tokens) captured for cost-telemetry only. They are NOT a
// billing source of truth — providers change pricing, free-tier usage is $0,
// and we may be on a different tier. Treat the cost_usd column as a rough
// directional signal, not an invoice. Update these constants if you re-price.

export interface PricePer1M {
  in: number;  // USD per 1M prompt (input) tokens
  out: number; // USD per 1M completion (output) tokens
}

// Approximate list prices (USD / 1M tokens). See note above.
const PRICE_TABLE: Record<string, PricePer1M> = {
  // ── Direct Google Gemini (bare ids — the active path) ───────────────────
  // Verified against ai.google.dev/gemini-api/docs/pricing on 2026-08-04.
  // NOTE: gemini-2.5-* are unreachable on our key (404 "not available to new
  // users"); their prices stay only so historical rows still cost out.
  'gemini-3.5-flash-lite': { in: 0.30, out: 2.50 },
  'gemini-3.1-flash-lite': { in: 0.25, out: 1.50 },
  'gemini-3.6-flash': { in: 1.50, out: 7.50 },
  'gemini-3.5-flash': { in: 1.50, out: 9.00 },
  'gemini-2.5-flash': { in: 0.30, out: 2.50 },
  'gemini-2.5-flash-lite': { in: 0.10, out: 0.40 },
  'llama-3.3-70b-versatile': { in: 0.59, out: 0.79 },
};

// Fallback used when the exact model isn't in the table (so we still record a
// non-null estimate rather than dropping the cost). Mid-range of the table.
const FALLBACK_PRICE: PricePer1M = { in: 0.45, out: 1.65 };

// OpenRouter records the served slug, often provider-prefixed and/or with a
// dated snapshot (e.g. 'google/gemini-2.5-flash', 'deepseek/deepseek-v3.2-20251201').
// Match by family so cost telemetry stays accurate without an entry per snapshot.
// Order matters: flash-lite before flash (the latter is a substring of the former).
function priceFor(model?: string): PricePer1M {
  if (!model) return FALLBACK_PRICE;
  if (PRICE_TABLE[model]) return PRICE_TABLE[model];
  const m = model.toLowerCase();
  // Order matters: every '-flash-lite' family test MUST precede its '-flash'
  // sibling, because 'gemini-3.5-flash' is a substring of
  // 'gemini-3.5-flash-lite'. Getting this backwards silently bills a $0.30
  // model at the $1.50 rate.
  if (m.includes('gemini-3.5-flash-lite')) return { in: 0.30, out: 2.50 };
  if (m.includes('gemini-3.1-flash-lite')) return { in: 0.25, out: 1.50 };
  if (m.includes('gemini-3.6-flash')) return { in: 1.50, out: 7.50 };
  if (m.includes('gemini-3.5-flash')) return { in: 1.50, out: 9.00 };
  if (m.includes('gemini-2.5-flash-lite')) return { in: 0.10, out: 0.40 };
  if (m.includes('gemini-2.5-flash')) return { in: 0.30, out: 2.50 };
  if (m.includes('deepseek-v3') || m.includes('deepseek-chat')) return { in: 0.229, out: 0.343 };
  if (m.includes('llama-3.3-70b')) return { in: 0.10, out: 0.32 }; // OpenRouter/DeepInfra instruct
  return FALLBACK_PRICE;
}

// Rough token estimate when the SDK didn't return usage: ~4 chars/token.
export function estimateTokens(text: string | undefined | null): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

// cost = prompt/1e6*in + (completion + thoughts)/1e6*out. Returns USD.
//
// Thought tokens bill at the OUTPUT rate on Gemini 3.x, so they belong on the
// output side, not ignored. Omitting them is not a rounding error: at its
// default thinking level gemini-3.6-flash produced 721 thought tokens against
// 147 visible output tokens in testing, i.e. ~85% of the true output cost would
// go unrecorded. The client forces thinkingLevel MINIMAL (which measured 0
// thoughts on every model), so this should normally be 0 — a non-zero value
// here is the signal that something is calling a model without that setting.
export function computeCostUsd(
  promptTokens: number,
  completionTokens: number,
  model?: string,
  thoughtTokens = 0
): number {
  const p = priceFor(model);
  return (promptTokens / 1e6) * p.in + ((completionTokens + thoughtTokens) / 1e6) * p.out;
}

// What a provider/generator filled in (subset of UsageSink, kept structural so
// api/_lib doesn't import from src/infrastructure).
export interface ResolvedUsage {
  provider?: string;
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  /** Gemini 3.x thinking tokens, billed at the output rate. */
  thoughtTokens?: number;
}

export interface CostFields {
  provider?: string;
  model?: string;
  promptTokens: number;
  completionTokens: number;
  thoughtTokens: number;
  costUsd: number;
}

// Resolve final token counts + cost for a call. Prefers the SDK-reported token
// counts; falls back to a ~4-chars/token estimate from the input/output text
// when the provider didn't return usage (better an estimate than null).
export function resolveCost(
  usage: ResolvedUsage,
  fallbackInputText?: string,
  fallbackOutputText?: string
): CostFields {
  const promptTokens =
    usage.promptTokens ?? estimateTokens(fallbackInputText);
  const completionTokens =
    usage.completionTokens ?? estimateTokens(fallbackOutputText);
  const thoughtTokens = usage.thoughtTokens ?? 0;
  return {
    provider: usage.provider,
    model: usage.model,
    promptTokens,
    completionTokens,
    thoughtTokens,
    costUsd: computeCostUsd(promptTokens, completionTokens, usage.model, thoughtTokens),
  };
}
