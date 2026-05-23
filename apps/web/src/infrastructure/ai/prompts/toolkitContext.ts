// Shared candidate-context builder + post-generation guards used by every
// toolkit generator (combined GeminiToolkitGenerator + the four
// single-artifact generators that handle per-item retries).
//
// Why centralize:
// 1. Authenticity — every generator now sees the FULL candidate profile
//    (certifications, awards, languages, education, extracurriculars,
//    publications) instead of just experience + projects + skills. Toolkit
//    output should anchor in real candidate evidence, not generic JD-shaped
//    filler.
// 2. Reframing — candidate evidence is presented FIRST as the source of
//    truth; the JD is presented SECOND as a filter and ordering signal.
//    This priming alone meaningfully reduces "JD-shaped generic" outputs.
// 3. Voice signature — a short excerpt of the candidate's own raw bullet
//    text is passed as TONE-ONLY reference (explicitly NOT a fact source)
//    so generated copy sounds more like the candidate and less like a
//    flattened Gemini voice.
// 4. Deterministic guards — three post-generation checks that throw when
//    triggered. The combined GeminiToolkitGenerator catches per-artifact and
//    records the message in errors[<item>] so one weak slot doesn't drag
//    the whole toolkit down; the single-artifact generators still let the
//    throw propagate so /api/toolkit-item returns a clean failure.
//      • assertNoFabricatedTools — high-signal tech tokens that appear in
//        output must also exist in the candidate's evidence corpus.
//      • assertOutreachSpecificity — outreach + LinkedIn output must
//        reference both the target company and the candidate's own work
//        (proper noun) — not just generic JD language.
//      • assertInterviewAnchor — interview answerStrategy text must point
//        to a real candidate proper noun (company / role / project /
//        certification / school) instead of vague "your relevant experience".

import { ResumeData } from '../../../domain/entities/Resume.js';

// ────────────────────────────────────────────────────────────────────
// 🧱 CANDIDATE CONTEXT
// ────────────────────────────────────────────────────────────────────
//
// One block, every section the candidate filled out, in a stable order. The
// generator prompts paste this verbatim under a "═ CANDIDATE EVIDENCE ═"
// header and reference it in their rule lists ("draw only from the
// candidate evidence above").
//
// Voice excerpt — first ~250 chars of each rawDescription, marked
// "(raw, for tone reference only)". Lets the model mimic the candidate's
// natural framing without lifting facts. Purely additive to the polished
// refinedBullets.

export interface CandidateContextOptions {
  /** Include the voice-reference excerpt block. Default true. */
  includeVoiceSignature?: boolean;
  /** Hard-cap each rawDescription excerpt at this many characters. */
  voiceExcerptChars?: number;
}

