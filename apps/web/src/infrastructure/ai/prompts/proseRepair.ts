// Deterministic prose surgery for the résumé + toolkit post-pipelines.
//
// Why this exists: the honesty guards used to THROW, which re-ran the whole
// generation on another model — up to the 50s deadline — and then failed with a
// refund (or, in the toolkit, discarded a whole cover letter and showed a retry
// button). For a user that is the worst possible experience: a long wait, then
// an error, for a document that was 98% fine. These helpers repair the one bad
// term in place instead, so generation completes on its first good response.
//
// The repair is deliberately small and grammatical:
//   "Hands-on with state management, local persistence, and CI/CD pipelines."
//     -> "Hands-on with state management and local persistence."
//   "testing frameworks like XCTest and Maestro" -> "testing frameworks like Maestro"
// When a term is not inside a clean list there is NO word-level fix — earlier
// versions cut prepositional phrases and single words, and every such rule
// garbled some phrasing ("Deployed it", "specializing in."). Callers instead
// drop the whole unit (high-confidence terms) or leave it alone (heuristic
// detections); the optimizer replaces an unrepairable summary opener with a
// deterministic positioning line.

import { AMBIGUOUS_WITH_ENGLISH, escapeExact, detectFabricatedTokens, guardEvidence, type FabricationGuardOptions } from './toolkitContext.js';
import type { ResumeData } from '../../../domain/entities/Resume.js';

// Generic nouns that ride along with a removed term ("CI/CD pipelines",
// "fintech domains") and would dangle without it.
// Two kinds of noun can follow a removed term. A TECH noun belongs to that one
// item ("…, and CI/CD pipelines") and goes with it. A GROUP noun belongs to the
// whole list ("banking, insurance and fintech clients") and must stay.
const TECH_NOUN = String.raw`pipelines?|frameworks?|tools?|tooling|platforms?|environments?|stacks?|practices?`;
const GROUP_NOUN = String.raw`domains?|sectors?|industr(?:y|ies)|clients?|customers?|companies|firms?|organizations?|businesses|projects?`;
const TRAILING_NOUN = String.raw`(?:\s+(?:${TECH_NOUN}|${GROUP_NOUN}))?`;

// Words that open a list. The list a term belongs to starts after the last of
// these before it (or at the sentence start).
const LIST_OPENER = /\b(?:with|in|of|across|using|like|including|such as|on|via|for|from|through|about|at|around|into|over|under|to)\s+|:\s+/gi;

// One regex-escape helper for the AI layer (toolkitContext owns it).
export const escapeRe = escapeExact;

// Tech names that are also everyday English words: matched case-sensitively so
// a stripped "Go" never touches "go live" nor "Swift" a "swift turnaround".
// Everything else is case-insensitive, so "docker" / "kubernetes" written in
// lowercase are still caught.
const ENGLISH_WORD_NAMES = new Set([
  'go', 'swift', 'react', 'spring', 'rust', 'dart', 'ruby', 'express', 'ember', 'elm', 'julia', 'chef',
  'puppet', 'salt', 'ant', 'hive', 'pig', 'spark', 'unity', 'swing', 'rails', 'flask', 'gin', 'echo',
  'nest', 'next', 'vue', 'mint', 'arch', 'bash', 'shell', 'storm', 'beam', 'prism', 'jest', 'mocha',
]);

// Uses the fabrication detector's own case-sensitive list (AMBIGUOUS_WITH_
// ENGLISH: docker, react, angular…) plus ENGLISH_WORD_NAMES. Repair is
// deliberately STRICTER than detection for these names — case-sensitive for
// all of them and never at a sentence start (AMBIGUOUS_BEFORE) — so a flagged
// "Docker" never deletes "a docker" (dock worker) and "Go" never deletes "go
// live". Where repair declines, the text is left as it was and the caller's
// gate applies exactly as before this repair existed.
/** Regex flags matching how the fabrication detector reads a term (exported so
 *  a last-resort removal never deletes the English word in "react to"). */
