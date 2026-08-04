// Local Gemini probe — no browser, no credits, no real user data.
//
// Five modes:
//   selftest  An OFFLINE regression over recorded real Google error payloads,
//             then a live walk of the error taxonomy and fallback chain. Both
//             halves ASSERT — an earlier version printed a tick in both branches
//             and so reported 6/6 whatever the classifier returned, which is worse
//             than no test because it manufactures confidence.
//   bench     Realistic-size payloads across the candidate models: tokens,
//             thought tokens, cost, latency, quality. Picks the model assignment
//             on measurements rather than vibes.
//   tier      Infers free vs paid tier from throughput (20 concurrent beats the
//             15 RPM free ceiling). Matters because the free tier trains on
//             prompts, which contradicts ToS §3.
//   e2e       All eight REAL generators with their real schemas and guards.
//   gaps      The two paths e2e cannot reach: the extractor's multimodal
//             inlineData branch, and gemini-3.6-flash at a full payload.
//
// Fixtures are SYNTHETIC on purpose. Google's free tier trains on prompts and
// human reviewers may read them (paid tier does not), and TermsOfService §3
// promises users we don't train providers on their data — so no real résumé
// touches an unbilled key.
//
// Usage:
//   node_modules/.bin/tsx scripts/ai-probe.ts selftest
//   node_modules/.bin/tsx scripts/ai-probe.ts bench [runs]

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ThinkingLevel } from '@google/genai';
import {
  GeminiClient,
  GeminiError,
  GEMINI_MODELS,
  classifyGeminiError,
  type GeminiAttempt,
} from '../src/infrastructure/ai/GeminiClient.js';

// ── env ─────────────────────────────────────────────────────────────────────
function loadKey(): string {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  for (const f of ['.env.local', '.env']) {
    try {
      const line = readFileSync(resolve(process.cwd(), f), 'utf8')
        .split('\n')
        .find((l) => l.startsWith('GEMINI_API_KEY='));
      if (!line) continue;
      const v = line.slice('GEMINI_API_KEY='.length).trim().replace(/^['"]|['"]$/g, '');
      // apps/web/.env.local currently holds a placeholder; skip it rather than
      // fail with a confusing 400 from the API.
      if (v && !/^PLACEHOLDER/i.test(v)) return v;
    } catch { /* next file */ }
  }
  throw new Error('No usable GEMINI_API_KEY in env, .env.local or .env');
}

// ── pricing (USD per 1M tokens, paid tier, verified 2026-08-04) ─────────────
// Thought tokens bill at the OUTPUT rate — they are added to output below.
const PRICE: Record<string, { in: number; out: number }> = {
  [GEMINI_MODELS.FLASH_LITE_35]: { in: 0.30, out: 2.50 },
  [GEMINI_MODELS.FLASH_LITE_31]: { in: 0.25, out: 1.50 },
  [GEMINI_MODELS.FLASH_36]: { in: 1.50, out: 7.50 },
};

function costOf(model: string, inTok = 0, outTok = 0, thoughtTok = 0): number {
  const p = PRICE[model] ?? { in: 0.30, out: 2.50 };
  return (inTok / 1e6) * p.in + ((outTok + thoughtTok) / 1e6) * p.out;
}

// ── synthetic fixtures, sized to match measured production tokens ───────────
// Real ai_call_log averages: optimize 4,028 in / 890 out; toolkit 3,347 / 3,210.
const JD = `Senior Backend Engineer — Payments Platform, Dhaka (hybrid)
We are scaling a mobile financial services platform serving 40M+ users. You will own
settlement and reconciliation services processing several million transactions daily.
Responsibilities: design and operate high-throughput payment ledger services; drive
idempotency and exactly-once settlement guarantees; reduce reconciliation breaks; own
SLOs, on-call and incident response; mentor mid-level engineers; partner with risk and
compliance on Bangladesh Bank reporting requirements.
Required: 6+ years backend engineering; deep SQL and relational modelling; distributed
systems fundamentals; message queues (Kafka or RabbitMQ); container orchestration;
observability tooling; experience with financial reconciliation or double-entry ledgers.
Nice to have: Go or Rust, event sourcing, PCI-DSS exposure, mobile-money domain
knowledge (bKash, Nagad, Rocket), regulatory reporting automation.`;

const PROFILE = `CANDIDATE EVIDENCE
Experience:
[id=exp-1] Senior Software Engineer, Ditio AS (2022-03 — Present), Oslo/remote
  - Built batch camera module and trip-tracking pipeline for construction fleet telematics
  - Migrated MongoDB change streams into a ClickHouse analytics warehouse via Redpanda CDC
  - Cut p99 trip-ingest latency from 4.2s to 780ms by batching writes and adding a Redis read-through cache
  - Owned on-call rotation for 6 Go microservices; drove error budget policy adoption
[id=exp-2] Software Engineer, Shohoz Ltd (2019-07 — 2022-02), Dhaka
  - Implemented bKash payment reconciliation for ticketing; cut settlement mismatches 40%
  - Built double-entry ledger for refunds and partial cancellations in PostgreSQL
  - Automated daily Bangladesh Bank settlement report generation, removing 6 hours of manual work weekly
[id=exp-3] Junior Developer, BJIT (2017-09 — 2019-06), Dhaka
  - Maintained ASP.NET billing modules and wrote SQL Server stored procedures
Projects:
[id=prj-1] OpenLedger — open-source double-entry ledger library in Go, 340 GitHub stars
[id=prj-2] ReconBot — Kafka consumer reconciling mobile-money callbacks against internal ledgers
Education: BSc Computer Science, BUET (2017-06)
Certifications: [id=cert-1] AWS Solutions Architect Associate (2023-04)
Skills: Go, Python, C#, PostgreSQL, SQL Server, MongoDB, ClickHouse, Kafka, Redpanda,
Redis, Docker, Kubernetes, Grafana, Prometheus, Loki, ASP.NET, REST, gRPC`;

// Mirrors OPTIMIZER_SCHEMA's shape: strict object, nested array of id+bullets.
const OPTIMIZER_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    skills: { type: 'array', items: { type: 'string' } },
    experience: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'string' }, refinedBullets: { type: 'array', items: { type: 'string' } } },
        required: ['id', 'refinedBullets'],
        additionalProperties: false,
      },
    },
  },
  required: ['summary', 'skills', 'experience'],
  additionalProperties: false,
};

