// Job discovery (Phase 0) — turn the saved master profile into a handful of
// job-board SEARCH URLs. Pure client-side, no AI call (the 2-call hot-path
// budget is untouched), no endpoint, no migration, nothing persisted.
//
// We never fetch job data. We build the query and the user's browser does the
// searching, which is what these sites are for: no crawler, no cache, no ToS
// surface, nothing to go stale, nothing to invalidate.
//
// THE ONE RULE: derive on render, every time. Never persist a link. Rebuilding
// is string concatenation, so a profile edit shows up on the next paint with
// nothing to sync. Deliberately NOT wired to the `sourceProfileHash` /
// regenerate-nudge machinery — that exists because regenerating hits the AI.
//
// LinkedIn's recency filter is a RELATIVE window, evaluated at request time, so
// a link built today and clicked in three weeks still returns "the last 7 days"
// counted from that click. Bdjobs carries no recency filter at all (see below),
// so only LinkedIn rows may mention one — and they say "past week", which
// describes the query, not the results.
//
// ── Verified URL contracts (2026-08-19) ──────────────────────────────────────
// LinkedIn   /jobs/search?keywords=<kw>&location=<geo>&f_TPR=<window>
//   · Free-text `location` resolves without an internal geoId. Verified against
//     the logged-out guest endpoint: "Dhaka, Bangladesh" → 47 cards, every one
//     Dhaka; "Chattogram, Bangladesh" → 3 cards, every one Chattogram. So a
//     city geo is safe, not just `location=Bangladesh`.
//   · f_TPR=r604800 = posted in the last 7 days (r86400 = last 24h). Verified
//     narrowing: Accountant/Bangladesh returned 47 cards at r604800 and 5 at
//     r86400.
// Bdjobs     /h/jobs?qOT=&txtsearch=<kw>&lang=<en|bn>
//   · Captured from the site itself. We send exactly this shape and nothing
//     more — no location, no sort, no extra filters. /h/jobs is an Angular SPA
//     and is fussy about its query string; the captured template is the one
//     known-good contract, so we don't decorate it.
//   · The recency filter left open in the issue does exist — `posted`, values
//     1..5 = Today / Last 2..5 days (there is no 7-day option). We deliberately
//     DON'T send it. A job board only lists ads whose deadline hasn't passed,
//     so every Bdjobs result is already "still open", and clamping a niche
//     title to five days mostly returns nothing — an empty search reads as
//     broken. Its sibling `deadline` param selects ads about to CLOSE, which is
//     the opposite of what this wants.
//   · Because no location is sent, a Bdjobs row must never name a city.
//
// ── Quality rules learned from production profiles (2026-08-19) ──────────────
// Running this over every real `experiences.role` in the database is what
// produced the guards below. Before them, 10 of 16 users saw at least one
// nonsense query. Each rule maps to a title that actually exists in the DB:
//   · "Software Engineer II" / "SWE II" / "Software Engineer I" — company
//     LEVEL markers. BD boards have no ads for them, and the ladder produced
//     "Senior Software Engineer II". → normalizeTitle strips levels + expands
//     abbreviations.
//   · "Junior Engineer (Planning)" — a parenthetical went straight into the
//     search box. → normalizeTitle drops parentheticals.
//   · "Director" — the generic ladder emitted "Head of Director". → we no
//     longer invent a rung above a title whose family we don't know.
//   · "adasd" / "fdsa" — placeholder profiles rendered as "Senior adasd" on the
//     dashboard. → isGibberish() gate, reusing the existing detector.
//   · "Database Administrator" matched the office-admin family because token
//     matching had no right-hand word boundary. → tokens are word-anchored, and
//     a trailing "*" is the explicit opt-in to stem matching.

import { isGibberish } from '../../application/validation/gibberishDetector';

// ── Types ────────────────────────────────────────────────────────────────────

export type JobSearchSource = 'linkedin' | 'bdjobs' | 'weworkremotely';

export type JobSearchAngle =
  | 'currentTitle'
  | 'nextTitle'
  | 'adjacentTitle'
  | 'industryCity'
  | 'largeEmployer'
  | 'remoteGlobal'
  | 'topSkill';

/** Employer shapes a BD candidate steps *up* into. Rendered via i18n. */
export type EmployerArchetype =
  | 'bank' | 'mnc' | 'group' | 'ngo' | 'hospital' | 'school' | 'buyingHouse' | 'agency';

export interface JobSearchInput {
  /** Job titles, most recent first (SupabaseProfileRepository orders by start_date DESC). */
  roles: string[];
  /** Profile skills. NOTE: `getSkills()` has no ORDER BY, so this arrives in arbitrary order. */
  skills: string[];
  /**
   * Skills the AI evidenced in the most recent role's `normalized` block. This
   * is the only real signal we have for which skill matters NOW, and it's
   * already loaded with the experiences — no extra round trip.
   */
  evidencedSkills?: string[];
  /** personalInfo.location, free text ("Mirpur, Dhaka" / "Chittagong"). */
  location?: string | null;
  /** Education fields/degrees, most recent first — the fallback when there's no work history. */
  educationFields?: string[];
}

