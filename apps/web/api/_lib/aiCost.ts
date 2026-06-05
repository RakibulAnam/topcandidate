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
  // Google Gemini 2.5 Flash — approx list price.
  'gemini-2.5-flash': { in: 0.30, out: 2.50 },
  // Groq llama-3.3-70b-versatile — approx list price.
  'llama-3.3-70b-versatile': { in: 0.59, out: 0.79 },
};

// Fallback used when the exact model isn't in the table (so we still record a
// non-null estimate rather than dropping the cost). Mid-range of the table.
const FALLBACK_PRICE: PricePer1M = { in: 0.45, out: 1.65 };

function priceFor(model?: string): PricePer1M {
  if (model && PRICE_TABLE[model]) return PRICE_TABLE[model];
  return FALLBACK_PRICE;
}

// Rough token estimate when the SDK didn't return usage: ~4 chars/token.
export function estimateTokens(text: string | undefined | null): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

// cost = prompt/1e6*in + completion/1e6*out. Returns USD as a number.
export function computeCostUsd(
  promptTokens: number,
  completionTokens: number,
  model?: string
): number {
  const p = priceFor(model);
  return (promptTokens / 1e6) * p.in + (completionTokens / 1e6) * p.out;
}

// What a provider/generator filled in (subset of UsageSink, kept structural so
// api/_lib doesn't import from src/infrastructure).
export interface ResolvedUsage {
  provider?: string;
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
}

export interface CostFields {
  provider?: string;
  model?: string;
  promptTokens: number;
  completionTokens: number;
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
  return {
    provider: usage.provider,
    model: usage.model,
    promptTokens,
    completionTokens,
    costUsd: computeCostUsd(promptTokens, completionTokens, usage.model),
  };
}