// Mirrors TOOLKIT_SCHEMA: the bilingual interview array is the largest field and
// the one that used to truncate under json_object mode.
const TOOLKIT_SCHEMA = {
  type: 'object',
  properties: {
    coverLetter: { type: 'string' },
    linkedInMessage: { type: 'string' },
    interviewQuestions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          category: { type: 'string', enum: ['Behavioral', 'Technical', 'Role-specific', 'Values & Culture', 'Situational'] },
          whyAsked: { type: 'string' },
          answerStrategy: { type: 'string' },
          questionBn: { type: 'string' },
          answerStrategyBn: { type: 'string' },
        },
        required: ['question', 'category', 'whyAsked', 'answerStrategy', 'questionBn', 'answerStrategyBn'],
        additionalProperties: false,
      },
    },
  },
  required: ['coverLetter', 'linkedInMessage', 'interviewQuestions'],
  additionalProperties: false,
};

interface Workload {
  name: string;
  system: string;
  prompt: string;
  schema: Record<string, unknown>;
  maxOutputTokens: number;
  temperature: number;
  /** Returns quality notes, or throws to mark the payload invalid. */
  check: (parsed: any) => string;
}

const bnRatio = (s: string) => {
  const bn = (s.match(/[ঀ-৿]/g) ?? []).length;
  const latin = (s.match(/[A-Za-z]/g) ?? []).length;
  return bn + latin === 0 ? 0 : latin / (bn + latin);
};

const WORKLOADS: Workload[] = [
  {
    name: 'optimizer',
    system:
      'You rewrite résumés for ATS fit. Use ONLY evidence present in the candidate profile — never invent tools, employers or metrics. Echo every input id back EXACTLY as given.',
    prompt: `CANDIDATE EVIDENCE:\n${PROFILE}\n\nTARGET JOB:\n${JD}\n\nRewrite the summary and refine bullets for each experience id. Return every id unchanged.`,
    schema: OPTIMIZER_SCHEMA,
    maxOutputTokens: 8000,
    temperature: 0.3,
    check: (p) => {
      const ids = (p.experience ?? []).map((e: any) => e.id);
      const want = ['exp-1', 'exp-2', 'exp-3'];
      const missing = want.filter((w) => !ids.includes(w));
      if (missing.length) throw new Error(`ID MISMATCH — missing ${missing.join(',')} (got ${ids.join(',')})`);
      const bullets = (p.experience ?? []).reduce((n: number, e: any) => n + (e.refinedBullets?.length ?? 0), 0);
      return `ids OK, ${bullets} bullets, ${p.skills?.length ?? 0} skills, summary ${p.summary?.length ?? 0}ch`;
    },
  },
  {
    name: 'toolkit',
    system:
      'You write job-application collateral for Bangladeshi candidates. Ground every claim in the candidate evidence. Bengali fields must be in Bangla script, natural and professional — not transliterated English.',
    prompt: `CANDIDATE EVIDENCE:\n${PROFILE}\n\nTARGET JOB:\n${JD}\n\nWrite a cover letter, a LinkedIn note under 280 characters, and 5 interview questions with bilingual English/Bengali answer strategies.`,
    schema: TOOLKIT_SCHEMA,
    maxOutputTokens: 8000,
    temperature: 0.4,
    check: (p) => {
      const qs = p.interviewQuestions ?? [];
      if (!p.coverLetter?.trim()) throw new Error('empty coverLetter');
      if (qs.length === 0) throw new Error('no interviewQuestions');
      const missingBn = qs.filter((q: any) => !q.questionBn?.trim() || !q.answerStrategyBn?.trim()).length;
      const allBn = qs.map((q: any) => `${q.questionBn} ${q.answerStrategyBn}`).join(' ');
      const li = (p.linkedInMessage ?? '').length;
      return `${qs.length} Qs, ${missingBn} missing BN, latinRatioBN=${bnRatio(allBn).toFixed(3)}, cover ${p.coverLetter.length}ch, linkedIn ${li}ch${li > 280 ? ' OVER-280' : ''}`;
    },
  },
];

