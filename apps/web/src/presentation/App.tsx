import React, { useState, useEffect, Suspense, lazy } from 'react';
import { Toaster, toast } from 'sonner';
import { ResumeData, AppStep } from '../domain/entities';
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
import { ResumeSourceDialog } from './components/ResumeSourceDialog';
import { useBrowserNav, NavScreen } from './hooks/useBrowserNav';
import { LocaleProvider, useT } from './i18n/LocaleContext';
import { SetNewPasswordScreen } from './SetNewPasswordScreen';
import { TermsOfService } from './legal/TermsOfService';
import { supabase } from '../infrastructure/supabase/client';

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
const AUTHED_SCREENS: NavScreen[] = ['DASHBOARD', 'PROFILE', 'PROFILE_SETUP', 'BUILDER'];

// Recovery hash detection. Supabase appends `#access_token=...&type=recovery`
// when the user clicks the password-reset link in their email. We watch for
// (a) the hash on initial load and (b) the PASSWORD_RECOVERY auth event,
// because the GoTrue client parses the hash slightly before our App.tsx
// effect runs.
function hasRecoveryHash(): boolean {
  if (typeof window === 'undefined') return false;
  const hash = window.location.hash.replace(/^#/, '');
  if (!hash) return false;
  const params = new URLSearchParams(hash);
  return params.get('type') === 'recovery' || params.has('error_code');
}

const AppContent = () => {
  const { user, loading } = useAuth();
  const t = useT();
  const [checkingProfile, setCheckingProfile] = useState(true);
  const [showSourceDialog, setShowSourceDialog] = useState(false);

  const [resumeService, setResumeService] = useState<ResumeService | null>(null);

  // Builder Hand-off State
  const [builderData, setBuilderData] = useState<ResumeData>(INITIAL_DATA);
  const [builderStep, setBuilderStep] = useState<AppStep>(AppStep.USER_TYPE);
  const [currentResumeId, setCurrentResumeId] = useState<string | null>(null);

  const { navState, navigate } = useBrowserNav({ screen: 'LANDING' });
  const screen = navState.screen;

  // Detect Supabase recovery link click. On first paint, if the URL hash
  // includes `type=recovery` (or an error_code), route to the reset screen.
  // We also listen to PASSWORD_RECOVERY in case the hash is consumed by
  // GoTrue before our effect runs.
  const [recoveryActive, setRecoveryActive] = useState<boolean>(() => hasRecoveryHash());
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

  useEffect(() => {
    try {
      const service = createResumeService();
      setResumeService(service);

      const savedDraft = service.loadDraft();
      if (savedDraft) {
        let dataToSet = { ...savedDraft };
        if (savedDraft.userType && (!savedDraft.visibleSections || savedDraft.visibleSections.length === 0)) {
          const defaults = ['skills', 'education', 'projects'];
          if (savedDraft.userType === 'experienced') defaults.push('experience');
          if (savedDraft.userType === 'student') defaults.push('extracurriculars');

          if (savedDraft.extracurriculars?.length) defaults.push('extracurriculars');
          if (savedDraft.awards?.length) defaults.push('awards');
          if (savedDraft.certifications?.length) defaults.push('certifications');
          if (savedDraft.affiliations?.length) defaults.push('affiliations');
          if (savedDraft.publications?.length) defaults.push('publications');

          dataToSet.visibleSections = Array.from(new Set(defaults));
        }

        setBuilderData(dataToSet);

        if (savedDraft.userType) {
          setBuilderStep(AppStep.SECTIONS);
        }
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
  }, [userId]);

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

  const prefillFromProfile = async () => {
    if (!user) return;
    try {
      const [profile, exps, projs, skls, uType, edus, extras, awds, certs, affils, pubs, langs, refs] = await Promise.all([
        profileRepository.getProfile(user.id),
        profileRepository.getExperiences(user.id),
        profileRepository.getProjects(user.id),
        profileRepository.getSkills(user.id),
        profileRepository.getUserType(user.id),
        profileRepository.getEducations(user.id),
        profileRepository.getExtracurriculars(user.id),
        profileRepository.getAwards(user.id),
        profileRepository.getCertifications(user.id),
        profileRepository.getAffiliations(user.id),
        profileRepository.getPublications(user.id),
        profileRepository.getLanguages(user.id),
        profileRepository.getReferences(user.id),
      ]);

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
        userType: uType || undefined,
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
        visibleSections: uniqueVisible
      });

      if (uType) {
        setBuilderStep(AppStep.SECTIONS);
      } else {
        setBuilderStep(AppStep.USER_TYPE);
      }
    } catch (error) {
      console.error('Error loading profile data:', error);
      toast.error(t('common.profileLoadFailed'));
    }
  };

  const handleChooseProfile = async () => {
    setShowSourceDialog(false);
    await prefillFromProfile();
    setCurrentResumeId(null);
    navigate({ screen: 'BUILDER' });
  };

  const handleChooseFresh = () => {
    setShowSourceDialog(false);
    setBuilderData({
      ...INITIAL_DATA,
      visibleSections: DEFAULT_SECTIONS
    });
    setBuilderStep(AppStep.USER_TYPE);
    setCurrentResumeId(null);
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
        onExit={() => navigate({ screen: 'DASHBOARD' })}
      />
    );
  }

  // Default: DASHBOARD (authenticated fallback)
  return (
    <>
      <DashboardScreen
        onCreateNew={() => setShowSourceDialog(true)}
        onEditProfile={() => navigate({ screen: 'PROFILE' })}
        onOpenApplication={() => {
          navigate({ screen: 'BUILDER' });
        }}
        onOpenResume={handleOpenResume}
      />
      <ResumeSourceDialog
        isOpen={showSourceDialog}
        onClose={() => setShowSourceDialog(false)}
        onChooseProfile={handleChooseProfile}
        onChooseFresh={handleChooseFresh}
      />
    </>
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
