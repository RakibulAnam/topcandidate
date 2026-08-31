// SummaryScreen — the checkpoint between "paste JD" (dashboard) and generation.
// The profile is the single source of truth; this screen reads it, lets the
// user pick which sections to include (→ visibleSections), and shows greyed
// "+ Add" for sections not in the profile yet. Rendered inside DashboardShell.
//
// (First slice: "+ Add" links to the Profile screen; the inline add-drawer that
// saves back to the profile with AI-refine is the next step. Generate hands off
// to the builder's existing generation via autoGenerate.)
//
// CREDIT GATE. The zero-credit check happens HERE, before we hand off — not in
// the builder. The builder has no wizard left to fall back to, so entering it
// without credits used to strand the user on a progress screen for a
// generation that never started. Declining the purchase now simply leaves them
// on this screen with every control intact; completing it hands off
// automatically, because that was plainly what they were trying to do.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, ArrowRight, ChevronDown, Plus, Check, Loader2, Info,
  Briefcase, GraduationCap, Sparkles, FolderGit2, BadgeCheck,
  Languages, Award, Users, Building2, BookOpen, UserCheck,
} from 'lucide-react';
import { useAuth } from '../infrastructure/auth/AuthContext';
import { profileRepository } from '../infrastructure/config/dependencies';
import type { ResumeData } from '../domain/entities';
import { useT } from './i18n/LocaleContext';
import { SectionAddDrawer } from './components/dashboard/SectionAddDrawer';
import { useDashboardShell } from './components/dashboard/DashboardShell';

interface Props {
  targetJob: ResumeData['targetJob'];
  onGenerate: (visibleSections: string[]) => void;
  onBack: () => void;
  onEditProfile: () => void;
}

type Loaded = Record<string, any[]>;

type Sect = { key: string; labelKey: string; Icon: any };

const CORE: Sect[] = [
  { key: 'experience', labelKey: 'builder.stepsExperience', Icon: Briefcase },
  { key: 'education', labelKey: 'builder.stepsEducation', Icon: GraduationCap },
  { key: 'skills', labelKey: 'builder.stepsSkills', Icon: Sparkles },
  { key: 'projects', labelKey: 'builder.stepsProjects', Icon: FolderGit2 },
];

const OPTIONAL: Sect[] = [
  { key: 'certifications', labelKey: 'builder.stepsCertifications', Icon: BadgeCheck },
  { key: 'languages', labelKey: 'builder.stepsLanguages', Icon: Languages },
  { key: 'awards', labelKey: 'builder.stepsAwards', Icon: Award },
  { key: 'extracurriculars', labelKey: 'builder.stepsActivities', Icon: Users },
  { key: 'affiliations', labelKey: 'builder.stepsAffiliations', Icon: Building2 },
  { key: 'publications', labelKey: 'builder.stepsPublications', Icon: BookOpen },
  { key: 'references', labelKey: 'builder.stepsReferences', Icon: UserCheck },
];

const CHIPS = [
  { key: 'chipResume', color: '#B87415', bg: 'rgba(232,150,15,.14)', border: 'rgba(232,150,15,.32)' },
  { key: 'chipCover', color: '#C06A48', bg: 'rgba(224,120,86,.14)', border: 'rgba(224,120,86,.32)' },
  { key: 'chipEmail', color: '#3F8C5E', bg: 'rgba(95,168,118,.16)', border: 'rgba(95,168,118,.34)' },
  { key: 'chipLinkedin', color: '#5F7CB0', bg: 'rgba(107,140,190,.16)', border: 'rgba(107,140,190,.34)' },
  { key: 'chipInterview', color: '#8064B0', bg: 'rgba(150,120,190,.16)', border: 'rgba(150,120,190,.34)' },
] as const;

