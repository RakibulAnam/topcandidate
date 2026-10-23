// Landing "See demo" — a full-screen, interactive walkthrough of how one job
// application kit gets made, for visitors who have not signed up yet (issue
// #59). Four stages, each driven by a timeline of "beats":
//   1. a job post is copied off a job board and pasted into the app's box
//   2. the job's requirements are matched against a sample profile
//   3. the five pieces of the kit assemble
//   4. a mock kit the visitor can browse tab by tab, ending in the CTA
// Stages 1–3 play on their own and advance automatically; Next / Skip to the
// kit / the step bar jump at any point. Under prefers-reduced-motion every
// stage renders its final state at once and nothing auto-advances.
//
// Lazy-loaded from LandingScreen (React.lazy) so none of this ships with the
// landing page's first load. All sample content lives in demoData.ts and is
// fictional. Copy obeys the toolkit positioning: never "AI" in user-facing text.

import React, { useEffect, useRef, useState } from 'react';
import {
  X, ArrowRight, Check, Copy, RotateCcw, FileText, Mail, MessagesSquare, PenLine, UserPlus,
  ClipboardPaste, MousePointer2, Briefcase, MapPin, CalendarDays, CircleCheck, CircleDashed,
} from 'lucide-react';
import { useT } from '../../i18n/LocaleContext';
import { track } from '../../../infrastructure/analytics/track';
import {
  DEMO_JOB, DEMO_JD_PASTE, DEMO_PROFILE, DEMO_MATCHES, DEMO_RESUME, DEMO_COVER_LETTER,
  DEMO_EMAIL, DEMO_LINKEDIN, DEMO_INTERVIEW,
} from './demoData';

interface Props {
  onClose: () => void;
  onGetStarted: () => void;
}

/** Beat times (ms from stage start) for the three animated stages. */
const BEATS: number[][] = [
  [700, 1900, 2700, 3400],                          // copy: select, copied, box, paste
  [500, 1200, 1900, 2600, 3300, 4000, 4700, 5500],  // match: scan, 6 rows, summary
  [500, 1200, 1900, 2600, 3300, 4100],              // build: 5 rows, done
];
/** Pause on a finished stage before moving on by itself. */
const ADVANCE_AFTER = [7600, 7200, 5800];
const STAGES = 4;
const KIT_STAGE = 3;

type Tab = 'resume' | 'cover' | 'email' | 'linkedin' | 'interview';

/** On a phone the stages stack, so the part that is animating can sit below
 *  the fold. Bring it into view — only when it isn't already fully visible,
 *  so the page doesn't twitch on a desktop where everything fits. */
const revealIfHidden = (el: HTMLElement | null, smooth: boolean) => {
  if (!el) return;
  const r = el.getBoundingClientRect();
  const vh = window.innerHeight || document.documentElement.clientHeight;
  if (r.top >= 56 && r.bottom <= vh - 72) return; // clear of header + footer
  el.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'center' });
};

const prefersReducedMotion = (): boolean => {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};