export function flagsFor(term: string): string {
  return isAmbiguous(term) ? '' : 'i';
}

/** A removable adjective: used BEFORE a noun right after a determiner, never
 *  predicatively ("made the sync robust against…"), not in a coordinated pair
 *  ("robust and scalable"), and not before a term-of-art head
 *  ("high-performance computing"). Shared by the optimizer's filler strip and the normalizer's
 *  inflation repair so the two stages agree. */
export function prenominal(word: string, flags = 'g'): RegExp {
  // Only right after a determiner ("a scalable API", "the robust sync"). Not
  // after a preposition — "in enterprise settings" / "with real-time updates"
  // are fixed phrases that read wrong without it — and not after "and"/","
  // (the second half of "a robust and scalable API").
  // After a verb or noun ("to be scalable using…", "made the sync robust
  // using…") it is a predicate, and deleting it breaks the sentence.
  // Determiner in either case ("An enterprise app" at a sentence start); the
  // adjective itself stays case-sensitive so Title-Case names are untouched.
  const dets = ['a', 'an', 'the', 'its', 'their', 'our', 'his', 'her', 'this', 'these', 'those']
    .map((d) => `[${d[0]}${d[0].toUpperCase()}]${d.slice(1)}`).join('|');
  const after = `(?<=\\b(?:${dets})\\s)`;
  const notNext = '(?!(?:as|across|and|or|to|for|in|on|with|at|by|from|of|against|while|when|under|over|through|throughout|during|than|but|so|using|enough|via|within|into|between|without|per|after|before|until|since|computing|messaging|resource)\\b)(?=[A-Za-z])';
  return new RegExp(`${after}\\b${word},?\\s+${notNext}`, flags);
}

// Word edges that also respect dotted names: "React" must not match inside
// "React.js", nor "js" inside "Node.js".
const EDGE_BEFORE = '(?<![A-Za-z0-9])(?<![A-Za-z0-9]\\.)';
const EDGE_AFTER = '(?![A-Za-z0-9])(?!\\.[A-Za-z0-9])';

function isAmbiguous(term: string): boolean {
  const lc = term.trim().toLowerCase();
  return ENGLISH_WORD_NAMES.has(lc) || AMBIGUOUS_WITH_ENGLISH.has(lc);
}

// For names that are also English words: never at a sentence start ("Go live
// soon.") and never as the head of a compound ("Go-to-market").
const AMBIGUOUS_BEFORE = '(?<=[^.!?\\s]\\s)';
const AMBIGUOUS_AFTER = '(?!-[A-Za-z])';

function edges(term: string): [string, string] {
  return isAmbiguous(term) ? [EDGE_BEFORE + AMBIGUOUS_BEFORE, EDGE_AFTER + AMBIGUOUS_AFTER] : [EDGE_BEFORE, EDGE_AFTER];
}

export function termRegex(term: string): RegExp {
  const [before, after] = edges(term);
  return new RegExp(`${before}${escapeRe(term.trim())}${TRAILING_NOUN}${after}`, flagsFor(term));
}


function rebuildList(items: string[], conj: string | null, oxford: boolean): string {
  if (items.length === 1) return items[0];
  if (!conj) return items.join(', ');
  if (items.length === 2) return `${items[0]} ${conj} ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}${oxford ? ',' : ''} ${conj} ${items[items.length - 1]}`;
}

/**
 * Remove `term` from the list it sits in. Returns the repaired sentence, the
 * sentence unchanged when the term is absent, or null when no SAFE fix exists.
 *
 * Deliberately strict. A list is only edited when it parses as plain items —
 * each 1–3 words, starting with a letter, no digits-first, no parentheses, no
 * preposition inside — joined by commas and a final "and"/"or", and the term
 * is exactly one whole item (optionally with its generic noun). Anything else
 * ("12,000 merchants", "AWS (EC2, S3)", "deployed it on AWS, and cut…") is
 * not touched by list surgery: leaving a sentence alone is always safe; a
 * garbled one never is. Callers then apply their drop/keep rules.
 */
