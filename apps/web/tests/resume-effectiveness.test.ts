/* eslint-disable */
// Effectiveness test for the resume optimizer.
// Run: npx tsx tests/resume-effectiveness.test.ts
//
// Mirrors production wiring: tries Groq first, falls back to Gemini, via
// MultiProviderResumeOptimizer. Whichever provider answers gets evaluated.
//
// One mock candidate, three different JDs (Backend / Frontend / DevOps).
// For each JD we call the real optimizer, then score:
//   - JD keyword coverage (using a hand-curated ground-truth keyword set)
//   - ATS compliance (action verb start, banned phrases, length, verb diversity, no 1st person)
//   - No-fabrication (preserved metrics from raw inputs)
//   - Cross-JD differentiation (Jaccard similarity between bullet sets)

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GeminiResumeOptimizer } from '../src/infrastructure/ai/GeminiResumeOptimizer';
import { GroqResumeOptimizer } from '../src/infrastructure/ai/GroqResumeOptimizer';
import { MultiProviderResumeOptimizer, NamedOptimizer } from '../src/infrastructure/ai/MultiProviderResumeOptimizer';
import type { IResumeOptimizer } from '../src/domain/usecases/OptimizeResumeUseCase';
import type { ResumeData, OptimizedResumeData } from '../src/domain/entities/Resume';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

// ────────────────────────────────────────────────
// Load API keys from .env
// ────────────────────────────────────────────────
function loadEnv(): Record<string, string> {
  const envPath = path.join(ROOT, '.env');
  const txt = fs.readFileSync(envPath, 'utf8');
  const out: Record<string, string> = {};
  for (const line of txt.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.+)$/);
    if (!m) continue;
    out[m[1]] = m[2].trim().replace(/^"|"$/g, '');
  }
  return out;
}

function isPlaceholder(v: string | undefined): boolean {
  return !v || v === '' || /your_.*here/i.test(v);
}

// ────────────────────────────────────────────────
// Mock candidate (constant — same for all 3 JDs)
// ────────────────────────────────────────────────
const baseCandidate: Omit<ResumeData, 'targetJob'> = {
  userType: 'experienced',
  personalInfo: {
    fullName: 'Alex Morgan',
    email: 'alex.morgan@example.com',
    phone: '+1 555-123-4567',
    location: 'Austin, TX',
    linkedin: 'linkedin.com/in/alexmorgan',
    github: 'github.com/alexmorgan',
  },
  summary: '',
  experience: [
    {
      id: 'exp-1',
      company: 'Northwind Logistics',
      role: 'Senior Software Engineer',
      startDate: '2023-03-01',
      endDate: '',
      isCurrent: true,
      rawDescription:
        'Led a team of 4 engineers building a shipment-tracking platform on Node.js, Postgres, and React. ' +
        'Designed REST and GraphQL APIs handling 12 million requests per day. Reduced p95 latency from 850ms to 220ms by ' +
        'introducing Redis caching and rewriting the route-planning service in Go. Set up CI/CD with GitHub Actions, cut deploy ' +
        'time from 18 to 4 minutes. Built dashboards in Grafana, ran weekly on-call rotations, mentored 2 junior engineers.',
      refinedBullets: [],
    },
    {
      id: 'exp-2',
      company: 'Brightline Analytics',
      role: 'Software Engineer',
      startDate: '2021-06-01',
      endDate: '2023-02-28',
      isCurrent: false,
      rawDescription:
        'Built a customer-facing analytics dashboard in React, TypeScript, and Next.js. Migrated legacy Angular code to React, ' +
        'shipped a component library used by 7 product teams. Implemented WebSocket streaming for live dashboards. Worked ' +
        'with product designers to redesign the funnel report; engagement on the report rose 35%. Wrote Cypress and Jest tests, ' +
        'pushed unit-test coverage from 38% to 78%.',
      refinedBullets: [],
    },
    {
      id: 'exp-3',
      company: 'Stack & Ladder Co.',
      role: 'Junior Backend Developer',
      startDate: '2020-01-01',
      endDate: '2021-05-31',
      isCurrent: false,
      rawDescription:
        'Maintained a Django + PostgreSQL monolith for an e-commerce client. Wrote integrations with Stripe and Shopify. ' +
        'Containerized services with Docker, deployed to AWS ECS. Triaged production bugs and on-call incidents. Helped ' +
        'migrate the deployment pipeline from Jenkins to GitHub Actions.',
      refinedBullets: [],
    },
  ],
  projects: [
    {
      id: 'proj-1',
      name: 'KubeWatch',
      rawDescription:
        'Open-source CLI that streams Kubernetes pod events to Slack. 1.2k GitHub stars. Wrote in Go using client-go. Ships ' +
        'as a Helm chart and a Docker image. Has integration tests against a kind cluster in CI.',
      technologies: 'Go, Kubernetes, Helm, Docker, GitHub Actions',
      link: 'github.com/alexmorgan/kubewatch',
      refinedBullets: [],
    },
    {
      id: 'proj-2',
      name: 'PaperTrail',
      rawDescription:
        'Side project: a Next.js + tRPC reading-list app with offline support via service workers. Used Tailwind CSS, ' +
        'Postgres on Supabase, Vercel Edge Functions. Has 400 monthly active users.',
      technologies: 'Next.js, tRPC, TypeScript, Tailwind CSS, Supabase, Vercel',
      link: 'papertrail.app',
      refinedBullets: [],
    },
    {
      id: 'proj-3',
      name: 'TerraDeploy',
      rawDescription:
        'Internal tool that bootstraps multi-region AWS environments via Terraform modules. Standardized VPC, EKS, RDS, and ' +
        'IAM setup. Reduced new-environment provisioning time from 2 days to 45 minutes across 6 product teams.',
      technologies: 'Terraform, AWS, EKS, RDS, IAM',
      refinedBullets: [],
    },
  ],
  education: [
    {
      id: 'edu-1',
      school: 'University of Texas at Austin',
      degree: 'B.S.',
      field: 'Computer Science',
      startDate: '2016-09-01',
      endDate: '2020-05-31',
      gpa: '3.7/4.0',
    },
  ],
  skills: [
    'JavaScript', 'TypeScript', 'React', 'Next.js', 'Node.js', 'Go', 'Python', 'Django',
    'PostgreSQL', 'Redis', 'GraphQL', 'REST API', 'Docker', 'Kubernetes', 'AWS',
    'Terraform', 'GitHub Actions', 'CI/CD', 'Jest', 'Cypress', 'Grafana',
  ],
  extracurriculars: [],
};