export function buildCandidateContext(
  data: ResumeData,
  opts: CandidateContextOptions = {}
): string {
  const includeVoice = opts.includeVoiceSignature !== false;
  const voiceCap = opts.voiceExcerptChars ?? 250;

  const lines: string[] = [];
  lines.push(`Name: ${data.personalInfo.fullName || '(not provided)'}`);
  lines.push(`Type: ${data.userType === 'student' ? 'Student / Entry-level' : 'Experienced Professional'}`);
  if (data.summary) lines.push(`Summary: ${data.summary}`);

  if (data.experience.length > 0) {
    lines.push('');
    lines.push('Work experience:');
    for (const e of data.experience) {
      const bullets = (e.refinedBullets && e.refinedBullets.length > 0)
        ? e.refinedBullets
        : e.rawDescription
          ? [e.rawDescription]
          : [];
      const tenure = e.startDate
        ? ` (${e.startDate} – ${e.isCurrent ? 'Present' : (e.endDate || 'present')})`
        : '';
      lines.push(`- ${e.role || 'Role'} at ${e.company || 'Company'}${tenure}`);
      for (const b of bullets) lines.push(`    • ${b}`);
    }
  }

  if (data.projects.length > 0) {
    lines.push('');
    lines.push('Projects:');
    for (const p of data.projects) {
      const bullets = (p.refinedBullets && p.refinedBullets.length > 0)
        ? p.refinedBullets
        : p.rawDescription
          ? [p.rawDescription]
          : [];
      const tech = p.technologies ? ` (${p.technologies})` : '';
      lines.push(`- ${p.name}${tech}`);
      for (const b of bullets) lines.push(`    • ${b}`);
    }
  }

  if (data.education.length > 0) {
    lines.push('');
    lines.push('Education:');
    for (const ed of data.education) {
      const field = ed.field ? ` in ${ed.field}` : '';
      const gpa = ed.gpa ? ` (GPA: ${ed.gpa})` : '';
      lines.push(`- ${ed.degree}${field} from ${ed.school}${gpa}`);
    }
  }

  if (data.certifications && data.certifications.length > 0) {
    lines.push('');
    lines.push('Certifications:');
    for (const c of data.certifications) {
      const issuer = c.issuer ? ` — ${c.issuer}` : '';
      const date = c.date ? ` (${c.date})` : '';
      lines.push(`- ${c.name}${issuer}${date}`);
    }
  }

  if (data.awards && data.awards.length > 0) {
    lines.push('');
    lines.push('Awards:');
    for (const a of data.awards) {
      const issuer = a.issuer ? ` — ${a.issuer}` : '';
      const date = a.date ? ` (${a.date})` : '';
      lines.push(`- ${a.title}${issuer}${date}${a.description ? `: ${a.description}` : ''}`);
    }
  }

  if (data.publications && data.publications.length > 0) {
    lines.push('');
    lines.push('Publications:');
    for (const p of data.publications) {
      const pub = p.publisher ? ` — ${p.publisher}` : '';
      const date = p.date ? ` (${p.date})` : '';
      lines.push(`- ${p.title}${pub}${date}`);
    }
  }

  if (data.extracurriculars && data.extracurriculars.length > 0) {
    lines.push('');
    lines.push('Extracurriculars:');
    for (const x of data.extracurriculars) {
      const tenure = x.startDate ? ` (${x.startDate} – ${x.endDate || 'present'})` : '';
      lines.push(`- ${x.title || 'Activity'} at ${x.organization || 'organization'}${tenure}`);
      const bullets = (x.refinedBullets && x.refinedBullets.length > 0)
        ? x.refinedBullets
        : x.description
          ? [x.description]
          : [];
      for (const b of bullets) lines.push(`    • ${b}`);
    }
  }

  if (data.affiliations && data.affiliations.length > 0) {
    lines.push('');
    lines.push('Affiliations:');
    for (const a of data.affiliations) {
      lines.push(`- ${a.role} at ${a.organization}`);
    }
  }

  if (data.languages && data.languages.length > 0) {
    lines.push('');
    lines.push('Languages: ' + data.languages
      .filter(l => l.name)
      .map(l => `${l.name} (${l.proficiency})`)
      .join(', '));
  }

  lines.push('');
  lines.push(`Skills: ${data.skills.join(', ') || '(none provided)'}`);

  if (data.skillCategories && data.skillCategories.length > 0) {
    lines.push('Skill groupings:');
    for (const cat of data.skillCategories) {
      lines.push(`  - ${cat.category}: ${cat.items.join(', ')}`);
    }
  }

  if (includeVoice) {
    const voiceParts: string[] = [];
    for (const e of data.experience) {
      if (!e.rawDescription) continue;
      const excerpt = e.rawDescription.trim().slice(0, voiceCap);
      if (!excerpt) continue;
      voiceParts.push(`@ ${e.role || 'role'} / ${e.company || 'company'}: ${excerpt}`);
    }
    for (const p of data.projects) {
      if (!p.rawDescription) continue;
      const excerpt = p.rawDescription.trim().slice(0, voiceCap);
      if (!excerpt) continue;
      voiceParts.push(`@ project ${p.name}: ${excerpt}`);
    }
    if (voiceParts.length > 0) {
      lines.push('');
      lines.push('VOICE REFERENCE — the candidate\'s own raw words. Use ONLY for tone and framing; do NOT lift facts that are not also in the polished bullets above:');
      for (const v of voiceParts.slice(0, 4)) {
        lines.push(`  > ${v}`);
      }
    }
  }

  return lines.join('\n');
}

// ────────────────────────────────────────────────────────────────────
// 🪪 EVIDENCE CORPUS
// ────────────────────────────────────────────────────────────────────
//
// One lowercased blob with everything the candidate said about themselves.
// Used by the fabrication guard to confirm a tech token mentioned in
// generator output is actually something the candidate evidenced.

export function buildToolkitEvidenceCorpus(data: ResumeData): string {
  const parts: string[] = [...(data.skills ?? [])];
  if (data.skillCategories) {
    for (const cat of data.skillCategories) {
      parts.push(cat.category);
      parts.push(...(cat.items ?? []));
    }
  }
  for (const e of data.experience ?? []) {
    parts.push(e.role ?? '', e.company ?? '', e.rawDescription ?? '');
    if (e.refinedBullets) parts.push(...e.refinedBullets);
  }
  for (const p of data.projects ?? []) {
    parts.push(p.name ?? '', p.rawDescription ?? '', p.technologies ?? '');
    if (p.refinedBullets) parts.push(...p.refinedBullets);
  }
  for (const ed of data.education ?? []) {
    parts.push(ed.school ?? '', ed.degree ?? '', ed.field ?? '');
  }
  for (const c of data.certifications ?? []) parts.push(c.name ?? '', c.issuer ?? '');
  for (const a of data.awards ?? []) parts.push(a.title ?? '', a.issuer ?? '', a.description ?? '');
  for (const p of data.publications ?? []) parts.push(p.title ?? '', p.publisher ?? '');
  for (const x of data.extracurriculars ?? []) {
    parts.push(x.title ?? '', x.organization ?? '', x.description ?? '');
    if (x.refinedBullets) parts.push(...x.refinedBullets);
  }
  for (const af of data.affiliations ?? []) parts.push(af.role ?? '', af.organization ?? '');
  for (const lang of data.languages ?? []) parts.push(lang.name ?? '');
  if (data.summary) parts.push(data.summary);
  return parts.join(' ').toLowerCase();
}