const STOP = '(?:for|to|into|on|in|with|across|by|from|that|which|while|and|or|of|at|as)';
// A period only INSIDE a word (Node.js, B.Sc), never the sentence's full stop.
const WORD = `(?!${STOP}\\b)[A-Za-z](?:[\\w+#/&-]|\\.(?=\\w))*`;
const ITEM = `${WORD}(?:\\s+${WORD}){0,2}`;
const LIST_RE = new RegExp(`^(${ITEM}(?:,\\s+${ITEM})*)(?:(,?)\\s+(and|or)\\s+(${ITEM}))?`);

export function scrubTerm(sentence: string, term: string): string | null {
  const re = termRegex(term);
  const m = re.exec(sentence);
  if (!m) return sentence;

  // Where the list starts: after the last opener before the term; else after
  // the verb ("Integrated Stripe, …") or "I/We <verb>"; a list at the very
  // start is the sentence's subject.
  let start = 0;
  LIST_OPENER.lastIndex = 0;
  for (let o = LIST_OPENER.exec(sentence); o && o.index < m.index; o = LIST_OPENER.exec(sentence)) {
    start = o.index + o[0].length;
  }
  let subjectList = false;
  if (start === 0) {
    const verb = /^(?:(?:I|We|They|He|She)\s+)?[A-Za-z][\w-]*\s+/.exec(sentence);
    if (verb && m.index >= verb[0].length) start = verb[0].length;
    else subjectList = true;
  }

  const rest = sentence.slice(start);
  const lm = LIST_RE.exec(rest);
  if (!lm) return null;
  const head = lm[1].split(/,\s+/);
  // No final "and"/"or" means comma-joined clauses, not a list.
  if (!lm[4]) return null;
  const items = [...head, lm[4]];
  const conj = lm[3] ?? null;
  const oxford = lm[2] === ',';
  // A real two-item list takes no comma; "X, and Y" is two clauses.
  if (items.length === 2 && oxford) return null;
  // A real pair's halves look alike — both names ("Docker and Kubernetes") or
  // both common words ("banking and insurance"). "Kubernetes and ship weekly"
  // is a name joined to a verb phrase: two clauses.
  if (items.length === 2) {
    const kind = (it: string) => /^[A-Z]/.test(it.trim()) || /[A-Z]/.test(it.trim().slice(1, 3)) ? 'name' : 'word';
    if (kind(items[0]) !== kind(items[1])) return null;
  }
  // An item that is a verb WITH an object ("monitored them", "shipped them")
  // means the "and" joins two clauses, not two things. A lone gerund is a noun
  // ("gaming", "banking", "accounting") and is fine.
  // ("banking clients" / "gaming studios" are a sector + group noun, not a verb.)
  const sectorPlusNoun = new RegExp(`^[a-z]+ing\\s+(?:${GROUP_NOUN}|${TECH_NOUN}|studios?|firms?)$`);
  if (items.some((it) => /\b[a-z]{2,}(?:ed|ing)\s+\S/.test(it) && !sectorPlusNoun.test(it.trim()))) return null;
  // The text right after the list must close it. A pair must close the clause
  // outright ("Jenkins for CI and Docker for local dev" is two phrases, not a
  // list); a 3+ list may continue into a prepositional tail.
  const after = rest.slice(lm[0].length);
  const closes = /^(?:[.,;:](?=\s|$)|$)/.test(after);
  const tail = /^\s+(?:for|to|into|on|in|with|across|by|from|that|which|while|at|as)\b/.test(after);
  if (!(closes || (items.length >= 3 && tail))) return null;

  const t = escapeRe(term.trim());
  const whole = new RegExp(`^${t}${TRAILING_NOUN}$`, flagsFor(term));
  const lastWithNoun = new RegExp(`^${t}\\s+(.+)$`, flagsFor(term));
  const last = items.length - 1;
  let idx = items.findIndex((it) => whole.test(it.trim()));
  // A pair whose second item carries extra words ("XCTest and Kubernetes
  // clusters", "banking and insurance sectors") is ambiguous — the words may
  // belong to both halves or only to the second — so it is not edited.
  if (items.length === 2 && lastWithNoun.test(items[last].trim()) && !whole.test(items[last].trim())) {
    return null;
  }
  if (items.length === 2 && idx === last && !new RegExp(`^${t}$`, flagsFor(term)).test(items[last].trim())) {
    return null;
  }
  if (idx < 0) return null;

  const kept = items.filter((_, i) => i !== idx);
  // Removing the LAST item: a noun it carried may belong to the whole list.
  // A GROUP noun always does ("banking, insurance and fintech clients") and
  // moves to the new last item. A TECH noun after descriptive phrases belongs
  // to its item ("state management, local persistence, and CI/CD pipelines")
  // and goes with it. A TECH noun after bare names is genuinely ambiguous —
  // "iOS, Android and web platforms" (shared) vs "Swift, SwiftUI and CI/CD
  // pipelines" (CI/CD's own) have the same shape — so that case is not edited.
  if (idx === items.length - 1 && kept.length) {
    const nm = new RegExp(`^${t}\\s+(${GROUP_NOUN}|${TECH_NOUN})$`, flagsFor(term)).exec(items[idx].trim());
    if (nm) {
      const isGroup = new RegExp(`^(?:${GROUP_NOUN})$`, 'i').test(nm[1]);
      const othersBare = kept.every((k) => !/\s/.test(k.trim()));
      if (isGroup) kept[kept.length - 1] = `${kept[kept.length - 1]} ${nm[1]}`;
      else if (othersBare) return null;
    }
  }
  if (subjectList && kept.length === 1) return null; // "Node.js and React power…"
  const rebuilt = rebuildList(kept, conj, oxford && kept.length >= 3);
  return (sentence.slice(0, start) + rebuilt + after)
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([.,;:])/g, '$1')
    .trim();
}

