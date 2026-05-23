// Pre-flight gibberish gate. Runs *before* any AI call so that token spend
// stays on real content. Designed for the Bangladesh audience: English,
// Bengali (native script), and Banglish (romanized Bengali) all pass.
//
// Strategy (cheap → expensive):
//   1. Trim & length floor — anything under ~3 chars is unjudgeable, pass.
//   2. Bengali Unicode passthrough — if ≥30% of letters are Bengali, accept.
//      This also covers code-switched English+Bangla.
//   3. Per-token shape checks — for Latin-only input, score each word:
//        - dictionary hit (English / tech / Banglish) → recognised
//        - obviously-mashed (no vowels in long word, 4+ repeats, 5+
//          consonants in a row, only one vowel surrounded by mash) → suspect
//        - otherwise → ambiguous (proper noun, niche jargon, name)
//   4. Decision:
//        - recognised ratio ≥ 0.20  → not gibberish (one real word per ~5 is
//          enough; resume bullets often have lots of proper nouns)
//        - suspect ratio ≥ 0.55     → gibberish
//        - else                     → not gibberish (benefit of the doubt)
//
// The detector returns soft "issues" rather than booleans so callers can
// surface a useful message (which field, why we think it's gibberish). All
// thresholds are conservative — we'd rather pay for a borderline AI call
// than block a legitimate user typing in heavy jargon.

import { KNOWN_WORDS } from './dictionaries';

export interface GibberishIssue {
    field: string;
    sample: string;
    reason: string;
}

export interface FieldCheck {
    field: string;
    text: string | undefined | null;
}

const BENGALI_RE = /[ঀ-৿]/g;
const LETTER_RE = /[\p{Letter}]/gu;
const LATIN_WORD_RE = /[a-z]+/gi;

const LENGTH_FLOOR = 3;
const BENGALI_RATIO_PASS = 0.30;
const RECOGNISED_RATIO_PASS = 0.20;
const SUSPECT_RATIO_FAIL = 0.55;

// Tokens shorter than this are too small to confidently judge ("aa", "lo")
// — they're skipped entirely so they neither help nor hurt the verdict.
const TOKEN_MIN_LEN = 3;

const VOWELS = new Set(['a', 'e', 'i', 'o', 'u', 'y']);

// Adjacent-key 3-grams from a QWERTY keyboard. Curated to substrings that
// effectively never occur inside real English/Banglish words — so we can
// flag a token whenever it contains one without false-positiving common
// suffixes like "wer" (lower, answer) or "ert" (expert, alert).
//
// Includes both forwards and reverse rolls. "qwe" and "ewq" both trip; "wer"
// is excluded because it's a real English suffix.
const KEYBOARD_ROLLS: readonly string[] = [
    // top row (q is followed by u in real English, never w)
    'qwe', 'tyu', 'yui', 'uio', 'iop',
    'ewq', 'uyt', 'iuy', 'oiu', 'poi',
    // home row — none of these substrings appear in standard English
    'asd', 'sdf', 'dfg', 'fgh', 'ghj', 'hjk', 'jkl',
    'dsa', 'fds', 'gfd', 'hgf', 'jhg', 'kjh', 'lkj',
    // bottom row
    'zxc', 'xcv', 'cvb', 'vbn', 'bnm',
    'cxz', 'vcx', 'bvc', 'nbv', 'mnb',
];

function countMatches(text: string, re: RegExp): number {
    const m = text.match(re);
    return m ? m.length : 0;
}

function containsKeyboardRoll(token: string): boolean {
    for (const roll of KEYBOARD_ROLLS) {
        if (token.includes(roll)) return true;
    }
    return false;
}