const DemoWalkthrough: React.FC<Props> = ({ onClose, onGetStarted }) => {
  const t = useT();
  const reduced = useRef(prefersReducedMotion()).current;
  const [stage, setStage] = useState(0);
  const [beat, setBeat] = useState(0);
  // Bumped by Replay so the same stage restarts its timeline.
  const [run, setRun] = useState(0);
  const [tab, setTab] = useState<Tab>('resume');
  const openedAt = useRef(Date.now());
  const dialogRef = useRef<HTMLDivElement>(null);

  // ── Timeline ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const beats = BEATS[stage] ?? [];
    if (reduced || beats.length === 0) {
      setBeat(beats.length);
      return;
    }
    setBeat(0);
    const timers = beats.map((ms, i) => window.setTimeout(() => setBeat(i + 1), ms));
    timers.push(window.setTimeout(() => setStage((s) => (s === stage ? s + 1 : s)), ADVANCE_AFTER[stage]));
    return () => timers.forEach((id) => window.clearTimeout(id));
  }, [stage, run, reduced]);

  useEffect(() => {
    track('demo_step', { n: stage + 1 });
  }, [stage]);

  // Each stage starts at its top — the scroll container outlives the stages.
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => { scrollRef.current?.scrollTo({ top: 0 }); }, [stage, run]);

  // ── Dialog plumbing: scroll lock, Escape, initial focus ────────────────────
  const close = () => {
    track('demo_closed', { step: stage + 1, seconds: Math.round((Date.now() - openedAt.current) / 1000) });
    onClose();
  };
  const closeRefFn = useRef(close);
  closeRefFn.current = close;

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRefFn.current(); };
    window.addEventListener('keydown', onKey);
    // Focus the dialog itself (not the ✕, which would wear a focus ring the
    // whole demo): screen readers announce it, Tab reaches every control.
    dialogRef.current?.focus();
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  const goTo = (s: number) => setStage(Math.max(0, Math.min(STAGES - 1, s)));
  const replay = () => { setTab('resume'); setStage(0); setRun((r) => r + 1); };

  const cta = () => {
    track('demo_cta_click', { step: stage + 1 });
    onClose();
    onGetStarted();
  };

  const stageTitle = [t('demo.s1Title'), t('demo.s2Title'), t('demo.s3Title'), t('demo.s4Title')][stage];
  const stageBody = [t('demo.s1Body'), t('demo.s2Body'), t('demo.s3Body'), t('demo.s4Body')][stage];

  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      className="fixed inset-0 z-[70] flex flex-col bg-paper text-brand-700 outline-none"
      role="dialog"
      aria-modal="true"
      aria-label={t('demo.dialogLabel')}
    >
      {/* ── Header: badge, step bar, close ── */}
      <header className="shrink-0 border-b border-charcoal-200 bg-charcoal-50/90 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4 sm:px-6">
          <span className="rounded-full bg-accent-100 px-2.5 py-1 text-[10.5px] font-bold demo-eyebrow uppercase tracking-[0.2em] text-accent-700">
            {t('demo.badge')}
          </span>
          <nav className="flex flex-1 items-center gap-1.5" aria-label={t('demo.stepOf', { n: stage + 1, total: STAGES })}>
            {Array.from({ length: STAGES }, (_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => goTo(i)}
                aria-label={t('demo.stepOf', { n: i + 1, total: STAGES })}
                aria-current={i === stage ? 'step' : undefined}
                className="group flex h-8 flex-1 items-center"
              >
                <span className={`h-1.5 w-full rounded-full transition-colors ${i < stage ? 'bg-brand-700' : i === stage ? 'bg-accent-500' : 'bg-charcoal-200 group-hover:bg-charcoal-300'}`} />
              </button>
            ))}
          </nav>
          <button
            type="button"
            onClick={close}
            className="-mr-2 rounded-full p-2 text-charcoal-500 outline-none transition-colors hover:bg-charcoal-100 hover:text-brand-700 focus-visible:ring-2 focus-visible:ring-accent-500"
            aria-label={t('demo.close')}
          >
            <X size={20} />
          </button>
        </div>
      </header>

      {/* ── Stage ── */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-4 pb-8 pt-5 sm:px-6 sm:pt-8">
          <div key={`h-${stage}-${run}`} className="demo-in mb-5 sm:mb-7">
            <p className="text-[11px] font-semibold demo-eyebrow uppercase tracking-[0.2em] text-accent-600">
              {t('demo.stepOf', { n: stage + 1, total: STAGES })}
            </p>
            <h2 className="mt-1 font-display text-[clamp(1.5rem,5vw,2.25rem)] font-semibold leading-tight text-brand-700">
              {stageTitle}
            </h2>
            <p className="mt-1.5 max-w-2xl text-[14.5px] leading-relaxed text-brand-500 sm:text-[15.5px]">{stageBody}</p>
          </div>

          {stage === 0 && <CopyPasteStage beat={beat} reduced={reduced} key={`s0-${run}`} />}
          {stage === 1 && <MatchStage beat={beat} key={`s1-${run}`} />}
          {stage === 2 && <BuildStage beat={beat} key={`s2-${run}`} />}
          {stage === KIT_STAGE && <KitStage tab={tab} onTab={(next) => { setTab(next); track('demo_tab_viewed', { tab: next }); }} />}
        </div>
      </div>

      {/* ── Footer ── */}
      <footer className="shrink-0 border-t border-charcoal-200 bg-charcoal-50 pb-[env(safe-area-inset-bottom)]">
        {stage < KIT_STAGE ? (
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
            <button
              type="button"
              onClick={() => goTo(KIT_STAGE)}
              className="min-h-11 px-1 text-[14px] font-semibold text-brand-500 underline-offset-4 hover:text-brand-700 hover:underline"
            >
              {t('demo.skipToKit')}
            </button>
            <button
              type="button"
              onClick={() => goTo(stage + 1)}
              className="inline-flex min-h-11 items-center gap-2 rounded-full bg-brand-700 px-5 text-[14.5px] font-semibold text-charcoal-50 transition-colors hover:bg-brand-800"
            >
              {t('demo.next')}
              <ArrowRight size={16} />
            </button>
          </div>
        ) : (
          <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <div className="hidden min-w-0 sm:block">
              <p className="text-[14.5px] font-semibold text-brand-700">{t('demo.ctaTitle')}</p>
              <p className="text-[13px] text-brand-500">{t('demo.ctaBody')}</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={replay}
                aria-label={t('demo.replay')}
                className="inline-flex min-h-12 items-center justify-center gap-1.5 rounded-full border border-charcoal-300 px-4 text-[14px] font-semibold text-brand-700 transition-colors hover:border-brand-700"
              >
                <RotateCcw size={15} />
                <span className="hidden sm:inline">{t('demo.replay')}</span>
              </button>
              <button
                type="button"
                onClick={cta}
                className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-full bg-accent-500 px-6 text-[15px] font-semibold text-brand-800 transition-colors hover:bg-accent-400 sm:flex-none"
              >
                {t('demo.cta')}
                <ArrowRight size={17} />
              </button>
            </div>
          </div>
        )}
      </footer>
    </div>
  );
};