const MODELS = [GEMINI_MODELS.FLASH_LITE_35, GEMINI_MODELS.FLASH_LITE_31, GEMINI_MODELS.FLASH_36];
const fmtAttempts = (a: GeminiAttempt[]) =>
  a.map((x) => `${x.model.replace('gemini-', '')}${x.ok ? '=ok' : `=${x.code}`}(${x.ms}ms)`).join(' → ');

// ── classifier regression: recorded real payloads ──────────────────────────
// These are VERBATIM Google error bodies (captured 2026-08-04), replayed offline.
// They exist because prose-matching the 429 message was a real bug: Google sends
// the byte-identical sentence "You exceeded your current quota, please check your
// plan and billing details." for BOTH a per-minute throttle and an exhausted
// daily quota, so ('quota' + 'exceeded') labelled every RPM throttle as
// quota_exhausted. Only the structured quotaId distinguishes them. Free, offline,
// deterministic — and unlike a live RPM test it keeps working on a paid tier,
// where 300 RPM makes the throttle impractical to provoke.
const RECORDED: Array<{ name: string; status: number; body: string; expect: string; expectDelayMs?: number }> = [
  {
    name: '429 per-MINUTE throttle',
    status: 429,
    expect: 'rate_limit',
    expectDelayMs: 53_000,
    body: '{"error":{"code":429,"message":"You exceeded your current quota, please check your plan and billing details. For more information on this error, head to: https://ai.google.dev/gemini-api/docs/rate-limits.\\n* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 15, model: gemini-3.5-flash-lite\\nPlease retry in 53.66424793s.","status":"RESOURCE_EXHAUSTED","details":[{"@type":"type.googleapis.com/google.rpc.QuotaFailure","violations":[{"quotaMetric":"generativelanguage.googleapis.com/generate_content_free_tier_requests","quotaId":"GenerateRequestsPerMinutePerProjectPerModel-FreeTier","quotaValue":"15"}]},{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"53s"}]}}',
  },
  {
    name: '429 per-DAY exhaustion (same prose, different quotaId)',
    status: 429,
    expect: 'quota_exhausted',
    body: '{"error":{"code":429,"message":"You exceeded your current quota, please check your plan and billing details.","status":"RESOURCE_EXHAUSTED","details":[{"@type":"type.googleapis.com/google.rpc.QuotaFailure","violations":[{"quotaMetric":"generativelanguage.googleapis.com/generate_content_free_tier_requests","quotaId":"GenerateRequestsPerDayPerProjectPerModel-FreeTier","quotaValue":"1500"}]}]}}',
  },
  {
    name: '400 bad API key (must beat the generic 400 rule)',
    status: 400,
    expect: 'auth',
    body: '{"error":{"code":400,"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT"}}',
  },
  {
    name: '404 model gated to new users',
    status: 404,
    expect: 'model_unavailable',
    body: '{"error":{"code":404,"message":"This model models/gemini-2.5-flash is no longer available to new users.","status":"NOT_FOUND"}}',
  },
  {
    name: '400 genuine schema rejection',
    status: 400,
    expect: 'schema_invalid',
    body: '{"error":{"code":400,"message":"Request contains an invalid argument.","status":"INVALID_ARGUMENT"}}',
  },
  {
    // Must NOT be schema_invalid: that advances the chain, so the moment the $20
    // spend cap fires every request would walk all three models before failing.
    name: '400 FAILED_PRECONDITION — billing off / spend cap hit',
    status: 400,
    expect: 'billing_required',
    body: '{"error":{"code":400,"message":"Gemini API has not been used in project 123 before or it is disabled. Enable billing to continue.","status":"FAILED_PRECONDITION"}}',
  },
  {
    // The prose fallback, exercised by stripping the structured details. It must
    // NOT match on "exhaust" — RESOURCE_EXHAUSTED is in every 429's status, so
    // that re-created the exact misclassification quotaId exists to prevent.
    name: '429 with NO quotaId details — must default to rate_limit',
    status: 429,
    expect: 'rate_limit',
    body: '{"error":{"code":429,"message":"You exceeded your current quota, please check your plan and billing details.","status":"RESOURCE_EXHAUSTED"}}',
  },
  {
    // Genuine per-day signal in prose, still no structured details.
    name: '429 prose says per day — quota_exhausted',
    status: 429,
    expect: 'quota_exhausted',
    body: '{"error":{"code":429,"message":"Quota exceeded for quota metric generate_requests per day.","status":"RESOURCE_EXHAUSTED"}}',
  },
];

/**
 * Generators wrap failures for a readable message (GeminiResumeOptimizer's
 * buildFinalError) which hides the GeminiError. classifyGeminiError unwraps one
 * `cause` level; without that, every PAID optimizer failure forfeited its
 * structured code and its retryDelayMs.
 */