function isLikelyMashed(token: string): boolean {
    // 4+ of the same character in a row → "aaaaa", "kkkk"
    if (/(.)\1{3,}/.test(token)) return true;

    // 5+ consonants in a row → "asdfgh", "kjhgf"
    if (/[^aeiouy\d]{5,}/i.test(token)) return true;

    // Long token with zero vowels — "y" counts as a vowel here, so "rhythm"
    // is fine ("rh-y-thm"), but "qwrtsd" trips this.
    if (token.length >= 5) {
        let vowels = 0;
        for (const ch of token) if (VOWELS.has(ch)) vowels++;
        if (vowels === 0) return true;
    }

    // Very long token with very few vowels — "asdfqwerzx" type strings.
    if (token.length >= 8) {
        let vowels = 0;
        for (const ch of token) if (VOWELS.has(ch)) vowels++;
        if (vowels / token.length < 0.15) return true;
    }

    // Adjacent-key keyboard rolls — catches the cases the vowel/consonant
    // shape rules miss because the masher happened to land on a vowel
    // ("asdf", "qwerty", "asdfasdf").
    if (containsKeyboardRoll(token)) return true;

    return false;
}

/**
 * Returns true if the input looks like gibberish/keyboard-mashing.
 * Conservative — only flips to true when we're highly confident.
 */
export function isGibberish(input: string | undefined | null): boolean {
    if (!input) return false;
    const text = input.trim();
    if (text.length < LENGTH_FLOOR) return false;

    // Bengali script free pass (covers monolingual Bangla and code-switching).
    const bengaliCount = countMatches(text, BENGALI_RE);
    const letterCount = countMatches(text, LETTER_RE);
    if (letterCount > 0 && bengaliCount / letterCount >= BENGALI_RATIO_PASS) {
        return false;
    }

    // From here on, we're judging Latin-script content.
    const tokens = (text.toLowerCase().match(LATIN_WORD_RE) || []).filter(
        t => t.length >= TOKEN_MIN_LEN,
    );

    // No judgeable tokens (just numbers/punctuation/short words) → pass.
    if (tokens.length === 0) return false;

    let recognised = 0;
    let suspect = 0;
    for (const t of tokens) {
        if (KNOWN_WORDS.has(t)) {
            recognised++;
        } else if (isLikelyMashed(t)) {
            suspect++;
        }
    }

    const recRatio = recognised / tokens.length;
    const susRatio = suspect / tokens.length;

    if (recRatio >= RECOGNISED_RATIO_PASS) return false;
    if (susRatio >= SUSPECT_RATIO_FAIL) return true;

    // Edge case: very short input (1–2 tokens) where no token is recognised
    // and at least one is suspect → call it gibberish. Without this, "asdfgh"
    // (1 token, 100% suspect, recRatio=0) would pass the susRatio guard only
    // when we hit ≥0.55 — which "asdfgh" does, but "asdf qwer" might not if
    // tokens fall under TOKEN_MIN_LEN. Belt and braces.
    if (tokens.length <= 3 && suspect >= 1 && recognised === 0) return true;

    return false;
}

/**
 * Bulk check — runs each field through `isGibberish` and returns any that
 * trip. Empty/missing fields are ignored. Useful as a single gate before AI
 * calls so the caller can surface every offending field at once instead of
 * dripping errors one at a time.
 */
export function findGibberishFields(checks: FieldCheck[]): GibberishIssue[] {
    const issues: GibberishIssue[] = [];
    for (const { field, text } of checks) {
        if (!text) continue;
        if (isGibberish(text)) {
            const sample = text.trim().slice(0, 60);
            issues.push({
                field,
                sample,
                reason: 'looks like random characters rather than real content',
            });
        }
    }
    return issues;
}

/**
 * Convenience: throws a friendly aggregate error if any field is gibberish.
 * Designed to be called at the top of AI-bound service methods.
 */
export class GibberishContentError extends Error {
    constructor(public issues: GibberishIssue[]) {
        super(GibberishContentError.formatMessage(issues));
        this.name = 'GibberishContentError';
    }

    private static formatMessage(issues: GibberishIssue[]): string {
        if (issues.length === 1) {
            return `The "${issues[0].field}" field ${issues[0].reason}. Please write real content so we can build a proper resume — random text wastes AI credits.`;
        }
        const fields = issues.map(i => `"${i.field}"`).join(', ');
        return `These fields look like random characters: ${fields}. Please write real content so we can build a proper resume — random text wastes AI credits.`;
    }
}

export function assertNotGibberish(checks: FieldCheck[]): void {
    const issues = findGibberishFields(checks);
    if (issues.length > 0) throw new GibberishContentError(issues);
}