// ────────────────────────────────────────────────
// 3 mock JDs + ground-truth keyword sets
// ────────────────────────────────────────────────
type JdSpec = {
  id: string;
  title: string;
  company: string;
  description: string;
  // Hand-curated single-word/short keywords we expect to see somewhere in the optimized output.
  expectedKeywords: string[];
  // Multi-word phrases (≥2 words) we expect to be lifted verbatim from the JD.
  expectedPhrases: string[];
  // Per-role lead-bullet keyword anchors — first bullet in current role should hit at least one.
  leadBulletAnchors: string[];
};

const JDS: JdSpec[] = [
  {
    id: 'backend',
    title: 'Senior Backend Engineer',
    company: 'Vector Pay',
    description: `
We are hiring a Senior Backend Engineer to scale our payments infrastructure. You'll own services that move
billions of dollars annually, written primarily in Go with PostgreSQL and Redis. You'll design idempotent REST
and gRPC APIs, ship features behind feature flags, and partner with SRE on observability.

Responsibilities:
- Design, build, and operate distributed systems on Kubernetes (EKS).
- Own service reliability: SLOs, error budgets, on-call rotation, incident reviews.
- Improve p95/p99 latency on the payments hot path.
- Mentor mid-level engineers; lead technical design reviews.

Requirements:
- 5+ years of backend experience, with strong Go (or willingness to ramp up fast from Node.js / Java).
- Production experience with PostgreSQL, Redis, and message queues (Kafka or NATS).
- Strong CI/CD practices using GitHub Actions or GitLab CI.
- Experience with observability tooling (Grafana, Prometheus, OpenTelemetry).
`.trim(),
    expectedKeywords: [
      'Go', 'PostgreSQL', 'Redis', 'REST', 'Kubernetes', 'CI/CD', 'GitHub Actions',
      'Grafana', 'distributed systems', 'mentor', 'on-call', 'latency',
    ],
    expectedPhrases: ['distributed systems', 'on-call', 'GitHub Actions', 'p95', 'CI/CD'],
    leadBulletAnchors: ['Go', 'latency', 'p95', 'distributed', 'Redis', 'PostgreSQL', 'API'],
  },
  {
    id: 'frontend',
    title: 'Senior Frontend Engineer (React)',
    company: 'Lumen Studio',
    description: `
Lumen Studio is hiring a Senior Frontend Engineer to lead our design-system and dashboard work. Our stack is
React 19, Next.js, TypeScript, and Tailwind CSS. We obsess over performance (Core Web Vitals), accessibility
(WCAG 2.2 AA), and component reusability.

You will:
- Own and evolve our internal component library used across 8 product teams.
- Build streaming, real-time dashboards using Server Components and WebSockets.
- Drive accessibility, performance budgets, and visual regression testing.
- Pair with designers on Figma-to-code workflows.

Requirements:
- 5+ years of frontend experience with React and TypeScript.
- Deep Next.js experience (App Router, RSC, edge runtime).
- Strong testing discipline: Jest, React Testing Library, Cypress.
- Comfort working with REST/GraphQL APIs.
`.trim(),
    expectedKeywords: [
      'React', 'Next.js', 'TypeScript', 'Tailwind CSS', 'component library', 'accessibility',
      'WebSockets', 'Jest', 'Cypress', 'GraphQL', 'REST',
    ],
    expectedPhrases: ['component library', 'Next.js', 'Tailwind CSS', 'WebSockets', 'TypeScript'],
    leadBulletAnchors: ['React', 'Next.js', 'TypeScript', 'component library', 'dashboard', 'WebSocket'],
  },
  {
    id: 'devops',
    title: 'DevOps / Site Reliability Engineer',
    company: 'OrbitOps',
    description: `
OrbitOps runs critical infrastructure for B2B SaaS customers. We're looking for a DevOps / SRE engineer to
own our multi-region AWS footprint and Kubernetes platform.

You will:
- Manage and evolve Terraform modules covering VPC, EKS, RDS, IAM across 3 AWS regions.
- Operate EKS clusters: cluster upgrades, autoscaling, network policies, Helm charts.
- Build CI/CD pipelines in GitHub Actions; standardize deploy patterns across 10+ services.
- Improve observability with Grafana, Prometheus, and Loki; lead incident response.
- Drive cost optimization on AWS (Savings Plans, right-sizing, spot).

Requirements:
- 4+ years operating production Kubernetes (EKS preferred).
- Deep Terraform experience and IaC discipline.
- Strong scripting (Go, Python, or Bash).
- On-call experience with PagerDuty or equivalent.
`.trim(),
    expectedKeywords: [
      'Terraform', 'AWS', 'EKS', 'Kubernetes', 'Helm', 'CI/CD', 'GitHub Actions',
      'Grafana', 'Prometheus', 'Go', 'Python', 'on-call',
    ],
    expectedPhrases: ['EKS', 'GitHub Actions', 'Helm', 'CI/CD', 'on-call'],
    leadBulletAnchors: ['Terraform', 'EKS', 'Kubernetes', 'AWS', 'CI/CD', 'Grafana', 'Helm'],
  },
];

