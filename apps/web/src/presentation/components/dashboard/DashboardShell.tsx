// DashboardShell — the redesigned sticky top bar + footer + bottom tab bar that
// wrap the three dashboard-area screens (Home, All Toolkits, Purchase History).
// Navigation is one list (`DESTINATIONS`) rendered two ways: header pills from
// lg up, a fixed bottom tab bar below it. App renders
// ONE shell and swaps the body, so shared state (credits, the master/general
// resume, the ⌘K palette, and the bKash PurchaseModal) is fetched once and
// survives navigation between the three.
//
// Children reach the shared state via `useDashboardShell()`.
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Search, User, LogOut, Home, LayoutGrid, FileText, Receipt } from 'lucide-react';
import { useAuth } from '../../../infrastructure/auth/AuthContext';
import { createResumeService, profileRepository } from '../../../infrastructure/config/dependencies';
import { ResumeService } from '../../../application/services/ResumeService';
import type { ResumeListItem } from '../../../domain/repositories/IResumeRepository';
import type { NavScreen } from '../../hooks/useBrowserNav';
import { useT } from '../../i18n/LocaleContext';
import { LanguageToggle } from '../../i18n/LanguageToggle';
import { CreditsBadge } from '../CreditsBadge';
import { VerifyingPurchasePill } from '../Layout/VerifyingPurchasePill';
import { PurchaseModal } from '../PurchaseModal';
import { CommandPalette } from './CommandPalette';

interface ShellCtx {
  credits: number | null;
  refreshCredits: () => Promise<void>;
  openPurchase: () => void;
  openSearch: () => void;
  generalResume: ResumeListItem | null;
  setGeneralResume: (r: ResumeListItem | null) => void;
  loadingShell: boolean;
}

const Ctx = createContext<ShellCtx | null>(null);

export const useDashboardShell = (): ShellCtx => {
  const v = useContext(Ctx);
  if (!v) throw new Error('useDashboardShell must be used inside <DashboardShell>');
  return v;
};

const Wordmark = () => (
  <div className="flex items-baseline gap-1 select-none">
    <span className="font-display text-base font-semibold text-brand-700 sm:text-lg">TOP</span>
    <span className="font-display text-base font-semibold text-accent-500 sm:text-lg">CANDIDATE</span>
  </div>
);

interface Props {
  active: 'home' | 'applications' | 'purchases' | null;
  onNavigate: (screen: NavScreen) => void;
  onEditProfile: () => void;
  onOpenResume: (id: string) => void;
  onStartNew: () => void;
  resumeService: ResumeService | null;
  children: React.ReactNode;
}