export const SummaryScreen = ({ targetJob, onGenerate, onBack, onEditProfile }: Props) => {
  const { credits, openPurchase } = useDashboardShell();
  // Set when Generate was pressed at zero credits, so a purchase completed
  // without leaving this screen resumes the hand-off. A ref would not do: the
  // resume is driven by `credits` changing, which only a render can observe.
  //
  // A boolean, NOT a snapshot of the sections: freezing the selection here meant
  // a user who dismissed the sheet, changed their sections (the whole point of
  // the add-drawer), and only then completed a purchase got a generation built
  // from the OLD selection. The live `selected` is read at fire time instead.
  const [pendingGenerate, setPendingGenerate] = useState(false);
  // The balance we were blocked at. If credits never rise above it the intent
  // is not armed, so an unrelated later top-up cannot silently spend a credit.
  const blockedAtCredits = useRef<number | null>(null);
  const { user } = useAuth();
  const t = useT();
  const [data, setData] = useState<Loaded | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [jdOpen, setJdOpen] = useState(false);
  // Credits can land after the sheet closes (bKash confirms out of band), so
  // this watches the balance rather than the modal's lifecycle.
  useEffect(() => {
    if (!pendingGenerate || credits === null || credits <= 0) return;
    // Only fire for credits that arrived AFTER we were blocked.
    if (blockedAtCredits.current !== null && credits <= blockedAtCredits.current) return;
    setPendingGenerate(false);
    blockedAtCredits.current = null;
    onGenerate([...selected]);   // read live, not a frozen snapshot
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [credits, pendingGenerate]);

  const [addSection, setAddSection] = useState<{ key: string; label: string } | null>(null);

  const loadProfile = useCallback(async (): Promise<Loaded | null> => {
    if (!user) return null;
    const [experience, education, skills, projects, certifications, languages, awards, extracurriculars, affiliations, publications, references] = await Promise.all([
      profileRepository.getExperiences(user.id),
      profileRepository.getEducations(user.id),
      profileRepository.getSkills(user.id),
      profileRepository.getProjects(user.id),
      profileRepository.getCertifications(user.id),
      profileRepository.getLanguages(user.id),
      profileRepository.getAwards(user.id),
      profileRepository.getExtracurriculars(user.id),
      profileRepository.getAffiliations(user.id),
      profileRepository.getPublications(user.id),
      profileRepository.getReferences(user.id),
    ]);
    const loaded: Loaded = { experience, education, skills: skills as any[], projects, certifications, languages, awards, extracurriculars, affiliations, publications, references };
    setData(loaded);
    return loaded;
  }, [user?.id]);

  // Initial load defaults the selection to every section that has content.
  // Re-loads after an inline add do NOT reset the selection (see onSaved).
  useEffect(() => {
    loadProfile()
      .then(loaded => { if (loaded) setSelected(new Set(Object.keys(loaded).filter(k => (loaded[k]?.length ?? 0) > 0))); })
      .catch(err => console.warn('summary profile load failed', err));
  }, [loadProfile]);

  const count = (k: string) => data?.[k]?.length ?? 0;
  const has = (k: string) => count(k) > 0;
  const toggle = (k: string) => setSelected(prev => {
    const next = new Set(prev);
    next.has(k) ? next.delete(k) : next.add(k);
    return next;
  });

  const preview = (k: string): string => {
    if (!data) return '';
    if (k === 'experience') return data.experience.slice(0, 3).map((e: any) => e.company).filter(Boolean).join(', ');
    if (k === 'education') return data.education.slice(0, 2).map((e: any) => e.school).filter(Boolean).join(', ');
    if (k === 'projects') return data.projects.slice(0, 3).map((p: any) => p.name).filter(Boolean).join(', ');
    if (k === 'skills') return data.skills.slice(0, 6).join(', ');
    return '';
  };
  const countLabel = (k: string) => k === 'skills'
    ? t('summary.skillsCount', { n: count(k) })
    : count(k) === 1 ? t('summary.itemsOne') : t('summary.itemsMany', { n: count(k) });

  const canGenerate = has('experience') || has('education');
  const company = targetJob?.company?.trim();
  const role = targetJob?.title?.trim();

  const coreIncluded = useMemo(() => CORE.filter(s => selected.has(s.key)).length, [selected]);
  const optSelected = useMemo(() => OPTIONAL.filter(s => selected.has(s.key)).length, [selected]);

  const Row: React.FC<{ s: Sect }> = ({ s }) => {
    const filled = has(s.key);
    const on = selected.has(s.key);
    return (
      <div className={`flex items-center gap-3.5 border-b border-[#F0EBDF] px-5 py-[15px] last:border-b-0 ${filled ? '' : 'opacity-90'}`}>
        {filled ? (
          <button
            type="button"
            onClick={() => toggle(s.key)}
            aria-pressed={on}
            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] border-2 transition-colors ${on ? 'border-accent-400 bg-accent-400' : 'border-charcoal-300 bg-white'}`}
          >
            {on && <Check size={12} className="text-white" strokeWidth={3} />}
          </button>
        ) : (
          <span className="h-5 w-5 shrink-0 rounded-[6px] border-2 border-[#E5DFCF] bg-[#F4F1E8]" />
        )}
        <span className={`flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[9px] ${filled ? 'bg-charcoal-100 text-charcoal-500' : 'bg-[#F4F1E8] text-[#C4BDA9]'}`}>
          <s.Icon size={17} />
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block text-[14.5px] font-semibold ${filled ? 'text-brand-700' : 'text-[#8E8877]'}`}>{t(s.labelKey as any)}</span>
          <span className="mt-0.5 block truncate text-[12.5px] text-charcoal-500">
            {filled ? (preview(s.key) || countLabel(s.key)) : t('summary.emptyNote')}
          </span>
        </span>
        {filled ? (
          <span className="whitespace-nowrap text-[12px] font-semibold text-charcoal-400">{countLabel(s.key)}</span>
        ) : (
          <button
            type="button"
            onClick={() => setAddSection({ key: s.key, label: t(s.labelKey as any) })}
            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-accent-50 px-3.5 py-[7px] text-[12.5px] font-semibold text-accent-600 transition-colors hover:bg-accent-100"
          >
            <Plus size={13} strokeWidth={2.6} /> {t('summary.addCta')}
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="pb-24">
      <a
        href="#"
        onClick={(e) => { e.preventDefault(); onBack(); }}
        className="mb-[18px] inline-flex items-center gap-1.5 text-[13px] font-semibold text-charcoal-500 transition-colors hover:text-accent-600"
      >
        <ArrowLeft size={14} /> {t('summary.back')}
      </a>
      <div className="mb-3 text-xs font-bold uppercase tracking-[0.14em] text-accent-600">{t('summary.eyebrow')}</div>
      <h1 className="font-display text-[clamp(28px,4.2vw,38px)] font-semibold leading-[1.1] text-brand-700">
        {company ? t('summary.titleFor', { company }) : t('summary.title')}
      </h1>
      <p className="mt-2.5 mb-7 max-w-[640px] text-[15.5px] leading-relaxed text-charcoal-500">{t('summary.subtitle')}</p>

      {/* Target role */}
      <div className="mb-6 rounded-2xl border border-charcoal-200 bg-white p-[18px_22px] shadow-[0_2px_6px_rgba(25,23,18,.04)]">
        <div className="flex items-center gap-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-50">
            <Briefcase size={20} className="text-accent-600" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[17px] font-semibold text-brand-700">{role || t('summary.noRole')}</h2>
            <div className="truncate text-[13px] text-charcoal-500">{company ? `${company} · ` : ''}{t('summary.pastedJd')}</div>
          </div>
          {targetJob?.description?.trim() && (
            <button
              type="button"
              onClick={() => setJdOpen(v => !v)}
              className="inline-flex items-center gap-1.5 whitespace-nowrap text-[13px] font-semibold text-accent-600"
            >
              {jdOpen ? t('summary.hideJd') : t('summary.viewJd')}
              <ChevronDown size={14} className={`transition-transform ${jdOpen ? 'rotate-180' : ''}`} />
            </button>
          )}
        </div>
        {jdOpen && targetJob?.description?.trim() && (
          <p className="mt-3.5 max-h-40 overflow-y-auto whitespace-pre-wrap border-t border-[#F0EBDF] pt-3.5 text-[13px] leading-relaxed text-charcoal-600">
            {targetJob.description}
          </p>
        )}
      </div>

      {!data ? (
        <div className="flex justify-center py-16"><Loader2 className="animate-spin text-brand-600" size={28} /></div>
      ) : (
        <>
          {/* Core */}
          <div className="mx-1 mb-3 flex items-baseline justify-between">
            <span className="text-xs font-bold uppercase tracking-[0.1em] text-charcoal-500">{t('summary.coreGroup')}</span>
            <span className="text-[12.5px] text-charcoal-400">{t('summary.included', { n: coreIncluded, total: CORE.length })}</span>
          </div>
          <div className="mb-[22px] overflow-hidden rounded-2xl border border-charcoal-200 bg-white shadow-[0_2px_6px_rgba(25,23,18,.04)]">
            {CORE.map(s => <Row key={s.key} s={s} />)}
          </div>

          {/* Optional */}
          <div className="mx-1 mb-3 flex items-baseline justify-between">
            <span className="text-xs font-bold uppercase tracking-[0.1em] text-charcoal-500">{t('summary.optionalGroup')}</span>
            <span className="text-[12.5px] text-charcoal-400">{t('summary.selectedCount', { n: optSelected })}</span>
          </div>
          <div className="mb-[22px] overflow-hidden rounded-2xl border border-charcoal-200 bg-white shadow-[0_2px_6px_rgba(25,23,18,.04)]">
            {OPTIONAL.map(s => <Row key={s.key} s={s} />)}
          </div>

          <div className="mx-1 mb-2 flex items-center gap-2 text-[13px] text-charcoal-500">
            <Info size={15} className="shrink-0 text-accent-600" />
            {canGenerate ? t('summary.hint') : t('summary.gateHint')}
          </div>
        </>
      )}

      {/* Sticky CTA */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-charcoal-200 bg-[rgba(246,244,238,.92)] backdrop-blur-[12px]">
        <div className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-x-5 gap-y-2 px-[clamp(16px,4vw,32px)] py-3.5">
          <span className="text-[13px] text-charcoal-500"><b className="text-brand-700">{t('summary.cost')}</b> {t('summary.youllGet')}</span>
          <span className="hidden flex-wrap gap-1.5 sm:flex">
            {CHIPS.map(c => (
              <span key={c.key} className="rounded-full border px-[11px] py-1 text-[11.5px] font-semibold" style={{ color: c.color, background: c.bg, borderColor: c.border }}>
                {t(`dashboard.${c.key}` as any)}
              </span>
            ))}
          </span>
          <button
            type="button"
            disabled={!canGenerate}
            onClick={() => {
              // credits === null means the balance is still loading or failed
              // to load; let it through and let the server decide rather than
              // blocking someone who does have credits.
              if (credits === 0) {
                blockedAtCredits.current = credits;
                setPendingGenerate(true);
                openPurchase();
                return;
              }
              onGenerate([...selected]);
            }}
            className="ml-auto inline-flex items-center gap-2.5 rounded-xl bg-accent-400 px-[26px] py-3 text-[15px] font-bold text-brand-800 transition-all hover:-translate-y-px hover:bg-accent-300 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
          >
            {t('summary.generateCta')}
            <ArrowRight size={16} />
          </button>
        </div>
      </div>

      {addSection && (
        <SectionAddDrawer
          sectionKey={addSection.key}
          sectionLabel={addSection.label}
          onClose={() => setAddSection(null)}
          onSaved={(key) => {
            setAddSection(null);
            setSelected(prev => new Set(prev).add(key)); // include the just-added section
            void loadProfile();                          // refresh counts/preview from the profile
          }}
        />
      )}
    </div>
  );
};