export interface JobSearchCard {
  /** Stable per derived query — changes when the profile changes, which is what we want. */
  id: string;
  angle: JobSearchAngle;
  source: JobSearchSource;
  /** Exactly what goes into the keyword param. */
  query: string;
  /** What the row shows. `employer` set only for the bigger-employer angle. */
  label: { text: string; employer?: EmployerArchetype };
  /** Named only when the query actually filtered on it. */
  city?: string;
  /** Which role family matched, or null when we fell through to the generic path. */
  family: string | null;
  /** No work history yet — flips the "your current title" reason copy. */
  entryLevel: boolean;
  url: string;
}

// ── Bangladesh geography ─────────────────────────────────────────────────────
// Only LinkedIn takes a geo (free-text, verified). Areas inside a metro resolve
// to the metro — LinkedIn has no geo for "Mirpur", it has one for "Dhaka".

interface BdLocation {
  /** Lowercase aliases as users actually type them, incl. pre-2018 spellings. */
  aliases: string[];
  city: string;
}

const BD_LOCATIONS: BdLocation[] = [
  { aliases: ['dhaka', 'mirpur', 'uttara', 'gulshan', 'banani', 'dhanmondi', 'motijheel', 'mohakhali', 'badda', 'bashundhara', 'tejgaon'], city: 'Dhaka' },
  { aliases: ['savar', 'ashulia'], city: 'Savar' },
  { aliases: ['gazipur', 'tongi'], city: 'Gazipur' },
  { aliases: ['narayanganj'], city: 'Narayanganj' },
  { aliases: ['tangail'], city: 'Tangail' },
  { aliases: ['narsingdi'], city: 'Narsingdi' },
  { aliases: ['faridpur'], city: 'Faridpur' },
  { aliases: ['chattogram', 'chittagong', 'ctg'], city: 'Chattogram' },
  { aliases: ["cox's bazar", 'coxs bazar', 'cox bazar'], city: "Cox's Bazar" },
  { aliases: ['cumilla', 'comilla'], city: 'Cumilla' },
  { aliases: ['feni'], city: 'Feni' },
  { aliases: ['noakhali'], city: 'Noakhali' },
  { aliases: ['brahmanbaria'], city: 'Brahmanbaria' },
  { aliases: ['sylhet'], city: 'Sylhet' },
  { aliases: ['moulvibazar', 'maulvibazar'], city: 'Moulvibazar' },
  { aliases: ['habiganj'], city: 'Habiganj' },
  { aliases: ['khulna'], city: 'Khulna' },
  { aliases: ['jashore', 'jessore'], city: 'Jashore' },
  { aliases: ['kushtia'], city: 'Kushtia' },
  { aliases: ['satkhira'], city: 'Satkhira' },
  { aliases: ['rajshahi'], city: 'Rajshahi' },
  { aliases: ['bogura', 'bogra'], city: 'Bogura' },
  { aliases: ['pabna'], city: 'Pabna' },
  { aliases: ['sirajganj'], city: 'Sirajganj' },
  { aliases: ['barishal', 'barisal'], city: 'Barishal' },
  { aliases: ['patuakhali'], city: 'Patuakhali' },
  { aliases: ['rangpur'], city: 'Rangpur' },
  { aliases: ['dinajpur'], city: 'Dinajpur' },
  { aliases: ['mymensingh'], city: 'Mymensingh' },
  { aliases: ['jamalpur'], city: 'Jamalpur' },
];

/**
 * Resolve a free-text profile location to a BD city. Returns null for anything
 * we don't recognise (including overseas), in which case the search widens to
 * Bangladesh rather than guessing a geo.
 */
export function resolveBdLocation(raw?: string | null): { city: string } | null {
  if (typeof raw !== 'string' || !raw) return null;
  const hay = ` ${raw.toLowerCase().replace(/[.,/|–—-]+/g, ' ').replace(/\s+/g, ' ')} `;
  let best: BdLocation | null = null;
  let bestLen = 0;
  for (const loc of BD_LOCATIONS) {
    for (const alias of loc.aliases) {
      // Longest alias wins so "cox's bazar" beats a shorter accidental hit.
      if (alias.length > bestLen && hay.includes(` ${alias} `)) {
        best = loc;
        bestLen = alias.length;
      }
    }
  }
  return best ? { city: best.city } : null;
}

// ── Title normalization ──────────────────────────────────────────────────────

// Takes `unknown` on purpose. Everything here is fed by Supabase rows, and a
// single non-string slipping through used to throw `s.replace is not a
// function` — which, with NO error boundary anywhere in the app, would take the
// whole dashboard down over a job-search tile.
function tidy(s: unknown): string {
  return typeof s === 'string' ? s.replace(/[\s,–—-]+/g, ' ').replace(/\s+/g, ' ').trim() : '';
}

// Only expansions that make a title MORE searchable on a BD job board. Left
// alone deliberately: HR, IT, QA, SQA, AGM, DGM, MTO — BD ads use those forms.
const ABBREVIATIONS: Record<string, string> = {
  swe: 'Software Engineer',
  sde: 'Software Engineer',
  sr: 'Senior',
  jr: 'Junior',
  asst: 'Assistant',
  mgr: 'Manager',
  engr: 'Engineer',
  exec: 'Executive',
  // No `dev: 'Developer'` — it fires mid-title ("Dev Ops Engineer" →
  // "Developer Ops Engineer"), and a bare "Dev" as a whole title is rare enough
  // that the expansion never paid for that risk.
};

