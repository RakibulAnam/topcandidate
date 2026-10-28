import React, { useState, useEffect, useRef, Suspense, lazy } from 'react';
import { Toaster, toast } from 'sonner';
import { ResumeData, AppStep, inferUserType } from '../domain/entities';
import { ResumeService } from '../application/services/ResumeService';
import { createResumeService, profileRepository } from '../infrastructure/config/dependencies';
import { AuthProvider, useAuth } from '../infrastructure/auth/AuthContext';
import { LoginScreen } from './LoginScreen';
import { LandingScreen } from './LandingScreen';
import { InAppBrowserBar } from './components/InAppBrowserBar';
import { Loader2 } from 'lucide-react';

import { Navbar } from './components/Layout/Navbar';
import { useBrowserNav, NavScreen, NavState } from './hooks/useBrowserNav';
import { track } from '../infrastructure/analytics/track';
import { LocaleProvider, useT } from './i18n/LocaleContext';
import { TermsOfService } from './legal/TermsOfService';
import { useDocumentMeta } from './seo';
import { FeaturePage } from './marketing/FeaturePage';
import { supabase, initialAuthParams } from '../infrastructure/supabase/client';

// Admin SPA is operator-only — customers never visit /admin. Lazy-load so
// the admin code (~100KB+ gzipped) doesn't ship with every customer page.
const AdminScreen = lazy(() => import('./admin/AdminScreen').then(m => ({ default: m.AdminScreen })));

// Every signed-in screen is its own chunk, so the landing page (prerendered,
// and the first thing a new visitor on a slow connection sees) downloads only
// what it shows. Landing, Login, Terms and the feature pages stay eager.
//
// On a flaky connection a chunk download can fail; `lazyScreen` retries it a
// few times before giving up, and the last resort is one full reload (a new
// deploy also changes chunk names, which a reload picks up).
function lazyScreen<T extends React.ComponentType<any>>(load: () => Promise<{ default: T }>) {
  return lazy(async () => {
    for (let attempt = 0; ; attempt++) {
      try {
        const mod = await load();
        try { sessionStorage.removeItem('tc.chunkReload'); } catch { /* ignore */ }
        return mod;
      } catch (err) {
        if (attempt < 3) { await new Promise((r) => setTimeout(r, 600 * (attempt + 1))); continue; }
        try {
          if (!sessionStorage.getItem('tc.chunkReload')) {
            sessionStorage.setItem('tc.chunkReload', '1');
            window.location.reload();
            return new Promise<never>(() => {});
          }
        } catch { /* storage blocked — fall through */ }
        throw err;
      }
    }
  });
}
const BuilderScreen = lazyScreen(() => import('./BuilderScreen').then(m => ({ default: m.BuilderScreen })));
const DashboardScreen = lazyScreen(() => import('./DashboardScreen').then(m => ({ default: m.DashboardScreen })));
const ProfileScreen = lazyScreen(() => import('./ProfileScreen').then(m => ({ default: m.ProfileScreen })));
const ProfileSetupScreen = lazyScreen(() => import('./ProfileSetupScreen').then(m => ({ default: m.ProfileSetupScreen })));
const DashboardShell = lazyScreen(() => import('./components/dashboard/DashboardShell').then(m => ({ default: m.DashboardShell })));
const ApplicationsScreen = lazyScreen(() => import('./ApplicationsScreen').then(m => ({ default: m.ApplicationsScreen })));
const PurchaseHistoryScreen = lazyScreen(() => import('./PurchaseHistoryScreen').then(m => ({ default: m.PurchaseHistoryScreen })));
const SummaryScreen = lazyScreen(() => import('./SummaryScreen').then(m => ({ default: m.SummaryScreen })));
const SetNewPasswordScreen = lazyScreen(() => import('./SetNewPasswordScreen').then(m => ({ default: m.SetNewPasswordScreen })));


// Path-based admin route. The admin SPA does NOT use Supabase auth — it
// gates on a separate owner login (username + password → session token). We
// intercept before any other routing so unauthenticated visitors land on the
// login screen, not the
// landing page.
const isAdminPath = (): boolean =>
  typeof window !== 'undefined' && window.location.pathname.startsWith('/admin');