// Ground-truth metrics that came from raw input — must survive optimization.
// We check these as substrings in the full optimized text.
const PRESERVED_METRICS = [
  '4 engineers', '12 million', '850ms', '220ms', '18 ', '4 minutes', '2 junior',
  '7 product teams', '35%', '38%', '78%',
  '1.2k', '400 monthly', '2 days', '45 minutes', '6 product teams',
];

// ────────────────────────────────────────────────
// Evaluator
// ────────────────────────────────────────────────
const STRONG_ACTION_VERBS = new Set(
  [
    'Architected', 'Built', 'Developed', 'Engineered', 'Implemented', 'Launched', 'Shipped', 'Deployed',
    'Refactored', 'Automated', 'Designed', 'Owned', 'Drove', 'Delivered', 'Improved', 'Reduced', 'Increased',
    'Established', 'Led', 'Directed', 'Coordinated', 'Streamlined', 'Scaled', 'Restructured', 'Oversaw',
    'Mentored', 'Migrated', 'Integrated', 'Optimized', 'Maintained', 'Containerized', 'Provisioned',
    'Standardized', 'Created', 'Spearheaded', 'Championed', 'Wrote', 'Pioneered', 'Authored', 'Configured',
    'Orchestrated', 'Modernized', 'Rolled', 'Reviewed', 'Researched', 'Investigated', 'Analyzed', 'Modeled',
    'Resolved', 'Triaged', 'Diagnosed', 'Hardened', 'Secured', 'Tuned', 'Reengineered', 'Cut', 'Boosted',
    'Accelerated', 'Operated', 'Partnered', 'Drafted', 'Decomposed', 'Composed', 'Generated',
    'Decreased', 'Eliminated', 'Saved', 'Captured', 'Negotiated', 'Closed', 'Forecasted', 'Pitched', 'Grew',
    'Acquired', 'Onboarded', 'Trained', 'Taught', 'Coached', 'Advised', 'Facilitated',
    'Set', 'Ran', 'Managed', 'Enabled', 'Pushed', 'Translated', 'Transformed',
    'Bootstrapped', 'Rewrote', 'Replaced', 'Packaged', 'Achieved', 'Distributed', 'Co-led',
    'Drove', 'Spearheaded', 'Authored', 'Authored', 'Reengineered',
  ].map(v => v.toLowerCase())
);