// ────────────────────────────────────────────────────────────────────
// 🎚️ FIT MODE — match vs. stretch
// ────────────────────────────────────────────────────────────────────
//
// Some candidates apply for roles squarely in their lane; others are pivoting
// industries. The toolkit needs to behave differently for each:
//
//   match   — candidate evidence covers the JD's key requirements. Strict
//             fabrication guard, anchor specificity required. Keeps the AI
//             from inflating an already-strong CV.
//
//   stretch — career switcher / industry pivot / junior reaching up. The
//             AI is allowed to acknowledge the gap honestly, lean on
//             transferable skills, and reference JD-named tools as growth
//             targets rather than claimed experience. The fabrication guard
//             relaxes to allow JD-named tokens in output (the candidate
//             chose this JD; mentioning what it asks for is not fabrication).
//             Anchor specificity becomes "either / or" — one anchor is
//             enough rather than requiring both target company AND a
//             candidate proper noun.
//
// Detection is a token-overlap heuristic between JD vocabulary and the
// candidate's evidence corpus. Below the threshold = stretch. We intentionally
// pick a low threshold (~20%) because even modest overlap means at least
// some skill transfer; "stretch" should be reserved for genuine pivots
// where almost nothing in the evidence speaks to the JD.

export type FitMode = 'match' | 'stretch';

export interface FitClassification {
  mode: FitMode;
  /** 0..1 ratio of JD vocab tokens that also appear in evidence. */
  overlap: number;
  /** Total JD vocab size after stopword + length filtering. */
  jdVocabSize: number;
  /** How many JD vocab tokens were found in evidence. */
  matched: number;
}

// 10% overlap floor. Calibrated against two real cases:
//   - Banking credit analyst → SCB SME RM (same field, thin profile): ~16% → match ✓
//   - Banking credit analyst → Linear Product Designer (industry pivot): ~0% → stretch ✓
// 20% was too aggressive — same-field candidates with thin profiles fell into
// stretch when they shouldn't have. 10% leaves headroom for short JDs and
// sparse profiles while still catching genuine industry pivots cleanly.
const FIT_STRETCH_THRESHOLD = 0.10;

const FIT_STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'with', 'for', 'to', 'of', 'in', 'on', 'at', 'by',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
  'will', 'would', 'should', 'could', 'may', 'might', 'must', 'shall', 'can',
  'as', 'we', 'you', 'your', 'our', 'their', 'this', 'that', 'these', 'those',
  'it', 'its', 'they', 'them', 'i', 'me', 'my', 'us', 'who', 'what', 'where', 'when', 'why', 'how',
  'all', 'any', 'each', 'every', 'no', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very',
  'just', 'also', 'into', 'about', 'from', 'such', 'including', 'across',
  'work', 'role', 'team', 'teams', 'company', 'years', 'year',
  'job', 'experience', 'requirements', 'responsibilities', 'qualifications',
  'looking', 'looking', 'role', 'position', 'candidate', 'candidates', 'preferred',
  'plus', 'bonus', 'nice', 'offer', 'benefits',
]);

function fitTokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9+./#-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

export function classifyFitMode(data: ResumeData): FitClassification {
  const jdText = data.targetJob?.description ?? '';
  const evidence = buildToolkitEvidenceCorpus(data);

  const jdVocab = new Set<string>();
  for (const t of fitTokenize(jdText)) {
    if (t.length < 3) continue;
    if (FIT_STOPWORDS.has(t)) continue;
    jdVocab.add(t);
  }

  // Tokenize evidence into a Set for O(1) lookup. Reuse the same filter
  // so we don't count stopword matches as overlap.
  const evidenceSet = new Set<string>();
  for (const t of fitTokenize(evidence)) {
    if (t.length < 3) continue;
    if (FIT_STOPWORDS.has(t)) continue;
    evidenceSet.add(t);
  }

  let matched = 0;
  for (const t of jdVocab) {
    if (evidenceSet.has(t)) matched++;
  }

  const overlap = jdVocab.size === 0 ? 1 : matched / jdVocab.size;
  // When JD vocab is too small to be reliable (e.g. a one-line description),
  // default to 'match' rather than risk classifying every short JD as stretch.
  const reliable = jdVocab.size >= 20;
  const mode: FitMode =
    reliable && overlap < FIT_STRETCH_THRESHOLD ? 'stretch' : 'match';

  return { mode, overlap, jdVocabSize: jdVocab.size, matched };
}

// ────────────────────────────────────────────────────────────────────
// 🎯 PROPER-NOUN HOOKS
// ────────────────────────────────────────────────────────────────────
//
// All the candidate's own proper-noun anchors — used to test whether output
// is actually grounded in the candidate's experience instead of being
// generic JD-shaped filler. Filtered for length so we don't trigger on
// 1–2 char artifacts.

// Returns true when a stored anchor string contains enough ASCII letters that
// the AI's English output can plausibly reproduce it. Anchors stored entirely
// in Bengali script (or other non-Latin scripts) will never substring-match an
// English-language AI output, so excluding them prevents false-positive
// specificity failures for candidates who fill their profiles in Bengali.
function isLatinRepresentable(anchor: string): boolean {
  const letters = anchor.replace(/[^a-zA-Zঀ-৿]/g, '');
  if (letters.length === 0) return false;
  const latinCount = (anchor.match(/[a-zA-Z]/g) ?? []).length;
  return latinCount / letters.length >= 0.5;
}

