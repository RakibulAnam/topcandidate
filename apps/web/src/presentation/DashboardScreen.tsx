// DashboardScreen — the redesigned Home body (the sticky top bar + footer +
// shared credits/master/purchase state live in <DashboardShell>, which wraps
// this). Sections top→bottom: dated welcome hero, the dark inline
// "Start a new application" card, the Master Resume banner, a 6-card recent
// toolkits grid, and the credits + help rows.
//
// The start card captures company/title/JD on the dashboard and hands them to
// App's handleStartFromDashboard, which prefills from the profile and enters
// the builder past the Target Job step. See App.tsx.
import React, { useEffect, useRef, useState } from 'react';
import { Sparkles, ArrowRight, FileText, Loader2, LifeBuoy, AlertTriangle, Mail, Facebook } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../infrastructure/auth/AuthContext';
import { createResumeService, profileRepository } from '../infrastructure/config/dependencies';
import { ResumeService } from '../application/services/ResumeService';
import type { ResumeListItem } from '../domain/repositories/IResumeRepository';
import type { NavScreen } from './hooks/useBrowserNav';
import { useT, useLocale } from './i18n/LocaleContext';
import { CONTACT_FACEBOOK_URL, contactMailto } from './support';
import { ToolkitCard } from './components/dashboard/ToolkitCard';
import { useRelativeTime } from './components/dashboard/relativeTime';
import { useDashboardShell } from './components/dashboard/DashboardShell';

interface Props {
  onStartApplication: (targetJob: { company: string; title: string; description: string }) => void;
  onOpenResume: (id: string) => void;
  onEditProfile: () => void;
  onNavigate: (screen: NavScreen) => void;
}

// The 5 toolkit artifacts, tinted per the redesign. These muted per-artifact
// hues (incl. blue/purple) ride the documented dashboard brand exception
// (apps/web/CLAUDE.md rule 3) — they only ever appear on the dark CTA card.
const CHIPS = [
  { key: 'chipResume', color: '#E8A83E', bg: 'rgba(232,150,15,0.14)', border: 'rgba(232,150,15,0.32)' },
  { key: 'chipCover', color: '#E89A7E', bg: 'rgba(224,120,86,0.14)', border: 'rgba(224,120,86,0.32)' },
  { key: 'chipEmail', color: '#8CC9A0', bg: 'rgba(95,168,118,0.14)', border: 'rgba(95,168,118,0.32)' },
  { key: 'chipLinkedin', color: '#9DB8DF', bg: 'rgba(107,140,190,0.16)', border: 'rgba(107,140,190,0.34)' },
  { key: 'chipInterview', color: '#B7A3D8', bg: 'rgba(150,120,190,0.16)', border: 'rgba(150,120,190,0.34)' },
] as const;

const RECENT_LIMIT = 6;