export default DemoWalkthrough;

// ─────────────────────────────────────────────────────────────────────────────
// Stage 1 — copy the job post, paste it into the app
// ─────────────────────────────────────────────────────────────────────────────

const CopyPasteStage: React.FC<{ beat: number; reduced: boolean }> = ({ beat, reduced }) => {
  const t = useT();
  const selecting = beat >= 1;
  const copied = beat >= 2;
  const showBox = beat >= 3;
  const pasting = beat >= 4;
  const [chars, setChars] = useState(reduced ? DEMO_JD_PASTE.length : 0);

  // Typewriter for the pasted text — fast, it is a paste, not typing.
  useEffect(() => {
    if (!pasting) return;
    if (reduced) { setChars(DEMO_JD_PASTE.length); return; }
    let n = 0;
    const id = window.setInterval(() => {
      n = Math.min(DEMO_JD_PASTE.length, n + 9);
      setChars(n);
      if (n >= DEMO_JD_PASTE.length) window.clearInterval(id);
    }, 16);
    return () => window.clearInterval(id);
  }, [pasting, reduced]);

  const done = chars >= DEMO_JD_PASTE.length;
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (showBox && !reduced) revealIfHidden(boxRef.current, true);
  }, [showBox, reduced]);

  return (
    <div className="grid gap-4 md:grid-cols-2 md:gap-6">
      {/* The job ad, on a generic job board */}
      <div className="demo-in relative overflow-hidden rounded-2xl border border-charcoal-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-[11px] font-semibold demo-eyebrow uppercase tracking-[0.18em] text-charcoal-500">{t('demo.s1Board')}</span>
          {copied && (
            <span className="demo-pop inline-flex items-center gap-1 rounded-full bg-brand-700 px-2.5 py-1 text-[11.5px] font-semibold text-charcoal-50">
              <Copy size={12} /> {t('demo.s1Copied')}
            </span>
          )}
        </div>
        <div className="flex items-start gap-3">
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-charcoal-100 text-brand-600">
            <Briefcase size={18} />
          </span>
          <div className="min-w-0">
            <p className="text-[16px] font-semibold leading-snug text-brand-700">{DEMO_JOB.title}</p>
            <p className="text-[13.5px] text-brand-500">{DEMO_JOB.company}</p>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-charcoal-500">
              <span className="inline-flex items-center gap-1"><MapPin size={12} />{DEMO_JOB.location}</span>
              <span className="inline-flex items-center gap-1"><CalendarDays size={12} />{DEMO_JOB.deadline}</span>
            </div>
          </div>
        </div>
        <div className="relative mt-4">
          {/* The selection sweeping over the ad body */}
          {selecting && <span aria-hidden className="demo-select absolute -inset-1 rounded-md bg-accent-200/70" />}
          <div className="relative">
            <p className="text-[13px] leading-relaxed text-brand-600">{DEMO_JOB.intro}</p>
            <p className="mt-2.5 text-[12px] font-semibold uppercase tracking-[0.14em] text-brand-500">Requirements</p>
            <ul className="mt-1.5 space-y-1">
              {DEMO_JOB.requirements.map((r) => (
                <li key={r} className="flex gap-2 text-[13px] leading-snug text-brand-600">
                  <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-brand-400" />
                  {r}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* The app's job box */}
      <div ref={boxRef} className={`relative ${showBox ? 'demo-in' : 'invisible md:visible md:opacity-40'}`}>
        <div className="rounded-2xl bg-brand-700 p-4 text-charcoal-50 shadow-[0_20px_50px_-24px_rgba(9,18,31,0.6)] sm:p-5">
          <p className="text-[15px] font-semibold">{t('demo.s1BoxLabel')}</p>
          <div className="relative mt-3 h-[188px] overflow-hidden rounded-xl border border-white/15 bg-white/[0.06] p-3.5 md:h-[300px]">
            {pasting ? (
              <pre className="whitespace-pre-wrap font-sans text-[12.5px] leading-relaxed text-charcoal-100">
                {DEMO_JD_PASTE.slice(0, chars)}
                {!done && <span className="demo-caret ml-px inline-block h-3.5 w-[2px] translate-y-0.5 bg-accent-400" />}
              </pre>
            ) : (
              <p className="text-[13px] text-charcoal-400">
                {t('demo.s1BoxPlaceholder')}
                {showBox && <span className="demo-caret ml-0.5 inline-block h-3.5 w-[2px] translate-y-0.5 bg-accent-400" />}
              </p>
            )}
            {showBox && !pasting && (
              <span aria-hidden className="demo-cursor absolute bottom-6 right-8 inline-flex items-center gap-1 rounded-full bg-accent-500 px-2.5 py-1 text-[11.5px] font-semibold text-brand-800 shadow-lg">
                <MousePointer2 size={13} /> <ClipboardPaste size={13} />
              </span>
            )}
          </div>
          <div className="mt-3 flex min-h-6 items-center gap-1.5 text-[13px]">
            {done && (
              <span className="demo-pop inline-flex items-center gap-1.5 font-semibold text-accent-300">
                <CircleCheck size={16} /> {t('demo.s1Pasted')}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Stage 2 — match the job against the profile
// ─────────────────────────────────────────────────────────────────────────────

const MatchStage: React.FC<{ beat: number }> = ({ beat }) => {
  const t = useT();
  const revealed = Math.max(0, Math.min(DEMO_MATCHES.length, beat - 1)); // beats 2..7 → rows 1..6
  const scanning = beat >= 1 && revealed < DEMO_MATCHES.length;
  const lit = new Set(DEMO_MATCHES.slice(0, revealed).map((m) => m.profileId));
  const current = revealed > 0 ? DEMO_MATCHES[revealed - 1].profileId : null;
  const matched = DEMO_MATCHES.filter((m) => m.status === 'matched').length;
  const showSummary = beat >= DEMO_MATCHES.length + 2;
  const rowRefs = useRef<(HTMLLIElement | null)[]>([]);
  const summaryRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (showSummary) revealIfHidden(summaryRef.current, true);
    else if (revealed > 0) revealIfHidden(rowRefs.current[revealed - 1], true);
  }, [revealed, showSummary]);

  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:gap-6">
      {/* Profile — after the requirements on a phone, where the matching is the story */}
      <div className="demo-in order-2 rounded-2xl border border-charcoal-200 bg-white p-4 sm:p-5 md:order-none">
        <p className="text-[11px] font-semibold demo-eyebrow uppercase tracking-[0.18em] text-charcoal-500">{t('demo.s2Profile')}</p>
        <div className="mt-2.5 flex items-center gap-3">
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-700 text-[13px] font-semibold text-charcoal-50">TR</span>
          <div>
            <p className="text-[15px] font-semibold leading-tight">{DEMO_PROFILE.name}</p>
            <p className="text-[12.5px] text-brand-500">{DEMO_PROFILE.headline}</p>
          </div>
        </div>
        <ul className="mt-3.5 space-y-2">
          {DEMO_PROFILE.items.map((item) => (
            <li
              key={item.id}
              className={`rounded-lg border px-3 py-2 text-[12.5px] leading-snug transition-all duration-300 ${
                item.id === current
                  ? 'border-accent-500 bg-accent-50 text-brand-700 ring-2 ring-accent-200'
                  : lit.has(item.id)
                    ? 'border-charcoal-300 bg-charcoal-50 text-brand-700'
                    : 'border-charcoal-200 text-brand-500'
              }`}
            >
              {item.label}
            </li>
          ))}
        </ul>
      </div>

      {/* Requirements with match results */}
      <div className="demo-in relative order-1 overflow-hidden rounded-2xl border border-charcoal-200 bg-white p-4 sm:p-5 md:order-none">
        {scanning && <span aria-hidden className="demo-scan absolute inset-x-0 h-10 bg-accent-100/60" />}
        <p className="relative text-[11px] font-semibold demo-eyebrow uppercase tracking-[0.18em] text-charcoal-500">
          {t('demo.s2Job')} · {DEMO_JOB.company}
        </p>
        <ul className="relative mt-3 space-y-2.5">
          {DEMO_JOB.requirements.map((req, i) => {
            const m = DEMO_MATCHES[i];
            const shown = i < revealed;
            return (
              <li key={req} ref={(el) => { rowRefs.current[i] = el; }} className="flex items-start gap-2.5">
                <span className="mt-0.5 shrink-0">
                  {shown ? (
                    m.status === 'matched'
                      ? <CircleCheck size={18} className="demo-pop text-emerald-600" />
                      : <CircleDashed size={18} className="demo-pop text-accent-600" />
                  ) : (
                    <span className="block h-[18px] w-[18px] rounded-full border-2 border-charcoal-200" />
                  )}
                </span>
                <div className="min-w-0">
                  <p className={`text-[13.5px] leading-snug ${shown ? 'text-brand-700' : 'text-brand-500'}`}>{req}</p>
                  {shown && (
                    <p className="demo-in mt-0.5 text-[12px] text-charcoal-500">
                      <span className={`mr-1.5 font-semibold ${m.status === 'matched' ? 'text-emerald-700' : 'text-accent-700'}`}>
                        {m.status === 'matched' ? t('demo.s2Matched') : t('demo.s2Partial')}
                      </span>
                      {t('demo.s2From', { source: m.source })}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        {showSummary && (
          <p ref={summaryRef} className="demo-pop relative mt-4 rounded-xl bg-brand-700 px-3.5 py-2.5 text-[13px] font-semibold text-charcoal-50">
            {t('demo.s2Summary', { matched, total: DEMO_MATCHES.length })}
          </p>
        )}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Stage 3 — the kit assembles
// ─────────────────────────────────────────────────────────────────────────────

const BuildStage: React.FC<{ beat: number }> = ({ beat }) => {
  const t = useT();
  const rows = [
    { icon: FileText, label: t('demo.s3Resume') },
    { icon: PenLine, label: t('demo.s3Cover') },
    { icon: Mail, label: t('demo.s3Email') },
    { icon: UserPlus, label: t('demo.s3Linkedin') },
    { icon: MessagesSquare, label: t('demo.s3Interview') },
  ];
  const doneCount = Math.min(rows.length, beat);
  const allDone = beat > rows.length;

  return (
    <div className="mx-auto max-w-xl">
      <ul className="space-y-2.5">
        {rows.map(({ icon: Icon, label }, i) => {
          const done = i < doneCount;
          const active = i === doneCount && !allDone;
          return (
            <li
              key={label}
              className={`demo-in relative overflow-hidden rounded-2xl border bg-white px-4 py-3.5 transition-colors ${done ? 'border-brand-700' : 'border-charcoal-200'}`}
              style={{ animationDelay: `${i * 60}ms` }}
            >
              {active && <span aria-hidden className="demo-fill absolute inset-y-0 left-0 w-full bg-accent-50" />}
              <div className="relative flex items-center gap-3">
                <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${done ? 'bg-brand-700 text-charcoal-50' : 'bg-charcoal-100 text-brand-500'}`}>
                  <Icon size={17} />
                </span>
                <span className={`flex-1 text-[14.5px] font-semibold ${done ? 'text-brand-700' : 'text-brand-500'}`}>{label}</span>
                {done ? (
                  <Check size={18} strokeWidth={3} className="demo-pop text-emerald-600" />
                ) : (
                  <span className={`h-2 w-2 rounded-full ${active ? 'bg-accent-500' : 'bg-charcoal-200'}`} />
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {allDone && (
        <p className="demo-in mt-4 text-center text-[13px] text-brand-500">{t('demo.s3Time')}</p>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Stage 4 — browse the mock kit
// ─────────────────────────────────────────────────────────────────────────────

const KitStage: React.FC<{ tab: Tab; onTab: (t: Tab) => void }> = ({ tab, onTab }) => {
  const t = useT();
  const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: 'resume', label: t('demo.tabResume'), icon: FileText },
    { id: 'cover', label: t('demo.tabCover'), icon: PenLine },
    { id: 'email', label: t('demo.tabEmail'), icon: Mail },
    { id: 'linkedin', label: t('demo.tabLinkedin'), icon: UserPlus },
    { id: 'interview', label: t('demo.tabInterview'), icon: MessagesSquare },
  ];

  return (
    <div className="demo-in">
      <div role="tablist" aria-label={t('demo.s4Title')} className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={(e) => { onTab(id); e.currentTarget.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' }); }}
            className={`inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-[13.5px] font-semibold transition-colors ${
              tab === id ? 'border-brand-700 bg-brand-700 text-charcoal-50' : 'border-charcoal-300 bg-white text-brand-600 hover:border-brand-700'
            }`}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </div>

      <div role="tabpanel" key={tab} className="demo-in">
        {tab === 'resume' && <ResumePane />}
        {tab === 'cover' && <TextPane text={DEMO_COVER_LETTER} />}
        {tab === 'email' && <EmailPane />}
        {tab === 'linkedin' && <LinkedInPane />}
        {tab === 'interview' && <InterviewPane />}
      </div>
      <p className="mt-3 text-center text-[12px] text-charcoal-500">{t('demo.sampleNote')}</p>
    </div>
  );
};

const Paper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="mx-auto max-w-3xl rounded-2xl border border-charcoal-200 bg-white p-5 shadow-[0_24px_60px_-34px_rgba(9,18,31,0.45)] sm:p-8">
    {children}
  </div>
);

const CopyChip: React.FC<{ text: string; item: Tab }> = ({ text, item }) => {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      track('demo_copy', { item });
      window.setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard blocked — nothing to do in a demo */ }
  };
  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-charcoal-300 px-3 text-[12.5px] font-semibold text-brand-700 transition-colors hover:border-brand-700"
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
      {copied ? t('demo.copied') : t('demo.copy')}
    </button>
  );
};

const SectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="mb-2 border-b border-charcoal-200 pb-1 text-[10.5px] font-bold uppercase tracking-[0.2em] text-brand-500">{children}</p>
);

const ResumePane: React.FC = () => (
  <Paper>
    <div className="text-center">
      <p className="font-display text-[24px] font-semibold leading-none text-brand-700">{DEMO_RESUME.name}</p>
      <p className="mt-2 text-[11.5px] text-brand-500">{DEMO_RESUME.contact}</p>
    </div>
    <div className="mt-5">
      <SectionLabel>Summary</SectionLabel>
      <p className="text-[13px] leading-relaxed text-brand-600">{DEMO_RESUME.summary}</p>
    </div>
    <div className="mt-5">
      <SectionLabel>Experience</SectionLabel>
      <div className="space-y-4">
        {DEMO_RESUME.experience.map((x) => (
          <div key={x.role}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <p className="text-[13.5px] font-semibold text-brand-700">{x.role} · <span className="font-normal text-brand-600">{x.org}</span></p>
              <p className="font-mono text-[11px] text-brand-400">{x.dates}</p>
            </div>
            <ul className="mt-1.5 space-y-1.5">
              {x.bullets.map((b) => (
                <li key={b} className="flex gap-2 text-[12.5px] leading-snug text-brand-600">
                  <span className="mt-[6px] h-1 w-1 shrink-0 rounded-full bg-accent-500" />
                  {b}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
    <div className="mt-5">
      <SectionLabel>Education</SectionLabel>
      <p className="text-[12.5px] text-brand-600">{DEMO_RESUME.education}</p>
    </div>
    <div className="mt-5">
      <SectionLabel>Certification</SectionLabel>
      <p className="text-[12.5px] text-brand-600">{DEMO_RESUME.certification}</p>
    </div>
    <div className="mt-5">
      <SectionLabel>Skills</SectionLabel>
      <div className="flex flex-wrap gap-1.5">
        {DEMO_RESUME.skills.map((s) => (
          <span key={s} className="rounded border border-charcoal-200 bg-charcoal-100 px-2 py-0.5 text-[11.5px] text-brand-600">{s}</span>
        ))}
      </div>
    </div>
  </Paper>
);

const TextPane: React.FC<{ text: string }> = ({ text }) => (
  <Paper>
    <div className="mb-3 flex justify-end"><CopyChip text={text} item="cover" /></div>
    <div className="whitespace-pre-line font-display text-[14.5px] leading-relaxed text-brand-700">{text}</div>
  </Paper>
);

const EmailPane: React.FC = () => {
  const t = useT();
  return (
    <Paper>
      <div className="mb-4 flex items-start justify-between gap-3 border-b border-charcoal-200 pb-3">
        <div className="min-w-0">
          <p className="text-[10.5px] font-bold demo-eyebrow uppercase tracking-[0.2em] text-brand-500">{t('demo.subjectLabel')}</p>
          <p className="mt-1 text-[14px] font-semibold leading-snug text-brand-700">{DEMO_EMAIL.subject}</p>
        </div>
        <CopyChip text={`${DEMO_EMAIL.subject}\n\n${DEMO_EMAIL.body}`} item="email" />
      </div>
      <div className="whitespace-pre-line text-[13.5px] leading-relaxed text-brand-600">{DEMO_EMAIL.body}</div>
    </Paper>
  );
};

const LinkedInPane: React.FC = () => {
  const t = useT();
  return (
    <Paper>
      <div className="mx-auto max-w-md">
        <div className="rounded-2xl border border-charcoal-200 bg-charcoal-50 p-4">
          <p className="text-[14px] leading-relaxed text-brand-700">{DEMO_LINKEDIN}</p>
        </div>
        <div className="mt-3 flex items-center justify-between">
          <span className="font-mono text-[11.5px] text-charcoal-500">{t('demo.charCount', { n: DEMO_LINKEDIN.length })}</span>
          <CopyChip text={DEMO_LINKEDIN} item="linkedin" />
        </div>
      </div>
    </Paper>
  );
};

const InterviewPane: React.FC = () => {
  const t = useT();
  const [lang, setLang] = useState<'en' | 'bn'>('en');
  const [open, setOpen] = useState(0);
  return (
    <Paper>
      <div className="mb-4 flex justify-end">
        <div className="inline-flex rounded-full border border-charcoal-300 p-0.5" role="group">
          {(['en', 'bn'] as const).map((l) => (
            <button
              key={l}
              type="button"
              aria-pressed={lang === l}
              onClick={() => setLang(l)}
              className={`min-h-8 rounded-full px-3 text-[12.5px] font-semibold transition-colors ${lang === l ? 'bg-brand-700 text-charcoal-50' : 'text-brand-600'}`}
            >
              {l === 'en' ? t('demo.langEn') : t('demo.langBn')}
            </button>
          ))}
        </div>
      </div>
      <ol className="space-y-3">
        {DEMO_INTERVIEW.map((q, i) => {
          const isOpen = open === i;
          return (
            <li key={q.q} className="rounded-xl border border-charcoal-200">
              <button
                type="button"
                onClick={() => setOpen(isOpen ? -1 : i)}
                aria-expanded={isOpen}
                className="flex w-full items-start gap-3 px-4 py-3 text-left"
              >
                <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-100 text-[12px] font-bold text-accent-700">{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[10.5px] font-bold uppercase tracking-[0.16em] text-charcoal-500">{q.category}</span>
                  <span className="mt-0.5 block text-[14px] font-semibold leading-snug text-brand-700">{lang === 'en' ? q.q : q.qBn}</span>
                </span>
              </button>
              {isOpen && (
                <div className="demo-in space-y-2.5 border-t border-charcoal-200 px-4 py-3">
                  <div>
                    <p className="text-[11px] font-bold demo-eyebrow uppercase tracking-[0.16em] text-accent-700">{t('demo.whyAsked')}</p>
                    <p className="mt-0.5 text-[13px] leading-relaxed text-brand-600">{lang === 'en' ? q.why : q.whyBn}</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-bold demo-eyebrow uppercase tracking-[0.16em] text-accent-700">{t('demo.howToAnswer')}</p>
                    <p className="mt-0.5 text-[13px] leading-relaxed text-brand-600">{lang === 'en' ? q.how : q.howBn}</p>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </Paper>
  );
};