export function buildCandidateAnchors(data: ResumeData): string[] {
  const anchors: string[] = [];
  for (const e of data.experience ?? []) {
    if (e.company && e.company.trim().length >= 3) anchors.push(e.company.trim());
    if (e.role && e.role.trim().length >= 3) anchors.push(e.role.trim());
  }
  for (const p of data.projects ?? []) {
    if (p.name && p.name.trim().length >= 3) anchors.push(p.name.trim());
  }
  for (const c of data.certifications ?? []) {
    if (c.name && c.name.trim().length >= 3) anchors.push(c.name.trim());
  }
  for (const a of data.awards ?? []) {
    if (a.title && a.title.trim().length >= 3) anchors.push(a.title.trim());
  }
  for (const ed of data.education ?? []) {
    if (ed.school && ed.school.trim().length >= 3) anchors.push(ed.school.trim());
  }
  for (const x of data.extracurriculars ?? []) {
    if (x.organization && x.organization.trim().length >= 3) anchors.push(x.organization.trim());
  }
  return anchors;
}

// ────────────────────────────────────────────────────────────────────
// 🛡 FABRICATION GUARD — INDUSTRY TOKEN DICTIONARIES
// ────────────────────────────────────────────────────────────────────
//
// Curated dictionaries of high-signal tools / products / employers / regulators
// across the industries this product targets in the BD market: software/cloud,
// banking & finance, pharma, garments / RMG, FMCG, NGO / development,
// telecom. If a generator's output mentions any of these tokens AND the
// candidate's evidence corpus does not contain it, that is fabrication —
// triggers a retry.
//
// All dictionaries are scanned for every candidate (the union — one common
// token list). This is correct because the guard fires only when a token
// appears in OUTPUT but not in EVIDENCE: a banking candidate's output
// won't contain "PyTorch" unless the model fabricated it; a pharma rep's
// output won't contain "Murex" unless the model fabricated it. Industry
// dispatch would be redundant.
//
// The dictionaries are intentionally NOT exhaustive — false negatives (rare
// tools the model invents) are acceptable. The goal is to catch the
// common, embarrassing case: model adds "AWS" / "Murex" / "Veeva" / "WFX"
// to make the candidate sound more impressive than their actual data
// supports. Tokens use the canonical casing recruiters expect; the matcher
// is case-insensitive against output and against evidence.
//
// Curation principle: include named PROPER NOUNS (specific software, vendors,
// regulators, big-name buyers / employers, formal certifications). EXCLUDE
// generic methodology phrases ("primary sales", "trade marketing", "lesson
// plan") — those legitimately describe what a candidate does without
// requiring the candidate to have written that exact phrase in their
// rawDescription, and would produce false positives.