/**
 * A job title as the user typed it is not a search query. Company level markers
 * ("II", "L3", "Grade 2"), parentheticals, and internal abbreviations are
 * meaningless to a job board — every one of these came from a real profile.
 */
export function normalizeTitle(raw: string): string {
  let t = ` ${tidy(raw)} `;
  t = t.replace(/\([^)]*\)/g, ' ');                                  // "(Planning)"
  t = t.replace(/\s+(?:level|grade|band|tier)\s*[-–]?\s*[0-9ivx]+\b/gi, ' '); // "Level 3"
  t = t.replace(/\s+[LlGgTt]-?[0-9]{1,2}\b/g, ' ');                  // "L3", "G-2"
  t = t.replace(/\s+(?:i{1,3}|iv|v|vi{1,3}|ix|x)\s*$/i, ' ');        // trailing "II"
  t = t.replace(/\s+[0-9]{1,2}\s*$/, ' ');                           // trailing "2"
  t = tidy(t);
  return t
    .split(' ')
    .map((word) => {
      const key = word.toLowerCase().replace(/\.$/, '');
      return ABBREVIATIONS[key] ?? word;
    })
    .join(' ');
}

// ── Role families ────────────────────────────────────────────────────────────
// Curated the same way COMMON_SKILLS_DICTIONARY is. A family supplies the three
// angles a title alone can't give us — the rung above, a sideways role, and the
// field/employer vocabulary.
//
// ORDER MATTERS: first match wins, so specific families come before broad ones
// and `engineering` (which owns the bare "engineer*" catch-all) is last.
// A token matches as a WHOLE WORD; a trailing "*" opts into stem matching
// ("account*" → accountant/accounts/accounting). Without that boundary
// "admin" swallowed "Database Administrator".

interface RoleFamily {
  id: string;
  match: string[];
  /** The title a fresher in this field actually applies to — used when there's no work history. */
  entry: string;
  /** The rung above a senior individual contributor. */
  manager: string;
  /** The rung above that, so a title that IS the manager title still has somewhere to go. */
  head: string;
  /** Titles they'd qualify for but wouldn't think to search. */
  adjacent: string[];
  /** Field vocabulary for the "your field, near you" angle. */
  industry: string;
  employer: EmployerArchetype;
  /** Keyword paired with the employer archetype in the query. */
  employerQuery: string;
  /**
   * The term to search the global remote market with, when this field HAS a
   * global remote market. Absent = no remote row for this family.
   *
   * Two things were measured on weworkremotely.com on 2026-08-19 (counting real
   * listing links, with a gibberish control returning 0):
   *   1. WHICH fields have inventory — Software Engineer 49, Sales 57,
   *      Marketing 40, Analyst 33, Support 30, Designer 27 … but Accountant 2,
   *      Copywriter 1, Civil Engineer 1, and HR / nursing / merchandising /
   *      supply chain all ZERO. Intuition was wrong twice over, which is why
   *      this is a measured field and not a hunch.
   *   2. That BD titles do NOT map to remote-market titles: "Android Developer"
   *      returns 0 where "Software Engineer" returns 49, for the same person.
   *      So this row deliberately sends the family's canonical remote-market
   *      term, NOT the user's own title — the one row where their own wording
   *      is the wrong query.
   *
   * Sales is deliberately EXCLUDED despite having the most inventory (57):
   * remote sales roles are overwhelmingly territory- and timezone-bound, so a
   * Dhaka candidate mostly cannot be hired into them. Inventory is necessary
   * but not sufficient — the bar is "could this person plausibly get hired".
   * The `family` prop on `job_search_link_clicked` is what will say if that
   * call was wrong.
   */
  remote?: string;
}