function causeUnwrapRegression(): boolean {
  const inner = new GeminiError('rate_limit', 429, 'gemini-3.5-flash-lite: throttled', [], 53_000);
  const wrapped = new Error(`Resume optimization failed: ${inner.message}`, { cause: inner });
  const got = classifyGeminiError(wrapped);
  const ok = got.code === 'rate_limit' && got.retryDelayMs === 53_000;
  console.log(
    `  ${ok ? '✓' : '✗'} ${'wrapped error unwraps one `cause` level'.padEnd(54)} -> ${got.code}` +
    `  retryDelayMs=${got.retryDelayMs ?? 'none'}${ok ? '' : '  EXPECTED rate_limit / 53000'}`,
  );
  return ok;
}

function classifierRegression(): boolean {
  console.log('\n=== CLASSIFIER REGRESSION (recorded payloads, offline) ===\n');
  let ok = true;
  for (const c of RECORDED) {
    const err = Object.assign(new Error(c.body), { status: c.status, name: 'ApiError' });
    const got = classifyGeminiError(err);
    const codeOk = got.code === c.expect;
    const delayOk = c.expectDelayMs === undefined || got.retryDelayMs === c.expectDelayMs;
    if (!codeOk || !delayOk) ok = false;
    console.log(
      `  ${codeOk && delayOk ? '✓' : '✗'} ${c.name.padEnd(54)} -> ${got.code}` +
      `${c.expect !== got.code ? ` (EXPECTED ${c.expect})` : ''}` +
      `${c.expectDelayMs !== undefined ? `  retryDelayMs=${got.retryDelayMs ?? 'none'}${delayOk ? '' : ` (EXPECTED ${c.expectDelayMs})`}` : ''}`
    );
  }
  const causeOk = causeUnwrapRegression();
  const allOk = ok && causeOk;
  console.log(`\n  ${allOk ? 'all recorded payloads classify correctly' : 'REGRESSION DETECTED'}`);
  return allOk;
}

// ── selftest: prove the error taxonomy is real ──────────────────────────────
async function selftest(client: GeminiClient) {
  const regressionOk = classifierRegression();
  console.log('\n=== SELFTEST: error taxonomy + fallback chain (live) ===\n');
  if (!regressionOk) process.exitCode = 1;
  // `expect` is ASSERTED, not decorative: 'ok' means the call must succeed,
  // anything else is the GeminiErrorCode it must produce.
  const cases: Array<{ name: string; expect: string; run: () => Promise<unknown> }> = [
    {
      name: 'happy path, structured JSON',
      expect: 'ok',
      run: () =>
        client.generate({
          models: [GEMINI_MODELS.FLASH_LITE_35],
          contents: 'Return the seniority of: "Senior Backend Engineer, 8 years".',
          responseJsonSchema: { type: 'object', properties: { seniority: { type: 'string' } }, required: ['seniority'], additionalProperties: false },
          maxOutputTokens: 256,
        }),
    },
    {
      name: 'fallback: dead 2.5 model first, 3.5-flash-lite second',
      expect: 'ok',
      run: () =>
        client.generate({
          models: ['gemini-2.5-flash', GEMINI_MODELS.FLASH_LITE_35],
          contents: 'Reply with the word ok.',
          maxOutputTokens: 64,
        }),
    },
    {
      name: 'all models dead',
      expect: 'model_unavailable',
      run: () =>
        client.generate({
          models: ['gemini-2.5-flash', 'gemini-2.5-flash-lite'],
          contents: 'Reply with the word ok.',
          maxOutputTokens: 64,
        }),
    },
    {
      name: 'truncation (maxOutputTokens=1)',
      expect: 'truncated',
      run: () =>
        client.generate({
          models: [GEMINI_MODELS.FLASH_LITE_35],
          contents: 'Write a 500 word essay about distributed ledgers.',
          maxOutputTokens: 1,
        }),
    },
    {
      name: 'timeout (budget below MIN_ATTEMPT_MS)',
      expect: 'timeout',
      run: () =>
        client.generate(
          { models: [GEMINI_MODELS.FLASH_LITE_35], contents: 'Write a long essay.', maxOutputTokens: 4096 },
          100,
        ),
    },
    {
      name: 'bad API key',
      expect: 'auth',
      run: () =>
        new GeminiClient('AIzaSyINVALID_KEY_FOR_SELFTEST_000000000').generate({
          models: [GEMINI_MODELS.FLASH_LITE_35],
          contents: 'hi',
          maxOutputTokens: 16,
        }),
    },
  ];

  let pass = 0;
  for (const c of cases) {
    let actual: string;
    let chain = '-';
    try {
      const r: any = await c.run();
      actual = 'ok';
      chain = fmtAttempts(r.attempts);
    } catch (e) {
      actual = e instanceof GeminiError ? e.code : classifyGeminiError(e).code;
      if (e instanceof GeminiError) chain = fmtAttempts(e.attempts);
    }
    const ok = actual === c.expect;
    if (ok) pass++;
    else process.exitCode = 1;
    console.log(
      `  ${ok ? '✓' : '✗'} ${c.name.padEnd(46)} -> ${actual.padEnd(18)}` +
      `${ok ? '' : ` EXPECTED ${c.expect}`} [${chain}]`,
    );
  }
  // An earlier version printed ✓ and incremented `pass` in BOTH branches, so it
  // reported 6/6 no matter what the classifier returned — a test that cannot fail
  // is worse than no test, because it manufactures confidence.
  console.log(`\n  ${pass}/${cases.length} live cases matched their expected outcome.`);
  if (pass < cases.length) console.log('  ^ a mismatch means the error taxonomy regressed.');
}