// Curation principle for this list: avoid single-word tokens that collide
// with common English words under case-insensitive whole-word matching.
// During the 2026-05-08 audit, `Next` (UK retailer, formerly here) and
// `Express` (the Node framework) both false-positived on legitimate output
// like "next steps" / "express interest" — same shape of bug. Tokens
// removed for the same reason are flagged in the comments below; their
// multi-word equivalents are preserved when one exists. Net trade-off:
// we lose detection of fabricated single-word tools (rare in practice —
// candidates and models tend to use the canonical multi-word form) in
// exchange for never blocking a legitimate cover letter.
const TECH_TOKENS: string[] = [
  // Cloud & infrastructure
  // Removed: 'Render' (verb), 'Railway' (noun), 'Azure' (color)
  'AWS', 'Amazon Web Services', 'GCP', 'Google Cloud',
  'Cloudflare', 'Vercel', 'Netlify', 'Heroku', 'DigitalOcean', 'Linode',
  'Fly.io', 'Render.com',
  // Programming languages
  // Removed: 'Go' (verb — kept 'Golang'), 'Rust' (noun/verb), 'Swift' (adj —
  // covered by 'SwiftUI' below for iOS context), 'R' (single letter, useless),
  // 'Dart' (verb), 'Ruby' (gem/name — kept Ruby on Rails), 'Elixir' (potion),
  // 'Java' (also island; kept because the language is overwhelmingly more
  // common in resume context).
  'Python', 'JavaScript', 'TypeScript', 'Java', 'Kotlin',
  'Objective-C', 'Golang', 'C++', 'C#', 'PHP',
  'Scala', 'Erlang', 'MATLAB', 'Perl', 'Lua',
  // Web frameworks & libraries
  // Removed: 'Express' (verb — kept 'Express.js'), 'Spring' (season —
  // kept 'Spring Boot' / 'Spring Framework'), 'Flask' (object —
  // very low fabrication value), 'Phoenix' (city/myth), 'Remix' (verb),
  // 'Bootstrap' (verb — kept 'Bootstrap CSS' for clarity), 'Rails' (train
  // rails — kept 'Ruby on Rails'), 'Vue' (French/noun — kept 'Vue.js').
  'React', 'Vue.js', 'Angular', 'Svelte', 'Next.js', 'Nuxt',
  'Gatsby', 'Astro', 'SolidJS',
  'Express.js', 'ExpressJS',
  'FastAPI', 'Django',
  'Spring Boot', 'Spring Framework',
  'Ruby on Rails', 'Laravel', 'NestJS', 'AdonisJS',
  'Tailwind', 'Bootstrap CSS', 'Material-UI', 'Chakra UI',
  // Mobile
  // Removed: 'Flutter' (verb — fabrication of Flutter without evidence is
  // rare and the false-positive risk on "fluttered" is real),
  // 'Ionic' (chemistry term — also a framework but minor risk).
  'iOS', 'Android', 'React Native', 'SwiftUI', 'Jetpack Compose',
  'Xamarin',
  // Databases
  // Removed: 'Cassandra' (proper name), 'Snowflake' (natural object),
  // 'Pinecone' (botany), 'Neon' (color — kept 'Neon DB').
  'PostgreSQL', 'Postgres', 'MySQL', 'MariaDB', 'SQLite', 'Oracle DB',
  'Oracle Database',
  'MongoDB', 'Redis', 'Memcached', 'DynamoDB', 'CosmosDB',
  'BigQuery', 'Databricks', 'Redshift',
  'Elasticsearch', 'OpenSearch', 'Algolia', 'Weaviate',
  'Firestore', 'Supabase', 'PlanetScale', 'Neon DB',
  // DevOps / IaC / CI
  // Removed: 'Chef' (occupation — kept 'Chef Configuration Management'),
  // 'Puppet' (toy — kept 'Puppet Configuration Management'),
  // 'Helm' (ship's helm).
  'Docker', 'Kubernetes', 'K8s', 'Terraform', 'Pulumi', 'Ansible',
  'Chef Configuration Management', 'Puppet Configuration Management',
  'Jenkins', 'GitHub Actions', 'GitLab CI', 'CircleCI',
  'Travis CI', 'ArgoCD', 'Istio',
  // AI / ML
  // Removed: 'Claude' (common name).
  'TensorFlow', 'PyTorch', 'JAX', 'Keras', 'scikit-learn', 'XGBoost',
  'OpenAI', 'Anthropic', 'ChatGPT', 'GPT-4', 'GPT-5',
  'Gemini', 'LangChain', 'LlamaIndex', 'Hugging Face',
  // Observability / SaaS infra
  // Removed: 'Sentry' (occupation), 'Prometheus' (myth — Prometheus the
  // monitoring tool is a real fabrication risk but the false positive on
  // mythological references in cover-letter writing is non-trivial; drop).
  // 'Honeycomb' (natural object — keep `Honeycomb.io` for tighter match).
  'Datadog', 'Grafana', 'Splunk', 'PagerDuty',
  'New Relic', 'Honeycomb.io', 'Lightstep',
  // Payments / comms / SaaS
  // Removed: 'Plaid' (fabric pattern), 'Stripe' (pattern — fabrication
  // risk for Stripe-the-payments-co is meaningful but the FP on "the
  // candidate has a strong stripe of independence" or "yellow stripe" or
  // "stripe of accomplishments" is too broad. Replaced with `Stripe.com`).
  'Stripe.com', 'Twilio', 'SendGrid', 'Mailchimp', 'Auth0',
  'Okta', 'Firebase',
  // Big tech / common fabrication targets
  // Removed: 'Apple' (fruit — kept 'Apple Inc'), 'Amazon' (rainforest —
  // kept 'Amazon.com'), 'Meta' (prefix — kept 'Meta Platforms'),
  // 'Tesla' (name / SI unit), 'Uber' (German prefix), 'Adobe' (mud brick —
  // kept 'Adobe Inc'), 'Oracle' (fortune-teller — kept 'Oracle Corporation'),
  // 'Intel' (slang for information — kept 'Intel Corporation'), 'Square'
  // (shape — kept 'Square Inc' / 'Block Inc'), 'Block' (verb).
  'Google', 'Microsoft', 'Apple Inc', 'Amazon.com', 'Meta Platforms', 'Facebook',
  'Netflix', 'Airbnb', 'Lyft', 'Spotify',
  'Salesforce', 'Adobe Inc', 'Oracle Corporation', 'IBM', 'Intel Corporation', 'NVIDIA',
  'Shopify', 'Square Inc', 'Block Inc',
  // Methodologies — kept tight to avoid common-word collisions.
  // Removed: 'Scrum' (rugby formation — fabrication is uncommon and FP
  // is real on rugby / metaphorical usage).
  'Kanban', 'TDD', 'BDD',
];

// Banking & finance — core systems, market-data terminals, regulators,
// well-known certifications. Curated for the BD market (BRAC Bank, City Bank,
// EBL, Standard Chartered BD, HSBC BD, DBBL, Prime Bank, etc.) plus the
// global vendor stack BD banks actually run on.
//
// Excluded for false-positive risk: 'SWIFT' (matches the adjective "swift"
// in any cover letter); 'CAMS' (matches "cams" plural noun); 'CIB', 'NPL',
// 'CMSME', 'KYC', 'AML' (short BD-banking acronyms that candidates and the
// JD use loosely). 'CFA' is kept because the case-insensitive regex matches
// only the 3-letter token and "cfa" rarely appears in any other context.
// Environmental regulations (Basel III, IFRS 9, Basel IV) used to live in
// this dictionary alongside vendor products and certifications. They were
// removed during the 2026-05-14 bilingual-prep audit — bank-side candidates
// repeatedly tripped the guard because the AI legitimately referenced the
// regulatory environment ("aligned with Basel III capital adequacy", "IFRS 9
// ECL staging discipline") which is true of any BD bank by definition.
// The distinction we keep is: CLAIMED ASSETS stay in the dictionary
// (software the candidate used, terminals they had access to, certifications
// they hold, employers they worked at — any of which could be fabricated to
// look more impressive). ENVIRONMENTAL REGULATIONS do not — every BD bank
// operates under Basel III; saying so is descriptive, not boastful.
const BANKING_TOKENS: string[] = [
  // Vendor software (claimed-asset class — keep strict)
  'Murex', 'Finacle', 'Avaloq', 'Temenos', 'T24', 'Oracle Flexcube',
  'Misys', 'Calypso', 'Sungard',
  // Market-data terminals (claimed-asset class — either you had a seat or
  // you didn't; keep strict)
  'Bloomberg Terminal', 'Bloomberg', 'Reuters Eikon', 'Refinitiv',
  // Certifications (claimed-asset class — either you hold it or you don't)
  'CFA', 'CIMA', 'FRM', 'CISA', 'ACCA', 'ICAB',
  // Regulators (claimed-asset class — claiming direct work with a regulator
  // you never engaged is fabrication)
  'Bangladesh Bank', 'BFIU',
];