const WEAK_VERBS = new Set(
  ['Assisted', 'Contributed', 'Utilized', 'Used', 'Helped', 'Worked', 'Handled', 'Supported', 'Collaborated',
   'Participated', 'Involved'].map(v => v.toLowerCase())
);

const BANNED_PHRASES = [
  'responsible for', 'worked on', 'helped with', 'helped to', 'duties included', 'in charge of',
  'tasked with', 'assisted with', 'assisted in', 'involved in', 'participated in',
];

const FIRST_PERSON = /\b(I|me|my|we|our|us)\b/g;

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9+./#\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function bulletShingles(bullets: string[], k = 5): Set<string> {
  // k-word shingles across all bullets — captures whether two outputs share long phrases.
  const set = new Set<string>();
  for (const b of bullets) {
    const toks = tokenize(b);
    for (let i = 0; i + k <= toks.length; i++) {
      set.add(toks.slice(i, i + k).join(' '));
    }
  }
  return set;
}

function allBullets(out: OptimizedResumeData): string[] {
  return [
    ...(out.experience ?? []).flatMap(e => e.refinedBullets),
    ...(out.projects ?? []).flatMap(p => p.refinedBullets),
    ...(out.extracurriculars ?? []).flatMap(e => e.refinedBullets),
  ];
}

function fullText(out: OptimizedResumeData): string {
  return [
    out.summary ?? '',
    (out.skills ?? []).join(', '),
    ...allBullets(out),
  ].join('\n');
}