// ── bench: real cost / latency / quality per model ──────────────────────────
async function bench(client: GeminiClient, runs: number) {
  console.log(`\n=== BENCH: ${runs} run(s) per model per workload ===\n`);
  const rows: Array<Record<string, string | number>> = [];

  for (const w of WORKLOADS) {
    console.log(`── ${w.name}`);
    for (const model of MODELS) {
      const oks: number[] = [];
      let inT = 0, outT = 0, thT = 0, cost = 0, fails = 0;
      let lastNote = '';

      for (let i = 0; i < runs; i++) {
        const t0 = Date.now();
        try {
          const res = await client.generate(
            {
              models: [model],
              systemInstruction: w.system,
              contents: w.prompt,
              responseJsonSchema: w.schema,
              temperature: w.temperature,
              maxOutputTokens: w.maxOutputTokens,
            },
            55_000,
          );
          const u = res.usage ?? {};
          inT += u.promptTokens ?? 0;
          outT += u.completionTokens ?? 0;
          thT += u.thoughtTokens ?? 0;
          cost += costOf(model, u.promptTokens, u.completionTokens, u.thoughtTokens);
          oks.push(Date.now() - t0);
          lastNote = w.check(JSON.parse(res.text));
        } catch (e) {
          fails++;
          const code = e instanceof GeminiError ? e.code : classifyGeminiError(e).code;
          lastNote = `FAIL ${code}: ${(e as Error).message.slice(0, 90)}`;
        }
      }

      const n = oks.length || 1;
      const avgMs = Math.round(oks.reduce((a, b) => a + b, 0) / n);
      console.log(
        `   ${model.replace('gemini-', '').padEnd(16)} ` +
        `in=${Math.round(inT / n).toString().padStart(5)} out=${Math.round(outT / n).toString().padStart(5)} ` +
        `th=${Math.round(thT / n).toString().padStart(4)} ` +
        `$${(cost / n).toFixed(5)} ${avgMs.toString().padStart(6)}ms ` +
        `${fails ? `${fails}/${runs} FAILED` : 'ok'}\n${' '.repeat(19)}${lastNote}`
      );
      rows.push({ workload: w.name, model, avgCost: +(cost / n).toFixed(6), avgMs, fails });
    }
    console.log('');
  }

  // Per-generation = optimizer + toolkit, the 2-call paid hot path.
  console.log('── per paid generation (optimizer + toolkit), same model for both');
  const REV_NET = 1.59; // ৳200 at ~123.4 BDT/USD, minus ~1.8% bKash merchant fee
  for (const model of MODELS) {
    const c = rows.filter((r) => r.model === model).reduce((s, r) => s + (r.avgCost as number), 0);
    const pack = c * 5;
    console.log(
      `   ${model.replace('gemini-', '').padEnd(16)} $${c.toFixed(5)}/generation  ` +
      `$${pack.toFixed(4)}/5-credit pack  margin ${(((REV_NET - pack) / REV_NET) * 100).toFixed(1)}%`
    );
  }
}

// ── tier: is this key on the free tier or a paid tier? ─────────────────────
// The API exposes no "what tier am I" endpoint, so infer it from throughput.
// Free tier is 15 RPM per model; Tier 1 is ~300. Fire 20 minimal requests at
// once: if several 429, we are still on free tier, and the 429's quotaMetric
// (`generate_content_free_tier_requests`) says so outright. Costs ~$0.000003.
async function tierCheck(client: GeminiClient) {
  console.log('\n=== TIER CHECK: 20 concurrent minimal requests ===\n');
  const results = await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      client
        // 64, not 4: a too-small cap makes every response finish MAX_TOKENS,
        // which is FATAL in the client and masks the throttle signal entirely.
        .generate({ models: [GEMINI_MODELS.FLASH_LITE_35], contents: `say ${i}`, maxOutputTokens: 64 }, 30_000)
        .then(() => null)
        .catch((e) => e),
    ),
  );
  const errs = results.filter(Boolean) as unknown[];
  const throttled = errs.filter((e) => e instanceof GeminiError && (e.code === 'rate_limit' || e.code === 'quota_exhausted'));
  console.log(`  ${20 - errs.length}/20 succeeded, ${throttled.length} throttled`);

  const sample = throttled[0] as GeminiError | undefined;
  if (sample) {
    const metric = /generate_content_(\w+)_tier_requests/.exec(sample.message)?.[1];
    console.log(`  throttle code : ${sample.code}`);
    console.log(`  quota metric  : ${metric ? `${metric}_tier` : '(not found in message)'}`);
    console.log(`\n  => STILL ON FREE TIER (15 RPM). Billing has not taken effect for this key.`);
  } else if (errs.length) {
    console.log(`  non-throttle errors: ${errs.map((e) => (e instanceof GeminiError ? e.code : String(e))).join(', ')}`);
    console.log(`\n  => inconclusive — see errors above`);
  } else {
    console.log(`\n  => PAID TIER CONFIRMED. 20 concurrent > the 15 RPM free-tier ceiling with zero throttles.`);
    console.log(`     Google no longer trains on these prompts; real résumé data is now in scope.`);
  }
}

