// DashboardShell — the redesigned sticky top bar + footer that wraps the three
// dashboard-area screens (Home, All Toolkits, Purchase History). App renders
// ONE shell and swaps the body, so shared state (credits, the master/general
// resume, the ⌘K palette, and the bKash PurchaseModal) is fetched once and
// survives navigation between the three.
//
// Children reach the shared state via `useDashboardShell()`.
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Search, User, LogOut } from 'lucide-react';
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
    <span className="font-display text-lg font-semibold text-brand-700">TOP</span>
    <span className="font-display text-lg font-semibold text-accent-500">CANDIDATE</span>
  </div>
);

interface Props {
  active: 'home' | 'applications' | null;
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

  const navLink = (label: string, on: () => void, isActive: boolean) => (
    <a
      href="#"
      onClick={(e) => { e.preventDefault(); on(); }}
      className={`rounded-lg px-3 py-1.5 text-[13.5px] transition-colors ${
        isActive ? 'bg-charcoal-200 font-semibold text-brand-700' : 'font-medium text-charcoal-500 hover:bg-charcoal-100 hover:text-brand-700'
      }`}
    >
      {label}
    </a>
  );

  const ctx: ShellCtx = { credits, refreshCredits, openPurchase, openSearch, generalResume, setGeneralResume, loadingShell };

  return (
    <Ctx.Provider value={ctx}>
      <div className="flex min-h-screen flex-col" style={{ background: '#F6F4EE' }}>
        {/* Top bar */}
        <header className="sticky top-0 z-40 border-b border-charcoal-200 bg-[rgba(246,244,238,0.88)] backdrop-blur-[12px]">
          <div className="mx-auto flex h-16 max-w-[1240px] items-center gap-2 px-[clamp(12px,4vw,32px)] sm:gap-4">
            <a href="#" onClick={(e) => { e.preventDefault(); onNavigate('DASHBOARD'); }} className="shrink-0">
              <Wordmark />
            </a>

            <nav className="ml-2 hidden items-center gap-1 sm:flex">
              {navLink(t('dashboard.navHome'), () => onNavigate('DASHBOARD'), active === 'home')}
              {navLink(t('dashboard.navApplications'), () => onNavigate('APPLICATIONS'), active === 'applications')}
              {navLink(t('dashboard.navMasterResume'), onMasterResume, false)}
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
            <button
              type="button"
              onClick={openSearch}
              className="hidden w-60 items-center gap-2 rounded-[10px] border border-charcoal-300 bg-white px-3 py-[7px] text-[13px] text-charcoal-400 shadow-[0_1px_2px_rgba(25,23,18,0.03)] transition-colors hover:border-charcoal-400 sm:flex"
            >
              <Search size={14} className="text-charcoal-400" />
              <span className="flex-1 text-left">{t('dashboard.searchNavPlaceholder')}</span>
              <span className="rounded-[5px] border border-charcoal-300 px-1.5 text-[11px]">⌘K</span>
            </button>

            <VerifyingPurchasePill onResubmit={openPurchase} onCredited={() => { void refreshCredits(); }} />
            <CreditsBadge credits={credits} onBuy={openPurchase} />
            <div className="hidden sm:block"><LanguageToggle /></div>

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
                    <div className="border-b border-charcoal-100 px-4 py-2.5 sm:hidden">
                      <LanguageToggle />
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