const ROLE_FAMILIES: RoleFamily[] = [
  {
    id: 'software',
    // The *Administrator and Principal/Staff Engineer titles live here on
    // purpose — they are IT roles that earlier matched office-admin/teaching.
    match: ['software', 'developer', 'programmer', 'frontend', 'front-end', 'backend', 'back-end', 'full stack', 'fullstack', 'web develop*', 'android', 'ios', 'mobile app', 'flutter', 'devops', 'dev ops', 'sqa', 'qa engineer', 'test engineer', 'computer science', 'cse', 'swe', 'system administrator', 'database administrator', 'network administrator', 'principal engineer', 'staff engineer'],
    entry: 'Junior Software Engineer',
    manager: 'Engineering Manager',
    head: 'Head of Engineering',
    adjacent: ['Technical Lead', 'Solutions Engineer'],
    industry: 'Software Development',
    employer: 'mnc',
    employerQuery: 'Multinational',
    remote: 'Software Engineer',
  },
  {
    id: 'data',
    match: ['data analyst', 'data scientist', 'data engineer', 'business analyst', 'mis', 'analytics', 'power bi', 'reporting officer'],
    entry: 'Junior Data Analyst',
    manager: 'Analytics Manager',
    head: 'Head of Analytics',
    adjacent: ['Business Analyst', 'MIS Officer'],
    industry: 'Data & Analytics',
    employer: 'mnc',
    employerQuery: 'Multinational',
    remote: 'Analyst',
  },
  {
    id: 'creditrisk',
    match: ['credit analyst', 'credit risk', 'credit officer', 'credit administration', 'risk analyst', 'risk management', 'underwrit*', 'portfolio manage*', 'investment analyst', 'equity research'],
    entry: 'Credit Analyst',
    manager: 'Credit Risk Manager',
    head: 'Head of Credit Risk',
    adjacent: ['Risk Analyst', 'Investment Analyst'],
    industry: 'Credit & Risk',
    employer: 'bank',
    employerQuery: 'Bank',
  },
  {
    id: 'accounting',
    match: ['account*', 'audit*', 'bookkeep*', 'financ*', 'tax', 'costing', 'treasury', 'reconciliation', 'icab', 'acca', 'cma'],
    entry: 'Junior Accountant',
    manager: 'Accounts Manager',
    head: 'Head of Finance',
    adjacent: ['Internal Auditor', 'Finance Executive'],
    industry: 'Accounts & Finance',
    employer: 'bank',
    employerQuery: 'Bank',
  },
  {
    id: 'banking',
    match: ['bank*', 'relationship officer', 'branch', 'teller', 'loan', 'nbfi', 'microfinance', 'mfi'],
    entry: 'Management Trainee Officer',
    manager: 'Branch Manager',
    head: 'Regional Manager',
    adjacent: ['Credit Analyst', 'Relationship Manager'],
    industry: 'Banking',
    employer: 'mnc',
    employerQuery: 'Multinational',
  },
  {
    id: 'merchandising',
    match: ['merchandis*', 'garment*', 'textile', 'rmg', 'apparel', 'knitting', 'dyeing', 'sewing', 'industrial engineer', 'work study', 'quality control', 'qc', 'sourcing'],
    entry: 'Junior Merchandiser',
    manager: 'Merchandising Manager',
    head: 'Head of Merchandising',
    adjacent: ['Sourcing Executive', 'Production Planner'],
    industry: 'Garments & Textile',
    employer: 'buyingHouse',
    employerQuery: 'Buying House',
  },
  {
    id: 'nursing',
    match: ['nurse', 'nursing', 'midwife', 'ward'],
    entry: 'Staff Nurse',
    manager: 'Nursing Supervisor',
    head: 'Nursing Superintendent',
    adjacent: ['Clinical Instructor', 'Community Health Worker'],
    industry: 'Nursing',
    employer: 'hospital',
    employerQuery: 'Hospital',
  },
  {
    id: 'medical',
    match: ['doctor', 'medical officer', 'physician', 'mbbs', 'pharmac*', 'physiotherap*', 'lab technician', 'medical technologist', 'paramedic', 'clinical', 'public health'],
    entry: 'Medical Officer',
    manager: 'Senior Medical Officer',
    head: 'Consultant',
    adjacent: ['Clinical Research Associate', 'Medical Information Officer'],
    industry: 'Healthcare',
    employer: 'hospital',
    employerQuery: 'Hospital',
  },
  {
    id: 'teaching',
    // Bare "principal" is NOT here — it matched "Principal Engineer". A school
    // principal is caught by headmaster / school principal / the rest.
    match: ['teacher', 'teaching', 'lecturer', 'instructor', 'tutor', 'faculty', 'academic*', 'curriculum', 'education*', 'headmaster', 'school principal', 'vice principal'],
    entry: 'Assistant Teacher',
    manager: 'Head of Department',
    head: 'Academic Director',
    adjacent: ['Curriculum Developer', 'Academic Coordinator'],
    industry: 'Education',
    employer: 'school',
    employerQuery: 'International School',
  },
  {
    id: 'ngo',
    // "monitoring" alone matched "Condition Monitoring Engineer".
    match: ['ngo', 'programme officer', 'program officer', 'project officer', 'field officer', 'monitoring officer', 'm&e', 'meal', 'humanitarian', 'community mobiliz*', 'social work', 'development studies'],
    entry: 'Project Officer',
    manager: 'Programme Manager',
    head: 'Head of Programmes',
    adjacent: ['Monitoring & Evaluation Officer', 'Project Coordinator'],
    industry: 'Development & NGO',
    employer: 'ngo',
    employerQuery: 'INGO',
  },
  {
    id: 'legal',
    match: ['legal', 'lawyer', 'advocate', 'compliance officer', 'company secretary', 'paralegal', 'llb'],
    entry: 'Legal Officer',
    manager: 'Legal Manager',
    head: 'Head of Legal',
    adjacent: ['Compliance Officer', 'Company Secretary'],
    industry: 'Legal & Compliance',
    employer: 'group',
    employerQuery: 'Group of Companies',
  },
  {
    id: 'design',
    match: ['graphic design*', 'ui/ux', 'ui ux', 'ux design*', 'ui design*', 'product design*', 'motion', 'illustrator', 'video edit*', 'creative'],
    entry: 'Junior Graphic Designer',
    manager: 'Design Lead',
    head: 'Head of Design',
    adjacent: ['Product Designer', 'Motion Designer'],
    industry: 'Design',
    employer: 'agency',
    employerQuery: 'Agency',
    remote: 'Designer',
  },
  {
    id: 'media',
    match: ['journalist', 'content writer', 'copywriter', 'editor', 'reporter', 'producer', 'photograph*', 'media'],
    entry: 'Content Writer',
    manager: 'Content Manager',
    head: 'Head of Content',
    adjacent: ['Content Strategist', 'Communications Officer'],
    industry: 'Media & Content',
    employer: 'agency',
    employerQuery: 'Agency',
  },
  {
    id: 'marketing',
    match: ['marketing', 'brand*', 'seo', 'social media', 'communications', 'pr'],
    entry: 'Marketing Executive',
    manager: 'Marketing Manager',
    head: 'Head of Marketing',
    adjacent: ['Brand Executive', 'Digital Marketing Executive'],
    industry: 'Marketing',
    employer: 'group',
    employerQuery: 'Group of Companies',
    // NOT the bare "Marketing" (40 listings) — that is this family's `industry`
    // too, so both tiles rendered the same headline. 29 listings, measured.
    remote: 'Marketing Manager',
  },
  {
    id: 'sales',
    match: ['sales', 'business dev*', 'key account', 'territory', 'distribution', 'retail officer'],
    entry: 'Sales Executive',
    manager: 'Sales Manager',
    head: 'Head of Sales',
    adjacent: ['Key Account Manager', 'Business Development Executive'],
    industry: 'Sales',
    employer: 'group',
    employerQuery: 'Group of Companies',
  },
  {
    id: 'hr',
    match: ['hr', 'human resource*', 'recruit*', 'talent acquisition', 'payroll'],
    entry: 'HR Executive',
    manager: 'HR Manager',
    head: 'Head of HR',
    adjacent: ['Talent Acquisition Executive', 'HR & Admin Officer'],
    industry: 'Human Resources',
    employer: 'group',
    employerQuery: 'Group of Companies',
  },
  {
    id: 'supplychain',
    match: ['supply chain', 'procurement', 'logistics', 'warehouse', 'inventory', 'store officer', 'purchase', 'import', 'export', 'commercial officer'],
    entry: 'Supply Chain Officer',
    manager: 'Supply Chain Manager',
    head: 'Head of Supply Chain',
    adjacent: ['Procurement Officer', 'Logistics Coordinator'],
    industry: 'Supply Chain',
    employer: 'group',
    employerQuery: 'Group of Companies',
  },
  {
    id: 'support',
    match: ['customer service', 'customer support', 'call center', 'call centre', 'csr', 'help desk', 'client service', 'customer care'],
    entry: 'Customer Service Executive',
    manager: 'Customer Service Manager',
    head: 'Head of Customer Experience',
    adjacent: ['Client Relationship Executive', 'Technical Support Executive'],
    industry: 'Customer Service',
    employer: 'mnc',
    employerQuery: 'Multinational',
    remote: 'Customer Support',
  },
  {
    id: 'admin',
    match: ['admin', 'administrative', 'administration', 'administrator', 'office manager', 'executive assistant', 'secretary', 'front desk', 'receptionist'],
    entry: 'Admin Officer',
    manager: 'Admin Manager',
    head: 'Head of Administration',
    adjacent: ['Executive Assistant', 'Office Coordinator'],
    industry: 'Administration',
    employer: 'group',
    employerQuery: 'Group of Companies',
  },
  {
    id: 'engineering',
    // Last on purpose: it owns the bare "engineer*" catch-all, so every more
    // specific engineering discipline above gets first refusal.
    match: ['civil engineer*', 'site engineer*', 'mechanical', 'electrical', 'structural', 'autocad', 'construction', 'maintenance engineer*', 'production engineer*', 'quantity surveyor', 'engineering', 'engineer*'],
    entry: 'Graduate Engineer',
    manager: 'Project Manager',
    head: 'Head of Projects',
    adjacent: ['Project Engineer', 'Quantity Surveyor'],
    industry: 'Engineering & Construction',
    employer: 'group',
    employerQuery: 'Group of Companies',
  },
];