// ── e2e: the REAL generators, with their REAL schemas and guards ────────────
// bench() exercises simplified schema mirrors, which proves the transport but not
// the product. This runs all eight production generators against a synthetic
// profile, so the real OPTIMIZER_SCHEMA / TOOLKIT_SCHEMA / EXTRACTOR_SCHEMA /
// NORMALIZER_SCHEMA, the fabrication + specificity guards, and the deterministic
// post-pipelines are all on the hook. One call per generator — this is the
// cheapest run that can actually say "the port works".
async function e2e(key: string) {
  const [
    { GeminiResumeOptimizer }, { GeminiToolkitGenerator }, { GeminiResumeExtractor },
    { GeminiProfileNormalizer }, { GeminiCoverLetterGenerator },
    { GeminiOutreachEmailGenerator }, { GeminiLinkedInMessageGenerator },
    { GeminiInterviewQuestionsGenerator },
  ] = await Promise.all([
    import('../src/infrastructure/ai/GeminiResumeOptimizer.js'),
    import('../src/infrastructure/ai/GeminiToolkitGenerator.js'),
    import('../src/infrastructure/ai/GeminiResumeExtractor.js'),
    import('../src/infrastructure/ai/GeminiProfileNormalizer.js'),
    import('../src/infrastructure/ai/GeminiCoverLetterGenerator.js'),
    import('../src/infrastructure/ai/GeminiOutreachEmailGenerator.js'),
    import('../src/infrastructure/ai/GeminiLinkedInMessageGenerator.js'),
    import('../src/infrastructure/ai/GeminiInterviewQuestionsGenerator.js'),
  ]);

  const data: any = {
    targetJob: { title: 'Senior Backend Engineer', company: 'NordPay Fintech Ltd', description: JD },
    personalInfo: { fullName: 'Rifat Hasan', email: 'rifat@example.com', phone: '+8801700000000', location: 'Dhaka, Bangladesh' },
    summary: '',
    experience: [
      { id: 'exp-1', company: 'Ditio AS', role: 'Senior Software Engineer', startDate: '2022-03', endDate: '', isCurrent: true,
        rawDescription: 'Built batch camera module and trip-tracking pipeline for construction fleet telematics. Migrated MongoDB change streams into a ClickHouse analytics warehouse via Redpanda CDC. Cut p99 trip-ingest latency from 4.2s to 780ms with batched writes and a Redis read-through cache. Owned on-call for 6 Go microservices.',
        refinedBullets: [] },
      { id: 'exp-2', company: 'Shohoz Ltd', role: 'Software Engineer', startDate: '2019-07', endDate: '2022-02', isCurrent: false,
        rawDescription: 'Implemented bKash payment reconciliation for ticketing, cutting settlement mismatches 40%. Built a double-entry ledger for refunds and partial cancellations in PostgreSQL. Automated daily Bangladesh Bank settlement reporting, removing 6 hours of manual work weekly.',
        refinedBullets: [] },
    ],
    projects: [
      { id: 'prj-1', name: 'OpenLedger', rawDescription: 'Open-source double-entry ledger library in Go, 340 GitHub stars.', refinedBullets: [], technologies: 'Go, PostgreSQL' },
    ],
    education: [{ id: 'edu-1', school: 'BUET', degree: 'BSc', field: 'Computer Science', endDate: '2017-06' }],
    skills: ['Go', 'Python', 'PostgreSQL', 'Kafka', 'Redis', 'Docker', 'Kubernetes', 'ClickHouse'],
    certifications: [{ id: 'cert-1', name: 'AWS Solutions Architect Associate', issuer: 'AWS', date: '2023-04' }],
  };

  const RESUME_TEXT = `Rifat Hasan
rifat@example.com | +8801700000000 | Dhaka, Bangladesh

EXPERIENCE
Senior Software Engineer, Ditio AS (Mar 2022 - Present)
- Built trip-tracking pipeline for construction fleet telematics
- Cut p99 ingest latency from 4.2s to 780ms
Software Engineer, Shohoz Ltd (Jul 2019 - Feb 2022)
- Implemented bKash payment reconciliation, cut settlement mismatches 40%

EDUCATION
BSc Computer Science, BUET, 2017

SKILLS
Go, Python, PostgreSQL, Kafka, Redis, Docker, Kubernetes`;

  const cases: Array<{ name: string; run: (u: any) => Promise<string> }> = [
    { name: 'optimizer (OPTIMIZER_SCHEMA + full post-pipeline)', run: async (u) => {
      const r: any = await new GeminiResumeOptimizer(key).optimize(data, u);
      const ids = r.experience.map((e: any) => e.id).join(',');
      if (ids !== 'exp-1,exp-2') throw new Error(`ID MISMATCH: ${ids}`);
      return `ids OK, summary ${r.summary.length}ch, ${r.skills.length} skills, ${r.skillCategories?.length ?? 0} categories`;
    } },
    { name: 'toolkit (TOOLKIT_SCHEMA + 4 artifact guards)', run: async (u) => {
      const r: any = await new GeminiToolkitGenerator(key).generate(data, u);
      const errs = Object.keys(r.errors ?? {});
      const bn = (r.interviewQuestions ?? []).map((q: any) => `${q.questionBn} ${q.answerStrategyBn}`).join(' ');
      return `cover ${r.coverLetter?.length ?? 0}ch, linkedIn ${r.linkedInMessage?.length ?? 0}ch, ${r.interviewQuestions?.length ?? 0} Qs, ` +
             `latinRatioBN=${bnRatio(bn).toFixed(3)}, failedSlots=[${errs.join(',') || 'none'}]`;
    } },
    { name: 'extractor (EXTRACTOR_SCHEMA, text mode)', run: async (u) => {
      const r: any = await new GeminiResumeExtractor(key).extract(RESUME_TEXT, 'text/plain', u);
      return `${r.experience?.length ?? 0} exp, ${r.education?.length ?? 0} edu, ${r.skills?.length ?? 0} skills`;
    } },
    { name: 'normalizer (NORMALIZER_SCHEMA)', run: async (u) => {
      const r = await new GeminiProfileNormalizer(key).normalize(data.experience[1].rawDescription, { kind: 'experience' } as any, u);
      return `${r.bullets.length} bullets, ${r.skills.length} skills, ${r.gaps.length} gaps`;
    } },
    { name: 'cover letter (fabrication guard)', run: async (u) => {
      const r = await new GeminiCoverLetterGenerator(key).generate(data, u);
      return `${r.length}ch`;
    } },
    { name: 'outreach (OUTREACH_SCHEMA + both guards)', run: async (u) => {
      const r = await new GeminiOutreachEmailGenerator(key).generate(data, u);
      return `subject ${r.subject.length}ch, body ${r.body.length}ch`;
    } },
    { name: 'linkedIn (280 trim + both guards)', run: async (u) => {
      const r = await new GeminiLinkedInMessageGenerator(key).generate(data, u);
      return `${r.length}ch${r.length > 280 ? ' OVER-280!' : ''}`;
    } },
    { name: 'interview (INTERVIEW_SCHEMA, bilingual)', run: async (u) => {
      const r = await new GeminiInterviewQuestionsGenerator(key).generate(data, u);
      const bn = r.map((q) => `${q.questionBn ?? ''} ${q.answerStrategyBn ?? ''}`).join(' ');
      return `${r.length} Qs, latinRatioBN=${bnRatio(bn).toFixed(3)}`;
    } },
  ];

  console.log('\n=== E2E: real generators, real schemas, real guards ===\n');
  let pass = 0, cost = 0;
  for (const c of cases) {
    const u: any = {};
    const t0 = Date.now();
    try {
      const note = await c.run(u);
      const cc = costOf(u.model ?? '', u.promptTokens, u.completionTokens, u.thoughtTokens);
      cost += cc;
      pass++;
      console.log(`  PASS  ${c.name}\n        served=${u.model} in=${u.promptTokens} out=${u.completionTokens} th=${u.thoughtTokens ?? 0} $${cc.toFixed(5)} ${Date.now() - t0}ms`);
      console.log(`        ${note}`);
      if ((u.attempts ?? []).length > 1) console.log(`        chain: ${fmtAttempts(u.attempts)}`);
    } catch (e) {
      const code = e instanceof GeminiError ? e.code : classifyGeminiError(e).code;
      console.log(`  FAIL  ${c.name}\n        code=${code} ${(e as Error).message.slice(0, 180)}`);
      if ((u.attempts ?? []).length) console.log(`        chain: ${fmtAttempts(u.attempts)}`);
    }
  }
  console.log(`\n  ${pass}/${cases.length} generators passed — total spend this run $${cost.toFixed(5)}`);
  if (pass < cases.length) process.exitCode = 1;
}

