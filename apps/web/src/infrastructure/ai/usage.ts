// Infrastructure — optional AI usage telemetry collector.
//
// Plumbing for cost/telemetry only. The optimizers/generators/extractors take
// an OPTIONAL `UsageSink` as a trailing argument and fill it in-place with the
// provider, model, and token counts the SDK reported. It is intentionally
// additive: the domain interfaces and return types are unchanged, and callers
// that don't pass a sink (the mobile-less library use cases, tests) behave
// exactly as before. A sink left empty just means "no usage captured" → the
// caller estimates from char counts instead.

export interface UsageSink {
  provider?: string;
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
}