/** The employer archetype used when no family matched — universally meaningful in BD. */
const DEFAULT_EMPLOYER: { employer: EmployerArchetype; query: string } = { employer: 'mnc', query: 'Multinational' };

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * One anchored alternation per family. Both ends are word-boundaried; a trailing
 * "*" on a token allows the word to keep growing ("financ*" → financial) while
 * everything else must match whole ("admin" ≠ administrator).
 */
const FAMILY_MATCHERS: { family: RoleFamily; re: RegExp }[] = ROLE_FAMILIES.map((family) => {
  const parts = family.match.map((token) => {
    const stem = token.endsWith('*');
    const body = escapeRe(stem ? token.slice(0, -1) : token).replace(/\\?\s+/g, '\\s+');
    return stem ? `${body}[a-z]*` : body;
  });
  return { family, re: new RegExp(`(?:^|[^a-z0-9])(?:${parts.join('|')})(?![a-z0-9])`, 'i') };
});

function findFamily(text: string): RoleFamily | null {
  if (!text) return null;
  for (const { family, re } of FAMILY_MATCHERS) {
    if (re.test(text)) return family;
  }
  return null;
}

// ── Seniority ────────────────────────────────────────────────────────────────
// Ranks, low → high. Compound BD titles ("Assistant Manager", "Senior Manager")
// are matched before their parts so they don't collapse to the wrong rung.