// Pharma / life sciences — sales-force enablement systems, market-data
// providers, big BD/global pharma houses.
const PHARMA_TOKENS: string[] = [
  'Veeva', 'Veeva CRM', 'Veeva Vault', 'IQVIA', 'IMS Health',
  'Salesforce Health Cloud', 'OneKey',
  'Square Pharmaceuticals', 'Beximco Pharma', 'Incepta', 'Renata',
  'Eskayef', 'ACI Limited', 'Healthcare Pharmaceuticals',
  'Pfizer', 'Novartis', 'GlaxoSmithKline', 'GSK', 'Sanofi', 'Roche',
  'AstraZeneca', 'Abbott', 'Sun Pharma', 'Cipla',
];

// Garments / RMG — merchandising software, big global buyers, BD-side
// large-group employers, BD trade-association acronyms.
//
// Curation note: tokens that are also common English words ("Next" the
// retailer, "Stage" the software, "Target" the retailer, "Mango" the
// retailer, "Kohl's" the retailer, "Gap" the retailer, "Care" — see NGO)
// are EXCLUDED from this list because the matcher uses simple word-boundary
// regex and would false-positive on legitimate sentence-level usage
// ("next steps", "stage of the project", "target market", "care about").
// We accept the false-negative risk of missing a fabricated retailer
// reference in exchange for not breaking ordinary English in the output.
const GARMENTS_TOKENS: string[] = [
  // Merchandising / production software
  'WFX', 'FastReact', 'BlueCherry', 'Coats Digital', 'Methods Workshop',
  // Big global buyers BD merchandisers actually liaise with — only those
  // whose names are unambiguous in resume / cover-letter context.
  'H&M', 'Inditex', 'Zara', 'Marks & Spencer', "Marks and Spencer",
  'Walmart', 'Primark', "Levi's", 'Levis',
  'Tesco', 'Decathlon', 'Uniqlo', 'C&A',
  'Aldi', 'Lidl', 'Carrefour', 'Costco',
  // BD-side big employers
  'DBL Group', 'Hameem Group', 'Beximco Textiles',
  'Pacific Jeans', 'Square Textiles', 'Mohammadi Group',
  'Ha-Meem', 'Ananta Group', 'Epyllion Group',
  // BD trade-association regulators
  'BGMEA', 'BKMEA',
];

// FMCG — global brand houses with BD presence, named POS / DMS systems.
//
// Excluded for false-positive risk: 'BAT' (matches the animal "bat" /
// the cricket bat). Use the full "British American Tobacco" instead.
const FMCG_TOKENS: string[] = [
  'Unilever', 'Nestlé', 'Nestle', 'Reckitt', 'Reckitt Benckiser',
  'Procter & Gamble', 'P&G', 'Colgate', 'Colgate-Palmolive',
  'Coca-Cola', 'Pepsi', 'PepsiCo', 'British American Tobacco',
  'Japan Tobacco International', 'JTI',
  'Marico', 'Dabur', 'GSK Consumer', 'Mondelez',
  // Distributor / route-to-market software
  'ALEFA', 'RouteIQ', 'BIQ', 'Salesforce Consumer Goods',
  'Salesforce CG', 'SAP Customer Activity Repository',
];

// NGO / international development — donor agencies, M&E platforms,
// well-known BD-active INGOs.
//
// Curation note: 'CARE' the INGO is excluded because "care" is a common
// English verb ("care about", "patient care") and case-insensitive matching
// would false-positive. Use 'CARE International' (the formal name) only.
// 'IRC' is also excluded — too short / too generic; use 'International
// Rescue Committee'.
const NGO_TOKENS: string[] = [
  // Major donors active in BD
  'USAID', 'DFID', 'FCDO', 'GIZ', 'JICA', 'KOICA', 'SIDA',
  'World Bank', 'ADB', 'Asian Development Bank', 'IFC',
  'BMGF', 'Bill and Melinda Gates Foundation',
  'UNICEF', 'UNHCR', 'WFP', 'UNDP', 'UNFPA',
  'OXFAM', 'Save the Children', 'Plan International',
  'CARE International', 'World Vision',
  'International Rescue Committee', 'MSF',
  'BRAC', 'Grameen', 'Grameen Bank', 'Friendship NGO',
  'icddr,b', 'icddrb',
  // M&E and field-data tools
  'Kobo Toolbox', 'KoboToolbox', 'ODK', 'Open Data Kit',
  'ActivityInfo', 'DHIS2', 'OpenMRS', 'CommCare', 'PowerBI',
];

