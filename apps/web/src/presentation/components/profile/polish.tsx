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
}> = ({ normalized, polishing }) => {
  if (polishing) {
    return (
      <div className="mt-3 flex items-center gap-2 text-xs text-charcoal-500 bg-charcoal-50 border border-charcoal-200 rounded-lg px-3 py-2">
        <Loader2 size={13} className="animate-spin text-brand-600" />
        Polishing this entry…
      </div>
    );
  }
  if (!normalized || normalized.bullets.length === 0) return null;
  return (
    <div className="mt-3 bg-charcoal-50 border border-charcoal-200 rounded-lg px-3 py-2.5">
      <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] font-semibold text-brand-600 mb-1.5">
        <Sparkles size={11} className="text-accent-500" /> Polished by AI — how resumes will present this
      </p>
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