const SENIORITY_RULES: { re: RegExp; rank: number }[] = [
  { re: /\b(?:senior|sr\.?)\s+(?:manager|director|general\s+manager)\b/i, rank: 6 },
  { re: /\b(?:assistant|asst\.?|deputy|sub[- ]?assistant)\s+(?:manager|director|general\s+manager)\b/i, rank: 4 },
  { re: /\b(?:head\s+of|chief|vice\s+president|vp|director|general\s+manager|gm|agm|dgm|principal)\b/i, rank: 6 },
  { re: /\bmanager\b/i, rank: 5 },
  { re: /\b(?:lead|team\s+lead|staff|supervisor|in[- ]charge|incharge|coordinator)\b/i, rank: 4 },
  { re: /\b(?:senior|sr\.?)\b/i, rank: 3 },
  { re: /\b(?:junior|jr\.?|associate|assistant|entry[- ]level|graduate|management\s+trainee|mto)\b/i, rank: 1 },
  { re: /\b(?:intern|internship|trainee|apprentice|fresher)\b/i, rank: 0 },
];

const SENIORITY_STRIP = /\b(?:senior|sr\.?|junior|jr\.?|associate|assistant|asst\.?|deputy|lead|principal|chief|head\s+of|entry[- ]level|graduate|intern|internship|trainee|apprentice|fresher|mto|management\s+trainee)\b/gi;

function seniorityOf(title: string): number {
  for (const rule of SENIORITY_RULES) {
    if (rule.re.test(title)) return rule.rank;
  }
  return 2; // plain individual contributor
}

/** "Senior Software Engineer" → "Software Engineer". Never returns empty. */
function baseTitleOf(title: string): string {
  return tidy(title.replace(SENIORITY_STRIP, ' ')) || tidy(title);
}

/**
 * One rung up, or null when we genuinely don't know.
 *
 * Ranks 0–2 move by prefix, which is safe for any title — "Senior X" is always
 * a real thing. From senior upward the answer depends on the field, so we ask
 * the family. WITHOUT a family we return null rather than guess: the generic
 * fallback used to emit "Head of Director" and "Executive Manager", which are
 * not jobs. A missing row beats a fabricated one.
 */
function nextTitleOf(title: string, family: RoleFamily | null): string | null {
  const rank = seniorityOf(title);
  const current = tidy(title).toLowerCase();
  // "Intern" / "Principal" alone carry no role to promote — only a family knows
  // where such a person goes, and which direction.
  const bare = tidy(title.replace(SENIORITY_STRIP, ' ')) === '';
  const base = baseTitleOf(title);
  let next: string | null;

  if (bare) next = rank <= 1 ? family?.entry ?? null : family?.head ?? null;
  else if (rank <= 0) next = `Junior ${base}`;
  else if (rank === 1) next = base;
  else if (rank === 2) next = `Senior ${base}`;
  else if (!family) next = null;
  else next = rank >= 6 ? family.head : family.manager;

  if (!next) return null;
  // They already hold the rung we picked — reach for the one above it.
  if (tidy(next).toLowerCase() === current) next = family?.head ?? null;
  if (!next) return null;

  next = tidy(next);
  return !next || next.toLowerCase() === current ? null : next;
}

// ── Skills ───────────────────────────────────────────────────────────────────
// A standalone soft-skill keyword is a useless search — every ad in the country
// says "good communication". These are dropped when picking one to search on;
// they stay on the résumé, they just don't become a query.

const UNSEARCHABLE_SKILLS = new Set([
  'communication', 'communications', 'teamwork', 'team work', 'leadership',
  'time management', 'problem solving', 'critical thinking', 'adaptability',
  'creativity', 'hard working', 'hardworking', 'punctuality', 'multitasking',
  'attention to detail', 'decision making', 'work ethic', 'self motivated',
  'fast learner', 'interpersonal skills', 'presentation skills', 'empathy',
  'organization', 'organisation', 'organizational skills', 'flexibility',
  'computer skills', 'typing', 'internet browsing', 'email', 'ms office',
  'microsoft office', 'english', 'bangla', 'bengali', 'writing', 'reading',
  'teaching', 'management', 'collaboration', 'positive attitude', 'honesty',
]);

/**
 * Pick the skill worth searching on.
 *
 * We do NOT claim it's their "strongest" — `getSkills()` has no ORDER BY, so
 * list position carries no meaning whatsoever. What we do have is
 * `normalized.skills` on the most recent experience: skills the normalizer
 * evidenced from the work they actually described. Those go first; everything
 * else keeps its arbitrary order behind them.
 */
function skillToSearch(skills: string[], evidenced: string[], title: string): string | null {
  const evidencedSet = new Set(evidenced.map((s) => tidy(s ?? '').toLowerCase()).filter(Boolean));
  const titleLower = title.toLowerCase();

  const usable = (raw: string): string | null => {
    const skill = tidy(raw ?? '');
    if (skill.length < 2 || skill.length > 40) return null;
    const lower = skill.toLowerCase();
    if (UNSEARCHABLE_SKILLS.has(lower)) return null;
    if (isGibberish(skill)) return null;
    // Already covered by the title angle — searching it adds nothing.
    if (titleLower.includes(lower) || lower.includes(titleLower)) return null;
    return skill;
  };

  const ranked = [...skills].sort((a, b) => {
    const aEv = evidencedSet.has(tidy(a ?? '').toLowerCase()) ? 0 : 1;
    const bEv = evidencedSet.has(tidy(b ?? '').toLowerCase()) ? 0 : 1;
    return aEv - bEv;
  });

  for (const raw of ranked) {
    const skill = usable(raw);
    if (skill) return skill;
  }
  return null;
}

