// Shared "polished profile" helpers for the profile sections (experience,
// project, extracurricular).
//
// Philosophy: the app does the heavy lifting. The user brain-dumps in any
// language; we silently convert it into professional evidence and show the
// result. Coaching is deliberately subtle — at most one quiet "Tip:" line,
// and only when something important (almost always a number) is missing that
// only the user can supply. No instructions, no warnings, no homework.

import React from 'react';
import { Sparkles, Loader2 } from 'lucide-react';
import { NormalizedItemContent } from '../../../domain/entities/Resume';
import { ProfileItemContext } from '../../../domain/usecases/NormalizeProfileItemUseCase';
import { profileNormalizer } from '../../../infrastructure/config/dependencies';
import { contentHash } from '../../../application/validation/contentHash';

// True when the description text changed since the stored normalization (or
// none exists yet) — i.e. a polish call would not be redundant.
export function needsPolish(
  text: string,
  prior?: { normalized?: NormalizedItemContent; normalizedSourceHash?: string },
): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return !prior?.normalized || prior.normalizedSourceHash !== contentHash(trimmed);
}

// ── Per-section daily re-polish guard ────────────────────────────────────────
// Editing a saved description re-runs the AI polish. To keep that from being
// spammed (cost), each section TYPE allows a small number of re-polishes per
// day. This is a lightweight CLIENT-side counter (localStorage) — exactly the
// "small guard" the product wants; the real backstop is the server-side
// per-user `normalize` daily cap. Initial onboarding polish does NOT go
// through here, so first-time profile creation is never limited.
export type PolishSection = 'experience' | 'project' | 'extracurricular';
export const RENORM_DAILY_LIMIT = 5;

function renormKey(section: PolishSection): string {
  // UTC calendar day — resets at midnight UTC. Good enough for a soft guard.
  const day = new Date().toISOString().slice(0, 10);
  return `tc.renorm.${section}.${day}`;
}

function renormCount(section: PolishSection): number {
  try {
    const n = parseInt(localStorage.getItem(renormKey(section)) ?? '0', 10);
    return Number.isNaN(n) ? 0 : n;
  } catch {
    return 0;
  }
}

export function renormRemaining(section: PolishSection): number {
  return Math.max(0, RENORM_DAILY_LIMIT - renormCount(section));
}

// Consume one re-polish slot for the section. Returns false (without
// consuming) when the daily limit is already reached.
export function tryConsumeRenorm(section: PolishSection): boolean {
  if (renormRemaining(section) <= 0) return false;
  try {
    localStorage.setItem(renormKey(section), String(renormCount(section) + 1));
  } catch {
    // localStorage unavailable (private mode) — allow the polish rather than
    // block a legitimate edit; the server cap still applies.
  }
  return true;
}

// Shallow "did any editable field change" check for the Close-vs-Save button.
// Returns true when `b` exists and every listed key is unchanged. String-cast
// so a boolean (isCurrent) and an empty/undefined value compare cleanly.
// Key-order-stable stringify so two equal `guided` maps with different key
// insertion order (DB round-trip vs freshly typed) compare equal.
function stableStringify(v: unknown): string {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    return '{' + Object.keys(o).sort().map(k => JSON.stringify(k) + ':' + stableStringify(o[k])).join(',') + '}';
  }
  return JSON.stringify(v ?? null);
}

export function fieldsEqual(
  a: Record<string, unknown>,
  b: Record<string, unknown> | undefined,
  keys: string[],
): boolean {
  if (!b) return false;
  return keys.every(k => {
    const av = a[k];
    const bv = b[k];
    // Objects (e.g. the `guided` answers map) need a deep compare — String()
    // would collapse every object to "[object Object]" and mask real edits.
    if ((av && typeof av === 'object') || (bv && typeof bv === 'object')) {
      return stableStringify(av) === stableStringify(bv);
    }
    return String(av ?? '') === String(bv ?? '');
  });
}

// Run the polish call and persist the result. Never throws and never blocks
// the save — the raw text is always the source of truth; a failure simply
// means the next save retries. Callers track in-flight state via the
// onStart/onSettle hooks (e.g. a per-row spinner).
export function polishInBackground(opts: {
  text: string;
  context: ProfileItemContext;
  persist: (normalized: NormalizedItemContent, sourceHash: string) => Promise<void>;
  onStart?: () => void;
  onSettle?: () => void;
  onDone?: () => void;
}): void {
  const text = opts.text.trim();
  if (!text) return;
  const hash = contentHash(text);
  opts.onStart?.();
  profileNormalizer
    .normalize(text, opts.context)
    .then(async normalized => {
      await opts.persist(normalized, hash);
      opts.onDone?.();
    })
    .catch(err => {
      console.warn('Profile polish failed (will retry on next save):', err);
    })
    .finally(() => {
      opts.onSettle?.();
    });
}

// Card block rendered under a profile item: the AI-polished bullets, with at
// most one quiet tip underneath. Renders nothing when there is neither a
// result nor an in-flight polish.
export const PolishedPreview: React.FC<{
  normalized?: NormalizedItemContent;
  polishing: boolean;
  // When provided, the preview detects whether `normalized` is stale relative
  // to the current text (e.g. an edit saved while over the 5/day re-polish
  // cap) and shows a quiet "previous version" note instead of pretending the
  // old bullets match the new text.
  sourceText?: string;
  sourceHash?: string;
}> = ({ normalized, polishing, sourceText, sourceHash }) => {
  if (polishing) {
    return (
      <div className="mt-3 flex items-center gap-2 text-xs text-charcoal-500 bg-charcoal-50 border border-charcoal-200 rounded-lg px-3 py-2">
        <Loader2 size={13} className="animate-spin text-brand-600" />
        Polishing this entry…
      </div>
    );
  }
  if (!normalized || normalized.bullets.length === 0) return null;
  const stale = !!sourceText?.trim() && !!sourceHash && contentHash(sourceText.trim()) !== sourceHash;
  return (
    <div className="mt-3 bg-charcoal-50 border border-charcoal-200 rounded-lg px-3 py-2.5">
      <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] font-semibold text-brand-600 mb-1.5">
        <Sparkles size={11} className="text-accent-500" /> Polished by AI — how resumes will present this
      </p>
      {stale && (
        <p className="text-xs text-charcoal-400 italic mb-1.5">
          Showing the previous version — your latest edit will be polished next time AI polish runs.
        </p>
      )}
      <ul className="space-y-1">
        {normalized.bullets.map((b, i) => (
          <li key={i} className="text-sm text-charcoal-700 flex gap-1.5">
            <span className="text-charcoal-400 shrink-0">•</span>
            <span>{b}</span>
          </li>
        ))}
      </ul>
      {normalized.gaps.length > 0 && (
        <p className="mt-2 text-xs text-charcoal-400 italic">
          Tip: {normalized.gaps[0]}
        </p>
      )}
    </div>
  );
};