// Telecom — global vendors, BD operators.
const TELECOM_TOKENS: string[] = [
  'Ericsson', 'Huawei', 'Nokia', 'Nokia Siemens', 'ZTE',
  'Cisco', 'Juniper', 'Samsung Networks',
  'Grameenphone', 'Robi', 'Robi Axiata', 'Banglalink',
  'Teletalk', 'Airtel', 'Axiata', 'Telenor',
  'BTRC',
];

// Combined dictionary scanned by the fabrication guard. Order does not
// matter for correctness; we dedupe + lowercase in the matcher.
const FABRICATION_TOKEN_DICTIONARY: string[] = [
  ...TECH_TOKENS,
  ...BANKING_TOKENS,
  ...PHARMA_TOKENS,
  ...GARMENTS_TOKENS,
  ...FMCG_TOKENS,
  ...NGO_TOKENS,
  ...TELECOM_TOKENS,
];

export class ToolkitFabricationError extends Error {
  constructor(public readonly tokens: string[]) {
    super(`Toolkit output contained fabricated tech tokens not in candidate evidence: ${tokens.join(', ')}`);
    this.name = 'ToolkitFabricationError';
  }
}

export class ToolkitSpecificityError extends Error {
  constructor(public readonly missing: string) {
    super(`Toolkit output failed specificity check: ${missing}`);
    this.name = 'ToolkitSpecificityError';
  }
}

// Tokens that look "tech-y" but are genuinely safe to mention without
// being in evidence — common methodology / generic terms the model uses
// to describe approaches. Keep this short; over-allowing weakens the guard.
const FABRICATION_SAFELIST = new Set<string>([
  'agile', 'rest', 'sql', 'http', 'json', 'api', 'apis', 'frontend',
  'backend', 'fullstack', 'mobile', 'web', 'cloud',
]);

// Look for each token in the FABRICATION_TOKEN_DICTIONARY as a whole-word,
// case-insensitive match in the generator's output. For any hit, confirm the
// same token (or a known alias) appears in evidence. Aliases handle common
// abbreviation pairs (AWS / Amazon Web Services; H&M / Hennes & Mauritz; ICDDR,B
// punctuation; etc.).
const TECH_TOKEN_ALIASES: Record<string, string[]> = {
  'aws': ['amazon web services'],
  'amazon web services': ['aws'],
  'gcp': ['google cloud', 'google cloud platform'],
  'google cloud': ['gcp', 'google cloud platform'],
  'k8s': ['kubernetes'],
  'kubernetes': ['k8s'],
  'postgres': ['postgresql'],
  'postgresql': ['postgres'],
  'golang': ['go'],
  'rails': ['ruby on rails'],
  'ruby on rails': ['rails'],
  'gpt-4': ['openai', 'chatgpt'],
  'gpt-5': ['openai', 'chatgpt'],
  'chatgpt': ['openai'],
  // Banking / finance
  'bloomberg terminal': ['bloomberg'],
  'bloomberg': ['bloomberg terminal'],
  'reuters eikon': ['refinitiv', 'reuters'],
  'refinitiv': ['reuters eikon'],
  't24': ['temenos'],
  'temenos': ['t24'],
  // Pharma
  'gsk': ['glaxosmithkline'],
  'glaxosmithkline': ['gsk'],
  'p&g': ['procter & gamble'],
  'procter & gamble': ['p&g'],
  'veeva crm': ['veeva'],
  'veeva vault': ['veeva'],
  // Garments — buyers
  "marks and spencer": ['marks & spencer', 'm&s'],
  'marks & spencer': ['marks and spencer', 'm&s'],
  'm&s': ['marks & spencer', 'marks and spencer'],
  'levis': ["levi's"],
  "levi's": ['levis'],
  // FMCG
  'reckitt benckiser': ['reckitt'],
  'reckitt': ['reckitt benckiser'],
  'pepsi': ['pepsico'],
  'pepsico': ['pepsi'],
  'nestle': ['nestlé'],
  'nestlé': ['nestle'],
  'bat': ['british american tobacco'],
  'british american tobacco': ['bat'],
  // NGO
  'world bank': ['ibrd', 'ida'],
  'asian development bank': ['adb'],
  'adb': ['asian development bank'],
  'bmgf': ['bill and melinda gates foundation', 'gates foundation'],
  'bill and melinda gates foundation': ['bmgf'],
  'icddr,b': ['icddrb', 'icddr b'],
  'icddrb': ['icddr,b'],
  'kobotoolbox': ['kobo toolbox'],
  'kobo toolbox': ['kobotoolbox'],
  // Telecom
  'robi axiata': ['robi'],
  'robi': ['robi axiata'],
  'nokia siemens': ['nokia'],
};

export function detectFabricatedTokens(output: string, evidence: string): string[] {
  const lcOutput = ` ${output.toLowerCase()} `;
  const lcEvidence = evidence; // already lowercased
  const fabricated: string[] = [];
  const seen = new Set<string>();

  for (const token of FABRICATION_TOKEN_DICTIONARY) {
    const lcToken = token.toLowerCase();
    if (FABRICATION_SAFELIST.has(lcToken)) continue;
    if (seen.has(lcToken)) continue;

    const escaped = lcToken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const wordBoundary = /^[a-z0-9]/.test(lcToken) ? '\\b' : '';
    const re = new RegExp(`${wordBoundary}${escaped}${/[a-z0-9]$/.test(lcToken) ? '\\b' : ''}`, 'i');
    if (!re.test(lcOutput)) continue;

    seen.add(lcToken);
    if (lcEvidence.includes(lcToken)) continue;
    const aliases = TECH_TOKEN_ALIASES[lcToken] ?? [];
    if (aliases.some(a => lcEvidence.includes(a))) continue;

    fabricated.push(token);
  }
  return fabricated;
}