// ── URL builders ─────────────────────────────────────────────────────────────

/** Posted in the last 7 days. Relative — LinkedIn evaluates it at request time. */
export const LINKEDIN_PAST_WEEK = 'r604800';

// encodeURIComponent, not URLSearchParams: the latter writes spaces as "+",
// and the templates that were verified live use "%20". Same meaning to a
// standards-compliant parser, but these are two specific sites and the encoding
// that was actually tested is the one we ship.
const enc = encodeURIComponent;

export function buildLinkedInUrl(keywords: string, geo: string): string {
  return `https://www.linkedin.com/jobs/search?keywords=${enc(keywords)}&location=${enc(geo)}&f_TPR=${LINKEDIN_PAST_WEEK}`;
}

export function buildBdjobsUrl(keywords: string, locale: 'en' | 'bn'): string {
  return `https://bdjobs.com/h/jobs?qOT=&txtsearch=${enc(keywords)}&lang=${locale === 'bn' ? 'bn' : 'en'}`;
}

// Verified 2026-08-19: server-rendered, and it genuinely filters — counting real
// listing links, "Software Engineer" returned 49, "Accountant" 2, and a gibberish
// control 0. No location or recency parameter exists, so a remote row claims
// neither. The rest of the BD/global portal field was checked the same way and
// none of it survived: chakri.com is down (523 twice), jagojobs' `term=` returns
// a byte-identical page for a real query and for gibberish, bdjobstoday's
// `KEYWORDS=` returns a no-results page for everything, bikroy strips any
// keyword param and 301s to /jobs, skill.jobs exposes no GET search route, and
// Kormo / Everjobs / Indeed BD no longer exist at all.
export function buildWeWorkRemotelyUrl(keywords: string): string {
  return `https://weworkremotely.com/remote-jobs/search?term=${enc(keywords)}`;
}

// ── Derivation ───────────────────────────────────────────────────────────────

/** Below this the set isn't worth a section — we show nothing rather than filler. */
export const MIN_JOB_SEARCH_CARDS = 3;

/**
 * Profile in, search URLs out. Pure — call it on every render; never cache the
 * result, never write it to the database.
 */
export function deriveJobSearches(input: JobSearchInput, locale: 'en' | 'bn'): JobSearchCard[] {
  const roles = (input.roles ?? []).map((r) => normalizeTitle(r ?? '')).filter(Boolean);
  const fields = (input.educationFields ?? []).map((f) => tidy(f ?? '')).filter(Boolean);
  const entryLevel = roles.length === 0;

  // No work history → the field of study stands in for the title, at the rung a
  // fresher in that field actually applies to. "Accounting" is a subject, not a
  // job ad; "Junior Accountant" is what Bdjobs has listings for.
  const family = findFamily(roles[0] ?? fields[0] ?? '');
  const title = roles[0] ?? family?.entry ?? (fields[0] ? `Junior ${fields[0]}` : '');

  // A placeholder profile ("adasd") must not become "Senior adasd" on the
  // dashboard. The detector already exists and is used on the generation path.
  if (!title || !/\p{L}{2}/u.test(title) || isGibberish(title)) return [];

  const base = baseTitleOf(title);
  const geo = resolveBdLocation(input.location);
  const linkedInGeo = geo ? `${geo.city}, Bangladesh` : 'Bangladesh';

  const cards: JobSearchCard[] = [];
  const seenQuery = new Set<string>();
  const seenLabel = new Set<string>();

  const push = (
    angle: JobSearchAngle,
    source: JobSearchSource,
    query: string,
    label: JobSearchCard['label'],
    opts?: { cityScoped?: boolean },
  ) => {
    const q = tidy(query);
    if (!q || !/\p{L}/u.test(q) || isGibberish(q)) return;
    const queryKey = `${source}|${q.toLowerCase()}`;
    // Same headline = same tile to the user, whatever board it points at.
    // EXCEPT the remote row: it is the only angle that changes the MARKET
    // rather than the role, so "Software Engineer" appearing once for
    // Bangladesh and once for the world is the feature working, not a repeat —
    // and the solid saffron globe plus a different board make it unmistakable.
    // Without this exemption the row vanished for plain "Software Engineer",
    // the most common title in the database and the exact person it is for.
    const labelKey = `${label.text.toLowerCase()}|${label.employer ?? ''}`;
    const labelDupe = angle !== 'remoteGlobal' && seenLabel.has(labelKey);
    if (seenQuery.has(queryKey) || labelDupe) return;
    seenQuery.add(queryKey);
    seenLabel.add(labelKey);
    const cityScoped = source === 'linkedin' && opts?.cityScoped === true;
    const url =
      source === 'linkedin' ? buildLinkedInUrl(q, cityScoped ? linkedInGeo : 'Bangladesh')
      : source === 'weworkremotely' ? buildWeWorkRemotelyUrl(q)
      : buildBdjobsUrl(q, locale);
    cards.push({
      id: `${source}|${angle}|${q.toLowerCase()}`,
      angle,
      source,
      query: q,
      label,
      // A row only names a place when the query actually filtered on one.
      city: cityScoped ? geo?.city : undefined,
      family: family?.id ?? null,
      entryLevel,
      url,
    });
  };

  // 1 — the title they hold right now (or the one a fresher in their field applies to).
  push('currentTitle', 'bdjobs', title, { text: title });

  // 2 — the rung above it, when we can name it honestly.
  const next = nextTitleOf(title, family);
  if (next) push('nextTitle', 'bdjobs', next, { text: next });

  // 3 — sideways: qualified for it, would never have searched it. The most
  //     differentiated angle here, and the one that needs a family.
  if (family) {
    const baseLower = base.toLowerCase();
    const adjacent = family.adjacent.find(
      (a) => !baseLower.includes(a.toLowerCase()) && !a.toLowerCase().includes(baseLower),
    );
    if (adjacent) push('adjacentTitle', 'bdjobs', adjacent, { text: adjacent });
  }

  // 4 — the whole field, close to home. The only city-scoped row, and only when
  //     the field term says something the title didn't (otherwise it was just
  //     the same query wearing a different label).
  if (family && family.industry.toLowerCase() !== base.toLowerCase()) {
    push('industryCity', 'linkedin', family.industry, { text: family.industry }, { cityScoped: true });
  }

  // 5 — the same work at a bigger employer. Nationwide on purpose: that's where
  //     the bigger employers are.
  const employer = family ? { employer: family.employer, query: family.employerQuery } : DEFAULT_EMPLOYER;
  push('largeEmployer', 'linkedin', `${base} ${employer.query}`, { text: base, employer: employer.employer });

  // 6 — the market that isn't in Bangladesh at all. Only for fields that
  //     actually hire remotely worldwide (see RoleFamily.remote), searched with
  //     that field's remote-market term rather than the user's BD title.
  if (family?.remote) {
    push('remoteGlobal', 'weworkremotely', family.remote, { text: family.remote });
  }

  // 7 — a skill worth searching on. Nationwide: skill × city × past-week is the
  //     narrowest query of the set and the one most likely to return nothing.
  const skill = skillToSearch(input.skills ?? [], input.evidencedSkills ?? [], title);
  if (skill) push('topSkill', 'linkedin', skill, { text: skill });

  return cards;
}