function firstWord(b: string): string {
  const m = b.trim().match(/^([A-Za-z][A-Za-z'-]*)/);
  return m ? m[1] : '';
}

type ItemReport = {
  bulletCount: number;
  unknownVerbStarts: { bullet: string; verb: string }[]; // not in strong nor weak — likely missing from list
  weakVerbStarts: { bullet: string; verb: string }[];
  bannedHits: { bullet: string; phrase: string }[];
  firstPersonHits: { bullet: string; word: string }[];
  tooShort: string[];
  tooLong: string[];
  duplicateStartVerbs: string[];
  empty: boolean;
};

function evaluateItem(bullets: string[]): ItemReport {
  const r: ItemReport = {
    bulletCount: bullets.length,
    unknownVerbStarts: [],
    weakVerbStarts: [],
    bannedHits: [],
    firstPersonHits: [],
    tooShort: [],
    tooLong: [],
    duplicateStartVerbs: [],
    empty: bullets.length === 0,
  };
  const verbCounts = new Map<string, number>();
  for (const b of bullets) {
    const fw = firstWord(b);
    const fwl = fw.toLowerCase();
    if (WEAK_VERBS.has(fwl)) r.weakVerbStarts.push({ bullet: b, verb: fw });
    else if (!STRONG_ACTION_VERBS.has(fwl)) r.unknownVerbStarts.push({ bullet: b, verb: fw });
    verbCounts.set(fwl, (verbCounts.get(fwl) ?? 0) + 1);
    const lc = b.toLowerCase();
    for (const phrase of BANNED_PHRASES) {
      if (lc.includes(phrase)) r.bannedHits.push({ bullet: b, phrase });
    }
    let m: RegExpExecArray | null;
    FIRST_PERSON.lastIndex = 0;
    while ((m = FIRST_PERSON.exec(b)) !== null) {
      r.firstPersonHits.push({ bullet: b, word: m[1] });
    }
    const wc = b.split(/\s+/).filter(Boolean).length;
    if (wc < 6) r.tooShort.push(b);
    if (wc > 35) r.tooLong.push(b);
  }
  for (const [v, c] of verbCounts) if (c > 1) r.duplicateStartVerbs.push(`${v}×${c}`);
  return r;
}

type CoverageReport = {
  expected: string[];
  matched: string[];
  missed: string[];
  ratio: number; // 0..1
};

function evaluateCoverage(out: OptimizedResumeData, expected: string[]): CoverageReport {
  const text = fullText(out).toLowerCase();
  const matched: string[] = [];
  const missed: string[] = [];
  for (const kw of expected) {
    if (text.includes(kw.toLowerCase())) matched.push(kw);
    else missed.push(kw);
  }
  return { expected, matched, missed, ratio: matched.length / expected.length };
}

function evaluatePreservedMetrics(out: OptimizedResumeData): { preserved: string[]; missing: string[] } {
  const text = fullText(out).toLowerCase();
  const preserved: string[] = [];
  const missing: string[] = [];
  for (const m of PRESERVED_METRICS) {
    if (text.includes(m.toLowerCase())) preserved.push(m);
    else missing.push(m);
  }
  return { preserved, missing };
}

function evaluateSummary(summary: string): { lengthSentences: number; firstPersonHits: string[]; tooShort: boolean; tooLong: boolean } {
  const sentences = summary.split(/[.!?]+/).map(s => s.trim()).filter(Boolean);
  const firstPersonHits: string[] = [];
  let m: RegExpExecArray | null;
  FIRST_PERSON.lastIndex = 0;
  while ((m = FIRST_PERSON.exec(summary)) !== null) firstPersonHits.push(m[1]);
  return {
    lengthSentences: sentences.length,
    firstPersonHits,
    tooShort: sentences.length < 2,
    tooLong: sentences.length > 5,
  };
}

function evaluateSkills(skills: string[]): { count: number; duplicates: string[] } {
  const seen = new Map<string, number>();
  for (const s of skills) {
    const k = s.toLowerCase().trim();
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  const duplicates: string[] = [];
  for (const [k, c] of seen) if (c > 1) duplicates.push(`${k}×${c}`);
  return { count: skills.length, duplicates };
}

// Build the "evidenced skill universe" — anything the candidate could legitimately claim
// based on their input. Used to detect skill fabrication.
function buildEvidenceText(c: typeof baseCandidate): string {
  const parts: string[] = [...c.skills];
  for (const e of c.experience) parts.push(e.role, e.company, e.rawDescription);
  for (const p of c.projects) {
    parts.push(p.name, p.rawDescription, p.technologies ?? '');
  }
  for (const ed of c.education) parts.push(ed.school, ed.degree, ed.field);
  return parts.join(' ').toLowerCase();
}
const EVIDENCE_TEXT = buildEvidenceText(baseCandidate);

function evaluateSkillFabrication(skills: string[]): { fabricated: string[]; total: number } {
  const fabricated: string[] = [];
  for (const s of skills) {
    const lc = s.toLowerCase().trim();
    if (!EVIDENCE_TEXT.includes(lc)) fabricated.push(s);
  }
  return { fabricated, total: skills.length };
}

function evaluatePhraseCoverage(out: OptimizedResumeData, phrases: string[]): { matched: string[]; missed: string[] } {
  const text = fullText(out).toLowerCase();
  const matched: string[] = [];
  const missed: string[] = [];
  for (const p of phrases) {
    if (text.includes(p.toLowerCase())) matched.push(p);
    else missed.push(p);
  }
  return { matched, missed };
}

function evaluateSummaryQuantification(summary: string): { hasNumber: boolean; numbers: string[] } {
  const matches = summary.match(/\b\d[\d,.]*\s*(%|k|m|million|x|ms|s|years?|hrs?|hours?|engineers?|teams?|requests?|stars?|users?|MAU|customers?)?/gi) ?? [];
  return { hasNumber: matches.length > 0, numbers: matches };
}

function evaluateLeadBullet(firstBullet: string | undefined, anchors: string[]): { hit: boolean; matched: string[] } {
  if (!firstBullet) return { hit: false, matched: [] };
  const lc = firstBullet.toLowerCase();
  const matched = anchors.filter(a => lc.includes(a.toLowerCase()));
  return { hit: matched.length > 0, matched };
}

// ────────────────────────────────────────────────
// Runner
// ────────────────────────────────────────────────
async function main() {
  const env = loadEnv();
  // Accept either non-VITE_ (new server-side names, post the API-proxy
  // migration) or VITE_-prefixed (legacy). Local .env is the only place
  // these still live for tests; production reads them server-side via
  // process.env.{GROQ,GEMINI}_API_KEY in Vercel Functions.
  const groqKey = env.GROQ_API_KEY || env.VITE_GROQ_API_KEY;
  const geminiKey = env.GEMINI_API_KEY || env.VITE_GEMINI_API_KEY;
  // Optional model override for either provider (rarely needed; e.g. testing
  // gemini-2.5-flash-lite when 2.5-flash daily quota is exhausted).
  const modelOverride = process.env.MODEL;

  const providers: NamedOptimizer[] = [];
  if (!isPlaceholder(groqKey)) {
    providers.push({ name: 'groq', optimizer: new GroqResumeOptimizer(groqKey, modelOverride) });
  }
  if (!isPlaceholder(geminiKey)) {
    providers.push({ name: 'gemini', optimizer: new GeminiResumeOptimizer(geminiKey, modelOverride) });
  }
  if (!providers.length) {
    throw new Error('No AI provider key found in .env (VITE_GROQ_API_KEY or VITE_GEMINI_API_KEY)');
  }
  console.log(`Provider order: ${providers.map(p => p.name).join(' → ')}${modelOverride ? `   model=${modelOverride}` : ''}`);
  const optimizer: IResumeOptimizer = new MultiProviderResumeOptimizer(providers);

  const outDir = path.join(ROOT, 'tests', 'out');
  fs.mkdirSync(outDir, { recursive: true });

  const cachePath = (id: string) => path.join(outDir, `cache.${id}.json`);

  const results: { jd: JdSpec; out: OptimizedResumeData; ms: number }[] = [];

  for (const jd of JDS) {
    // Use cached result if present (lets the run complete after quota recovers).
    if (fs.existsSync(cachePath(jd.id))) {
      const cached = JSON.parse(fs.readFileSync(cachePath(jd.id), 'utf8'));
      console.log(`[${jd.id}] using cached output`);
      results.push({ jd, out: cached.out, ms: cached.ms });
      continue;
    }
    const data: ResumeData = {
      ...baseCandidate,
      targetJob: { title: jd.title, company: jd.company, description: jd.description },
    } as ResumeData;
    console.log(`\n[${jd.id}] calling Gemini for "${jd.title}"…`);
    const t0 = Date.now();
    try {
      const out = await optimizer.optimize(data);
      const ms = Date.now() - t0;
      console.log(`[${jd.id}] done in ${ms}ms`);
      fs.writeFileSync(cachePath(jd.id), JSON.stringify({ out, ms }, null, 2));
      results.push({ jd, out, ms });
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      console.warn(`[${jd.id}] FAILED — ${msg.slice(0, 120)}…`);
      // Skip and continue. The report will note the missing JD.
      continue;
    }
    await new Promise(r => setTimeout(r, 4000));
  }

  if (results.length === 0) {
    console.error('\nNo JDs succeeded. Report cannot be generated. Re-run after quota resets.');
    process.exit(1);
  }

  // ── per-JD evaluation
  type PerJd = {
    id: string;
    title: string;
    ms: number;
    coverage: CoverageReport;
    phrases: ReturnType<typeof evaluatePhraseCoverage>;
    preserved: { preserved: string[]; missing: string[] };
    summary: ReturnType<typeof evaluateSummary>;
    summaryQuant: ReturnType<typeof evaluateSummaryQuantification>;
    skillsAudit: ReturnType<typeof evaluateSkills>;
    skillsFab: ReturnType<typeof evaluateSkillFabrication>;
    leadBulletCurrentRole: ReturnType<typeof evaluateLeadBullet>;
    items: { id: string; kind: 'experience' | 'project'; report: ItemReport; bullets: string[] }[];
    out: OptimizedResumeData;
  };

  const perJd: PerJd[] = results.map(({ jd, out, ms }) => {
    const items: PerJd['items'] = [];
    for (const e of out.experience ?? []) {
      items.push({ id: e.id, kind: 'experience', report: evaluateItem(e.refinedBullets), bullets: e.refinedBullets });
    }
    for (const p of out.projects ?? []) {
      items.push({ id: p.id, kind: 'project', report: evaluateItem(p.refinedBullets), bullets: p.refinedBullets });
    }
    // Identify "current role" — the experience entry corresponding to baseCandidate.experience[0] (exp-1).
    const currentRoleId = baseCandidate.experience[0].id;
    const currentRole = (out.experience ?? []).find(e => e.id === currentRoleId);
    const firstBullet = currentRole?.refinedBullets?.[0];
    return {
      id: jd.id,
      title: jd.title,
      ms,
      coverage: evaluateCoverage(out, jd.expectedKeywords),
      phrases: evaluatePhraseCoverage(out, jd.expectedPhrases),
      preserved: evaluatePreservedMetrics(out),
      summary: evaluateSummary(out.summary ?? ''),
      summaryQuant: evaluateSummaryQuantification(out.summary ?? ''),
      skillsAudit: evaluateSkills(out.skills ?? []),
      skillsFab: evaluateSkillFabrication(out.skills ?? []),
      leadBulletCurrentRole: evaluateLeadBullet(firstBullet, jd.leadBulletAnchors),
      items,
      out,
    };
  });

  // ── pairwise differentiation (Jaccard over 5-word shingles of all bullets)
  const sims: { a: string; b: string; bullets: number; summary: number; skills: number }[] = [];
  for (let i = 0; i < perJd.length; i++) {
    for (let j = i + 1; j < perJd.length; j++) {
      const A = perJd[i], B = perJd[j];
      const bulletsSim = jaccard(bulletShingles(allBullets(A.out)), bulletShingles(allBullets(B.out)));
      const summarySim = jaccard(new Set(tokenize(A.out.summary ?? '')), new Set(tokenize(B.out.summary ?? '')));
      const skillsSim = jaccard(new Set((A.out.skills ?? []).map(s => s.toLowerCase())), new Set((B.out.skills ?? []).map(s => s.toLowerCase())));
      sims.push({ a: A.id, b: B.id, bullets: bulletsSim, summary: summarySim, skills: skillsSim });
    }
  }

  // ────────────────────────────────────────────────
  // Render report
  // ────────────────────────────────────────────────
  const lines: string[] = [];
  const push = (s = '') => lines.push(s);
  const hr = () => push('─'.repeat(78));

  push('═'.repeat(78));
  push('  RESUME OPTIMIZER EFFECTIVENESS REPORT');
  push('═'.repeat(78));

  for (const r of perJd) {
    push();
    hr();
    push(`▶ ${r.id.toUpperCase()} — ${r.title}   (${r.ms}ms)`);
    hr();
    push();
    push('  Summary:');
    push(`    "${r.out.summary}"`);
    push(`    sentences=${r.summary.lengthSentences}  firstPerson=${r.summary.firstPersonHits.length}  hasNumber=${r.summaryQuant.hasNumber}  numbers=[${r.summaryQuant.numbers.join(', ')}]`);
    push();
    push(`  Skills (${r.skillsAudit.count}, dup=${r.skillsAudit.duplicates.length}, fabricated=${r.skillsFab.fabricated.length}):`);
    push(`    ${(r.out.skills ?? []).join(' · ')}`);
    if (r.skillsFab.fabricated.length) push(`    ⚠ FABRICATED (not in candidate input/experience/projects): ${r.skillsFab.fabricated.join(', ')}`);
    push();
    push(`  JD keyword coverage: ${r.coverage.matched.length}/${r.coverage.expected.length} = ${(r.coverage.ratio * 100).toFixed(1)}%`);
    if (r.coverage.missed.length) push(`    MISSED keywords:  ${r.coverage.missed.join(', ')}`);
    push(`  JD phrase verbatim:  ${r.phrases.matched.length}/${r.phrases.matched.length + r.phrases.missed.length} multi-word phrases lifted`);
    if (r.phrases.missed.length) push(`    MISSED phrases:   ${r.phrases.missed.join(' | ')}`);
    push();
    push(`  Preserved metrics: ${r.preserved.preserved.length}/${PRESERVED_METRICS.length}`);
    if (r.preserved.missing.length) push(`    missing (some metrics are role-specific — only flag if material): ${r.preserved.missing.join(' | ')}`);
    push();
    push(`  Lead bullet of current role hit JD anchor? ${r.leadBulletCurrentRole.hit ? `✓ matched [${r.leadBulletCurrentRole.matched.join(', ')}]` : '✗ MISS — first bullet does not surface a JD-relevant anchor'}`);
    push();
    push('  Per-item ATS audit:');
    for (const it of r.items) {
      const issues: string[] = [];
      if (it.report.empty) issues.push('EMPTY');
      if (it.report.weakVerbStarts.length) issues.push(`${it.report.weakVerbStarts.length} WEAK verb starts`);
      if (it.report.unknownVerbStarts.length) issues.push(`${it.report.unknownVerbStarts.length} unknown verb starts (review)`);
      if (it.report.bannedHits.length) issues.push(`${it.report.bannedHits.length} banned phrases`);
      if (it.report.firstPersonHits.length) issues.push(`${it.report.firstPersonHits.length} 1st-person`);
      if (it.report.tooShort.length) issues.push(`${it.report.tooShort.length} too short`);
      if (it.report.tooLong.length) issues.push(`${it.report.tooLong.length} too long`);
      if (it.report.duplicateStartVerbs.length) issues.push(`dup verbs: ${it.report.duplicateStartVerbs.join(',')}`);
      push(`    [${it.kind}/${it.id}] bullets=${it.report.bulletCount}  ${issues.length ? '⚠ ' + issues.join('; ') : '✓ clean'}`);
      for (const w of it.report.weakVerbStarts) push(`        WEAK "${w.verb}" → "${w.bullet.slice(0, 90)}…"`);
      for (const u of it.report.unknownVerbStarts) push(`        unknown verb "${u.verb}" → "${u.bullet.slice(0, 90)}…"`);
      for (const h of it.report.bannedHits) push(`        banned "${h.phrase}" → "${h.bullet.slice(0, 90)}…"`);
    }
  }

  push();
  hr();
  push('▶ CROSS-JD DIFFERENTIATION (lower = more tailored, higher = more generic/recycled)');
  hr();
  for (const s of sims) {
    push(`  ${s.a} ↔ ${s.b}   bullets: ${(s.bullets * 100).toFixed(1)}%   summary: ${(s.summary * 100).toFixed(1)}%   skills: ${(s.skills * 100).toFixed(1)}%`);
  }

  push();
  hr();
  push('▶ AGGREGATE');
  hr();
  const totalKw = perJd.reduce((acc, r) => acc + r.coverage.expected.length, 0);
  const matchedKw = perJd.reduce((acc, r) => acc + r.coverage.matched.length, 0);
  const totalPhrases = perJd.reduce((acc, r) => acc + r.phrases.matched.length + r.phrases.missed.length, 0);
  const matchedPhrases = perJd.reduce((acc, r) => acc + r.phrases.matched.length, 0);
  const totalBullets = perJd.reduce((acc, r) => acc + r.items.reduce((a, i) => a + i.report.bulletCount, 0), 0);
  const totalWeakVerbs = perJd.reduce((acc, r) => acc + r.items.reduce((a, i) => a + i.report.weakVerbStarts.length, 0), 0);
  const totalUnknownVerbs = perJd.reduce((acc, r) => acc + r.items.reduce((a, i) => a + i.report.unknownVerbStarts.length, 0), 0);
  const totalBanned = perJd.reduce((acc, r) => acc + r.items.reduce((a, i) => a + i.report.bannedHits.length, 0), 0);
  const totalFirstPerson = perJd.reduce((acc, r) => acc + r.items.reduce((a, i) => a + i.report.firstPersonHits.length, 0), 0);
  const totalTooShort = perJd.reduce((acc, r) => acc + r.items.reduce((a, i) => a + i.report.tooShort.length, 0), 0);
  const totalTooLong = perJd.reduce((acc, r) => acc + r.items.reduce((a, i) => a + i.report.tooLong.length, 0), 0);
  const totalDupVerbs = perJd.reduce((acc, r) => acc + r.items.reduce((a, i) => a + i.report.duplicateStartVerbs.length, 0), 0);
  const totalFabricated = perJd.reduce((acc, r) => acc + r.skillsFab.fabricated.length, 0);
  const summariesWithNumber = perJd.filter(r => r.summaryQuant.hasNumber).length;
  const leadBulletHits = perJd.filter(r => r.leadBulletCurrentRole.hit).length;
  push(`  Keyword coverage:           ${matchedKw}/${totalKw} = ${((matchedKw / totalKw) * 100).toFixed(1)}%`);
  push(`  JD multi-word phrase lift:  ${matchedPhrases}/${totalPhrases} = ${((matchedPhrases / totalPhrases) * 100).toFixed(1)}%`);
  push(`  Summaries with a number:    ${summariesWithNumber}/${perJd.length}`);
  push(`  Current-role lead bullets hitting JD anchor: ${leadBulletHits}/${perJd.length}`);
  push(`  Fabricated skills (total):  ${totalFabricated}`);
  push(`  Total bullets:              ${totalBullets}`);
  push(`  Weak-verb bullet starts:    ${totalWeakVerbs}`);
  push(`  Unknown-verb starts:        ${totalUnknownVerbs}  (review — may need to extend evaluator's verb list)`);
  push(`  Banned phrase hits:         ${totalBanned}`);
  push(`  First-person hits:          ${totalFirstPerson}`);
  push(`  Too short (<6 words):       ${totalTooShort}`);
  push(`  Too long (>35 words):       ${totalTooLong}`);
  push(`  Duplicate-verb items:       ${totalDupVerbs}`);
  push();

  const report = lines.join('\n');
  console.log('\n' + report);

  fs.writeFileSync(path.join(outDir, 'report.txt'), report);
  fs.writeFileSync(path.join(outDir, 'raw.json'), JSON.stringify(perJd.map(r => ({ id: r.id, out: r.out })), null, 2));
  console.log(`\nReport written to tests/out/report.txt`);
  console.log(`Raw outputs written to tests/out/raw.json`);
}

main().catch(err => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
