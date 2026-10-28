// DashboardShell — the redesigned sticky top bar + footer + bottom tab bar that
// wrap the three dashboard-area screens (Home, All Toolkits, Purchase History).
// Navigation is one list (`DESTINATIONS`) rendered two ways: header pills from
// lg up, a fixed bottom tab bar below it. App renders
// ONE shell and swaps the body, so shared state (credits, the master/general
// resume, the ⌘K palette, and the bKash PurchaseModal) is fetched once and
// survives navigation between the three.
//
// Children reach the shared state via `useDashboardShell()`.
import React, { Suspense, createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Search, User, LogOut, Home, LayoutGrid, FileText, Receipt, Loader2 } from 'lucide-react';
import { useAuth } from '../../../infrastructure/auth/AuthContext';
import { createResumeService, profileRepository } from '../../../infrastructure/config/dependencies';
import { ResumeService } from '../../../application/services/ResumeService';
import type { CreditStatus } from '../../../domain/repositories/IProfileRepository';
import type { ResumeListItem } from '../../../domain/repositories/IResumeRepository';
import type { NavScreen } from '../../hooks/useBrowserNav';
import { useT } from '../../i18n/LocaleContext';
import { LanguageToggle } from '../../i18n/LanguageToggle';
import { CreditsBadge } from '../CreditsBadge';
import { VerifyingPurchasePill } from '../Layout/VerifyingPurchasePill';
import { PurchaseModal, type PurchaseSource } from '../PurchaseModal';
import { requestJdFocus } from './jdFocusRequest';
import { useResumeOfferProfile, useResumeOfferSummary } from './resumeOfferData';
import { useOpenPurchase } from '../../hooks/useOpenPurchase';
import type { PackageId } from '../../../infrastructure/api/purchaseClient';
import { CommandPalette } from './CommandPalette';
import { LogoMark } from '../ui/LogoMark';
import { masterPriceLabel } from '../../pricing';

interface ShellCtx {
  credits: number | null;
  refreshCredits: () => Promise<CreditStatus | null>;
  /** Any purchase has completed → the master resume can be built. Null while loading. */
  masterUnlocked: boolean | null;
  /** A credit-granting pack has been bought. Null while loading. NOT the same
   *  as masterUnlocked since the master-resume package (migration 033, ৳99
   *  since 034) — every "never bought a pack" decision keys on this. */
  boughtPack: boolean | null;
  /** Master-resume price for this account (CreditStatus.masterPriceTaka). Null while loading. */
  masterPrice: number | null;
  /** The only credit left is the free welcome one (never bought a pack). */
  onFreeCredit: boolean;
  /** Open the bKash sheet. `pkg` preselects a package (default: the pack). */
  openPurchase: (source?: PurchaseSource, pkg?: PackageId) => void;
  /** No master resume and never bought: the ৳99 master-resume package is on
   *  offer (the dashboard's ResumeOfferPreview, the priced Master tab). */
  masterOffer: boolean;
  /** Locked with no master resume, but the profile read that decides
   *  `masterOffer` hasn't answered yet — hold the preview's space. */
  masterOfferPending: boolean;
  /** Account reaching for a master resume it doesn't have: open the bKash
   *  sheet on the ৳99 master-resume package. `refused` = the server just said
   *  master_locked, so the account IS locked whatever the status read said. */
  openMasterPurchase: (source: PurchaseSource, opts?: { refused?: boolean }) => void;
  openSearch: () => void;
  generalResume: ResumeListItem | null;
  /** True while a master-resume build is in flight (background or banner). */
  buildingMaster: boolean;
  /** Build the master resume. Single-flight: a second call while one is
   *  running is a no-op, so two builds can never race into duplicate rows. */
  buildMaster: () => Promise<string | null>;
  loadingShell: boolean;
}

const Ctx = createContext<ShellCtx | null>(null);

export const useDashboardShell = (): ShellCtx => {
  const v = useContext(Ctx);
  if (!v) throw new Error('useDashboardShell must be used inside <DashboardShell>');
  return v;
};

