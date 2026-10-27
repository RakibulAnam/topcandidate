// Infrastructure — Gemini implementation of IResumeOptimizer.
// Direct-Google port of OpenRouterResumeOptimizer.
//
// This is the PAID hot path: /api/optimize charges the credit and its output is
// the resume the user sees, so it gets the largest deadline of any generator.
// Shares the SAME prompt module and the SAME deterministic post-pipeline as the
// optimizers it replaces (prompts/resumeOptimizerPrompts.ts) — only the
// transport changes.
//
// Structured output: `responseJsonSchema` (OPTIMIZER_SCHEMA, which now lives in
// the prompt module beside the spec text that mirrors it) — the provider
// enforces the shape, same as the toolkit generator (2026-06-10 lesson: loose
// JSON mode truncates/malforms large structured payloads). We STILL embed the
// shape spec in the user prompt (`embedSchemaSpec: true`) because the schema
// can't express "echo back exactly these input IDs" — the spec text lists them,
// and validateOptimizedResponse() remains the final gate.
//
// PORT NOTES (canonical template: GeminiProfileNormalizer.ts):
//   • Transport is GeminiClient. The model fallback chain is now walked
//     CLIENT-side (Google has no server-side models[] equivalent), so `models`
//     is an ordered array and the client advances on transport failure.
//   • `thinkingLevel` defaults to MINIMAL inside the client. Do not pass
//     thinkingBudget:0 — it returns 400 on 3.5-flash-lite and 3.6-flash. This
//     also replaces OpenRouter's `reasoning: { enabled: false }`: thinking
//     tokens bill at the OUTPUT rate and would blow up cost on a structured
//     task this large.
//   • Usage fields are camelCase now (`promptTokens`, not `prompt_tokens`) and
//     include `thoughtTokens` + `attempts`. `vite build` does NOT type-check
//     src/, so a typo here fails silently and cost telemetry degrades to a
//     4-chars/token estimate — worth the care.
//   • The catch block copies `err.attempts` into the sink so a FAILED call still
//     records which models were tried; otherwise failures log an empty chain.
//
// Model choice: 3.5-flash-lite leads — measured fastest on this very workload
// (1.9s vs 3.0s for 3.1-flash-lite on the optimizer), 0 thought tokens, and
// priced identically to the gemini-2.5-flash that used to lead this chain.
// 3.6-flash is the premium mid-chain rescue (only ever with thinkingLevel
// MINIMAL — see GeminiClient's header), and 3.1-flash-lite is the cheap last
// resort. The failure mode this chain exists to route around is a model that
// rewrites input item IDs or stalls past the function cap — the two things that
// got DeepSeek V3.2 dropped from the optimizer chain in 2026-06 live testing
// ("ID mismatch in projects", >45s → a 504 at Vercel's 60s cap).
// NOTE: unlike the OpenRouter chain, there is no non-Google last resort — the
// Llama escape hatch is gone, so a Google-wide outage fails this path.

import { ResumeData, OptimizedResumeData } from '../../domain/entities/Resume.js';
import { IResumeOptimizer } from '../../domain/usecases/OptimizeResumeUseCase.js';
import { resetUsageAttempt, type UsageSink } from './usage.js';
import { GeminiClient, GeminiError, GEMINI_MODELS, withRetry, rotateModels } from './GeminiClient.js';
import {
  buildSystemInstruction,
  buildUserPrompt,
  validateOptimizedResponse,
  normalizeSkills,
  filterFabricatedSkills,
  reportFabricatedProse,
  repairUnevidencedProse,
  repairInflatedOpeners,
  dropBannedOpenerBullets,
  demoteActivityCountBullets,
  takeOptimizerPlan,
  reorderLeadBulletByJDFit,
  reorderProjectsByJDFit,
  enforceBulletDensity,
  stripBannedCliches,
  stripBulletFiller,
  safeJsonParse,
  OPTIMIZER_SCHEMA,
  computeBulletBudgets,
} from './prompts/resumeOptimizerPrompts.js';