export const DashboardScreen = ({ onStartApplication, onOpenResume, onEditProfile, onNavigate }: Props) => {
  const { user } = useAuth();
  const t = useT();
  const { locale } = useLocale();
  const rel = useRelativeTime();
  const { credits, generalResume, setGeneralResume, openPurchase } = useDashboardShell();

  const [company, setCompany] = useState('');
  const [title, setTitle] = useState('');
  const [jd, setJd] = useState('');
  const jdRef = useRef<HTMLTextAreaElement>(null);

  const [recent, setRecent] = useState<ResumeListItem[]>([]);
  const [recentTotal, setRecentTotal] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0); // bumped after a delete to refetch the grid
  const [buildingMaster, setBuildingMaster] = useState(false);
  // Profile has neither education nor experience → nothing can be generated.
  const [profileEmpty, setProfileEmpty] = useState(false);

  const firstName = (user?.user_metadata?.full_name as string | undefined)?.split(' ')[0]
    ?? user?.email?.split('@')[0]
    ?? t('dashboard.greetingFallbackName');

  const today = new Date().toLocaleDateString(locale === 'bn' ? 'bn-BD' : 'en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  });

  // Recent toolkits (6) + total company count.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const svc = createResumeService();
    svc.getGeneratedResumesPaginated(user.id, { page: 1, pageSize: RECENT_LIMIT })
      .then(({ items, total }) => { if (!cancelled) { setRecent(items); setRecentTotal(total); } })
      .catch((err) => { if (!cancelled) console.warn('recent toolkits failed', err); });
    // The hard content gate is education OR experience — if both are empty,
    // no toolkit or general resume can be generated. Surface a banner.
    Promise.all([
      profileRepository.getExperiences(user.id).catch(() => []),
      profileRepository.getEducations(user.id).catch(() => []),
    ]).then(([exps, edus]) => { if (!cancelled) setProfileEmpty(exps.length === 0 && edus.length === 0); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, refreshKey]);

  const handleDeleteToolkit = async (id: string) => {
    try {
      await createResumeService().deleteGeneratedResume(id);
      toast.success(t('dashboard.deleted'));
      setRefreshKey((k) => k + 1);
    } catch (err) {
      console.error('Failed to delete toolkit:', err);
      toast.error(t('dashboard.deleteFailed'));
    }
  };

  const handleStart = () => {
    if (!jd.trim()) {
      toast.message(t('dashboard.startNeedJd'));
      jdRef.current?.focus();
      return;
    }
    onStartApplication({ company: company.trim(), title: title.trim(), description: jd.trim() });
  };

  const handleBuildMaster = async () => {
    if (!user || buildingMaster) return;
    setBuildingMaster(true);
    try {
      const id = await createResumeService().generateGeneralResume(user.id);
      toast.success(t('dashboard.masterReady'));
      const now = new Date().toISOString();
      setGeneralResume({ id, title: ResumeService.GENERAL_RESUME_TITLE, date: now, updatedAt: now });
      onOpenResume(id);
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message || t('dashboard.masterError'));
      setBuildingMaster(false);
    }
  };

  const masterUpdatedAt = generalResume?.updatedAt ?? generalResume?.date;

  return (
    <div className="flex flex-col gap-[clamp(28px,4vw,40px)]">
      {/* Incomplete-profile warning — no education/experience means nothing can
          be generated (no toolkits, no general resume). */}
      {profileEmpty && (
        <section>
          <div className="flex flex-col gap-4 rounded-[18px] border border-accent-200 bg-accent-50 px-[clamp(18px,3vw,28px)] py-5 sm:flex-row sm:items-center">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[13px] bg-accent-400 text-brand-800">
              <AlertTriangle size={20} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-display text-[18px] font-semibold text-brand-700">{t('dashboard.profileIncompleteTitle')}</p>
              <p className="mt-1 text-[14px] leading-relaxed text-charcoal-600">{t('dashboard.profileIncompleteBody')}</p>
            </div>
            <button
              type="button"
              onClick={onEditProfile}
              className="inline-flex w-full items-center justify-center gap-2 whitespace-nowrap rounded-full bg-brand-700 px-5 py-3 text-sm font-semibold text-charcoal-50 transition-colors hover:bg-brand-800 sm:w-auto"
            >
              {t('dashboard.profileIncompleteCta')}
              <ArrowRight size={15} />
            </button>
          </div>
        </section>
      )}

      {/* Hero */}
      <section>
        <div className="mb-3 text-[13px] font-semibold uppercase tracking-[0.08em] text-accent-600">{today}</div>
        <h1 className="font-display text-[clamp(30px,5.5vw,44px)] font-semibold leading-[1.1] text-brand-700">
          {t('dashboard.welcomeBack', { name: firstName })}
        </h1>
        <p className="mt-2.5 text-base leading-relaxed text-charcoal-500">
          <strong className="font-semibold text-brand-700">{t('dashboard.heroSubBold')}</strong>
          {t('dashboard.heroSubRest')}
        </p>
      </section>

      {/* Start a new application (dark) */}
      <section>
        <div className="relative overflow-hidden rounded-[20px] bg-brand-700 p-[clamp(18px,3vw,28px)] shadow-[0_24px_48px_-20px_rgba(25,23,18,0.35)]">
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background: 'linear-gradient(105deg, transparent 40%, rgba(232,150,15,0.10) 50%, transparent 60%)',
              backgroundSize: '200% 100%',
              animation: 'glintMove 7s linear infinite',
            }}
          />
          <div className="relative mb-4 flex items-center gap-2.5">
            <span
              className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[7px]"
              style={{ background: 'linear-gradient(135deg, #E8960F, #C7590E)' }}
            >
              <Sparkles size={12} className="text-[#FFF7EA]" fill="#FFF7EA" />
            </span>
            <span className="font-display text-[19px] font-semibold leading-tight text-charcoal-50 sm:text-[22px]">{t('dashboard.startTitle')}</span>
            <span className="ml-auto shrink-0 self-start whitespace-nowrap rounded-full border border-cta-border px-2.5 py-1 text-[11.5px] font-semibold text-[#A89F8C]">{t('dashboard.startCost')}</span>
          </div>

          <div className="relative flex flex-col gap-3.5">
            <div className="flex flex-wrap gap-3.5">
              <input
                type="text"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                placeholder={t('dashboard.startCompanyPlaceholder')}
                className="min-w-0 max-w-[320px] flex-[1_1_200px] rounded-xl border border-cta-border bg-cta-surface px-4 py-3 text-[15px] text-charcoal-50 outline-none placeholder:text-charcoal-400"
              />
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t('dashboard.startJobTitlePlaceholder')}
                className="min-w-0 max-w-[320px] flex-[1_1_200px] rounded-xl border border-cta-border bg-cta-surface px-4 py-3 text-[15px] text-charcoal-50 outline-none placeholder:text-charcoal-400"
              />
            </div>
            <textarea
              ref={jdRef}
              rows={5}
              value={jd}
              onChange={(e) => setJd(e.target.value)}
              placeholder={t('dashboard.startJdPlaceholder')}
              className="min-h-[110px] w-full resize-y rounded-xl border border-cta-border bg-cta-surface px-4 py-3.5 text-[15px] leading-relaxed text-charcoal-50 outline-none placeholder:text-charcoal-400"
            />
            <div className="flex flex-col gap-3.5 sm:flex-row sm:items-center sm:gap-2.5">
              <div className="flex flex-wrap items-center gap-2 sm:gap-2.5">
                <span className="text-[12.5px] text-[#8B8574]">{t('dashboard.startYoullGet')}</span>
                {CHIPS.map((c) => (
                  <span
                    key={c.key}
                    className="rounded-full border px-2.5 py-[5px] text-[12px] font-semibold sm:px-3 sm:text-[12.5px]"
                    style={{ color: c.color, background: c.bg, borderColor: c.border }}
                  >
                    {t(`dashboard.${c.key}` as any)}
                  </span>
                ))}
              </div>
              <div className="hidden flex-1 sm:block" />
              <button
                type="button"
                onClick={handleStart}
                className="inline-flex w-full items-center justify-center gap-2.5 rounded-xl bg-accent-400 px-[26px] py-3.5 text-[15px] font-bold text-brand-800 transition-all hover:-translate-y-px hover:bg-accent-300 sm:w-auto sm:py-3"
              >
                {t('dashboard.startCta')}
                <ArrowRight size={16} />
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Master Resume banner */}
      <section>
        <div
          className="flex flex-wrap items-center gap-x-5 gap-y-4 rounded-[18px] border px-[clamp(18px,3vw,28px)] py-[22px] shadow-[0_8px_24px_-12px_rgba(199,126,16,0.25)]"
          style={{ background: 'linear-gradient(120deg, #FFFDF8, #FBF4E4)', borderColor: '#EBD9B4' }}
        >
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] border bg-white" style={{ borderColor: '#EFE3C8' }}>
            <FileText size={20} className="text-accent-600" />
          </span>
          <span className="min-w-0 flex-[1_1_320px]">
            <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
              <span className="font-display text-[19px] font-semibold text-brand-700">{t('dashboard.bannerTitle')}</span>
              <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11.5px] font-semibold text-emerald-700">{t('dashboard.masterCostNote')}</span>
            </span>
            <span className="mt-1 block text-[13px] leading-relaxed text-charcoal-500">
              {masterUpdatedAt
                ? t('dashboard.bannerBody', { when: rel(masterUpdatedAt) ?? '' })
                : t('dashboard.bannerBodyNoDate')}
            </span>
          </span>
          <a
            href="#"
            onClick={(e) => { e.preventDefault(); onEditProfile(); }}
            className="whitespace-nowrap text-[13.5px] font-semibold text-charcoal-500 transition-colors hover:text-accent-600"
          >
            {t('dashboard.bannerUpdateProfile')}
          </a>
          {generalResume ? (
            <button
              type="button"
              onClick={() => onOpenResume(generalResume.id)}
              className="inline-flex w-full items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-brand-700 px-[22px] py-3 text-sm font-semibold text-charcoal-50 transition-colors hover:bg-brand-800 sm:w-auto"
            >
              {t('dashboard.masterOpenCta')}
              <ArrowRight size={14} />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleBuildMaster}
              disabled={buildingMaster}
              className="inline-flex w-full items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-brand-700 px-[22px] py-3 text-sm font-semibold text-charcoal-50 transition-colors hover:bg-brand-800 disabled:opacity-60 sm:w-auto"
            >
              {buildingMaster ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
              {buildingMaster ? t('dashboard.masterBuilding') : t('dashboard.masterBuildCta')}
            </button>
          )}
        </div>
      </section>

      {/* Recent toolkits */}
      <section>
        <div className="mb-5 flex flex-wrap items-baseline gap-x-3.5 gap-y-2.5">
          <h2 className="font-display text-[22px] font-semibold text-brand-700">{t('dashboard.toolkitsTitle')}</h2>
          {recentTotal > 0 && (
            <span className="text-[13px] text-charcoal-500">
              {recentTotal === 1 ? t('dashboard.companiesCountOne', { count: recentTotal }) : t('dashboard.companiesCountMany', { count: recentTotal })}
            </span>
          )}
          <div className="flex-1" />
          {recentTotal > RECENT_LIMIT && (
            <a
              href="#"
              onClick={(e) => { e.preventDefault(); onNavigate('APPLICATIONS'); }}
              className="text-[13.5px] font-semibold text-charcoal-500 transition-colors hover:text-accent-600"
            >
              {t('dashboard.viewAll')} →
            </a>
          )}
        </div>
        {recentTotal === 0 ? (
          <div className="rounded-2xl border border-dashed border-charcoal-300 px-6 py-12 text-center">
            <p className="text-sm text-charcoal-500">{t('dashboard.appsEmpty')}</p>
          </div>
        ) : (
          <div className="grid gap-5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
            {recent.map((item) => (
              <ToolkitCard
                key={item.id}
                item={item}
                builtLabel={t('dashboard.builtOn', { when: rel(item.updatedAt ?? item.date) ?? '' })}
                onOpen={onOpenResume}
                onDelete={handleDeleteToolkit}
              />
            ))}
          </div>
        )}
      </section>

      {/* Credits + Help rows */}
      <section className="flex flex-wrap gap-5">
        <div className="flex flex-[1_1_320px] items-center gap-3.5 rounded-[14px] border border-charcoal-200 bg-white px-5 py-3.5 shadow-[0_1px_3px_rgba(25,23,18,0.03)]">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-accent-50">
            <span className="h-2 w-2 rounded-full bg-accent-400" />
          </span>
          <span className="min-w-0 flex-1 text-[13.5px]">
            <strong className="text-brand-700">
              {(credits ?? 0) > 0 ? t('dashboard.creditsRemaining', { n: credits ?? 0 }) : t('dashboard.creditsNone')}
            </strong>{' '}
            <span className="text-charcoal-500">
              {(credits ?? 0) > 0 ? t('dashboard.creditsValueHint') : t('dashboard.creditsNoneHint')} ·{' '}
              <a href="#" onClick={(e) => { e.preventDefault(); onNavigate('PURCHASES'); }} className="text-charcoal-500 underline transition-colors hover:text-accent-600">
                {t('dashboard.purchaseHistoryLink')}
              </a>
            </span>
          </span>
          <button
            type="button"
            onClick={openPurchase}
            className="rounded-full bg-accent-50 px-3.5 py-1.5 text-[12.5px] font-semibold text-accent-600 transition-colors hover:bg-accent-100"
          >
            {t('dashboard.topUp')}
          </button>
        </div>

        <div className="flex flex-[1_1_320px] flex-wrap items-center gap-x-3.5 gap-y-2.5 rounded-[14px] border border-charcoal-200 bg-white px-5 py-3.5 shadow-[0_1px_3px_rgba(25,23,18,0.03)]">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-accent-50">
            <LifeBuoy size={16} className="text-accent-600" />
          </span>
          <span className="min-w-0 flex-1 text-[13.5px]">
            <strong className="text-brand-700">{t('dashboard.helpTitle')}</strong>{' '}
            <span className="text-charcoal-500">{t('dashboard.helpBody')}</span>
          </span>
          <span className="flex shrink-0 items-center gap-2 text-[13px] font-semibold">
            <a
              href={contactMailto(t('help.emailSubject'))}
              className="inline-flex items-center gap-1.5 text-charcoal-500 transition-colors hover:text-accent-600"
            >
              <Mail size={14} className="shrink-0" aria-hidden="true" />
              {t('dashboard.helpEmail')}
            </a>
            <span aria-hidden="true" className="text-charcoal-300">·</span>
            <a
              href={CONTACT_FACEBOOK_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-charcoal-500 transition-colors hover:text-accent-600"
            >
              <Facebook size={14} className="shrink-0" aria-hidden="true" />
              {t('dashboard.helpFacebook')}
            </a>
          </span>
        </div>
      </section>
    </div>
  );
};
