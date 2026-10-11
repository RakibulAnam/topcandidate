// PasteReturnPrompt — a floating "Found a job? Paste the ad here" pill on Home.
//
// The gap it closes: a user taps a job-discovery tile, the board opens in a
// new tab, they find an ad and come back… to whatever part of the page they
// left, with nothing pointing at the paste box several screens up. This is
// help pulled by a signal (they opened a board and returned), not pushed on
// load: the caller shows it only after a job-tile click followed by the tab
// becoming visible again, and only while the paste box is still empty.
//
// It floats above the phone tab bar (bottom-right on desktop) and goes away on
// tap, on ✕, or as soon as the box has text. Orange, like the welcome banner it
// continues — navy disappeared against the navy job board it usually sits over.
import React, { useEffect } from 'react';
import { ClipboardPaste, X } from 'lucide-react';
import { useT } from '../../i18n/LocaleContext';
import { track } from '../../../infrastructure/analytics/track';

interface Props {
  onPaste: () => void;
  onClose: () => void;
}

export const PasteReturnPrompt = ({ onPaste, onClose }: Props) => {
  const t = useT();

  useEffect(() => { track('paste_prompt_shown'); }, []);

  return (
    <div
      role="status"
      className="wb-enter fixed inset-x-4 bottom-[calc(64px+env(safe-area-inset-bottom))] z-40 mx-auto flex max-w-[460px] items-center gap-1 rounded-2xl bg-accent-400 p-1.5 pl-2 shadow-[0_18px_40px_-12px_rgba(15,27,45,0.55)] ring-2 ring-white lg:inset-x-auto lg:bottom-8 lg:right-8"
    >
      <button
        type="button"
        onClick={() => { track('paste_prompt_click'); onPaste(); }}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-2 py-2 text-left text-brand-800 transition-colors hover:bg-brand-800/5"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-700 text-accent-300">
          <ClipboardPaste size={18} />
        </span>
        <span className="min-w-0 text-[14.5px] font-bold leading-snug">{t('dashboard.pastePrompt')}</span>
      </button>
      <button
        type="button"
        onClick={onClose}
        aria-label={t('dashboard.wbHide')}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-brand-800/70 transition-colors hover:bg-brand-800/10 hover:text-brand-800"
      >
        <X size={17} />
      </button>
    </div>
  );
};