// ── gaps: the two paths e2e could not reach ─────────────────────────────────
//  1. MULTIMODAL. e2e drives the extractor's text/plain branch only. The
//     inlineData branch — what fires when pdf.js cannot pull text out, i.e.
//     scanned PDFs — is a different code path (Part[] instead of a string) and
//     had never run against Gemini 3.x. Needs a real PDF: pass its path as argv.
//  2. gemini-3.6-flash AT FULL PAYLOAD. It sits mid-chain but no fallback ever
//     fired in testing, so it was unexercised. thinkingLevel MINIMAL measured 0
//     thoughts on a trivial task; if thoughts reappear on a real 8000-token
//     toolkit they also consume maxOutputTokens, and truncation does not walk the
//     chain — so this is the latent risk worth pricing.
async function gaps(key: string, pdfPath?: string) {
  console.log('\n=== GAPS: multimodal + premium-model-at-scale ===\n');
  const client = new GeminiClient(key);

  // ── 1. multimodal extractor
  if (!pdfPath) {
    console.log('  SKIP  multimodal — pass a PDF path as the 2nd arg');
  } else {
    const { GeminiResumeExtractor } = await import('../src/infrastructure/ai/GeminiResumeExtractor.js');
    const b64 = readFileSync(pdfPath).toString('base64');
    const u: any = {};
    const t0 = Date.now();
    try {
      const r: any = await new GeminiResumeExtractor(key).extract(b64, 'application/pdf', u);
      console.log(
        `  PASS  multimodal extractor (inlineData, application/pdf, ${Math.round(b64.length / 1024)}KB b64)\n` +
        `        served=${u.model} in=${u.promptTokens} out=${u.completionTokens} th=${u.thoughtTokens ?? 0} ` +
        `$${costOf(u.model ?? '', u.promptTokens, u.completionTokens, u.thoughtTokens).toFixed(5)} ${Date.now() - t0}ms\n` +
        `        name=${r.personalInfo?.fullName ?? '?'} ${r.experience?.length ?? 0} exp, ${r.education?.length ?? 0} edu, ${r.skills?.length ?? 0} skills`
      );
    } catch (e) {
      const code = e instanceof GeminiError ? e.code : classifyGeminiError(e).code;
      console.log(`  FAIL  multimodal extractor\n        code=${code} ${(e as Error).message.slice(0, 200)}`);
      process.exitCode = 1;
    }
  }

  // ── 2. gemini-3.6-flash on the real toolkit payload, MINIMAL vs default
  const { buildToolkitSystemInstruction, buildToolkitUserPrompt, TOOLKIT_SCHEMA } =
    await import('../src/infrastructure/ai/prompts/toolkitPrompts.js');
  const data: any = {
    targetJob: { title: 'Senior Backend Engineer', company: 'NordPay Fintech Ltd', description: JD },
    personalInfo: { fullName: 'Rifat Hasan', email: 'r@e.com', phone: '+8801700000000', location: 'Dhaka' },
    summary: '', education: [], projects: [],
    experience: [{ id: 'exp-1', company: 'Shohoz Ltd', role: 'Software Engineer', startDate: '2019-07', endDate: '2022-02', isCurrent: false,
      rawDescription: 'Implemented bKash payment reconciliation for ticketing, cutting settlement mismatches 40%. Built a double-entry ledger for refunds in PostgreSQL. Automated Bangladesh Bank settlement reporting.', refinedBullets: [] }],
    skills: ['Go', 'PostgreSQL', 'Kafka', 'Redis'],
  };

  for (const [label, thinking] of [
    ['thinkingLevel MINIMAL (what we ship)', ThinkingLevel.MINIMAL],
    ['thinking DEFAULT (what we avoid)', undefined],
  ] as Array<[string, ThinkingLevel | undefined]>) {
    const t0 = Date.now();
    try {
      const r = await client.generate(
        {
          models: [GEMINI_MODELS.FLASH_36],
          systemInstruction: buildToolkitSystemInstruction('match'),
          contents: buildToolkitUserPrompt(data, 'match'),
          responseJsonSchema: TOOLKIT_SCHEMA,
          temperature: 0.4,
          maxOutputTokens: 8000,
          ...(thinking ? { thinkingLevel: thinking } : {}),
        },
        55_000,
      );
      const th = r.usage?.thoughtTokens ?? 0;
      const out = r.usage?.completionTokens ?? 0;
      console.log(
        `  ${th === 0 || thinking ? 'PASS' : 'INFO'}  3.6-flash @8000 tok — ${label}\n` +
        `        in=${r.usage?.promptTokens} out=${out} thoughts=${th}` +
        `${out ? ` (${(th / out).toFixed(2)}x output)` : ''} ` +
        `$${costOf(GEMINI_MODELS.FLASH_36, r.usage?.promptTokens, out, th).toFixed(5)} ${Date.now() - t0}ms`
      );
    } catch (e) {
      const code = e instanceof GeminiError ? e.code : classifyGeminiError(e).code;
      console.log(`  FAIL  3.6-flash — ${label}\n        code=${code} ${(e as Error).message.slice(0, 160)}`);
      process.exitCode = 1;
    }
  }
}

async function main() {
  const mode = process.argv[2] ?? 'selftest';
  const key = loadKey();
  const client = new GeminiClient(key);
  if (mode === 'selftest') await selftest(client);
  else if (mode === 'bench') await bench(client, Number(process.argv[3] ?? 1));
  else if (mode === 'tier') await tierCheck(client);
  else if (mode === 'e2e') await e2e(key);
  else if (mode === 'gaps') await gaps(key, process.argv[3]);
  else { console.error(`unknown mode "${mode}" — use selftest, bench, tier, e2e or gaps`); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });
