// Custom JD skill extractor for SkillsStep.
//
// Why custom: a generic NPM "keyword extractor" pulls *every* salient noun out
// of a job description (company names, locations, soft fluff). What we need is
// a *resume-skill* extractor — tools, methods, technologies, and the soft
// skills that recruiters actually keyword-match. So this file combines four
// passes tuned for JD prose:
//
//   A. Known-skill match — regex + fuse.js fuzzy. Highest precision. Catches
//      "React" in "React.js experience…", "ReactJS" → "React" via fuzzy.
//   B. Intro-phrase extraction — phrases like "experience with X, Y, Z",
//      "proficient in A and B", "familiarity with C". Splits the trailing
//      noun phrase on , / ; / and / or, cleans each item.
//   C. Section-aware bullet parsing — finds "Requirements:" / "Skills:" /
//      "Tech stack:" headings and walks the bullets after them.
//   D. Repeated capitalized phrases — proper nouns appearing 2+ times.
//      Catches niche tools the dictionary doesn't know (Snowflake, Datadog).
//
// Each pass scores its candidates; we sum scores, normalise to canonical
// names from the dictionary when possible, and return the top N. Pure
// client-side — no Gemini call (would burn the 2-call optimizer+toolkit
// budget). The matchSkillsToJD helper from before is still exported as the
// internal known-skill match (used by Pass A).

import Fuse from 'fuse.js';

// Curated dictionary used both as a canonical name source ("react" → "React")
// and as the fallback pool when the user has no profile skills yet. Broad-
// by-design — the AI optimizer trims to whatever the role actually needs at
// generation time.
export const COMMON_SKILLS_DICTIONARY: string[] = [
  // Languages
  'JavaScript', 'TypeScript', 'Python', 'Java', 'Go', 'Rust', 'Ruby', 'PHP',
  'C++', 'C#', 'Kotlin', 'Swift', 'Objective-C', 'Scala', 'R', 'MATLAB',
  // Web frameworks / libs
  'React', 'Vue', 'Angular', 'Svelte', 'Next.js', 'Nuxt.js', 'Remix',
  'React Native', 'Flutter', 'Tailwind CSS', 'Sass', 'Webpack', 'Vite',
  // Backend
  'Node.js', 'Express', 'NestJS', 'Django', 'Flask', 'FastAPI',
  'Spring Boot', 'Ruby on Rails', '.NET',
  // Data / DB
  'PostgreSQL', 'MySQL', 'SQLite', 'MongoDB', 'Redis', 'DynamoDB',
  'Elasticsearch', 'Cassandra',
  'GraphQL', 'REST APIs', 'gRPC', 'WebSockets', 'OAuth',
  // Cloud / DevOps
  'AWS', 'GCP', 'Azure', 'Docker', 'Kubernetes', 'Terraform', 'Ansible',
  'CI/CD', 'GitHub Actions', 'Jenkins', 'CircleCI',
  'Git', 'Linux', 'Bash', 'SQL', 'NoSQL',
  // Data science / ML
  'Machine Learning', 'Deep Learning', 'Data Analysis', 'Data Engineering',
  'Statistical Analysis', 'A/B Testing',
  'TensorFlow', 'PyTorch', 'scikit-learn', 'NumPy', 'Pandas', 'Jupyter',
  'Tableau', 'Power BI', 'Looker', 'dbt', 'Airflow', 'Snowflake', 'BigQuery',
  'Spark', 'Hadoop', 'Kafka', 'Databricks',
  // Design
  'Figma', 'Sketch', 'Adobe XD', 'Photoshop', 'Illustrator', 'After Effects',
  'InDesign', 'Premiere Pro', 'Webflow', 'Framer',
  'UX Design', 'UI Design', 'Wireframing', 'Prototyping', 'User Research',
  'Usability Testing', 'Design Systems', 'Accessibility',
  // Marketing / sales
  'SEO', 'SEM', 'Google Analytics', 'Google Ads', 'HubSpot', 'Salesforce',
  'Mailchimp', 'Marketo', 'Content Marketing', 'Social Media',
  'Copywriting', 'Brand Strategy', 'Email Marketing',
  // PM / business
  'Stakeholder Management', 'Project Management', 'Product Management',
  'Agile', 'Scrum', 'Kanban', 'OKRs',
  'Cross-functional Collaboration', 'Strategic Planning', 'Roadmapping',
  'Forecasting', 'Budgeting', 'Financial Modeling', 'P&L Management',
  'Vendor Management', 'Procurement',
  // Office
  'Microsoft Excel', 'Microsoft Word', 'PowerPoint', 'Google Workspace',
  'Slack', 'Notion', 'Asana', 'Jira', 'Confluence', 'Trello', 'Monday.com',
  // Soft skills
  'Leadership', 'Communication', 'Public Speaking', 'Writing', 'Editing',
  'Coaching', 'Mentoring', 'Negotiation', 'Conflict Resolution',
  'Problem Solving', 'Critical Thinking', 'Time Management', 'Teamwork',
  'Customer Service', 'Empathy', 'Adaptability',
  // Healthcare
  'Patient Care', 'Clinical Research', 'Electronic Medical Records',
  'Epic', 'Cerner', 'BLS', 'ACLS', 'Phlebotomy', 'Triage',
  'Medication Administration', 'HIPAA',
  // Legal
  'Contract Negotiation', 'Compliance', 'Risk Management', 'Litigation',
  'Legal Research', 'Drafting', 'Due Diligence',
  // Education
  'Curriculum Design', 'Lesson Planning', 'Classroom Management',
  'Differentiated Instruction', 'IEP',
  // Trades / ops
  'Inventory Management', 'Logistics', 'Supply Chain', 'Quality Assurance',
  'Process Improvement', 'Lean', 'Six Sigma', 'CAD', 'AutoCAD', 'SolidWorks',
];

// Things that show up in JDs but aren't skills. These get rejected even if a
// pattern picks them up.
const STOP_WORDS = new Set([
  // Articles, conjunctions, prepositions
  'a', 'an', 'the', 'and', 'or', 'but', 'nor', 'so', 'yet',
  'at', 'by', 'for', 'from', 'in', 'into', 'of', 'on', 'onto', 'to',
  'with', 'without', 'within', 'about', 'against', 'between', 'through',
  'during', 'before', 'after', 'above', 'below', 'over', 'under', 'across',
  // Aux verbs
  'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did',
  'will', 'would', 'could', 'should', 'may', 'might', 'must', 'shall', 'can',
  // Pronouns
  'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'us', 'them',
  'my', 'your', 'his', 'her', 'its', 'our', 'their',
  'this', 'that', 'these', 'those', 'who', 'whom', 'which', 'what',
  // Generic JD nouns we never want as a skill
  'role', 'roles', 'job', 'jobs', 'position', 'positions', 'opportunity',
  'team', 'teams', 'company', 'companies', 'organization', 'department',
  'environment', 'culture', 'mission', 'business', 'industry', 'field',
  'candidate', 'applicant', 'individual', 'professional', 'person', 'people',
  'work', 'working', 'workplace', 'office', 'remote', 'hybrid', 'onsite',
  'time', 'day', 'days', 'week', 'weeks', 'month', 'months', 'year', 'years',
  'experience', 'experiences', 'expertise', 'background', 'history',
  'skill', 'skills', 'ability', 'abilities', 'knowledge',
  'qualification', 'qualifications', 'requirement', 'requirements',
  'responsibility', 'responsibilities', 'duty', 'duties',
  // Vague adjectives
  'some', 'any', 'all', 'every', 'each', 'most', 'many', 'much', 'few',
  'several', 'various', 'multiple', 'minimum', 'maximum',
  'good', 'great', 'strong', 'solid', 'excellent', 'deep', 'broad',
  'preferred', 'required', 'optional', 'plus', 'bonus', 'paced',
  // Filler
  'thing', 'things', 'something', 'someone', 'anything', 'everyone',
  'etc', 'etc.', 'eg', 'e.g.', 'ie', 'i.e.',
]);

// Phrases (lowercase) we never want to extract as a skill, even if they
// pattern-match. Catches headings and JD boilerplate.
const PHRASE_BLOCKLIST = new Set([
  'job description', 'job summary', 'about us', 'about the role',
  'about you', 'who we are', 'what we offer', 'what you\'ll do',
  'what you will do', 'overview', 'introduction', 'summary', 'description',
  'fast paced', 'fast-paced', 'work environment', 'work life balance',
  'equal opportunity', 'compensation', 'benefits', 'salary range',
  'starting salary', 'base salary',
]);

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Word-boundary matcher that handles tech symbols ("C++", "C#", "Node.js",
// ".NET") which the standard \b boundary mishandles.
function wordBoundaryRegex(skill: string): RegExp {
  const escaped = escapeRegex(skill).replace(/\\?\s+/g, '\\s+');
  return new RegExp(
    `(?:^|[^a-z0-9.+#])${escaped}(?:$|[^a-z0-9])`,
    'i',
  );
}

/**
 * Match skills in `pool` against the JD using regex + fuse.js fuzzy. High
 * precision — used as Pass A inside the extractor, and as a standalone helper
 * elsewhere. Returns matches in pool-order (so profile skills surface first).
 * Pure function, no I/O.
 */
export function matchSkillsToJD(jd: string, pool: string[]): string[] {
  if (!jd || jd.trim().length < 50 || pool.length === 0) return [];

  const matched = new Set<string>();

  for (const skill of pool) {
    if (skill.length < 2) continue;
    if (wordBoundaryRegex(skill).test(jd)) {
      matched.add(skill);
    }
  }

  const remaining = pool.filter(s => !matched.has(s) && s.length >= 3);
  if (remaining.length > 0) {
    const ngrams = extractNgrams(jd, 3);
    const fuse = new Fuse(ngrams, {
      threshold: 0.18,
      distance: 30,
      ignoreLocation: true,
      minMatchCharLength: 3,
    });
    for (const skill of remaining) {
      const results = fuse.search(skill);
      if (results.length > 0 && (results[0].score ?? 1) <= 0.18) {
        matched.add(skill);
      }
    }
  }

  return pool.filter(s => matched.has(s));
}

function extractNgrams(text: string, maxN: number): string[] {
  const words = text.toLowerCase().match(/[a-z][a-z0-9.+#]*/g) ?? [];
  const set = new Set<string>();
  for (let n = 1; n <= maxN; n++) {
    for (let i = 0; i <= words.length - n; i++) {
      set.add(words.slice(i, i + n).join(' '));
    }
  }
  return Array.from(set);
}

/**
 * Pool order: user's profile skills FIRST (they're "yours"), then the
 * curated dictionary. Already-added skills are filtered out so we don't
 * suggest dupes.
 */
export function buildSkillPool(
  profileSkills: string[],
  alreadyAdded: string[],
): string[] {
  const taken = new Set(alreadyAdded.map(s => s.toLowerCase().trim()));
  const seen = new Set<string>();
  const out: string[] = [];

  const push = (raw: string) => {
    const k = raw.trim();
    if (!k) return;
    const lower = k.toLowerCase();
    if (taken.has(lower) || seen.has(lower)) return;
    seen.add(lower);
    out.push(k);
  };

  for (const s of profileSkills) push(s);
  for (const s of COMMON_SKILLS_DICTIONARY) push(s);
  return out;
}

// ---------------------------------------------------------------------------
// Custom extractor
// ---------------------------------------------------------------------------

type Candidate = {
  display: string;
  score: number;
  sources: Set<string>;
};

export type ExtractOptions = {
  /**
   * Skills the user already owns (profile + dictionary). Used for canonical
   * naming ("react" → "React") and as a high-confidence Pass A dictionary.
   * Pass `buildSkillPool(profileSkills, [])` to maximise the canonical pool.
   */
  knownSkills?: string[];
  /** Cap the result list. Default 25. */
  maxResults?: number;
  /**
   * Skills already added to the resume — filtered from the final result so we
   * never suggest something the user has.
   */
  exclude?: string[];
};

/**
 * Extract resume-relevant skills from a job description.
 *
 * This is the primary public API for SkillsStep. It runs four passes
 * (known-match, intro-phrase, section-bullet, capitalized-frequency),
 * scores candidates, normalises to canonical names from the dictionary
 * where possible, and returns the top N ranked by score.
 *
 * Pure function. No network. Safe to call on every keystroke (memoise
 * upstream if hot).
 */
export function extractSkillsFromJD(
  jd: string,
  options: ExtractOptions = {},
): string[] {
  if (!jd || jd.trim().length < 50) return [];

  const {
    knownSkills = COMMON_SKILLS_DICTIONARY,
    maxResults = 25,
    exclude = [],
  } = options;

  const knownLookup = new Map<string, string>(); // lower → canonical
  for (const s of knownSkills) {
    const k = s.toLowerCase().trim();
    if (k && !knownLookup.has(k)) knownLookup.set(k, s);
  }
  const excludeLower = new Set(exclude.map(s => s.toLowerCase().trim()));

  const candidates = new Map<string, Candidate>();

  const upsert = (raw: string, points: number, source: string) => {
    const cleaned = cleanCandidate(raw);
    if (!cleaned) return;
    const key = cleaned.toLowerCase();
    if (excludeLower.has(key)) return;

    const canonical = knownLookup.get(key) ?? cleaned;
    const existing = candidates.get(key);
    if (existing) {
      existing.score += points;
      existing.sources.add(source);
      // Always prefer canonical if we discover it later
      if (knownLookup.has(key)) existing.display = canonical;
    } else {
      candidates.set(key, {
        display: canonical,
        score: points,
        sources: new Set([source]),
      });
    }
  };

  // -- Pass A: known-skill match (highest precision) --
  if (knownSkills.length > 0) {
    const matched = matchSkillsToJD(jd, knownSkills);
    for (const m of matched) upsert(m, 6, 'known');
  }

  // -- Pass B: intro-phrase extraction --
  // "experience with X, Y, Z" / "proficient in A and B" / "knowledge of C"
  const introPattern =
    /\b(?:experience(?:d)?|familiar(?:ity)?|proficien[ct]y?|skilled|comfortable|fluent|hands?[\s-]?on|expertise|knowledge|background|competen[ct]y?|adept|versed|literate|understanding|grasp|command|able\s+to\s+work|ability\s+to\s+(?:work|use|build|design|develop|implement|deploy))\s+(?:with|in|of|using|across|on|at)\b\s+/gi;
  let m: RegExpExecArray | null;
  introPattern.lastIndex = 0;
  while ((m = introPattern.exec(jd)) !== null) {
    const start = m.index + m[0].length;
    const after = jd.slice(start, start + 300);
    // Stop at sentence boundaries
    const cutoff = after.search(/[.;!?\n]/);
    const phrase = cutoff > 0 ? after.slice(0, cutoff) : after.slice(0, 200);
    splitItems(phrase).forEach(item => upsert(item, 4, 'intro'));
  }

  // -- Pass C: section-aware bullet parsing --
  // "Requirements:" / "Skills:" / "Tech stack:" headers + bullets after them
  const sectionHeader =
    /(?:^|\n)\s*(?:required\s+(?:skills|qualifications|experience)|preferred\s+(?:skills|qualifications)|qualifications|requirements|key\s+skills|core\s+skills|technical\s+skills|tech\s*stack|technologies|tools(?:\s+(?:&|and)\s+technologies)?|must[\s-]?haves?|nice[\s-]?to[\s-]?haves?|skills?|what\s+you'?ll?\s+(?:bring|need)|what\s+we'?re?\s+looking\s+for|about\s+you)\s*[:：—-]?\s*\n/gi;
  sectionHeader.lastIndex = 0;
  while ((m = sectionHeader.exec(jd)) !== null) {
    const start = m.index + m[0].length;
    const block = jd.slice(start, start + 1800);
    // End on a blank line followed by a non-bullet line (next section)
    const blockEnd = block.search(/\n\s*\n(?=\s*[A-Za-z])/);
    const truncated = blockEnd > 0 ? block.slice(0, blockEnd) : block;

    for (const rawLine of truncated.split('\n')) {
      const line = rawLine
        .replace(/^[\s\-•·*✓✔→▪▫◦‣⁃►▶◇◆◊·\d.\)]+/, '')
        .trim();
      if (!line || line.length < 2) continue;
      // Each bullet line might have multiple skills
      splitItems(line).forEach(item => upsert(item, 3, 'section'));
    }
  }

  // -- Pass D: repeated capitalized phrases --
  // Catches niche tools the dictionary doesn't know — e.g. "Datadog" in
  // "We use Datadog for monitoring. Datadog dashboards…". Requires 2+
  // mentions to filter sentence-starter false positives.
  const capPattern =
    /\b([A-Z][A-Za-z0-9]*(?:[.+#-][A-Za-z0-9]+)*(?:\s+[A-Z][A-Za-z0-9]*(?:[.+#-][A-Za-z0-9]+)*){0,2})\b/g;
  const capCounts = new Map<string, { display: string; count: number }>();
  capPattern.lastIndex = 0;
  while ((m = capPattern.exec(jd)) !== null) {
    const phrase = m[1].trim();
    if (phrase.length < 2 || phrase.length > 35) continue;
    const cleaned = cleanCandidate(phrase);
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    const existing = capCounts.get(key);
    if (existing) existing.count++;
    else capCounts.set(key, { display: cleaned, count: 1 });
  }
  for (const { display, count } of capCounts.values()) {
    if (count < 2) continue; // single-mention proper nouns are too noisy
    // 2 mentions → 2 pts, 3 → 3 pts, etc. (cap at 5)
    upsert(display, Math.min(count, 5), 'capitalized');
  }

  // Final ranking — bonus for being in the canonical dictionary, bonus for
  // showing up via multiple passes (cross-corroboration).
  for (const [key, cand] of candidates) {
    if (knownLookup.has(key)) cand.score += 3;
    if (cand.sources.size >= 2) cand.score += 2;
  }

  return [...candidates.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)
    .map(c => c.display);
}

// Split a phrase like "React, Node.js, and PostgreSQL" or "AWS / GCP / Azure"
// into individual skill candidates.
function splitItems(phrase: string): string[] {
  return phrase
    .split(/,|;|\sand\s|\sor\s|\s\/\s|\s\|\s|·|•/i)
    .map(s => s.trim())
    .filter(Boolean);
}

// Strip JD wrapper words and reject if the result isn't skill-shaped
// (too long, too short, all stop words, blocklisted, etc.).
function cleanCandidate(input: string): string | null {
  let c = input
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/^[\s\-•·*✓✔→▪▫◦‣⁃►\d.\)]+/, '')
    .replace(/[\s,;.\-—:!?\)\(]+$/, '')
    .replace(/^[\s,;.\-—:!?\)\(]+/, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!c) return null;

  // Strip "strong/good/excellent" prefixes — keep the noun
  c = c.replace(
    /^(?:strong|solid|deep|excellent|good|sound|broad|robust|proven|demonstrated|hands?-?on|advanced|basic|working|in-depth)\s+/i,
    '',
  );
  // Strip "skills/experience/knowledge/background" suffixes
  c = c.replace(
    /\s+(?:skills?|experience|knowledge|background|abilities|expertise|fluency|proficien[ct]y)$/i,
    '',
  );
  // Strip "X+ years of" prefix
  c = c.replace(
    /^(?:\d+\+?\s*(?:years?|yrs?)\s*(?:of)?\s*)/i,
    '',
  );
  // Strip leading articles/pronouns/conjunctions left over after splits
  c = c.replace(/^(?:and|or|the|a|an|of|in|with|using|to|for)\s+/i, '');

  c = c.trim();
  if (!c) return null;
  if (c.length < 2 || c.length > 40) return null;

  const lower = c.toLowerCase();
  if (STOP_WORDS.has(lower)) return null;
  if (PHRASE_BLOCKLIST.has(lower)) return null;
  // Reject pure numbers / years
  if (/^\d+\+?$/.test(c)) return null;
  // Reject if it ends with a digit-only token (e.g. "Python 3.10" ok, but
  // "Python 5" likely "5 years of Python" residue — keep tech versions, drop
  // bare "X 5" patterns)
  if (/^\w+\s+\d+$/.test(c) && !/(?:\.|js|jsx|ts|tsx|net)$/i.test(c)) {
    return null;
  }

  const words = c.split(/\s+/);
  if (words.length > 4) return null; // skills are 1-3 words; >4 is prose

  // Reject if the candidate is mostly stop words
  const lowerWords = words.map(w => w.toLowerCase());
  const stopCount = lowerWords.filter(w => STOP_WORDS.has(w)).length;
  if (stopCount === words.length) return null;
  if (words.length === 1 && (lower.length < 2 || /^[a-z]$/.test(lower))) {
    return null;
  }

  return c;
}
