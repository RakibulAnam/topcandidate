import React, { useState, useEffect, useRef, Suspense, lazy } from 'react';
import { Toaster, toast } from 'sonner';
import { ResumeData, AppStep, inferUserType } from '../domain/entities';
import { BuilderScreen } from './BuilderScreen';
import { ResumeService } from '../application/services/ResumeService';
import { createResumeService, profileRepository } from '../infrastructure/config/dependencies';
import { AuthProvider, useAuth } from '../infrastructure/auth/AuthContext';
import { LoginScreen } from './LoginScreen';
import { LandingScreen } from './LandingScreen';
import { Loader2 } from 'lucide-react';

import { Navbar } from './components/Layout/Navbar';
import { DashboardScreen } from './DashboardScreen';
import { ProfileScreen } from './ProfileScreen';
import { ProfileSetupScreen } from './ProfileSetupScreen';
import { DashboardShell } from './components/dashboard/DashboardShell';
import { ApplicationsScreen } from './ApplicationsScreen';
import { PurchaseHistoryScreen } from './PurchaseHistoryScreen';
import { SummaryScreen } from './SummaryScreen';
import { useBrowserNav, NavScreen } from './hooks/useBrowserNav';
import { track } from '../infrastructure/analytics/track';
import { LocaleProvider, useT } from './i18n/LocaleContext';
import { SetNewPasswordScreen } from './SetNewPasswordScreen';
import { TermsOfService } from './legal/TermsOfService';
import { supabase, initialAuthParams } from '../infrastructure/supabase/client';

// Admin SPA is operator-only — customers never visit /admin. Lazy-load so
// the admin code (~100KB+ gzipped) doesn't ship with every customer page.
const AdminScreen = lazy(() => import('./admin/AdminScreen').then(m => ({ default: m.AdminScreen })));

// Path-based admin route. The admin SPA does NOT use Supabase auth — it
// gates on a separate owner login (username + password → session token). We
// intercept before any other routing so unauthenticated visitors land on the
// login screen, not the
// landing page.
const isAdminPath = (): boolean =>
  typeof window !== 'undefined' && window.location.pathname.startsWith('/admin');

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

const AppContent = () => {
  const { user, loading } = useAuth();
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
    if (screen === 'LOGIN') {
      return <LoginScreen onOpenTerms={() => navigate({ screen: 'LEGAL_TERMS' })} />;
    }
    return (
      <LandingScreen
        onGetStarted={() => navigate({ screen: 'LOGIN' })}
        onOpenTerms={() => navigate({ screen: 'LEGAL_TERMS' })}
      />
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


  const handleOpenResume = async (id: string) => {
    if (!user || !resumeService) return;
    try {
      const data = await resumeService.getGeneratedResume(id);
      if (data) {
        setBuilderData(data);
        setCurrentResumeId(id);
        setBuilderStep(AppStep.PREVIEW);
        setBuilderAutoGenerate(false);
        navigate({ screen: 'BUILDER' });
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
        <ProfileScreen />
      </div>
    );
  }

  if (screen === 'BUILDER') {
    return (
      <BuilderScreen
        initialData={builderData}
        initialStep={builderStep}
        currentResumeId={currentResumeId}
        resumeService={resumeService}
        autoGenerate={builderAutoGenerate}
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
        <AppContent />
        <Toaster richColors position="top-center" />
      </AuthProvider>
    </LocaleProvider>
  );
}