export const DashboardShell: React.FC<Props> = ({
  active, onNavigate, onEditProfile, onOpenResume, onStartNew, resumeService, children,
}) => {
  const { user, signOut } = useAuth();
  const t = useT();

  const [credits, setCredits] = useState<number | null>(null);
  const [generalResume, setGeneralResume] = useState<ResumeListItem | null>(null);
  const [loadingShell, setLoadingShell] = useState(true);
  const [purchaseOpen, setPurchaseOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const refreshCredits = useCallback(async () => {
    if (!user) return;
    try {
      const balance = await profileRepository.getToolkitCredits(user.id);
      if (balance !== null) setCredits(balance);
    } catch (err) {
      console.warn('Could not refresh toolkit credits', err);
    }
  }, [user]);

  // Fetch shared state once. generalResume is found the same way the old
  // dashboard did — by the reserved General Resume title.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setLoadingShell(true);
    const svc = createResumeService();
    Promise.all([
      profileRepository.getToolkitCredits(user.id).catch(() => null),
      svc.getGeneratedResumes(user.id).catch(() => [] as ResumeListItem[]),
    ]).then(([balance, all]) => {
      if (cancelled) return;
      if (balance !== null) setCredits(balance);
      setGeneralResume(all.find((r) => r.title === ResumeService.GENERAL_RESUME_TITLE) ?? null);
    }).finally(() => { if (!cancelled) setLoadingShell(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Global ⌘K / Ctrl+K opens the palette; Esc closes it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearchOpen(true); }
      if (e.key === 'Escape') setSearchOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const firstName = (user?.user_metadata?.full_name as string | undefined)?.split(' ')[0]
    ?? user?.email?.split('@')[0]
    ?? t('dashboard.greetingFallbackName');

  const openPurchase = useCallback(() => setPurchaseOpen(true), []);
  const openSearch = useCallback(() => setSearchOpen(true), []);

  const onMasterResume = () => {
    if (generalResume) onOpenResume(generalResume.id);
    else onNavigate('DASHBOARD');
  };

  const navLink = (
    label: string,
    on: () => void,
    isActive: boolean,
    opts?: { Icon?: React.ComponentType<{ size?: number }>; attention?: boolean },
  ) => (
    <a
      href="#"
      onClick={(e) => { e.preventDefault(); on(); }}
      aria-current={isActive ? 'page' : undefined}
      className={`relative inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-[13.5px] transition-colors ${
        isActive
          ? 'bg-charcoal-200 font-semibold text-brand-700'
          : opts?.attention
            // Not built yet. The one destination that is free, foundational and
            // most-missed right after profile setup, so it gets a standing
            // treatment rather than blending into three identical text links.
            ? 'border border-accent-200 bg-accent-50 font-semibold text-accent-700 hover:bg-accent-100'
            : 'font-medium text-charcoal-500 hover:bg-charcoal-100 hover:text-brand-700'
      }`}
    >
      {opts?.Icon && <opts.Icon size={14} />}
      {label}
      {opts?.attention && (
        // A dot, not a word: the eye finds it without reading the bar.
        <span className="ml-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-500" aria-hidden />
      )}
    </a>
  );

  // The four dashboard destinations, shared by the header pills (lg and up) and
  // the bottom tab bar (below lg). Master Resume opens the Preview screen, which
  // lives OUTSIDE this shell, so that entry is never the active one.
  const DESTINATIONS = [
    { key: 'home', icon: Home, label: t('dashboard.navHome'), tabLabel: t('dashboard.navHome'), on: () => onNavigate('DASHBOARD'), isActive: active === 'home' },
    { key: 'applications', icon: LayoutGrid, label: t('dashboard.navApplications'), tabLabel: t('dashboard.navApplications'), on: () => onNavigate('APPLICATIONS'), isActive: active === 'applications' },
    // `attention` = the master resume does not exist yet. Users lose this
    // destination immediately after profile setup, which is exactly when it has
    // never been built — so mark it until it has been.
    { key: 'master', icon: FileText, label: t('dashboard.navMasterResume'), tabLabel: t('dashboard.navTabMaster'), on: onMasterResume, isActive: false, attention: !loadingShell && !generalResume },
    { key: 'purchases', icon: Receipt, label: t('dashboard.navPurchases'), tabLabel: t('dashboard.navPurchases'), on: () => onNavigate('PURCHASES'), isActive: active === 'purchases' },
  ];

  const ctx: ShellCtx = { credits, refreshCredits, openPurchase, openSearch, generalResume, setGeneralResume, loadingShell };

  return (
    <Ctx.Provider value={ctx}>
      {/* Bottom padding below lg keeps the footer clear of the fixed tab bar. */}
      <div className="flex min-h-screen flex-col pb-[calc(56px+env(safe-area-inset-bottom))] lg:pb-0" style={{ background: '#F6F4EE' }}>
        {/* Top bar */}
        <header className="sticky top-0 z-40 border-b border-charcoal-200 bg-[rgba(246,244,238,0.88)] backdrop-blur-[12px]">
          <div className="mx-auto flex h-16 max-w-[1240px] items-center gap-1.5 px-[clamp(10px,3vw,32px)] sm:gap-4">
            <a href="#" onClick={(e) => { e.preventDefault(); onNavigate('DASHBOARD'); }} className="shrink-0">
              <Wordmark />
            </a>

            {/* Header pills only from lg up: at 640–1023px four pills plus the
                240px search field overflow the bar (they used to wrap mid-word).
                Below lg the bottom tab bar carries the same four destinations. */}
            <nav className="ml-2 hidden items-center gap-1 lg:flex">
              {DESTINATIONS.map((d) => (
                <React.Fragment key={d.key}>
                  {navLink(d.label, d.on, d.isActive, d.key === 'master' ? { Icon: d.icon, attention: d.attention } : undefined)}
                </React.Fragment>
              ))}
            </nav>

            <div className="flex-1" />

            {/* Search: field on desktop, round icon on mobile */}
            <button
              type="button"
              onClick={openSearch}
              aria-label={t('dashboard.searchNavPlaceholder')}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-charcoal-300 bg-white text-charcoal-500 shadow-[0_1px_2px_rgba(25,23,18,0.03)] transition-colors hover:border-charcoal-400 sm:hidden"
            >
              <Search size={15} />
            </button>
            {/* w-44 until xl, and the placeholder truncates rather than wraps:
                with four nav pills the bar is ~40px over budget at exactly lg,
                which used to break the placeholder onto a second line. */}
            <button
              type="button"
              onClick={openSearch}
              className="hidden w-44 min-w-0 items-center gap-2 rounded-[10px] border border-charcoal-300 bg-white px-3 py-[7px] text-[13px] text-charcoal-400 shadow-[0_1px_2px_rgba(25,23,18,0.03)] transition-colors hover:border-charcoal-400 sm:flex xl:w-60"
            >
              <Search size={14} className="shrink-0 text-charcoal-400" />
              <span className="min-w-0 flex-1 truncate text-left">{t('dashboard.searchNavPlaceholder')}</span>
              <span className="shrink-0 rounded-[5px] border border-charcoal-300 px-1.5 text-[11px]">⌘K</span>
            </button>

            <VerifyingPurchasePill onResubmit={openPurchase} onCredited={() => { void refreshCredits(); }} />
            <CreditsBadge credits={credits} onBuy={openPurchase} />
            <div className="hidden sm:block"><LanguageToggle /></div>
            <div className="sm:hidden"><LanguageToggle variant="mini" /></div>

            {/* Account */}
            <div className="relative shrink-0">
              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                aria-label={t('dashboard.accountMenuLabel')}
                className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-brand-700 text-[13px] font-semibold text-charcoal-50"
              >
                {firstName.charAt(0).toUpperCase()}
              </button>
              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} aria-hidden />
                  <div className="absolute right-0 top-full z-50 mt-2 w-56 max-w-[calc(100vw-1.5rem)] rounded-xl border border-charcoal-200 bg-white py-1 shadow-xl">
                    <div className="border-b border-charcoal-100 px-4 py-3">
                      <p className="text-xs text-charcoal-500">{t('dashboard.signedInAs')}</p>
                      <p className="truncate text-sm font-medium text-brand-700">{user?.email}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => { setMenuOpen(false); onEditProfile(); }}
                      className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-brand-700 transition-colors hover:bg-charcoal-50"
                    >
                      <User size={16} /> {t('dashboard.myProfile')}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setMenuOpen(false); signOut(); }}
                      className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-red-600 transition-colors hover:bg-red-50"
                    >
                      <LogOut size={16} /> {t('dashboard.signOut')}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1240px] flex-1 px-[clamp(16px,4vw,32px)] pb-[clamp(48px,7vw,80px)] pt-[clamp(28px,5vw,48px)]">
          {children}
        </main>

        <footer className="border-t border-charcoal-200">
          <div className="mx-auto flex max-w-[1240px] flex-wrap items-center justify-between gap-x-4 gap-y-2 px-[clamp(16px,4vw,32px)] py-6">
            <span className="font-display text-[15px] font-semibold text-brand-700">TOP <span className="text-accent-500">CANDIDATE</span></span>
            <span className="text-[12.5px] text-charcoal-400">{t('dashboard.footerLine', { year: new Date().getFullYear() })}</span>
          </div>
        </footer>

        {/* Bottom tab bar — the only route to these four screens below lg. */}
        <nav
          aria-label={t('dashboard.navTabBarLabel')}
          className="fixed bottom-0 left-0 right-0 z-40 border-t border-charcoal-200 bg-[rgba(246,244,238,0.94)] pb-[env(safe-area-inset-bottom)] backdrop-blur-[12px] lg:hidden"
        >
          {/* Capped so the tabs stay a group on a tablet instead of drifting to
              the far corners; on a phone the cap never binds. */}
          <div className="mx-auto flex w-full max-w-[520px]">
          {DESTINATIONS.map(({ key, icon: Icon, tabLabel, on, isActive, attention }) => (
            <a
              key={key}
              href="#"
              onClick={(e) => { e.preventDefault(); on(); }}
              aria-current={isActive ? 'page' : undefined}
              className={`relative flex min-w-0 flex-1 flex-col items-center justify-center gap-1 py-2 transition-colors ${
                isActive ? 'text-accent-600' : attention ? 'text-accent-600' : 'text-charcoal-500'
              }`}
            >
              <span className="relative">
                <Icon size={19} strokeWidth={isActive || attention ? 2.4 : 1.9} />
                {attention && (
                  <span className="absolute -right-1.5 -top-0.5 h-2 w-2 rounded-full bg-accent-500 ring-2 ring-[#F6F4EE]" aria-hidden />
                )}
              </span>
              <span className={`max-w-full truncate px-0.5 text-[10.5px] leading-none ${isActive ? 'font-bold' : 'font-medium'}`}>
                {tabLabel}
              </span>
            </a>
          ))}
          </div>
        </nav>
      </div>

      <CommandPalette
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        resumeService={resumeService}
        userId={user?.id ?? null}
        onOpenResume={onOpenResume}
        onStartNew={onStartNew}
      />

      <PurchaseModal
        isOpen={purchaseOpen}
        onClose={() => setPurchaseOpen(false)}
        onSuccess={() => { void refreshCredits(); }}
      />
    </Ctx.Provider>
  );
};