const OPTIMIZER_MODELS = [GEMINI_MODELS.FLASH_LITE_35, GEMINI_MODELS.FLASH_36, GEMINI_MODELS.FLASH_LITE_31];

export class GeminiResumeOptimizer implements IResumeOptimizer {
  private readonly client: GeminiClient;
  // Total wall-time budget across attempts (deadline-bounded — see withRetry).
  // Since the 2026-06-11 split, /api/optimize runs the optimizer ALONE in its
  // own function invocation (the toolkit lives on /api/toolkit), so the
  // optimizer gets most of Vercel's 60s window: 50s leaves room for auth +
  // credit RPC + telemetry overhead and buys a second attempt after a slow
  // first one.
  private readonly deadlineMs = 50_000;
  // Lowered 0.3 → 0.15 on 2026-08-11. Ordering is now a product decision the
  // model makes (RULE 4 + the `plan` field), and at 0.3 it was unstable: three
  // runs on identical input produced two different project orders (one led with
  // a self-described learning demo over a shipped app with 5k users) and two
  // different skill orderings (one led with the candidate's weakest language
  // because the JD named it). Sampling variance in phrasing is harmless;
  // sampling variance in *which evidence leads* is the product being wrong half
  // the time. Not 0 — greedy decoding on these models tends to flatten phrasing
  // and lean harder on stock résumé constructions.
  private readonly temperature = 0.15;

  constructor(apiKey: string) {
    this.client = new GeminiClient(apiKey);
  }

