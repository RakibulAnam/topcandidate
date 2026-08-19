// ToolkitCard — the recent-toolkit / all-toolkits grid card from the redesign.
// Shared by the Home grid and the All Toolkits screen so they stay identical.
//
// A tailored resume's "role" is derived from its title (trailing "Resume"
// stripped, matching the legacy dashboard), and the monogram is the company's
// (or role's) first letter until real company logos exist.
//
// The card is a wrapper <div> holding a body <a> plus a sibling overflow menu,
// not one big <a>: a <button> nested inside an anchor is invalid HTML and the
// two activations fight each other. The wrapper carries the hover treatment so
// the whole card still lifts as one.
import React, { useEffect, useRef, useState } from 'react';
import { MoreVertical, Trash2, Loader2 } from 'lucide-react';
import { useT } from '../../i18n/LocaleContext';
import type { ResumeListItem } from '../../../domain/repositories/IResumeRepository';

export const roleFromTitle = (title: string, fallback: string): string =>
  title.replace(/ Resume$/i, '').replace(/Resume$/i, '').trim() || fallback;

export const monogramOf = (item: ResumeListItem): string => {
  const src = (item.company || item.title || '?').trim();
  return (src.charAt(0) || '?').toUpperCase();
};

interface Props {
  item: ResumeListItem;
  builtLabel: string;
  onOpen: (id: string) => void;
  /** Deletes the toolkit and refreshes the caller's list; awaited for the busy state. */
  onDelete: (id: string) => Promise<void>;
}

export const ToolkitCard: React.FC<Props> = ({ item, builtLabel, onOpen, onDelete }) => {
  const t = useT();
  const role = roleFromTitle(item.title, t('dashboard.untitledRole'));
  const company = item.company || role;

  const [menuOpen, setMenuOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Dismiss on outside click / Escape. Listeners are mounted only while open so
  // a grid of idle cards doesn't keep one each.
  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setMenuOpen(false); buttonRef.current?.focus(); }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  const handleDelete = async () => {
    if (deleting) return;
    if (!window.confirm(t('dashboard.confirmDelete'))) return;
    setDeleting(true);
    try {
      await onDelete(item.id);
      setMenuOpen(false); // usually moot — the refresh unmounts this card
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="group relative rounded-2xl border border-charcoal-200 bg-white shadow-[0_2px_6px_rgba(25,23,18,0.04)] transition-all duration-150 hover:-translate-y-0.5 hover:border-accent-400 hover:shadow-[0_12px_28px_-10px_rgba(232,150,15,0.25)]">
      <a
        href="#"
        onClick={(e) => { e.preventDefault(); onOpen(item.id); }}
        className="block rounded-2xl p-[22px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 focus-visible:ring-offset-2"
      >
        <span className="mb-3.5 flex items-center gap-3 pr-11 sm:pr-8">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px] bg-charcoal-100 font-display text-base font-bold text-charcoal-500">
            {monogramOf(item)}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[15px] font-semibold text-brand-700">{company}</span>
            <span className="mt-px block truncate text-[13px] text-charcoal-500">{role}</span>
          </span>
        </span>
        <span className="flex items-center justify-between border-t border-charcoal-100 pt-3">
          <span className="text-[12.5px] text-charcoal-400">{builtLabel}</span>
          <span className="inline-flex items-center gap-1 text-[13px] font-semibold text-accent-600">
            {t('dashboard.open')} →
          </span>
        </span>
      </a>

      <div ref={menuRef} className="absolute right-1.5 top-1.5 sm:right-2.5 sm:top-2.5">
        <button
          ref={buttonRef}
          type="button"
          aria-label={t('dashboard.appActionsLabel')}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
          className={`flex h-11 w-11 items-center justify-center rounded-full transition-colors hover:bg-charcoal-50 hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 sm:h-9 sm:w-9 ${menuOpen ? 'bg-charcoal-50 text-brand-700' : 'text-charcoal-300 group-hover:text-charcoal-500'}`}
        >
          <MoreVertical size={18} />
        </button>

        {menuOpen && (
          <div
            role="menu"
            className="absolute right-0 top-full z-20 mt-1 w-44 overflow-hidden rounded-xl border border-charcoal-200 bg-white py-1 shadow-[0_12px_28px_-8px_rgba(25,23,18,0.22)]"
          >
            <button
              type="button"
              role="menuitem"
              disabled={deleting}
              onClick={handleDelete}
              className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-red-600 transition-colors hover:bg-red-50 disabled:opacity-60"
            >
              {deleting ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
              {t('dashboard.delete')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
