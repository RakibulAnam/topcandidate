// Shared résumé date formatting — the ONE place a stored date becomes display text.
//
// This exists because Preview.tsx and PdfResumeExporter.ts had drifted: the
// preview ran a local formatDate() that turned "2022-03" into "Mar 2022", while
// the PDF exporter interpolated the raw field and printed "2022-03". So the user
// saw one thing on screen and downloaded another — a WYSIWYG break in the one
// artifact they actually send to employers, and bare ISO year-month reads as a
// data-entry slip to a human recruiter (ATS parsers also key on month names far
// more reliably than on "2022-03").
//
// Both renderers now call this. Keep it that way: `apps/web/CLAUDE.md` rule 7
// requires the preview and the PDF to agree, and a second copy of this logic is
// exactly how they stopped agreeing last time.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * "2022-03" → "Mar 2022". Passes through anything already human-formatted, and
 * normalizes the ongoing markers to "Present". Never throws: an unrecognized
 * value is returned unchanged, because losing a date entirely is worse than
 * printing it in the shape the user typed.
 */
export function formatResumeDate(dateString: string | undefined | null): string {
  if (!dateString) return '';
  const s = String(dateString).trim();
  const lc = s.toLowerCase();
  if (lc === 'present' || lc === 'current') return 'Present';

  const m = /^(\d{4})-(\d{2})$/.exec(s);
  if (m) {
    const monthIndex = parseInt(m[2], 10) - 1;
    // Guard a malformed month rather than emitting "undefined 2022".
    if (monthIndex >= 0 && monthIndex < 12) return `${MONTHS[monthIndex]} ${m[1]}`;
    return m[1];
  }
  return s;
}

/**
 * Renders a start–end pair the way both the preview and the PDF present it, with
 * an en-dash. `isCurrent` wins over `end` so a current role never shows a stale
 * end date. Returns just the end value when there is no start — education is
 * usually a single completion date (see the inverted-dates note in AGENTS.md).
 */
export function formatResumeDateRange(
  start: string | undefined | null,
  end: string | undefined | null,
  isCurrent?: boolean,
): string {
  const from = formatResumeDate(start);
  const to = isCurrent ? 'Present' : formatResumeDate(end);
  if (!from) return to;
  if (!to) return from;
  return `${from} – ${to}`;
}