  async optimize(data: ResumeData, usage?: UsageSink): Promise<OptimizedResumeData> {
    const systemInstruction = buildSystemInstruction(data.resumeMode ?? 'tailored');
    // responseJsonSchema enforces the shape, but can't express "echo back
    // exactly these input IDs" → embed the shape spec in the prompt too (see
    // header).
    // One budget map for the prompt AND every post-step.
    const budgets = computeBulletBudgets(data);
    const userPrompt = buildUserPrompt(data, { embedSchemaSpec: true, budgets });

    try {
      return await withRetry(async (remainingMs, attempt) => {
        // Lead each retry with the next model: a per-minute 429 is scoped
        // PerProjectPerModel, so rotating escapes the throttle immediately
        // instead of waiting out Google's advised ~53s window.
        const chain = rotateModels(OPTIMIZER_MODELS, attempt);
        // Clear last attempt's token fields so a failure row can't inherit them —
        // see resetUsageAttempt.
        resetUsageAttempt(usage);
        try {
          const result = await this.client.generate(
            {
              models: chain,
              systemInstruction,
              contents: userPrompt,
              responseJsonSchema: OPTIMIZER_SCHEMA,
              temperature: this.temperature,
              maxOutputTokens: 8000,
            },
            remainingMs,
          );

          // Surface real token usage for cost telemetry (additive). The model is
          // whichever one in the chain actually served the response (may be a
          // fallback).
          if (usage) {
            usage.provider = 'gemini';
            usage.model = result.model;
            usage.promptTokens = result.usage?.promptTokens;
            usage.completionTokens = result.usage?.completionTokens;
            usage.thoughtTokens = result.usage?.thoughtTokens;
            usage.attempts = result.attempts;
          }

          // Identical post-pipeline to the optimizers this replaces.
          const parsed = safeJsonParse<OptimizedResumeData>(result.text);
          // Off the object before anything else touches it: the plan is the
          // model's pre-writing deliberation (see PLAN_SCHEMA), useful for
          // debugging a bad résumé but never part of one. Every downstream step
          // — validation, honesty checks, merge, persistence, render — must see
          // the same shape it always has.
          const plan = takeOptimizerPlan(parsed);
          if (plan?.thesis) {
            console.info(`[gemini] résumé thesis: ${plan.thesis}`);
            if (plan.orderPlan?.length) {
              console.info(`[gemini] ordering: ${plan.orderPlan.join(' | ')}`);
            }
            if (plan.weakSpots?.length) {
              console.info(`[gemini] de-emphasised gaps: ${plan.weakSpots.join(' | ')}`);
            }
          }
          normalizeSkills(parsed);
          const fabResult = filterFabricatedSkills(parsed, data);
          if (fabResult.fabricated.length) {
            console.warn(`[gemini] stripped ${fabResult.fabricated.length} fabricated skill(s):`, fabResult.fabricated.join(', '));
          }
          // Visibility only — see reportFabricatedProse for why a prose-only hit
          // warns instead of throwing on the paid path.
          const proseFab = reportFabricatedProse(parsed, data);
          if (proseFab.length) {
            console.warn(`[gemini] UNVERIFIED token(s) in résumé prose (not blocked):`, proseFab.join(', '));
          }
          // Before the lead-bullet choice, so a banned-opener line can never be
          // promoted into the recruiter's highest-attention slot.
          const droppedOpeners = dropBannedOpenerBullets(parsed);
          if (droppedOpeners.length) {
            console.warn(`[gemini] dropped ${droppedOpeners.length} bullet(s) with a RULE 3 banned opener:`, droppedOpeners.map((b) => b.slice(0, 60)).join(' | '));
          }
          // The two JD-vocabulary rescues have nothing to score against in
          // master mode — the "JD" there is a placeholder sentence, and scoring
          // real work against it is what used to reshuffle and gut the master
          // résumé. The model's own order stands.
          if (data.resumeMode !== 'master') {
            reorderLeadBulletByJDFit(parsed, data.targetJob.description);
            reorderProjectsByJDFit(parsed, data.targetJob.description);
          }
          enforceBulletDensity(parsed, data, budgets);
          // AFTER the density trim: demoting first would put a count bullet (and
          // the work it may describe) at the tail the trim cuts from.
          const movedCounts = demoteActivityCountBullets(parsed);
          if (movedCounts.length) {
            console.info(`[gemini] moved ${movedCounts.length} activity-count bullet(s) last:`, movedCounts.map((b) => b.slice(0, 60)).join(' | '));
            // A demoted LEAD leaves the model's second bullet on top; give the
            // JD rescue another look at the new lead (tailored only).
            if (data.resumeMode !== 'master') reorderLeadBulletByJDFit(parsed, data.targetJob.description);
          }
          stripBulletFiller(parsed);
          stripBannedCliches(parsed);
          const deflated = repairInflatedOpeners(parsed, data);
          if (deflated) console.info(`[gemini] swapped ${deflated} inflated opening verb(s) the candidate never used`);
          // Last content step, so it sees the final bullets. Cuts unevidenced
          // tools / industries out IN PLACE — content problems never
          // throw (a throw here meant a model re-run and, at worst, a failed
          // generation over a single word). See repairUnevidencedProse.
          const repaired = repairUnevidencedProse(parsed, data, fabResult.fabricated, budgets);
          if (repaired.length) {
            console.warn(`[gemini] removed unevidenced term(s) from résumé prose:`, repaired.join(', '));
          }
          validateOptimizedResponse(data, parsed);

          return parsed;
        } catch (err) {
          // Preserve the attempt chain on failure too, so ai_call_log can show
          // which models were tried on a call that ultimately failed.
          if (usage && err instanceof GeminiError && err.attempts.length) {
            usage.provider = 'gemini';
            usage.attempts = err.attempts;
          }
          throw err;
        }
      }, this.deadlineMs);
    } catch (error) {
      throw this.buildFinalError(error);
    }
  }

  private buildFinalError(error: unknown): Error {
    // `cause` keeps the underlying GeminiError (and its attempt chain / error
    // code) reachable after this wrapper flattens the message.
    if (error instanceof Error) return new Error(`Resume optimization failed: ${error.message}`, { cause: error });
    return new Error('Resume optimization failed due to unknown error');
  }
}