/** scrubTerm repeated until the term is gone (one occurrence per pass). */
export function scrubAll(sentence: string, term: string): string | null {
  let cur = sentence;
  for (let i = 0; i < 4; i++) {
    if (!termRegex(term).test(cur)) return cur;
    const next = scrubTerm(cur, term);
    if (next === null || next === cur) return null;
    cur = next;
  }
  return termRegex(term).test(cur) ? null : cur;
}

// ── Sentence segmentation that survives "3.5 years", "Node.js", "B.Sc." ─────
// A sentence ends at . ! ? or the Bangla danda ONLY when followed by spaces and
// then an uppercase letter / digit / opening quote. Line breaks are separators
// of their own, so a paragraph's layout is rebuilt exactly.
type Seg = { text: string; sep: string };

function segment(text: string): Seg[] {
  const segs: Seg[] = [];
  // …or a mixed-case name that starts the next sentence ("iOS apps…", "bKash…").
  const re = /(?<=[.!?।])[ \t]+(?=[A-Z0-9"'(“]|[a-z]+[A-Z])|\n+/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    segs.push({ text: text.slice(last, m.index), sep: m[0] });
    last = m.index + m[0].length;
  }
  segs.push({ text: text.slice(last), sep: '' });
  return segs;
}

/** Sentences of a one-paragraph text (the summary), with the same splitting
 *  rules as scrubText — "3.5 years", "Node.js" and "iOS apps…" handled. */
export function sentencesOf(text: string): string[] {
  return segment(text).map((sg) => sg.text.trim()).filter(Boolean);
}

function joinSegs(segs: Seg[]): string {
  return segs.map((s) => s.text + s.sep).join('').trim();
}

/**
 * Remove every term from free text (a summary, a cover letter, an email body),
 * preserving its line structure. A sentence that cannot be repaired is dropped
 * only for terms in `droppable`, and never when it is the last non-empty one.
 */
export function scrubText(
  text: string,
  terms: string[],
  droppable: Set<string> = new Set(terms),
  opts: { protectFirst?: boolean } = {},
): { text: string; removed: string[] } {
  let segs = segment(text);
  const removed: string[] = [];
  for (const term of terms) {
    const re = termRegex(term);
    const next: Seg[] = [];
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      if (!re.test(s.text)) { next.push(s); continue; }
      const fixed = scrubAll(s.text, term);
      if (fixed !== null) { next.push({ ...s, text: fixed }); removed.push(term); continue; }
      const othersLeft = [...next, ...segs.slice(i + 1)].some((o) => o.text.trim());
      // A summary's first sentence is its positioning line (role + tenure):
      // never dropped — the optimizer replaces it instead when needed.
      const isFirst = opts.protectFirst && !next.some((o) => o.text.trim());
      if (droppable.has(term) && othersLeft && !isFirst) {
        removed.push(term);
        // A line break that followed the dropped sentence survives on the one
        // before it; a plain space separator is simply absorbed.
        if (s.sep.includes('\n') && next.length) next[next.length - 1] = { ...next[next.length - 1], sep: s.sep };
        continue;
      }
      next.push(s); // unrepairable and not safe to drop — leave it
    }
    segs = next;
  }
  return { text: joinSegs(segs), removed };
}