const Wordmark = () => (
  <div className="flex items-center gap-1 select-none">
    <LogoMark className="h-5 mr-0.5 sm:h-6" />
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
  const [masterUnlocked, setMasterUnlocked] = useState<boolean | null>(null);
  const [boughtPack, setBoughtPack] = useState<boolean | null>(null);
  const [masterPrice, setMasterPrice] = useState<number | null>(null);
  const [newPricing, setNewPricing] = useState<boolean | null>(null);
  const [purchaseOpen, setPurchaseOpen] = useState(false);
  const [purchaseSource, setPurchaseSource] = useState<PurchaseSource>('other');
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  // Mirror of state for the build paths below, which run from callbacks and
  // must see the latest value rather than a stale closure.
  const generalResumeRef = useRef<ResumeListItem | null>(null);
  generalResumeRef.current = generalResume;
  const [buildingMaster, setBuildingMaster] = useState(false);
  const masterInFlight = useRef(false);
  const autoBuiltMaster = useRef(false);

  // The ONE place the master resume is built from the dashboard area. The
  // in-flight ref (not state — state lags a render) makes it single-flight:
  // generateGeneralResume's "already exists" check is read-then-write, so two
  // concurrent calls would both pass it and save two rows.
  const buildMaster = useCallback(async (): Promise<string | null> => {
    if (!user || masterInFlight.current || generalResumeRef.current) return null;
    masterInFlight.current = true;
    setBuildingMaster(true);
    try {
      const id = await createResumeService().generateGeneralResume(user.id);
      const now = new Date().toISOString();
      setGeneralResume({ id, title: ResumeService.GENERAL_RESUME_TITLE, date: now, updatedAt: now });
      return id;
    } finally {
      masterInFlight.current = false;
      setBuildingMaster(false);
    }
  }, [user]);

  // The master resume is the first pack's bonus. Once an account is unlocked
  // and has none — a purchase just confirmed here, or confirmed while the user
  // was in the builder / profile / another tab — build it in the background:
  // they paid for it, they shouldn't have to go find a button. Once per mount;
  // a failure leaves the banner's build button as the fallback.
  const autoBuildMaster = useCallback(async () => {
    if (autoBuiltMaster.current || generalResumeRef.current) return;
    autoBuiltMaster.current = true;
    try {
      const id = await buildMaster();
      if (id) toast.success(t('dashboard.masterReady'));
    } catch (err) {
      console.warn('Background master-resume build failed', err);
    }
  }, [buildMaster, t]);

  // Resolves with the fresh status (null if it couldn't be read); never rejects.
  const refreshCredits = useCallback(async (): Promise<CreditStatus | null> => {
    if (!user) return null;
    try {
      const status = await profileRepository.getCreditStatus(user.id);
      setCredits(status.credits);
      setMasterUnlocked(status.masterUnlocked);
      setBoughtPack(status.boughtPack);
      setMasterPrice(status.masterPriceTaka);
      setNewPricing(status.newPricing);
      if (status.masterUnlocked) void autoBuildMaster();
      return status;
    } catch (err) {
      console.warn('Could not refresh toolkit credits', err);
      return null;
    }
  }, [user, autoBuildMaster]);

  // Fetch shared state once. generalResume is found the same way the old
  // dashboard did — by the reserved General Resume title.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setLoadingShell(true);
    const svc = createResumeService();
    Promise.all([
      profileRepository.getCreditStatus(user.id).catch(() => null),
      svc.getGeneratedResumes(user.id).catch(() => [] as ResumeListItem[]),
    ]).then(async ([status, all]) => {
      if (cancelled) return;
      const existing = all.find((r) => r.title === ResumeService.GENERAL_RESUME_TITLE) ?? null;
      setGeneralResume(existing);
      // Set now, not on the next render: autoBuildMaster below reads it.
      generalResumeRef.current = existing;
      if (!status) return;
      let balance = status.credits;
      // Backstop for the one-time welcome credit of accounts that existed
      // before migration 034: profile setup claims it on finish, but if that
      // call failed the shell picks it up. The RPC is idempotent, and new
      // accounts never have welcomePending.
      if (status.welcomePending) {
        const granted = await profileRepository.claimWelcomeCredit().catch(() => null);
        if (granted !== null) {
          balance = granted;
        } else {
          // Nothing granted here — usually a parallel claim (profile setup,
          // another tab) got it first, so `status.credits` predates it.
          const fresh = await profileRepository.getCreditStatus(user.id).catch(() => null);
          if (fresh) balance = fresh.credits;
        }
      }
      if (cancelled) return;
      setCredits(balance);
      setMasterUnlocked(status.masterUnlocked);
      setBoughtPack(status.boughtPack);
      setMasterPrice(status.masterPriceTaka);
      setNewPricing(status.newPricing);
      if (status.masterUnlocked && !existing) void autoBuildMaster();
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

  // Opened for a specific package: the user has already chosen to buy, so the
  // sheet skips the free-kit gift panel.
  const [purchaseSkipGift, setPurchaseSkipGift] = useState(false);
  const [purchasePkg, setPurchasePkg] = useState<PackageId>('five-pack');
  // A package choice is a decision already made: skip the free-kit gift panel
  // and land on the bKash step for that package.
  const openPurchase = useCallback((source: PurchaseSource = 'other', pkg?: PackageId) => {
    setPurchaseSource(source);
    setPurchaseSkipGift(pkg !== undefined);
    setPurchasePkg(pkg ?? 'five-pack');
    setPurchaseOpen(true);
  }, []);
  const openMasterPurchase = useCallback((source: PurchaseSource, opts?: { refused?: boolean }) => {
    // Without this a refused build whose status read had failed would land on
    // a pack-only sheet: the master package is only sold while masterOffer
    // holds. Re-read too, so the sheet learns this account's price (৳50 / ৳99)
    // if the first read never arrived.
    // Opened after the re-read lands, so the sheet doesn't open pack-only and
    // then switch itself to the master resume.
    if (opts?.refused) {
      setMasterUnlocked(false);
      void refreshCredits().then((st) => {
        // A purchase landed between the 402 and this read: they own it now
        // (refreshCredits has already started the build). Nothing to sell.
        if (st?.masterUnlocked) return;
        setMasterUnlocked(false);
        openPurchase(source, 'master-resume');
      });
      return;
    }
    openPurchase(source, 'master-resume');
  }, [openPurchase, refreshCredits]);
  const onFreeCredit = boughtPack === false && credits === 1;
  // The profile the master resume would be built from (cached; shared with
  // the dashboard preview). An empty one can't be sold a resume.
  const openPurchaseState = useOpenPurchase();
  const preview = useResumeOfferProfile(user?.id, masterUnlocked === false);
  // Locked, nothing built yet, and the profile has something to build from —
  // known, not assumed: offering before the read answers made an empty
  // profile flash the preview and the priced tab. Pre-032 accounts that kept
  // a master resume while locked aren't offered one.
  // `masterPrice !== null`: never show a price (৳50 / ৳99) before this
  // account's price is known — the sheet won't sell it until then either.
  const offerCandidate = masterUnlocked === false && !loadingShell && !generalResume && masterPrice !== null;
  const masterOffer = offerCandidate && preview !== null && !preview.empty;
  const masterOfferPending = offerCandidate && preview === null;
  // The priced nav tab additionally steps aside while a payment is in flight
  // (undefined = not known yet): a "৳99" pill beside "verifying your payment"
  // invites paying twice.
  // The same (cached) summary request the dashboard preview makes: if the build
  // refuses this profile (random text), the resume can't be made, so the tab
  // stops selling it and sends them to fix the profile instead.
  const offerSummary = useResumeOfferSummary(user?.id, masterOffer);
  const offerUnbuildable = masterOffer && offerSummary.status === 'unbuildable';
  const navOffer = masterOffer && openPurchaseState === null && !offerUnbuildable;
  const openSearch = useCallback(() => setSearchOpen(true), []);

  const onMasterResume = () => {
    if (generalResume) onOpenResume(generalResume.id);
    // A payment is in flight: reopen it rather than offer a second purchase.
    else if (masterUnlocked === false && openPurchaseState) openPurchase('master_nav');
    else if (offerUnbuildable) onEditProfile();
    else if (masterUnlocked === false) openMasterPurchase('master_nav');
    else onNavigate('DASHBOARD');
  };

  const navLink = (
    label: string,
    on: () => void,
    isActive: boolean,
    opts?: { Icon?: React.ComponentType<{ size?: number }>; attention?: boolean; offer?: boolean },
  ) => opts?.offer ? (
    // No master resume and never bought: the tab is the one-tap route to the
    // ৳99 offer, so it is the loudest thing in the bar — a filled orange pill
    // with its price on it and a radiating dot. Deliberately not subtle (owner,
    // 2026-10-24): a finished profile has earned this and they should see it.
    <a
      href="#"
      onClick={(e) => { e.preventDefault(); on(); }}
      className="relative inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-accent-400 py-1.5 pl-3 pr-1.5 text-[13.5px] font-bold text-brand-800 shadow-[0_6px_16px_-8px_rgba(201,93,39,0.9)] transition-colors hover:bg-accent-300"
    >
      {opts.Icon && <opts.Icon size={14} />}
      {label}
      <span className="rounded-md bg-brand-700 px-1.5 py-0.5 text-[11px] font-bold text-accent-300">{masterPriceLabel(t, masterPrice)}</span>
      <span className="absolute -right-1 -top-1 h-2.5 w-2.5" aria-hidden>
        <span className="mo-ping absolute inset-0 rounded-full bg-accent-500" />
        <span className="absolute inset-0 rounded-full bg-accent-600 ring-2 ring-[#F6F4EE]" />
      </span>
    </a>
  ) : (
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
    // Locked accounts (no pack yet) don't get the attention cue: it would point
    // at something they can't build, which reads as nagging.
    // `offer` = locked with no master resume: the tab becomes the offer itself.
    { key: 'master', icon: FileText, label: t('dashboard.navMasterResume'), tabLabel: t('dashboard.navTabMaster'), on: onMasterResume, isActive: false, attention: !loadingShell && !generalResume && masterUnlocked === true, offer: navOffer },
    { key: 'purchases', icon: Receipt, label: t('dashboard.navPurchases'), tabLabel: t('dashboard.navPurchases'), on: () => onNavigate('PURCHASES'), isActive: active === 'purchases' },
  ];

  const ctx: ShellCtx = { credits, refreshCredits, masterUnlocked, boughtPack, masterPrice, onFreeCredit, openPurchase, masterOffer, masterOfferPending, openMasterPurchase, openSearch, generalResume, buildingMaster, buildMaster, loadingShell };

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
                  {navLink(d.label, d.on, d.isActive, d.key === 'master' ? { Icon: d.icon, attention: d.attention, offer: d.offer } : undefined)}
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

            <VerifyingPurchasePill onResubmit={() => openPurchase('resubmit')} onCredited={() => { void refreshCredits(); }} />
            <CreditsBadge credits={credits} free={onFreeCredit} onBuy={() => openPurchase('header_badge')} />
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
          {/* The screens inside the shell are lazy chunks: while one downloads,
              only this area waits — the top bar and tab bar stay put. */}
          <Suspense fallback={
            <div className="flex justify-center py-24" role="status">
              <Loader2 className="animate-spin text-brand-600" size={28} />
            </div>
          }>
            {children}
          </Suspense>
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
          {DESTINATIONS.map(({ key, icon: Icon, tabLabel, on, isActive, attention, offer }) => offer ? (
            // The offer tab: an orange tile lifted out of the bar, price on it.
            <a
              key={key}
              href="#"
              onClick={(e) => { e.preventDefault(); on(); }}
              className="relative flex min-w-0 flex-1 flex-col items-center justify-center gap-1 py-1.5"
            >
              <span className="relative flex h-[30px] items-center gap-1 rounded-full bg-accent-400 px-2.5 text-brand-800 shadow-[0_6px_14px_-6px_rgba(201,93,39,0.9)]">
                <Icon size={16} strokeWidth={2.4} />
                <span className="text-[11px] font-extrabold leading-none">{masterPriceLabel(t, masterPrice)}</span>
                <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5" aria-hidden>
                  <span className="mo-ping absolute inset-0 rounded-full bg-accent-500" />
                  <span className="absolute inset-0 rounded-full bg-accent-600 ring-2 ring-[#F6F4EE]" />
                </span>
              </span>
              <span className="max-w-full truncate px-0.5 text-[10.5px] font-bold leading-none text-accent-700">
                {tabLabel}
              </span>
            </a>
          ) : (
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
        source={purchaseSource}
        // A locked account that already has a master resume (pre-032) isn't
        // getting one as a bonus — don't promise it.
        masterBonus={masterUnlocked === false && !generalResume}
        // Not to a profile the build refuses: it would be sold a resume
        // that can't be made (the dashboard asks them to fix it instead).
        masterOffer={masterOffer && !offerUnbuildable}
        initialPackage={purchasePkg}
        masterPrice={masterPrice}
        newPricing={newPricing}
        freeCredit={onFreeCredit && !purchaseSkipGift}
        onUseFreeCredit={() => {
          requestJdFocus();
          if (active !== 'home') onNavigate('DASHBOARD');
        }}
      />
    </Ctx.Provider>
  );
};
