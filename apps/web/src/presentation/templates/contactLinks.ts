/**
 * contactLinks — shared, pure URL/href derivation for the resume contact line.
 *
 * Lives beside TemplateRegistry because all three render surfaces already import
 * from `presentation/templates`:
 *   - on-screen preview      (presentation/components/Preview.tsx)
 *   - PDF export             (infrastructure/export/PdfResumeExporter.ts)
 *   - Word export            (infrastructure/export/WordResumeExporter.ts)
 *
 * Single source of truth for (a) the ORDER contact parts appear in and (b) the
 * href each linkable part resolves to. Keeping it here guarantees the three
 * surfaces stay WYSIWYG-identical (web app CLAUDE.md rule 7).
 *
 * Design rules:
 *   - The VISIBLE text is always the full URL / address (never a label like
 *     "LinkedIn"). ATS parsers that ignore the link annotation still read the
 *     URL as plain text — keep it that way.
 *   - href derivation is defensive: malformed / non-URL-ish input yields NO
 *     href, so the segment renders as plain text instead of a broken link.
 */

import type { PersonalInfo } from '../../domain/entities/Resume';

export interface ContactSegment {
  /** The visible text (full URL / email / phone / location). */
  text: string;
  /** The link target, or undefined when the value isn't safely linkable. */
  href?: string;
}

/** `mailto:` for a plausible email address, else undefined. */
export function toMailto(email: string | undefined | null): string | undefined {
  const v = (email ?? '').trim();
  // Minimal sanity check — a local-part, an @, and a dotted domain.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return undefined;
  return `mailto:${v}`;
}

/**
 * `tel:` for a phone number. PhoneInput stores E.164 (`+8801711000000`), but
 * the per-resume builder form does not hard-enforce it, so we coerce: keep a
 * leading `+` and digits only. Requires >= 4 digits to avoid `tel:` on junk.
 */
export function toTel(phone: string | undefined | null): string | undefined {
  const v = (phone ?? '').trim();
  if (!v) return undefined;
  const cleaned = v.replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '');
  if (cleaned.replace(/\D/g, '').length < 4) return undefined;
  return `tel:${cleaned}`;
}

/**
 * Normalize a web URL (linkedin / github / website / project / publication).
 * Capture inputs use `type="url"` so the expected value is a full `https://…`,
 * but nothing enforces it — a user can paste `linkedin.com/in/foo` or `@foo`.
 * Returns undefined when the value doesn't look like a linkable URL/domain
 * (so callers fall back to plain text rather than emit `https://my linkedin`).
 */
export function normalizeWebUrl(raw: string | undefined | null): string | undefined {
  let v = (raw ?? '').trim();
  if (!v) return undefined;
  // Reject anything with internal whitespace — almost certainly free text.
  if (/\s/.test(v)) return undefined;
  if (/^https?:\/\//i.test(v)) return v;
  // Strip a leading "@" handle marker and any leading slashes.
  v = v.replace(/^@/, '').replace(/^\/+/, '');
  // Must contain a dot (a domain) to be worth linkifying.
  if (!/^[^\s/]+\.[^\s]+/.test(v)) return undefined;
  return `https://${v}`;
}

/**
 * The contact line, as ordered segments. Order matches the legacy
 * `contactParts` arrays in all three surfaces: email · phone · location ·
 * linkedin · github · website. `location` is intentionally never linked.
 *
 * Falsy fields are skipped (same as the old `.filter(Boolean)`), so
 * `segments.map(s => s.text).join('  |  ')` reproduces the previous plain line
 * exactly.
 */
export function buildContactSegments(p: PersonalInfo): ContactSegment[] {
  const segs: ContactSegment[] = [];
  if (p.email) segs.push({ text: p.email, href: toMailto(p.email) });
  if (p.phone) segs.push({ text: p.phone, href: toTel(p.phone) });
  if (p.location) segs.push({ text: p.location });
  if (p.linkedin) segs.push({ text: p.linkedin, href: normalizeWebUrl(p.linkedin) });
  if (p.github) segs.push({ text: p.github, href: normalizeWebUrl(p.github) });
  if (p.website) segs.push({ text: p.website, href: normalizeWebUrl(p.website) });
  return segs;
}

/** The visual separator between contact segments (kept identical across surfaces). */
export const CONTACT_SEPARATOR = '  |  ';
