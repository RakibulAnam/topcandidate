// Infrastructure — optional AI usage telemetry collector.
//
// Plumbing for cost/telemetry only. The optimizers/generators/extractors take
// an OPTIONAL `UsageSink` as a trailing argument and fill it in-place with the
// provider, model, and token counts the SDK reported. It is intentionally
// additive: the domain interfaces and return types are unchanged, and callers
// that don't pass a sink (the mobile-less library use cases, tests) behave
// exactly as before. A sink left empty just means "no usage captured" → the
// caller estimates from char counts instead.

/**
 * One model's outcome inside a single logical call. Structurally compatible
 * with GeminiAttempt, so a client result assigns straight across without a cast.
 * Typed loosely on purpose (`code` as string, not the GeminiErrorCode union) so
 * this module stays provider-agnostic.
 */
export interface UsageAttempt {
  model: string;
  ok: boolean;
  ms: number;
  code?: string;
  status?: number;
  message?: string;
}

/**
 * Clear the per-attempt fields at the START of each `withRetry` attempt.
 *
 * The sink is filled IN PLACE, and only a SUCCESSFUL `client.generate` writes
 * the token fields. So without this, an outer retry could log a failure row
 * carrying an earlier attempt's numbers: attempt 0 completes transport (tokens
 * recorded) then throws in validation → attempt 1 fails at transport → the row
 * is written with status=error but attempt 0's model, promptTokens,
 * completionTokens and thoughtTokens still in place. resolveCost() then bills a
 * failed call at a successful call's token count, and `model` names a model that
 * did not serve the final answer.
 *
 * `attempts` is deliberately NOT cleared — the chain is meant to accumulate
 * across the whole logical call, and both the success path and the catch block
 * overwrite it wholesale anyway.
 */
export function resetUsageAttempt(sink?: UsageSink): void {
  if (!sink) return;
  sink.model = undefined;
  sink.promptTokens = undefined;
  sink.completionTokens = undefined;
  sink.thoughtTokens = undefined;
}

export interface UsageSink {
  provider?: string;
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  /**
   * Gemini 3.x thinking tokens. Billed at the OUTPUT rate, so this must reach
   * aiCost.resolveCost() or every 3.x call is costed too low.
   */
  thoughtTokens?: number;
  /**
   * Per-model attempts, oldest first. Lets ai_call_log answer "which model
   * failed, and why", and makes a fallback rescue visible in telemetry instead
   * of looking like a clean first-try success.
   */
  attempts?: UsageAttempt[];
}