/**
 * Remove every term from one item's bullets. An unrepairable bullet is dropped
 * only for `droppable` terms and only while the item keeps ≥ `minKeep` bullets.
 */
export function scrubBullets(
  bullets: string[],
  terms: string[],
  minKeep: number,
  droppable: Set<string> = new Set(terms),
): { bullets: string[]; removed: string[] } {
  let out = [...bullets];
  const removed: string[] = [];
  for (const term of terms) {
    const re = termRegex(term);
    const next: string[] = [];
    for (let i = 0; i < out.length; i++) {
      const b = out[i];
      if (!re.test(b)) { next.push(b); continue; }
      const fixed = scrubAll(b, term);
      if (fixed !== null) { next.push(fixed); removed.push(term); continue; }
      const remaining = next.length + (out.length - i - 1);
      if (droppable.has(term) && remaining >= Math.max(1, minKeep)) { removed.push(term); continue; }
      next.push(b);
    }
    out = next;
  }
  return { bullets: out, removed };
}

/**
 * Tool-shaped tokens: anything a reader would take as a named technology —
 * symbol-joined ("CI/CD", "Node.js", "C#"), mixedCase ("GraphQL", "SwiftUI"),
 * caps-led ("XCTest"), or an all-caps acronym of 3+ letters ("AWS", "CRM").
 * Finds tools the model wrote into prose that the candidate never named; the
 * dictionary in toolkitContext only knows a fixed list and missed both "CI/CD"
 * and "XCTest". HEURISTIC — callers list-scrub these, and may drop a LATER
 * summary sentence over one, but never the opener and never a bullet.
 */
