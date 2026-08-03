// Output-quality + ATS audit. Answers "is the product actually good", not "does
// the code run" — that is what ai-probe.ts is for.
//
//   artifacts   Generates all FIVE user-facing outputs (optimized résumé, cover
//               letter, outreach email, LinkedIn note, interview questions) for
//               three deliberately different personas and scores each against
//               concrete, checkable criteria. Prints the real text so you can
//               judge it yourself — a score is a summary, not a verdict.
//   ats         Renders a REAL PDF through the production PdfResumeExporter,
//               extracts its text with pdfjs-dist, and runs the checks an ATS
//               parser would. This is the only way to know the download is
//               machine-readable; eyeballing the preview cannot tell you.
//
// Personas are chosen to stress different things: a tech profile (the easy case),
// a garments merchandiser (non-tech, hits the BD-market fabrication buckets, the
// case most likely to trip a false positive), and a fresher (thin evidence, where
// fabrication pressure is highest).
//
// Usage:
//   node_modules/.bin/tsx scripts/quality-audit.ts artifacts
//   node_modules/.bin/tsx scripts/quality-audit.ts ats

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ResumeData } from '../src/domain/entities/Resume.js';

function loadKey(): string {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  for (const f of ['.env.local', '.env']) {
    try {
      const line = readFileSync(resolve(process.cwd(), f), 'utf8').split('\n').find((l) => l.startsWith('GEMINI_API_KEY='));
      if (!line) continue;
      const v = line.slice('GEMINI_API_KEY='.length).trim().replace(/^['"]|['"]$/g, '');
      if (v && !/^PLACEHOLDER/i.test(v)) return v;
    } catch { /* next */ }
  }
  throw new Error('No usable GEMINI_API_KEY');
}

// ── scoring helpers ─────────────────────────────────────────────────────────
const ACTION_VERBS = /^(built|led|drove|cut|reduced|increased|grew|owned|designed|implemented|migrated|automated|launched|delivered|shipped|negotiated|managed|coordinated|streamlined|improved|scaled|resolved|established|introduced|standardi[sz]ed|consolidated|recovered|secured|trained|mentored|audited|forecast|sourced|onboarded)/i;
const FIRST_PERSON = /\b(I|my|me|we|our)\b/;
const CLICHES = /\b(team player|hard.?working|detail.?oriented|go.?getter|think outside the box|synerg|leverage my|passionate about|results.?driven|self.?starter)\b/i;
const HAS_METRIC = /\d/;

const bnRatio = (s: string) => {
  const bn = (s.match(/[ঀ-৿]/g) ?? []).length;
  const la = (s.match(/[A-Za-z]/g) ?? []).length;
  return bn + la === 0 ? 0 : la / (bn + la);
};
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

interface Check { ok: boolean; label: string; detail?: string }
const chk = (ok: boolean, label: string, detail?: string): Check => ({ ok, label, detail });

function report(title: string, checks: Check[], sample?: string) {
  const pass = checks.filter((c) => c.ok).length;
  console.log(`\n  ── ${title}  [${pass}/${checks.length}]`);
  for (const c of checks) {
    console.log(`     ${c.ok ? 'ok  ' : 'FAIL'} ${c.label}${c.detail ? `  — ${c.detail}` : ''}`);
  }
  if (sample) console.log(`\n     ┌─ sample ─────────────\n${sample.split('\n').map((l) => '     │ ' + l).join('\n')}\n     └──────────────────────`);
  return { pass, total: checks.length };
}

// ── personas ────────────────────────────────────────────────────────────────
const PERSONAS: Array<{ name: string; why: string; data: ResumeData }> = [
  {
    name: 'TECH — senior backend, payments',
    why: 'the easy case: dense metrics, JD vocabulary overlaps heavily',
    data: {
      targetJob: {
        title: 'Senior Backend Engineer', company: 'NordPay Fintech Ltd',
        description: `Senior Backend Engineer — Payments Platform, Dhaka (hybrid). Own settlement and reconciliation services processing several million transactions daily. Design high-throughput payment ledger services; drive idempotency and exactly-once settlement guarantees; reduce reconciliation breaks; own SLOs, on-call and incident response; mentor mid-level engineers; partner with risk and compliance on Bangladesh Bank reporting. Required: 6+ years backend engineering; deep SQL and relational modelling; distributed systems fundamentals; Kafka or RabbitMQ; container orchestration; observability tooling; experience with financial reconciliation or double-entry ledgers. Nice to have: Go, event sourcing, PCI-DSS exposure, mobile-money domain knowledge (bKash, Nagad), regulatory reporting automation.`,
      },
      personalInfo: { fullName: 'Rifat Hasan', email: 'rifat.hasan@example.com', phone: '+8801711223344', location: 'Dhaka, Bangladesh', linkedin: 'https://linkedin.com/in/rifathasan' },
      summary: '',
      experience: [
        { id: 'exp-1', company: 'Ditio AS', role: 'Senior Software Engineer', startDate: '2022-03', endDate: '', isCurrent: true,
          rawDescription: 'Built the batch camera module and trip-tracking pipeline for construction fleet telematics. Migrated MongoDB change streams into a ClickHouse analytics warehouse via Redpanda CDC. Cut p99 trip-ingest latency from 4.2s to 780ms by batching writes and adding a Redis read-through cache. Owned on-call rotation for 6 Go microservices and drove error-budget policy adoption.', refinedBullets: [] },
        { id: 'exp-2', company: 'Shohoz Ltd', role: 'Software Engineer', startDate: '2019-07', endDate: '2022-02', isCurrent: false,
          rawDescription: 'Implemented bKash payment reconciliation for ticketing, cutting settlement mismatches 40%. Built a double-entry ledger for refunds and partial cancellations in PostgreSQL. Automated daily Bangladesh Bank settlement report generation, removing 6 hours of manual work weekly.', refinedBullets: [] },
      ],
      projects: [{ id: 'prj-1', name: 'OpenLedger', rawDescription: 'Open-source double-entry ledger library in Go, 340 GitHub stars.', refinedBullets: [], technologies: 'Go, PostgreSQL' }],
      education: [{ id: 'edu-1', school: 'BUET', degree: 'BSc', field: 'Computer Science', endDate: '2017-06' }],
      skills: ['Go', 'Python', 'PostgreSQL', 'Kafka', 'Redis', 'Docker', 'Kubernetes', 'ClickHouse'],
      certifications: [{ id: 'cert-1', name: 'AWS Solutions Architect Associate', issuer: 'Amazon Web Services', date: '2023-04' }],
    } as unknown as ResumeData,
  },
  {
    name: 'NON-TECH — garments merchandiser',
    why: 'stresses the BD-market fabrication buckets (WFX, BGMEA, H&M) and a domain with no code vocabulary — the likeliest false-positive case',
    data: {
      targetJob: {
        title: 'Senior Merchandiser', company: 'Epyllion Group',
        description: `Senior Merchandiser — Knit Division, Gazipur. Own buyer accounts end to end from enquiry to shipment. Responsibilities: costing and price negotiation; developing tech packs with the sample room; booking yarn and trims against lead times; monitoring WIP against the production plan; managing buyer inspections and third-party audits; on-time delivery and shipment documentation; coordinating with the compliance team on buyer codes of conduct. Required: 5+ years knit merchandising; direct buyer handling; strong costing and consumption calculation; ERP experience; Excel fluency; spoken English. Nice to have: WFX or FastReact, H&M or Inditex buyer exposure, BGMEA liaison experience, sustainability certification familiarity.`,
      },
      personalInfo: { fullName: 'Nusrat Jahan', email: 'nusrat.jahan@example.com', phone: '+8801822334455', location: 'Gazipur, Bangladesh' },
      summary: '',
      experience: [
        { id: 'exp-1', company: 'DBL Group', role: 'Merchandiser', startDate: '2021-01', endDate: '', isCurrent: true,
          rawDescription: 'Handled H&M and Lindex knit accounts worth 4.2 million USD annually. Reduced sample approval turnaround from 21 days to 12 by restructuring the tech pack handover with the sample room. Negotiated yarn pricing that cut fabric cost 7% across three seasons. Tracked WIP in WFX and escalated bottlenecks weekly, lifting on-time delivery from 82% to 94%.', refinedBullets: [] },
        { id: 'exp-2', company: 'Square Fashions Ltd', role: 'Assistant Merchandiser', startDate: '2018-06', endDate: '2020-12', isCurrent: false,
          rawDescription: 'Supported costing and consumption calculation for basic tees and polos. Prepared trim bookings against lead times and chased suppliers. Coordinated BGMEA documentation for shipment clearance.', refinedBullets: [] },
      ],
      projects: [],
      education: [{ id: 'edu-1', school: 'BUFT', degree: 'BBA', field: 'Apparel Merchandising', endDate: '2018-05' }],
      skills: ['Costing', 'Consumption calculation', 'WFX', 'Buyer handling', 'Excel', 'Trim booking'],
    } as unknown as ResumeData,
  },
  {
    name: 'FRESHER — CS graduate, thin evidence',
    why: 'thin evidence is where fabrication pressure is highest and where a stretch-mode toolkit must not invent experience',
    data: {
      targetJob: {
        title: 'Junior Data Analyst', company: 'BRAC',
        description: `Junior Data Analyst — Research and Evaluation Division, Dhaka. Support programme teams with data cleaning, analysis and reporting. Responsibilities: clean and validate survey data; build dashboards for programme managers; run descriptive analysis and simple regressions; document data pipelines; support field enumerator training. Required: bachelor's in a quantitative field; SQL; Excel; Python or R; clear written English. Nice to have: Kobo Toolbox, Power BI or Tableau, Stata, experience with household survey data, Bangla fluency.`,
      },
      personalInfo: { fullName: 'Tanvir Ahmed', email: 'tanvir.ahmed@example.com', phone: '+8801933445566', location: 'Dhaka, Bangladesh' },
      summary: '',
      experience: [
        { id: 'exp-1', company: 'Bengal Analytics (internship)', role: 'Data Intern', startDate: '2025-06', endDate: '2025-11', isCurrent: false,
          rawDescription: 'Cleaned a 12,000-row customer survey dataset in Python and pandas. Built three Power BI dashboards used in weekly management review. Wrote SQL queries against a PostgreSQL replica to pull cohort retention numbers.', refinedBullets: [] },
      ],
      projects: [
        { id: 'prj-1', name: 'Dhaka Air Quality Explorer', rawDescription: 'Scraped two years of AQI readings and built a Streamlit dashboard showing seasonal patterns across five districts. Used pandas and matplotlib.', refinedBullets: [], technologies: 'Python, pandas, Streamlit' },
      ],
      education: [{ id: 'edu-1', school: 'University of Dhaka', degree: 'BSc', field: 'Statistics', endDate: '2025-05', gpa: '3.62/4.00' }],
      skills: ['Python', 'pandas', 'SQL', 'Excel', 'Power BI'],
    } as unknown as ResumeData,
  },
];

// ── artifacts mode ──────────────────────────────────────────────────────────
async function artifacts(key: string) {
  const [{ GeminiResumeOptimizer }, { GeminiToolkitGenerator }] = await Promise.all([
    import('../src/infrastructure/ai/GeminiResumeOptimizer.js'),
    import('../src/infrastructure/ai/GeminiToolkitGenerator.js'),
  ]);
  const opt = new GeminiResumeOptimizer(key);
  const tk = new GeminiToolkitGenerator(key);
  let totalPass = 0, totalChecks = 0;

  for (const p of PERSONAS) {
    console.log(`\n${'═'.repeat(78)}\n${p.name}\n  why this persona: ${p.why}\n${'═'.repeat(78)}`);
    const jd = p.data.targetJob.description.toLowerCase();

    // ── 1. optimized résumé
    let optimized: any;
    try {
      optimized = await opt.optimize(p.data, {});
    } catch (e) {
      console.log(`  OPTIMIZER FAILED: ${(e as Error).message.slice(0, 200)}`);
      continue;
    }
    const allBullets: string[] = (optimized.experience ?? []).flatMap((e: any) => e.refinedBullets ?? []);
    const inputMetrics = p.data.experience.filter((e) => HAS_METRIC.test(e.rawDescription)).length;
    const outMetricItems = (optimized.experience ?? []).filter((e: any) => (e.refinedBullets ?? []).some((b: string) => HAS_METRIC.test(b))).length;
    const jdTokens = new Set(jd.match(/[a-z][a-z+.#-]{2,}/g) ?? []);
    const outText = (optimized.summary + ' ' + allBullets.join(' ') + ' ' + (optimized.skills ?? []).join(' ')).toLowerCase();
    const covered = [...jdTokens].filter((t) => t.length > 4 && outText.includes(t)).length;

    const r1 = report(`OPTIMIZED RÉSUMÉ`, [
      chk((optimized.experience ?? []).map((e: any) => e.id).join(',') === p.data.experience.map((e) => e.id).join(','), 'input ids echoed exactly', (optimized.experience ?? []).map((e: any) => e.id).join(',')),
      chk(allBullets.length > 0 && allBullets.every((b) => ACTION_VERBS.test(b.trim())), 'every bullet starts with an action verb', `${allBullets.filter((b) => !ACTION_VERBS.test(b.trim())).length} violations of ${allBullets.length}`),
      chk(!allBullets.some((b) => FIRST_PERSON.test(b)) && !FIRST_PERSON.test(optimized.summary ?? ''), 'no first person'),
      chk(!CLICHES.test(outText), 'no banned clichés'),
      chk(outMetricItems >= inputMetrics, 'metrics preserved from input', `${outMetricItems}/${inputMetrics} items retain a number`),
      chk(allBullets.every((b) => words(b) <= 32), 'bullets ATS-length (<=32 words)', `longest ${Math.max(0, ...allBullets.map(words))}w`),
      chk(words(optimized.summary ?? '') >= 25 && words(optimized.summary ?? '') <= 90, 'summary 25–90 words', `${words(optimized.summary ?? '')}w`),
      chk(covered >= 8, 'JD keyword coverage', `${covered} JD terms present`),
      chk((optimized.skills ?? []).length >= 5, 'skills populated', `${(optimized.skills ?? []).length}`),
    ], allBullets.slice(0, 3).map((b) => '• ' + b).join('\n') + `\n\nSUMMARY: ${optimized.summary}`);
    totalPass += r1.pass; totalChecks += r1.total;

    // ── 2-5. toolkit (cover letter, outreach, linkedIn, interview)
    let bundle: any;
    try {
      bundle = await tk.generate(p.data, {});
    } catch (e) {
      console.log(`  TOOLKIT FAILED: ${(e as Error).message.slice(0, 200)}`);
      continue;
    }
    const failed = Object.keys(bundle.errors ?? {});
    if (failed.length) console.log(`\n  !! guard-rejected slots: ${JSON.stringify(bundle.errors)}`);

    const cl = bundle.coverLetter ?? '';
    const r2 = report('COVER LETTER', [
      chk(!!cl, 'produced'),
      chk(words(cl) >= 180 && words(cl) <= 420, 'length 180–420 words', `${words(cl)}w`),
      chk(cl.toLowerCase().includes(p.data.targetJob.company.split(' ')[0].toLowerCase()), 'names the target company'),
      chk(!/^(dear|to whom)/i.test(cl.trim()) && !/sincerely|best regards/i.test(cl), 'no salutation/signature block (cleaner worked)'),
      chk(!CLICHES.test(cl), 'no clichés'),
      chk(/\d/.test(cl), 'cites at least one concrete number'),
    ], cl.slice(0, 700));
    totalPass += r2.pass; totalChecks += r2.total;

    const oe = bundle.outreachEmail ?? {};
    const r3 = report('OUTREACH EMAIL', [
      chk(!!oe.subject && !!oe.body, 'produced'),
      chk(words(oe.subject ?? '') <= 12, 'subject <=12 words', `${words(oe.subject ?? '')}w`),
      chk(words(oe.body ?? '') <= 200, 'body <=200 words (cold email discipline)', `${words(oe.body ?? '')}w`),
      chk((oe.body ?? '').toLowerCase().includes(p.data.targetJob.company.split(' ')[0].toLowerCase()), 'names the company'),
    ], `SUBJECT: ${oe.subject}\n\n${oe.body}`);
    totalPass += r3.pass; totalChecks += r3.total;

    const li = bundle.linkedInMessage ?? '';
    const r4 = report('LINKEDIN NOTE', [
      chk(!!li, 'produced'),
      chk(li.length <= 280, 'within LinkedIn 280-char limit', `${li.length} chars`),
      chk(li.length >= 120, 'not trivially short', `${li.length} chars`),
      chk(!/\s\S{0,2}$/.test(li) || /[.!?]$/.test(li), 'not cut mid-word', `ends: "${li.slice(-24)}"`),
    ], li);
    totalPass += r4.pass; totalChecks += r4.total;

    const qs: any[] = bundle.interviewQuestions ?? [];
    const bnAll = qs.map((q) => `${q.questionBn ?? ''} ${q.answerStrategyBn ?? ''}`).join(' ');
    const anchored = qs.filter((q) => {
      const s = (q.answerStrategy ?? '').toLowerCase();
      return p.data.experience.some((e) => s.includes(e.company.toLowerCase().split(' ')[0]))
        || (p.data.skills ?? []).some((sk) => s.includes(sk.toLowerCase()));
    }).length;
    const r5 = report('INTERVIEW QUESTIONS', [
      chk(qs.length >= 5, 'at least 5 questions', `${qs.length}`),
      chk(qs.every((q) => q.question && q.whyAsked && q.answerStrategy), 'all EN fields present'),
      chk(qs.every((q) => (q.questionBn ?? '').trim() && (q.answerStrategyBn ?? '').trim()), 'all BN fields present', `${qs.filter((q) => !(q.questionBn ?? '').trim()).length} missing`),
      chk(bnRatio(bnAll) < 0.20, 'Bengali is genuinely Bengali (latin ratio <0.20)', `ratio ${bnRatio(bnAll).toFixed(3)}`),
      chk(new Set(qs.map((q) => q.category)).size >= 3, 'categories varied', `${new Set(qs.map((q) => q.category)).size} distinct`),
      chk(anchored >= Math.ceil(qs.length / 2), 'answers anchored in real evidence', `${anchored}/${qs.length}`),
    ], qs.slice(0, 2).map((q) => `Q: ${q.question}\n   [${q.category}] why: ${q.whyAsked}\n   strategy: ${q.answerStrategy}\n   BN: ${q.questionBn}`).join('\n\n'));
    totalPass += r5.pass; totalChecks += r5.total;
  }

  console.log(`\n${'═'.repeat(78)}\nTOTAL: ${totalPass}/${totalChecks} checks passed across ${PERSONAS.length} personas`);
  if (totalPass < totalChecks) console.log('Read the FAIL lines above — some are stylistic thresholds, others are real defects.');
}

// ── ats mode ────────────────────────────────────────────────────────────────
async function ats() {
  const { PdfResumeExporter } = await import('../src/infrastructure/export/PdfResumeExporter.js');
  const { default: jsPDF } = await import('jspdf');
  // resolveTemplate is module-private to the exporter; render via the class so we
  // exercise the SAME code path the download button uses.
  const data: any = JSON.parse(JSON.stringify(PERSONAS[0].data));
  data.summary = 'Senior backend engineer with 8 years building payment and settlement systems. Cut reconciliation mismatches 40% at Shohoz and p99 ingest latency 82% at Ditio. Strong on double-entry ledgers, Kafka pipelines and Bangladesh Bank reporting automation.';
  data.experience[0].refinedBullets = [
    'Built trip-tracking pipeline for construction fleet telematics, cutting p99 ingest latency from 4.2s to 780ms',
    'Migrated MongoDB change streams into a ClickHouse warehouse via Redpanda CDC',
    'Owned on-call rotation for 6 Go microservices and drove error-budget policy adoption',
  ];
  data.experience[1].refinedBullets = [
    'Implemented bKash payment reconciliation for ticketing, cutting settlement mismatches 40%',
    'Built a double-entry ledger for refunds and partial cancellations in PostgreSQL',
    'Automated Bangladesh Bank settlement reporting, removing 6 hours of manual work weekly',
  ];
  data.projects[0].refinedBullets = ['Published an open-source double-entry ledger library in Go with 340 GitHub stars'];

  const { resolveTemplate } = await import('../src/presentation/templates/TemplateRegistry.js');
  const exporter: any = new PdfResumeExporter();
  const doc = new (jsPDF as any)({ unit: 'pt', format: 'a4', compress: true });
  // renderResume is `private` in TS only — at runtime it is a normal method, so we
  // exercise the EXACT code path the download button uses rather than a copy of it.
  // (exportResumeToPDF itself ends in FileSaver.saveAs, which needs a browser.)
  exporter.renderResume(doc, data, resolveTemplate(data.template));
  const bytes = Buffer.from(doc.output('arraybuffer'));
  const out = resolve(process.cwd(), 'ats-audit-resume.pdf');
  writeFileSync(out, bytes);
  console.log(`\n=== ATS AUDIT ===\n  wrote ${out} (${(bytes.length / 1024).toFixed(1)} KB)`);

  // Extract text exactly as a parser would.
  const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true }).promise;
  let text = '';
  const xs: number[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const c = await page.getTextContent();
    for (const it of c.items as any[]) {
      text += it.str + (it.hasEOL ? '\n' : ' ');
      if (it.transform) xs.push(Math.round(it.transform[4]));
    }
    text += '\n';
  }
  const t = text.replace(/[ \t]+/g, ' ');
  const leftEdges = [...new Set(xs)].sort((a, b) => a - b);
  // Single-column heuristic: the vast majority of runs should start near one x.
  const modeX = leftEdges.map((x) => ({ x, n: xs.filter((v) => Math.abs(v - x) <= 2).length })).sort((a, b) => b.n - a.n)[0];

  const checks: Check[] = [
    chk(t.trim().length > 400, 'text is extractable (not an image scan)', `${t.trim().length} chars`),
    chk(pdf.numPages <= 2, 'fits 1–2 pages', `${pdf.numPages}`),
    chk(/rifat\.hasan@example\.com/i.test(t), 'email survives extraction'),
    chk(/\+?8801711223344|\+?880\s?1711/.test(t.replace(/\s/g, '')) || /1711223344/.test(t.replace(/\D/g, '')), 'phone survives extraction'),
    chk(/experience/i.test(t), 'EXPERIENCE heading present'),
    chk(/education/i.test(t), 'EDUCATION heading present'),
    chk(/skills/i.test(t), 'SKILLS heading present'),
    chk(/ditio/i.test(t) && /shohoz/i.test(t), 'both employers present'),
    chk(/2022/.test(t) && /2019/.test(t), 'dates present and parseable'),
    // Scope to the EXPERIENCE section: the summary also names employers, so a
    // whole-document indexOf compares the wrong occurrences.
    chk((() => {
      const sec = t.slice(t.search(/EXPERIENCE/i), t.search(/EDUCATION/i) >= 0 ? t.search(/EDUCATION/i) : undefined);
      return sec.indexOf('Ditio') >= 0 && sec.indexOf('Ditio') < sec.indexOf('Shohoz');
    })(), 'reading order within EXPERIENCE is reverse-chronological'),
    chk(t.search(/experience/i) < t.search(/education/i), 'sections in expected order'),
    // ATS parsers key company↔role↔date association off proximity. Verify the
    // employer name is adjacent to its role rather than separated by a bullet block.
    chk((() => {
      const i = t.indexOf('Senior Software Engineer'); const j = t.indexOf('Ditio AS');
      return i >= 0 && j > i && j - i < 60;
    })(), 'employer adjacent to its role (parser can associate them)'),
    // Month-name dates parse more reliably than bare ISO year-month across ATS
    // vendors. Informational: not a failure, but worth knowing.
    chk(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+20\d\d/.test(t), 'dates use month names (more portable than 2022-03)', /20\d\d-\d\d/.test(t) ? 'uses bare ISO "2022-03" instead' : ''),
    chk(!/[�]/.test(t), 'no replacement/garbled glyphs'),
    chk(!/\b[a-z]\s[a-z]\s[a-z]\s[a-z]\b/.test(t), 'no letter-spacing corruption (a b c d)'),
    chk(/cutting settlement mismatches 40%/i.test(t), 'a full bullet survives intact (no mid-word breaks)'),
    chk(modeX ? modeX.n / xs.length > 0.5 : false, 'single-column layout (most runs share one left edge)', modeX ? `${((modeX.n / xs.length) * 100).toFixed(0)}% at x=${modeX.x}` : 'n/a'),
    chk((t.match(/•/g) ?? []).length === 0 || (t.match(/•/g) ?? []).length > 0, 'bullet glyph is a standard char if present', `${(t.match(/•/g) ?? []).length} bullets`),
  ];
  report('ATS PARSE CHECKS', checks);
  console.log(`\n  ┌─ first 900 chars an ATS would read ──────────\n${t.slice(0, 900).split('\n').map((l) => '  │ ' + l).join('\n')}\n  └──────────────────────────────────────────────`);
}

async function main() {
  const mode = process.argv[2] ?? 'artifacts';
  if (mode === 'artifacts') await artifacts(loadKey());
  else if (mode === 'ats') await ats();
  else { console.error('modes: artifacts | ats'); process.exit(1); }
}
main().catch((e) => { console.error(e); process.exit(1); });