// A returning signed-in visitor (session in storage) or one coming back from
// Google sign-in is about to need the dashboard: start those downloads now, in
// parallel with the session check, instead of after it.
if (typeof window !== 'undefined') {
  try {
    const signedIn = !!initialAuthParams
      || Object.keys(localStorage).some((k) => /^sb-.+-auth-token$/.test(k));
    if (signedIn && !isAdminPath()) {
      void import('./components/dashboard/DashboardShell');
      void import('./DashboardScreen');
    }
  } catch { /* storage blocked — the screens load on demand */ }
}

const INITIAL_DATA: ResumeData = {
  userType: undefined,
  targetJob: { title: '', company: '', description: '' },
  personalInfo: { fullName: '', email: '', phone: '', location: '' },
  summary: '',
  experience: [],
  education: [],
  projects: [],
  skills: [],
  extracurriculars: [],
  awards: [],
  certifications: [],
  affiliations: [],
  publications: [],
};

const DEFAULT_SECTIONS = [
  'experience', 'education', 'projects', 'skills',
  'extracurriculars', 'awards', 'certifications', 'affiliations', 'publications'
];

const UNAUTHED_SCREENS: NavScreen[] = ['LANDING', 'LOGIN', 'LEGAL_TERMS'];
const AUTHED_SCREENS: NavScreen[] = ['DASHBOARD', 'APPLICATIONS', 'PURCHASES', 'PROFILE', 'PROFILE_SETUP', 'SUMMARY', 'BUILDER'];

// Recovery detection. The password-reset link returns to `?auth=recovery`
// (set by requestPasswordReset). client.ts captures that marker at module load
// — before useBrowserNav can strip the URL — so we read it from there instead
// of re-parsing the (already-cleaned) live URL. Works whether Supabase returns
// the session as a PKCE `?code=` or an implicit `#…&type=recovery` hash.
const isRecoveryRedirect = (): boolean => !!initialAuthParams?.recovery;

// A screen chunk that still can't be downloaded after lazyScreen's retries
// and one reload would otherwise throw past every boundary and unmount the
// whole app — a blank white page. Say what happened and offer a retry.
type ChunkErrorBoundaryProps = { children: React.ReactNode; message: string; retry: string };
class ChunkErrorBoundary extends React.Component<ChunkErrorBoundaryProps, { failed: boolean }> {
  declare props: Readonly<ChunkErrorBoundaryProps>;
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(err: unknown) { console.error('[app] screen failed to load', err); }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="min-h-screen flex items-center justify-center bg-charcoal-50 px-6">
        <div className="max-w-sm text-center">
          <p className="text-[15px] leading-relaxed text-charcoal-600">{this.props.message}</p>
          <button
            type="button"
            onClick={() => {
              try { sessionStorage.removeItem('tc.chunkReload'); } catch { /* ignore */ }
              window.location.reload();
            }}
            className="mt-5 inline-flex items-center justify-center rounded-full bg-brand-700 px-6 py-3 text-sm font-semibold text-charcoal-50 hover:bg-brand-800"
          >
            {this.props.retry}
          </button>
        </div>
      </div>
    );
  }
}

// Strings for the boundary above (it sits outside hooks).
const ChunkBoundary = ({ children }: { children: React.ReactNode }) => {
  const t = useT();
  return <ChunkErrorBoundary message={t('common.loadFailed')} retry={t('common.tryAgain')}>{children}</ChunkErrorBoundary>;
};

const AppContent = () => {
  const { user, loading, signInFailed } = useAuth();
  const t = useT();
  const [checkingProfile, setCheckingProfile] = useState(true);

  const [resumeService, setResumeService] = useState<ResumeService | null>(null);

  // Builder Hand-off State
  const [builderData, setBuilderData] = useState<ResumeData>(INITIAL_DATA);
  const [builderStep, setBuilderStep] = useState<AppStep>(AppStep.SECTIONS);
  const [currentResumeId, setCurrentResumeId] = useState<string | null>(null);
  // Summary flow: the JD/company/title captured on the dashboard, held until
  // the user confirms sections on the Summary screen and generates.
  const [pendingTargetJob, setPendingTargetJob] = useState<ResumeData['targetJob']>(INITIAL_DATA.targetJob);
  const [builderAutoGenerate, setBuilderAutoGenerate] = useState(false);

  const { navState, navigate } = useBrowserNav({ screen: 'LANDING' });
  const screen = navState.screen;
  useDocumentMeta(screen, navState.feature);

  // One page_view per screen change (and one on first paint, which is the
  // session's entry page). This is what makes exit pages and bounce rate
  // computable: the LAST page_view in a session IS the exit page, so no
  // unreliable beforeunload/pagehide handler is needed — mobile browsers drop
  // those routinely. Fire-and-forget; track() can never throw.
  //
  // The ref guard is load-bearing, not defensive. StrictMode double-invokes
  // effects on mount, which logged every entry page TWICE — and because the dev
  // server writes to the production Supabase, those duplicates land in real
  // analytics and inflate page views while distorting bounce rate. Guarding on
  // the last screen actually tracked makes the effect idempotent (the ref
  // survives StrictMode's simulated remount). Navigating away and back still
  // fires, because `screen` changes in between.
  const lastTrackedScreen = useRef<NavScreen | null>(null);
  useEffect(() => {
    if (lastTrackedScreen.current === screen) return;
    lastTrackedScreen.current = screen;
    track('page_view', { screen });
  }, [screen]);

  // Detect Supabase recovery link click. On first paint, if the URL hash
  // includes `type=recovery` (or an error_code), route to the reset screen.
  // We also listen to PASSWORD_RECOVERY in case the hash is consumed by
  // GoTrue before our effect runs.
  const [recoveryActive, setRecoveryActive] = useState<boolean>(() => isRecoveryRedirect());
  useEffect(() => {
    if (recoveryActive) {
      navigate({ screen: 'RESET_PASSWORD' }, { replace: true });
    }
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setRecoveryActive(true);
        navigate({ screen: 'RESET_PASSWORD' }, { replace: true });
      }
    });
    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // OAuth callback errors. The happy-path `?code=…` is consumed by AuthContext
  // (from initialAuthParams, captured at module load) → session → the userId
  // effect routes the user. Here we only surface an error (e.g. the user
  // cancelled on Google's consent screen → `error=access_denied`). We read it
  // from the module-load snapshot, NOT window.location, because useBrowserNav
  // has already stripped the live URL by the time this effect runs.
  // Google came back with a code but the session couldn't be established
  // (network failed even after retries): say so, rather than leave them on
  // the landing page wondering why they're not signed in.
  useEffect(() => {
    if (signInFailed === 'network') toast.error(t('login.googleNetworkFailed'), { duration: 8000 });
    else if (signInFailed === 'error') toast.error(t('login.googleUnavailable'), { duration: 8000 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signInFailed]);

  useEffect(() => {
    if (initialAuthParams?.kind !== 'error') return;
    // Recovery-link errors (e.g. expired token) are surfaced by the reset
    // screen ("request a new link"), not a Google toast.
    if (initialAuthParams.recovery) return;
    if (initialAuthParams.error === 'access_denied') {
      toast.message(t('login.googleCancelled'));
    } else {
      console.warn('[oauth] callback error:', initialAuthParams.error, initialAuthParams.description ?? '');
      toast.error(t('login.googleUnavailable'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      const service = createResumeService();
      setResumeService(service);

      const savedDraft = service.loadDraft();
      if (savedDraft) {
        const dataToSet = { ...savedDraft };
        if (!savedDraft.visibleSections || savedDraft.visibleSections.length === 0) {
          // No saved section selection — default to the core set plus any
          // sections the draft already has content for. userType is derived.
          const defaults = ['skills', 'education', 'projects'];
          if (inferUserType(savedDraft.experience) === 'experienced') defaults.push('experience');
          else defaults.push('extracurriculars');

          if (savedDraft.extracurriculars?.length) defaults.push('extracurriculars');
          if (savedDraft.awards?.length) defaults.push('awards');
          if (savedDraft.certifications?.length) defaults.push('certifications');
          if (savedDraft.affiliations?.length) defaults.push('affiliations');
          if (savedDraft.publications?.length) defaults.push('publications');

          dataToSet.visibleSections = Array.from(new Set(defaults));
        }

        setBuilderData(dataToSet);
        setBuilderStep(AppStep.SECTIONS);
      }
    } catch (error) {
      console.error('Failed to initialize resume service:', error);
      toast.error(t('common.appInitFailed'));
    }
  }, []);

  // Depend on user?.id (stable string), NOT user (object reference). The
  // AuthContext is already idempotent on identity changes, but using the id
  // here is belt-and-braces: even if a fresh user object ever slips through,
  // we'd only re-check profile completeness when the actual user identity
  // changes (e.g. sign-in or sign-out), never on a tab-focus token refresh.
  const userId = user?.id ?? null;

  // Signed in: fetch the remaining screen chunks while the browser is idle,
  // so the first tap on Applications / Profile / a new application doesn't
  // wait on a download (and an open tab survives the next deploy renaming
  // them). Dashboard chunks were already started at module load.
  useEffect(() => {
    if (!userId) return;
    const load = () => {
      void import('./SummaryScreen');
      void import('./BuilderScreen');
      void import('./ApplicationsScreen');
      void import('./PurchaseHistoryScreen');
      void import('./ProfileScreen');
    };
    const w = window as Window & { requestIdleCallback?: (cb: () => void) => number };
    if (w.requestIdleCallback) w.requestIdleCallback(load);
    else setTimeout(load, 2000);
  }, [userId]);

  useEffect(() => {
    // Wait for auth to settle. While `loading` is true the session is still
    // being restored from storage, so `user` is null but not meaningfully so —
    // acting on it would fire the signed-out bounce below against a URL the
    // user IS entitled to. That broke every authed deep link on a cold load:
    // /purchases → LANDING (replace) → session arrives → LANDING is unauthed →
    // DASHBOARD. Only /dashboard survived, because the bounce ended there
    // anyway. The render already shows a spinner while `loading`.
    if (loading) return;

    const checkProfileCompleteness = async () => {
      if (!userId) {
        setCheckingProfile(false);
        // If we were on an authenticated screen (e.g. after sign-out), fall
        // back to landing without polluting history — replace the current
        // entry so the back button doesn't re-enter the authed state.
        if (AUTHED_SCREENS.includes(screen)) {
          navigate({ screen: 'LANDING' }, { replace: true });
        }
        return;
      }

      setCheckingProfile(true);
      try {
        const isComplete = await profileRepository.isProfileComplete(userId);
        const target: NavScreen = isComplete ? 'DASHBOARD' : 'PROFILE_SETUP';
        // Replace on sign-in so back doesn't bounce through login.
        if (UNAUTHED_SCREENS.includes(screen)) {
          navigate({ screen: target }, { replace: true });
        }
      } catch (error) {
        console.error('Error checking profile:', error);
        if (UNAUTHED_SCREENS.includes(screen)) {
          navigate({ screen: 'PROFILE_SETUP' }, { replace: true });
        }
      } finally {
        setCheckingProfile(false);
      }
    };

    checkProfileCompleteness();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, loading]);

  // Disarm auto-generate the moment we are not on the builder — including when
  // the user leaves via the browser Back gesture, which runs no handler of
  // ours. Without this the flag stays true, and pressing Forward remounts
  // BuilderScreen with a fresh autoGenFired ref, silently starting a SECOND
  // paid generation and saving a duplicate resume row.
  useEffect(() => {
    if (screen !== 'BUILDER' && builderAutoGenerate) setBuilderAutoGenerate(false);
  }, [screen, builderAutoGenerate]);

  // Which resume the builder hand-off state (builderData/builderStep/
  // currentResumeId) currently holds. Cleared on every departure from
  // /builder, so any return to it reloads from the server.
  const builderLoadedIdRef = useRef<string | null>(null);

  // Restore the builder from the history entry. /builder entries carry the
  // resume id, so Back-then-Forward — and a hard reload — land back on the
  // generated toolkit instead of the idle "nothing is building right now"
  // panel. Before this, nav state was just { screen }: BuilderScreen kept the
  // generated resume in ITS OWN state, App still held the pre-generation
  // prefill, and a remount therefore came back at step PERSONAL_INFO with no
  // resume id and rendered the idle panel over a toolkit that existed and was
  // already paid for.
  //
  // Always refetches rather than reusing an in-memory copy. The toolkit bundle
  // is written in a SECOND update that routinely lands after the user has
  // navigated away, so the Supabase row is the only version guaranteed to be
  // complete — an in-memory copy would silently restore a resume with empty
  // toolkit tabs.
  useEffect(() => {
    if (screen !== 'BUILDER') {
      builderLoadedIdRef.current = null;
      return;
    }
    const wanted = navState.resumeId;
    if (!wanted || !user || !resumeService) return;
    if (builderLoadedIdRef.current === wanted) return;
    let cancelled = false;
    resumeService.getGeneratedResume(wanted)
      .then((data) => {
        if (cancelled) return;
        if (!data) throw new Error(`resume ${wanted} not found`);
        builderLoadedIdRef.current = wanted;
        setBuilderData(data);
        setBuilderStep(AppStep.PREVIEW);
        setCurrentResumeId(wanted);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('Failed to restore builder from history', error);
        toast.error(t('common.resumeLoadFailed'));
        // Mark it handled so this cannot refetch on every render, and send the
        // user somewhere real rather than to an idle panel they never asked
        // for. replace, not push, so Back does not bounce back into the void.
        builderLoadedIdRef.current = wanted;
        navigate({ screen: 'DASHBOARD' }, { replace: true });
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, navState.resumeId, user, resumeService]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-charcoal-50">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="animate-spin text-brand-600" size={40} />
          <p className="text-charcoal-500">{t('common.loading')}</p>
        </div>
      </div>
    );
  }

  // Public feature pages — viewable signed-in or out (deliberately in neither
  // UNAUTHED_SCREENS nor AUTHED_SCREENS, so the auth guard never bounces them).
  if (screen === 'FEATURE' && navState.feature) {
    return (
      <FeaturePage
        slug={navState.feature}
        onGetStarted={() => navigate({ screen: user ? 'DASHBOARD' : 'LOGIN' })}
        onOpenHome={() => navigate({ screen: user ? 'DASHBOARD' : 'LANDING' })}
        onOpenFeature={(feature) => navigate({ screen: 'FEATURE', feature })}
        onOpenTerms={() => navigate({ screen: 'LEGAL_TERMS' })}
      />
    );
  }

  // Public legal page — viewable signed-in or out.
  if (screen === 'LEGAL_TERMS') {
    return <TermsOfService onBack={() => window.history.length > 1 ? window.history.back() : navigate({ screen: user ? 'DASHBOARD' : 'LANDING' }, { replace: true })} />;
  }

  // Password-reset landing — handled regardless of signed-in state because
  // Supabase puts the recovery session in localStorage but we want the
  // dedicated "set new password" UI, not the dashboard.
  if (screen === 'RESET_PASSWORD' || recoveryActive) {
    return (
      <SetNewPasswordScreen
        onDone={() => {
          setRecoveryActive(false);
          // After updateUser, the session is now a normal one — AuthProvider
          // will surface user and route us in. Send the user to dashboard
          // (or profile-setup if they're new).
          navigate({ screen: 'DASHBOARD' }, { replace: true });
        }}
        onRequestNewLink={() => {
          setRecoveryActive(false);
          try { window.history.replaceState(null, '', window.location.pathname); } catch { /* ignore */ }
          navigate({ screen: 'LOGIN' }, { replace: true });
        }}
      />
    );
  }

  if (!user) {
    // Signed-out screens are where in-app-browser visitors land from ads —
    // the moment to offer their real browser, before a login is created here.
    if (screen === 'LOGIN') {
      return (
        <>
          <LoginScreen onOpenTerms={() => navigate({ screen: 'LEGAL_TERMS' })} />
          <InAppBrowserBar />
        </>
      );
    }
    return (
      <>
        <LandingScreen
          onGetStarted={() => navigate({ screen: 'LOGIN' })}
          onOpenTerms={() => navigate({ screen: 'LEGAL_TERMS' })}
          onOpenFeature={(feature) => navigate({ screen: 'FEATURE', feature })}
        />
        <InAppBrowserBar />
      </>
    );
  }

  if (checkingProfile) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-charcoal-50">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="animate-spin text-brand-600" size={40} />
          <p className="text-charcoal-500">{t('common.loadingProfile')}</p>
        </div>
      </div>
    );
  }

  /** Returns false when the profile could not be loaded, so callers can decide
   *  whether it is safe to commit to a screen that assumes the data is there. */
  const prefillFromProfile = async (opts?: { targetJob?: ResumeData['targetJob']; step?: AppStep; visibleSections?: string[] }): Promise<boolean> => {
    if (!user) return false;
    try {
      const [profile, exps, projs, skls, edus, extras, awds, certs, affils, pubs, langs, refs] = await Promise.all([
        profileRepository.getProfile(user.id),
        profileRepository.getExperiences(user.id),
        profileRepository.getProjects(user.id),
        profileRepository.getSkills(user.id),
        profileRepository.getEducations(user.id),
        profileRepository.getExtracurriculars(user.id),
        profileRepository.getAwards(user.id),
        profileRepository.getCertifications(user.id),
        profileRepository.getAffiliations(user.id),
        profileRepository.getPublications(user.id),
        profileRepository.getLanguages(user.id),
        profileRepository.getReferences(user.id),
      ]);

      // userType is derived from the data, not a (removed) selector.
      const uType = inferUserType(exps);
      const initialVisible: string[] = ['skills', 'education', 'projects'];
      if (uType === 'experienced') initialVisible.push('experience');
      if (uType === 'student') initialVisible.push('extracurriculars');

      if (extras.length > 0) initialVisible.push('extracurriculars');
      if (awds.length > 0) initialVisible.push('awards');
      if (certs.length > 0) initialVisible.push('certifications');
      if (affils.length > 0) initialVisible.push('affiliations');
      if (pubs.length > 0) initialVisible.push('publications');
      if (langs.length > 0) initialVisible.push('languages');
      if (refs.length > 0) initialVisible.push('references');

      const uniqueVisible = Array.from(new Set(initialVisible));

      setBuilderData({
        ...INITIAL_DATA,
        userType: uType,
        targetJob: opts?.targetJob ?? INITIAL_DATA.targetJob,
        personalInfo: profile || INITIAL_DATA.personalInfo,
        experience: exps,
        projects: projs,
        skills: skls,
        education: edus,
        extracurriculars: extras,
        awards: awds,
        certifications: certs,
        affiliations: affils,
        publications: pubs,
        languages: langs,
        references: refs,
        visibleSections: opts?.visibleSections ?? uniqueVisible
      });

      setBuilderStep(opts?.step ?? AppStep.SECTIONS);
      return true;
    } catch (error) {
      console.error('Error loading profile data:', error);
      toast.error(t('common.profileLoadFailed'));
      return false;
    }
  };

  // Dashboard fast-path: the JD / company / title are captured on the
  // dashboard's "Start a new application" card. Prefill everything else from
  // the profile and drop the user into the builder just past the Target Job
  // step (which is now pre-filled). The credit gate + 2-call generation hot
  // path in BuilderScreen are unchanged.
  const handleStartFromDashboard = (targetJob: ResumeData['targetJob']) => {
    setPendingTargetJob(targetJob);
    navigate({ screen: 'SUMMARY' });
  };

  // From the Summary screen: the profile is the single source of truth.
  // Prefill from it, apply the user's section selection + the pasted JD, then
  // enter the builder in autoGenerate mode so generation fires immediately
  // (the step wizard is bypassed).
  const handleGenerateFromSummary = async (visibleSections: string[]) => {
    setCurrentResumeId(null);
    // Only commit to the builder if the prefill actually produced something to
    // build from. It used to navigate unconditionally, so a failed profile load
    // dropped the user onto the builder with empty data and an armed
    // auto-generate that could never succeed.
    const ok = await prefillFromProfile({ targetJob: pendingTargetJob, step: AppStep.PERSONAL_INFO, visibleSections });
    if (ok === false) return;
    setBuilderAutoGenerate(true);
    navigate({ screen: 'BUILDER' });
  };


  // The builder just persisted a NEW resume. Stamp its id into the CURRENT
  // history entry (replace, not push — the user pressed Generate once and
  // should get one Back) so Forward and reload can restore this preview.
  const handleBuilderGenerated = (id: string) => {
    // Live read, not the `screen` closure: this fires from an async save that
    // can resolve after the user has already navigated away, and rewriting a
    // DASHBOARD entry into a BUILDER one would corrupt their history.
    if ((window.history.state as NavState | null)?.screen !== 'BUILDER') return;
    builderLoadedIdRef.current = id;
    setCurrentResumeId(id);
    setBuilderStep(AppStep.PREVIEW);
    navigate({ screen: 'BUILDER', resumeId: id }, { replace: true });
  };

  const handleOpenResume = async (id: string) => {
    if (!user || !resumeService) return;
    try {
      const data = await resumeService.getGeneratedResume(id);
      if (data) {
        setBuilderData(data);
        setCurrentResumeId(id);
        setBuilderStep(AppStep.PREVIEW);
        setBuilderAutoGenerate(false);
        builderLoadedIdRef.current = id;
        navigate({ screen: 'BUILDER', resumeId: id });
      }
    } catch (error) {
      console.error('Failed to load resume', error);
      toast.error(t('common.resumeLoadFailed'));
    }
  };

  if (screen === 'PROFILE_SETUP') {
    return (
      <ProfileSetupScreen
        resumeService={resumeService}
        onComplete={() => navigate({ screen: 'DASHBOARD' }, { replace: true })}
      />
    );
  }

  if (screen === 'PROFILE') {
    return (
      <div className="min-h-screen bg-charcoal-50">
        <Navbar
          onDashboardClick={() => navigate({ screen: 'DASHBOARD' })}
          showExitBuilder={false}
        />
        <ProfileScreen onGoHome={() => navigate({ screen: 'DASHBOARD' })} />
      </div>
    );
  }

  if (screen === 'BUILDER') {
    // The history entry names a resume the hand-off state has not loaded yet
    // (Forward gesture, or a reload straight onto /builder). Read the ref
    // DURING RENDER rather than mirroring it in state: a state flag is set
    // from an effect, which lets one frame of the idle panel paint first —
    // the same class of flash the dashboard banner had.
    if (navState.resumeId && builderLoadedIdRef.current !== navState.resumeId) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-charcoal-50">
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="animate-spin text-brand-600" size={40} />
            <p className="text-charcoal-500">{t('common.loadingResume')}</p>
          </div>
        </div>
      );
    }
    return (
      <BuilderScreen
        initialData={builderData}
        initialStep={builderStep}
        currentResumeId={currentResumeId}
        resumeService={resumeService}
        autoGenerate={builderAutoGenerate}
        onGenerated={handleBuilderGenerated}
        onExit={() => { setBuilderAutoGenerate(false); navigate({ screen: 'DASHBOARD' }); }}
      />
    );
  }

  // Dashboard area — Home / All Toolkits / Purchase History share ONE shell so
  // credits, the master resume, the ⌘K palette, and the PurchaseModal persist
  // across navigation between them.
  return (
    <DashboardShell
      active={screen === 'APPLICATIONS' ? 'applications' : screen === 'PURCHASES' ? 'purchases' : screen === 'SUMMARY' ? null : 'home'}
      onNavigate={(s) => navigate({ screen: s })}
      onEditProfile={() => navigate({ screen: 'PROFILE' })}
      onOpenResume={handleOpenResume}
      onStartNew={() => navigate({ screen: 'DASHBOARD' })}
      resumeService={resumeService}
    >
      {screen === 'APPLICATIONS' ? (
        <ApplicationsScreen
          onOpenResume={handleOpenResume}
          onNewApplication={() => navigate({ screen: 'DASHBOARD' })}
          onBack={() => navigate({ screen: 'DASHBOARD' })}
        />
      ) : screen === 'PURCHASES' ? (
        <PurchaseHistoryScreen onBack={() => navigate({ screen: 'DASHBOARD' })} />
      ) : screen === 'SUMMARY' ? (
        <SummaryScreen
          targetJob={pendingTargetJob}
          onGenerate={handleGenerateFromSummary}
          onBack={() => navigate({ screen: 'DASHBOARD' })}
          onEditProfile={() => navigate({ screen: 'PROFILE' })}
        />
      ) : (
        <DashboardScreen
          onStartApplication={handleStartFromDashboard}
          onOpenResume={handleOpenResume}
          onEditProfile={() => navigate({ screen: 'PROFILE' })}
          onNavigate={(s) => navigate({ screen: s })}
        />
      )}
    </DashboardShell>
  );
};

export default function App() {
  // The admin SPA mounts at /admin and does NOT use Supabase auth (gated by
  // its own owner login → session token). Render it BEFORE the providers so the
  // operator can get to the login screen without going through Supabase login. The
  // tradeoff: no i18n + no toasts on the admin surface, which is the design.
  if (isAdminPath()) {
    return (
      <Suspense fallback={
        <div className="min-h-screen flex items-center justify-center bg-charcoal-50">
          <Loader2 className="animate-spin text-brand-600" size={32} />
        </div>
      }>
        <AdminScreen />
      </Suspense>
    );
  }
  return (
    <LocaleProvider>
      <AuthProvider>
        <ChunkBoundary>
          <Suspense fallback={
            <div className="min-h-screen flex items-center justify-center bg-charcoal-50">
              <Loader2 className="animate-spin text-brand-600" size={32} />
            </div>
          }>
            <AppContent />
          </Suspense>
        </ChunkBoundary>
        <Toaster richColors position="top-center" />
      </AuthProvider>
    </LocaleProvider>
  );
}
