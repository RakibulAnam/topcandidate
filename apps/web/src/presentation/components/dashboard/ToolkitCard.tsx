// ToolkitCard — the recent-toolkit / all-toolkits grid card from the redesign.
// Shared by the Home grid and the All Toolkits screen so they stay identical.
//
// A tailored resume's "role" is derived from its title (trailing "Resume"
// stripped, matching the legacy dashboard), and the monogram is the company's
// (or role's) first letter until real company logos exist.
import React from 'react';
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
}

export const ToolkitCard: React.FC<Props> = ({ item, builtLabel, onOpen }) => {
  const t = useT();
  const role = roleFromTitle(item.title, t('dashboard.untitledRole'));
  const company = item.company || role;
  return (
    <a
      href="#"
      onClick={(e) => { e.preventDefault(); onOpen(item.id); }}
      className="group block rounded-2xl border border-charcoal-200 bg-white p-[22px] shadow-[0_2px_6px_rgba(25,23,18,0.04)] transition-all duration-150 hover:-translate-y-0.5 hover:border-accent-400 hover:shadow-[0_12px_28px_-10px_rgba(232,150,15,0.25)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 focus-visible:ring-offset-2"
    >
      <span className="mb-3.5 flex items-center gap-3">
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
  );
};