export interface FabricationGuardOptions {
  /**
   * Include the JD text in the allowed-evidence corpus. Use for interview
   * questions: the JD dictates what the interviewer probes, and naming a
   * JD-listed regulator / framework / tool in answer-strategy text is
   * legitimate prep, not fabrication. Do NOT enable for cover letter /
   * outreach / LinkedIn — those represent the candidate's pitch and must
   * not import unsupported claims from the JD.
   */
  allowJD?: boolean;
}

export function assertNoFabricatedTools(
  output: string,
  data: ResumeData,
  options: FabricationGuardOptions = {}
): void {
  const evidence = buildToolkitEvidenceCorpus(data);
  // Always allow the target company name in output even if the candidate
  // never worked there — outreach to a target IS the whole point.
  let augmented = data.targetJob.company
    ? `${evidence} ${data.targetJob.company.toLowerCase()}`
    : evidence;
  if (options.allowJD && data.targetJob.description) {
    augmented = `${augmented} ${data.targetJob.description.toLowerCase()}`;
  }
  const fabricated = detectFabricatedTokens(output, augmented);
  if (fabricated.length > 0) {
    throw new ToolkitFabricationError(fabricated);
  }
}

// ────────────────────────────────────────────────────────────────────
// 🎯 SPECIFICITY GUARD
// ────────────────────────────────────────────────────────────────────
//
// Catches generic outreach / LinkedIn output. Two checks:
//   1. The text references the target company (or, if no company name was
//      provided in the JD, accepts any candidate anchor as proof of
//      grounding).
//   2. The text references at least one candidate proper-noun anchor
//      (their own company / role / project / certification / award /
//      school / extracurricular).
//
// `mode = 'either'` is used for LinkedIn notes — 280 chars rarely fits
// both; we accept either. `mode = 'both'` for outreach emails which have
// 110–170 words to play with.

export function assertOutreachSpecificity(
  output: string,
  data: ResumeData,
  mode: 'both' | 'either' = 'both'
): void {
  const lc = output.toLowerCase();
  const company = data.targetJob.company?.trim();
  const anchors = buildCandidateAnchors(data);

  const hasCompany = !!company && lc.includes(company.toLowerCase());
  const hasAnchor = anchors.some(a => isLatinRepresentable(a) && lc.includes(a.toLowerCase()));

  if (mode === 'both') {
    if (!hasCompany && !!company) {
      throw new ToolkitSpecificityError(`output never names target company "${company}"`);
    }
    // Only enforce the candidate-anchor check when:
    //   1. The target company was NOT already found (company presence alone is sufficient
    //      specificity — enforcing both is too strict and breaks for non-Latin anchor names).
    //   2. There are Latin-representable anchors the AI could plausibly reproduce.
    const latinAnchors = anchors.filter(isLatinRepresentable);
    if (!hasCompany && latinAnchors.length > 0 && !hasAnchor) {
      throw new ToolkitSpecificityError('output never references a candidate proper noun (company / role / project / cert / school)');
    }
  } else {
    const okEither = hasCompany || hasAnchor || (!company && anchors.length === 0);
    if (!okEither) {
      throw new ToolkitSpecificityError('output is generic — no target company OR candidate anchor present');
    }
  }
}

// ────────────────────────────────────────────────────────────────────
// 🪝 INTERVIEW ANSWER-STRATEGY ANCHOR
// ────────────────────────────────────────────────────────────────────
//
// Each interview question's answerStrategy must reference at least one
// candidate proper-noun anchor — otherwise it's a generic prep sheet
// pretending to be tailored. We're lenient: only require half the
// questions to be properly anchored before throwing, since not every
// question type maps to a specific item (e.g. broad behavioral).

export function countAnchoredStrategies(
  strategies: string[],
  data: ResumeData
): number {
  const anchors = buildCandidateAnchors(data).filter(isLatinRepresentable);
  if (anchors.length === 0) return strategies.length; // can't enforce — no matchable anchors
  let count = 0;
  for (const s of strategies) {
    const lc = s.toLowerCase();
    if (anchors.some(a => lc.includes(a.toLowerCase()))) count++;
  }
  return count;
}

export function assertInterviewAnchorCoverage(
  strategies: string[],
  data: ResumeData
): void {
  if (strategies.length === 0) return;
  const anchored = countAnchoredStrategies(strategies, data);
  // Require at least a third to anchor in a candidate proper noun. The
  // previous 50% bar was too strict given 6–8 questions span 5 categories
  // (Behavioral / Technical / Role-specific / Values & Culture / Situational)
  // and not every category naturally maps to a literal candidate proper noun —
  // e.g. broad behavioural questions, values fit. 50% was the single biggest
  // source of "toolkit failed entirely on initial generation" in practice.
  if (anchored * 3 < strategies.length) {
    throw new ToolkitSpecificityError(
      `interview answerStrategies are mostly generic — only ${anchored}/${strategies.length} reference a candidate proper noun`
    );
  }
}