const SAFE_TOKENS = new Set([
  'api', 'apis', 'ui', 'ux', 'ui/ux', 'qa', 'kpi', 'kpis', 'roi', 'it', 'hr', 'cv', 'mba', 'bba', 'bsc', 'msc', 'phd',
  'usd', 'bdt', 'ceo', 'cto', 'coo', 'cfo', 'b2b', 'b2c', 'sdk', 'sdks', 'os', 'mvp', 'r&d', 'faq', 'sla', 'slas',
  'seo', 'sem', 'pr', 'prs', 'e2e', 'gpa', 'cgpa', 'ielts', 'toefl', 'ssc', 'hsc', 'ngo', 'ngos', 'ios', 'end-to-end',
  'rest', 'id', 'ids', 'url', 'urls', 'pdf', 'pdfs', 'llc', 'ltd', 'plc', 'inc', 'usa', 'uk', 'uae', 'eu',
  'ph.d', 'b.sc', 'm.sc', 'b.a', 'm.a', 'b.com', 'm.com', 'b.tech', 'm.tech', 'p&l', 'q&a',
  // Formats, protocols, patterns and metrics: generic professional vocabulary,
  // not a product anyone can falsely claim.
  'json', 'xml', 'html', 'css', 'http', 'https', 'sql', 'nosql', 'mvvm', 'mvc', 'oop', 'solid', 'tdd', 'bdd',
  'nps', 'csat', 'okr', 'okrs', 'sop', 'sops', 'gdpr', 'wcag', 'ux/ui',
  // Degree subjects as Bangladeshi CVs write them.
  'cse', 'eee', 'ece', 'ete', 'ict', 'cis', 'swe', 'ipe', 'bcom', 'mcom', 'llb', 'llm', 'mbbs', 'bds',
  // Domain acronyms in business, finance and operations résumés: names of a
  // kind of work or sector, not products ("FMCG distribution", "KYC checks").
  'mvps', 'uat', 'ppc', 'poc', 'pocs', 'fmcg', 'kyc', 'aml', 'erp', 'crm', 'pos', 'scm', 'hrm', 'hris', 'mis', 'bpo', 'rmg', 'ifrs', 'gaap', 'vat',
  'smb', 'sme', 'smes', 'cpg', 'otc', 'emr', 'ehr', 'icu', 'opd', 'qc', 'ngo', 'csr', 'hse', 'ehs', 'ppe',
]);