/**
 * True when the profile carries enough to build a set worth showing. Gates
 * VISIBILITY only. Job discovery is deliberately NOT gated on credit balance —
 * finding a job is what creates demand for a credit, so putting it behind the
 * purchase would invert the funnel.
 */
export function canDeriveJobSearches(input: JobSearchInput): boolean {
  return deriveJobSearches(input, 'en').length >= MIN_JOB_SEARCH_CARDS;
}

// ── Visited state + click attribution (localStorage) ─────────────────────────
// Nothing here is job data — only "did this browser open this search, and
// when". The visited key embeds the query, so editing the profile resets a
// row's state, which is right: it is a different search now.

const VISITS_KEY = 'topcandidate.jobSearchVisits';
const LAST_CLICK_KEY = 'topcandidate.jobSearchLastClick';
/** How long a search click stays credited for a subsequent paste. */
const ATTRIBUTION_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Keep the map from growing without bound as a profile changes over months. */
const MAX_VISITS = 40;

export type VisitMap = Record<string, string>;

export function readVisits(): VisitMap {
  try {
    const raw = localStorage.getItem(VISITS_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? (parsed as VisitMap) : {};
  } catch {
    return {};
  }
}

export function recordVisit(id: string): VisitMap {
  const visits = readVisits();
  visits[id] = new Date().toISOString();
  const entries = Object.entries(visits).sort((a, b) => b[1].localeCompare(a[1])).slice(0, MAX_VISITS);
  const trimmed = Object.fromEntries(entries) as VisitMap;
  try {
    localStorage.setItem(VISITS_KEY, JSON.stringify(trimmed));
  } catch {
    /* private mode — the rows just stay unvisited */
  }
  return trimmed;
}

export interface SearchClick {
  angle: JobSearchAngle;
  source: JobSearchSource;
  at: string;
}

export function recordSearchClick(card: JobSearchCard): void {
  try {
    const click: SearchClick = { angle: card.angle, source: card.source, at: new Date().toISOString() };
    localStorage.setItem(LAST_CLICK_KEY, JSON.stringify(click));
  } catch {
    /* ignore */
  }
}

/**
 * Read and clear the pending search click, if one happened recently enough to
 * have plausibly produced the JD now being pasted. Clearing is what keeps the
 * conversion event firing once per click instead of once per generation.
 */
export function consumeSearchClick(): SearchClick | null {
  try {
    const raw = localStorage.getItem(LAST_CLICK_KEY);
    if (!raw) return null;
    localStorage.removeItem(LAST_CLICK_KEY);
    const click = JSON.parse(raw) as SearchClick;
    if (!click?.at) return null;
    const age = Date.now() - new Date(click.at).getTime();
    if (!Number.isFinite(age) || age < 0 || age > ATTRIBUTION_WINDOW_MS) return null;
    return click;
  } catch {
    return null;
  }
}
