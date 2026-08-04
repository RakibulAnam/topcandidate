// Canonical spelling for local brand names, and repair of near-miss corruptions.
//
// Why this exists: measured on 2026-08-04, the normalizer turned the candidate's
// "bkash payment gateway integrate korlam" into "Integrated the bakesh payment
// gateway". Roughly 1 run in 10. That single word is the most expensive thing on
// the whole résumé to get wrong:
//   • ATS exact-match scoring for a payments role searches "bKash". "bakesh"
//     scores zero, so the best keyword the candidate had is destroyed.
//   • To a Bangladeshi recruiter, misspelling bKash reads as illiteracy about
//     the market — worse than not mentioning it.
// Users type these names in lowercase, transliterated, or inconsistently
// ("bkash", "bKash", "Bkash", "b-kash"), and the model then re-types them from
// its own head, which is where the corruption enters.
//
// SAFETY RULE, non-negotiable: this can only ever CORRECT a brand the candidate
// already wrote. A brand whose name is not loosely present in their evidence is
// never introduced, never re-cased, never touched — otherwise a "spelling fix"
// would become a fabrication vector, which is exactly what the rest of this
// module's siblings exist to prevent.

/**
 * Canonical forms for brands common in Bangladeshi résumés, keyed by their
 * loose form (lowercase, alphanumeric only). Deliberately NOT merged into
 * FABRICATION_TOKEN_DICTIONARY: that list answers "may this be claimed at all",
 * this one answers "how is it spelled". Different questions, different lists.
 */
const CANONICAL_BRANDS: Record<string, string> = {
  // Mobile financial services — the highest-value keywords in BD fintech.
  bkash: 'bKash', nagad: 'Nagad', rocket: 'Rocket', upay: 'Upay',
  surjopay: 'ShurjoPay', shurjopay: 'ShurjoPay', sslcommerz: 'SSLCOMMERZ',
  // Telecom.
  grameenphone: 'Grameenphone', banglalink: 'Banglalink', teletalk: 'Teletalk',
  robi: 'Robi', airtel: 'Airtel', btrc: 'BTRC',
  // Internet / marketplaces / logistics.
  pathao: 'Pathao', shohoz: 'Shohoz', daraz: 'Daraz', bikroy: 'Bikroy',
  chaldal: 'Chaldal', rokomari: 'Rokomari', foodpanda: 'foodpanda',
  sheba: 'Sheba', shikho: 'Shikho', truckLagbe: 'Truck Lagbe',
  // Banks, regulators, conglomerates, institutions.
  brac: 'BRAC', bgmea: 'BGMEA', bkmea: 'BKMEA', beximco: 'Beximco',
  akij: 'Akij', pran: 'PRAN', walton: 'Walton', bashundhara: 'Bashundhara',
  bangladeshbank: 'Bangladesh Bank', bfiu: 'BFIU', nbr: 'NBR',
  buet: 'BUET', dhakauniversity: 'University of Dhaka', bracu: 'BRAC University',
};

/** Levenshtein distance, capped: returns > max as soon as that's certain. */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

const loose = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Fix brand spelling and casing in generated text.
 *
 * Two passes, both gated on the brand being present in the candidate's own words:
 *   1. Exact-but-miscased ("bkash", "BKASH") -> canonical ("bKash").
 *   2. Near-miss corruption ("bakesh") -> canonical, when within 2 edits.
 *
 * Pass 2 requires the output token to be ABSENT from the evidence, so a word the
 * candidate actually typed is never "corrected" into something else, and requires
 * length >= 5 so short words can't be mangled into a brand.
 *
 * @returns the repaired text plus the corrections made, for telemetry.
 */
export function fixBrandSpellings(
  text: string,
  evidence: string,
): { text: string; corrections: Array<{ from: string; to: string }> } {
  if (!text) return { text, corrections: [] };
  const evLoose = loose(evidence);
  const evTokens = new Set(evidence.toLowerCase().match(/[a-z0-9]+/g) ?? []);

  // Only brands the candidate actually referenced are in play.
  const active: Array<{ key: string; canonical: string }> = [];
  for (const [key, canonical] of Object.entries(CANONICAL_BRANDS)) {
    if (evLoose.includes(key)) active.push({ key, canonical });
  }
  if (active.length === 0) return { text, corrections: [] };

  const corrections: Array<{ from: string; to: string }> = [];
  const out = text.replace(/[A-Za-z][A-Za-z0-9]*/g, (word) => {
    const wl = loose(word);
    if (!wl) return word;

    // Pass 1 — right brand, wrong casing.
    const exact = active.find((b) => b.key === wl);
    if (exact) {
      if (word !== exact.canonical) corrections.push({ from: word, to: exact.canonical });
      return exact.canonical;
    }

    // Pass 2 — corrupted transliteration. Never touch a word the candidate typed.
    if (wl.length < 5 || evTokens.has(wl)) return word;
    let best: { canonical: string; d: number } | null = null;
    for (const b of active) {
      if (b.key.length < 4) continue;
      const d = editDistance(wl, b.key, 2);
      if (d <= 2 && (best === null || d < best.d)) best = { canonical: b.canonical, d };
    }
    if (best) {
      corrections.push({ from: word, to: best.canonical });
      return best.canonical;
    }
    return word;
  });

  return { text: out, corrections };
}

/** Apply fixBrandSpellings across an array, reporting every correction made. */
export function fixBrandSpellingsInAll(
  values: string[],
  evidence: string,
): { values: string[]; corrections: Array<{ from: string; to: string }> } {
  const all: Array<{ from: string; to: string }> = [];
  const fixed = values.map((v) => {
    const r = fixBrandSpellings(v, evidence);
    all.push(...r.corrections);
    return r.text;
  });
  return { values: fixed, corrections: all };
}