export function toolShapedTokens(text: string): string[] {
  const found = text.match(/[A-Za-z][A-Za-z0-9]*(?:[/+#.][A-Za-z0-9+#]+)+|\b[A-Za-z]*[a-z][A-Z][A-Za-z0-9]*\b|\b[A-Z]{2,}[a-z][A-Za-z0-9]*\b|\b[A-Z]{3,}s?\b|\b[A-Z][A-Za-z]*#/g) ?? [];
  const out = new Set<string>();
  for (const raw of found) {
    const t = raw.replace(/[.]+$/, '');
    if (t.length < 2 || SAFE_TOKENS.has(t.toLowerCase())) continue;
    if (/^(e\.g|i\.e|etc|vs)$/i.test(t)) continue;
    const segments = t.split(/[/+#.]/).filter(Boolean);
    if (segments.length > 1 && segments.every((s) => s.length === 1)) continue; // U.S, A/B (CI/CD stays)
    if (/^v?\d+(?:\.\d+)*$/i.test(t)) continue;                                 // v2.0
    if (/^[a-z]+(?:\/[a-z]+)+$/.test(t)) continue;                               // client/server, and/or
    out.add(t);
  }
  return [...out];
}

/**
 * Remove a word or phrase and, if an a/an sat right in front of it, re-pick the
 * article for the word that now follows ("an enterprise healthcare app" ->
 * "a healthcare app"). Only that one article is touched — a/an follows SOUND,
 * not spelling ("a unit", "a one-week"), so a letter test anywhere else breaks
 * correct text.
 */
export function removeKeepingArticle(text: string, find: RegExp): string {
  const MARK = '\u0000';
  const marked = text.replace(find, (match: string, ...args: unknown[]) => {
    const offset = args.find((a) => typeof a === 'number') as number;
    const art = /\b(a|an|A|An)\s+$/.exec(text.slice(0, offset));
    if (!art) return '';
    const next = text.slice(offset + match.length);
    // Acronyms are read letter by letter: "an HR portal", "an MQTT feed", "a UX
    // audit". Otherwise go by the leading vowel sound.
    const acronym = /^[A-Z]{2,}\b/.test(next);
    // By SOUND: "a European", "a Ukrainian", "a one-week", "a unit" — but "an
    // hour", "an honest".
    const wantAn = acronym
      ? /^[AEFHILMNORSX]/.test(next)
      : /^(?:hour|honest|honou?r|heir)/i.test(next)
        || (/^[aeiou]/i.test(next) && !/^(?:eu|ewe|uk|un[iu]|us[eu]|uti|uro|one\b|once\b)/i.test(next));
    const fixed = wantAn ? (art[1][0] === 'A' ? 'An' : 'an') : (art[1][0] === 'A' ? 'A' : 'a');
    return fixed === art[1] ? '' : `${MARK}${fixed}${MARK}`;
  });
  return marked.replace(new RegExp(`\\b(?:a|an|A|An)\\s+${MARK}(a|an|A|An)${MARK}`, 'g'), '$1 ');
}

/** Capitalise a sentence's first letter — unless the first word is a
 *  deliberately mixed-case name ("iOS", "eBay", "bKash"), which must stay. */
export function capitalizeFirst(text: string): string {
  const first = text.split(/\s/, 1)[0] ?? '';
  if (/^[a-z]/.test(first) && /[A-Z]/.test(first)) return text;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Toolkit artifacts: cut invented tools out IN PLACE before the fabrication
 * gate (assertNoFabricatedTools), using the same evidence the gate uses. One
 * helper for the combined bundle AND the single-item regenerators, so neither
 * path throws a whole letter away over one word. List-scrub only — never drops
 * a sentence (it could be the letter's opener); whatever cannot be repaired
 * still meets the gate and is discarded exactly as before.
 */
export function repairFabricatedTools(output: string, data: ResumeData, options: FabricationGuardOptions = {}): string {
  return repairAgainst(output, guardEvidence(data, options));
}

/** The same repair against an explicit evidence string (the combined toolkit
 *  generator's pitch evidence). */
export function repairAgainst(output: string, evidence: string): string {
  const tokens = detectFabricatedTokens(output, evidence);
  return tokens.length ? scrubText(output, tokens, new Set()).text : output;
}

/** An email subject is too short to cut a word out of: try the list repair,
 *  then the documented default "<Role> — <Name>", then "Application — <Name>",
 *  each re-checked. Shared by the combined and single-item outreach paths. */
export function repairSubject(subject: string, data: ResumeData, evidence: string): string {
  if (detectFabricatedTokens(subject, evidence).length === 0) return subject;
  const candidates = [
    repairAgainst(subject, evidence),
    // Both parts or nothing: a bare name is not a subject line.
    data.targetJob.title?.trim() && data.personalInfo?.fullName?.trim() ? `${data.targetJob.title.trim()} — ${data.personalInfo.fullName.trim()}` : '',
    data.personalInfo?.fullName ? `Application — ${data.personalInfo.fullName}` : '',
  ];
  return candidates.find((c) => c && detectFabricatedTokens(c, evidence).length === 0) ?? subject;
}

/** A deterministic edit: [pattern, replacement]. An empty-string replacement
 *  is a REMOVAL and goes through removeKeepingArticle (a/an re-picked). */
export type RemovalPattern = [RegExp, string | ((match: string) => string)];

/** Apply the patterns until the text stops changing (removing one word can
 *  put the next one right after the article, where only a second pass sees
 *  it). ONE loop for the normalizer's inflation repair and the optimizer's
 *  filler / cliché strips, so they cannot drift apart. */
export function applyRemovals(text: string, patterns: RemovalPattern[], maxPasses = 4): string {
  let out = text;
  for (let pass = 0, prev = ''; pass < maxPasses && prev !== out; pass++) {
    prev = out;
    for (const [re, repl] of patterns) {
      out = repl === '' ? removeKeepingArticle(out, re) : out.replace(re, repl as string);
    }
  }
  return out.replace(/\s{2,}/g, ' ').trim();
}
