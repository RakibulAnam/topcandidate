import React, { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { ResumeData, AppStep, ToolkitItem } from '../domain/entities';
import {
  UserTypeStep,
  TargetJobStep,
  PersonalInfoStep,
  ExperienceStep,
  ProjectsStep,
  EducationStep,
  SkillsStep,
  ExtracurricularStep,
  AwardsStep,
  CertificationsStep,
  AffiliationsStep,
  PublicationsStep,
  LanguagesStep,
  ReferencesStep,
  SectionSelectionStep,
} from './components/FormSteps';
import { Preview } from './components/Preview';
import { ResumeService } from '../application/services/ResumeService';
import { isGibberish } from '../application/validation/gibberishDetector';
import { isValidEmail } from './components/ui/EmailInput';
import { isValidPhone } from './components/ui/PhoneInput';
import { useAuth } from '../infrastructure/auth/AuthContext';
import { ChevronRight, ChevronLeft, Sparkles } from 'lucide-react';
import { Navbar } from './components/Layout/Navbar';
import { BuilderStepper } from './components/Builder/BuilderStepper';
import { PurchaseModal } from './components/PurchaseModal';
import { profileRepository } from '../infrastructure/config/dependencies';
import { ApiCallError } from '../infrastructure/ai/proxy/ProxyClients';
import { useT } from './i18n/LocaleContext';

const stepsInfoFor = (t: ReturnType<typeof useT>) => [
  { id: AppStep.USER_TYPE, title: t('builder.stepsUserType') },
  { id: AppStep.SECTIONS, title: t('builder.stepsSections') },
  { id: AppStep.TARGET_JOB, title: t('builder.stepsTargetJob') },
  { id: AppStep.PERSONAL_INFO, title: t('builder.stepsPersonalInfo') },
  { id: AppStep.EXPERIENCE, title: t('builder.stepsExperience') },
  { id: AppStep.PROJECTS, title: t('builder.stepsProjects') },
  { id: AppStep.EDUCATION, title: t('builder.stepsEducation') },
  { id: AppStep.SKILLS, title: t('builder.stepsSkills') },
  { id: AppStep.EXTRACURRICULARS, title: t('builder.stepsActivities') },
  { id: AppStep.AWARDS, title: t('builder.stepsAwards') },
  { id: AppStep.CERTIFICATIONS, title: t('builder.stepsCertifications') },
  { id: AppStep.AFFILIATIONS, title: t('builder.stepsAffiliations') },
  { id: AppStep.PUBLICATIONS, title: t('builder.stepsPublications') },
  { id: AppStep.LANGUAGES, title: t('builder.stepsLanguages') },
  { id: AppStep.REFERENCES, title: t('builder.stepsReferences') },
];

// Static IDs without titles — used by getVisibleSteps which is called outside React.
const STEP_IDS_INFO: { id: AppStep }[] = [
  AppStep.USER_TYPE, AppStep.SECTIONS, AppStep.TARGET_JOB, AppStep.PERSONAL_INFO,
  AppStep.EXPERIENCE, AppStep.PROJECTS, AppStep.EDUCATION, AppStep.SKILLS,
  AppStep.EXTRACURRICULARS, AppStep.AWARDS, AppStep.CERTIFICATIONS,
  AppStep.AFFILIATIONS, AppStep.PUBLICATIONS, AppStep.LANGUAGES, AppStep.REFERENCES,
].map(id => ({ id }));

const DEFAULT_SECTIONS = [
  'experience', 'education', 'projects', 'skills',
  'extracurriculars', 'awards', 'certifications', 'affiliations', 'publications',
  'languages', 'references',
];

export const getVisibleSteps = (userType?: 'experienced' | 'student', visibleSections?: string[]) => {
  const baseSteps = [AppStep.SECTIONS, AppStep.TARGET_JOB, AppStep.PERSONAL_INFO];
  const stepsToShow = userType ? baseSteps : [AppStep.USER_TYPE, ...baseSteps];

  const sectionMap: Record<string, AppStep> = {
    'experience': AppStep.EXPERIENCE,
    'projects': AppStep.PROJECTS,
    'education': AppStep.EDUCATION,
    'skills': AppStep.SKILLS,
    'extracurriculars': AppStep.EXTRACURRICULARS,
    'awards': AppStep.AWARDS,
    'certifications': AppStep.CERTIFICATIONS,
    'affiliations': AppStep.AFFILIATIONS,
    'publications': AppStep.PUBLICATIONS,
    'languages': AppStep.LANGUAGES,
    'references': AppStep.REFERENCES,
  };

  return STEP_IDS_INFO.filter(s => {
    if (stepsToShow.includes(s.id)) return true;
    const sectionKey = Object.keys(sectionMap).find(key => sectionMap[key] === s.id);

    if (sectionKey) {
      if (visibleSections && visibleSections.length > 0) {
        return visibleSections.includes(sectionKey);
      }
      if (!userType) return false;
      if (userType === 'student') {
        if ([AppStep.EXPERIENCE, AppStep.CERTIFICATIONS, AppStep.AFFILIATIONS, AppStep.PUBLICATIONS].includes(s.id)) return false;
      }
      if (userType === 'experienced') {
        if ([AppStep.EXTRACURRICULARS, AppStep.AWARDS].includes(s.id)) return false;
      }
      return true;
    }
    return false;
  });
};

interface BuilderScreenProps {
  initialData: ResumeData;
  initialStep: AppStep;
  currentResumeId: string | null;
  resumeService: ResumeService | null;
  onExit: () => void;
}

export const BuilderScreen: React.FC<BuilderScreenProps> = ({
  initialData,
  initialStep,
  currentResumeId,
  resumeService,
  onExit,
}) => {
  const { user } = useAuth();
  const t = useT();
  const [step, setStep] = useState<AppStep>(initialStep);
  const [resumeData, setResumeData] = useState<ResumeData>(initialData);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);

  // Toolkit credits — null while loading, integer once fetched. We fetch on
  // mount and after every purchase so the user always sees a fresh balance
  // before clicking Generate. The server is the source of truth; this number
  // only drives the UI (the gate is enforced in /api/optimize).
  const [credits, setCredits] = useState<number | null>(null);
  const [purchaseModalOpen, setPurchaseModalOpen] = useState(false);
  // True if the user clicked Generate while at zero credits — after a
  // successful purchase we resume the generation automatically rather than
  // making them click again.
  const [resumeGenerateAfterPurchase, setResumeGenerateAfterPurchase] = useState(false);

  // Validation errors map field paths (e.g. "personalInfo.fullName") to error messages
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Mirror the prop so we can capture the row id right after the initial
  // auto-save. Without this, regeneration buttons click-bail (no id) until
  // the user round-trips through the dashboard to load the resume again.
  const [activeResumeId, setActiveResumeId] = useState<string | null>(currentResumeId);
  useEffect(() => {
    setActiveResumeId(currentResumeId);
  }, [currentResumeId]);

  const [isGeneralResume, setIsGeneralResume] = useState(false);
  const [canRegenerate, setCanRegenerate] = useState(true);
  const [cooldownEndsAt, setCooldownEndsAt] = useState<Date | null>(null);
  const [regeneratingItem, setRegeneratingItem] = useState<ToolkitItem | null>(null);

  // Skills the user accumulated during profile setup. Used by SkillsStep to
  // surface JD-relevant suggestions (via fuse.js) before falling back to the
  // common dictionary.
  const [profileSkills, setProfileSkills] = useState<string[]>([]);
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    profileRepository
      .getSkills(user.id)
      .then(skills => {
        if (!cancelled) setProfileSkills(skills ?? []);
      })
      .catch(err => console.warn('Could not load profile skills', err));
    return () => {
      cancelled = true;
    };
  }, [user]);

  // Pull the user's credit balance once on mount (and whenever the user
  // changes). On failure we leave it as null — the server still gates the
  // call, so a missing client-side balance just means we don't show the
  // remaining-count hint until the next refresh.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    profileRepository
      .getToolkitCredits(user.id)
      .then(n => {
        if (!cancelled) setCredits(n);
      })
      .catch(err => console.warn('Could not load toolkit credits', err));
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    const checkResumeStatus = async () => {
      if (!user || !resumeService || !activeResumeId) return;
      const resumes = await resumeService.getGeneratedResumes(user.id);
      const current = resumes.find(r => r.id === activeResumeId);

      const isGeneral = current?.title === ResumeService.GENERAL_RESUME_TITLE;
      setIsGeneralResume(isGeneral);

      if (isGeneral) {
        const info = await resumeService.getGeneralResumeInfo(user.id);
        if (info) {
          setCanRegenerate(info.canRegenerate);
          setCooldownEndsAt(info.cooldownEndsAt);
        }
      }
    };
    checkResumeStatus();
  }, [user, resumeService, activeResumeId]);

  const handleRegenerateGeneralResume = async () => {
      if (!user || !resumeService || !activeResumeId) return;
      try {
        const newData = await resumeService.regenerateGeneralResume(user.id, activeResumeId);
        setResumeData(newData);
        toast.success(t('builder.generalRegenSuccess'));

        // update cooldown logic
        const info = await resumeService.getGeneralResumeInfo(user.id);
        if (info) {
          setCanRegenerate(info.canRegenerate);
          setCooldownEndsAt(info.cooldownEndsAt);
        }
      } catch (error) {
        console.error('General resume regeneration failed:', error);
        // The 24-hour cooldown message IS user-actionable and worth showing
        // verbatim; everything else (quota, network, validation) should stay
        // behind a friendly fallback so we don't leak model-provider language.
        const msg = error instanceof Error ? error.message : '';
        const isCooldown = msg.includes('24 hours');
        const isGibberish = error instanceof Error && error.name === 'GibberishContentError';
        toast.error(
          isCooldown || isGibberish
            ? msg
            : t('builder.generalRegenFailGeneric')
        );
      }
  };

  const ITEM_LABELS: Record<ToolkitItem, string> = {
    coverLetter: t('builder.itemCoverLetter'),
    outreachEmail: t('builder.itemOutreachEmail'),
    linkedInMessage: t('builder.itemLinkedInMessage'),
    interviewQuestions: t('builder.itemInterviewQuestions'),
  };

  const handleRegenerateItem = async (item: ToolkitItem) => {
    if (!resumeService) {
      toast.error(t('builder.serviceNotInit'));
      return;
    }
    // Concurrent regen would race on local state and double-bill the API; let
    // the current attempt finish before starting another.
    if (regeneratingItem) return;

    setRegeneratingItem(item);
    try {
      const updatedData = await resumeService.regenerateToolkitItem(
        user?.id ?? null,
        activeResumeId,
        resumeData,
        item,
      );
      setResumeData(updatedData);
      const itemError = updatedData.toolkit?.errors?.[item];
      if (itemError) {
        // Keep the user-facing message generic — the real error is logged to
        // the devtools console by the service / ToolkitStatusCard.
        toast.error(t('builder.itemFailed', { label: ITEM_LABELS[item] }));
      } else {
        toast.success(t('builder.itemSuccess', { label: ITEM_LABELS[item] }));
      }
    } catch (error) {
      console.error('Regeneration persist failed:', error);
      toast.error(t('builder.itemPersistFailed'));
    } finally {
      setRegeneratingItem(null);
    }
  };

  const validateStep = (currentStepId: AppStep, showToast = true): boolean => {
    const newErrors: Record<string, string> = {};
    let isValid = true;

    // Gibberish guard — refuses to advance past free-form text fields that
    // look like keyboard mashing. Skips proper-noun fields (company, school,
    // person names) where a dictionary check would false-positive. Errors
    // here surface inline on the field, matching how required-field errors
    // already render.
    const GIBBERISH_MSG = t('builder.gibberishField');
    const flagIfGibberish = (key: string, text: string | undefined) => {
      if (text && text.trim().length > 0 && isGibberish(text)) {
        newErrors[key] = GIBBERISH_MSG;
        isValid = false;
      }
    };

    switch (currentStepId) {
      case AppStep.SECTIONS:
        if (!resumeData.visibleSections || resumeData.visibleSections.length === 0) {
          if (showToast) toast.error(t('builder.selectAtLeastOneSection'));
          isValid = false;
        }
        break;

      case AppStep.TARGET_JOB:
        if (!(resumeData.targetJob?.title || '').trim()) {
          newErrors['targetJob.title'] = t('builder.errJobTitle');
          isValid = false;
        }
        if (!(resumeData.targetJob?.company || '').trim()) {
          newErrors['targetJob.company'] = t('builder.errCompany');
          isValid = false;
        }
        if (!(resumeData.targetJob?.description || '').trim()) {
          newErrors['targetJob.description'] = t('builder.errJobDescription');
          isValid = false;
        }
        flagIfGibberish('targetJob.title', resumeData.targetJob?.title);
        flagIfGibberish('targetJob.description', resumeData.targetJob?.description);
        break;

      case AppStep.PERSONAL_INFO:
        if (!(resumeData.personalInfo.fullName || '').trim()) {
          newErrors['personalInfo.fullName'] = t('builder.errFullName');
          isValid = false;
        }
        if (!(resumeData.personalInfo.email || '').trim()) {
          newErrors['personalInfo.email'] = t('builder.errEmail');
          isValid = false;
        } else if (!isValidEmail(resumeData.personalInfo.email)) {
          newErrors['personalInfo.email'] = t('builder.errEmailInvalid');
          isValid = false;
        }
        if ((resumeData.personalInfo.phone || '').trim() && !isValidPhone(resumeData.personalInfo.phone)) {
          newErrors['personalInfo.phone'] = t('builder.errPhoneInvalid');
          isValid = false;
        }
        break;

      case AppStep.EXPERIENCE:
        if (resumeData.userType === 'experienced' && resumeData.experience.length === 0) {
          if (showToast) toast.error(t('builder.addOneExp'));
          isValid = false;
        }
        resumeData.experience.forEach((exp, index) => {
          if (!(exp.company || '').trim()) {
            newErrors[`experience.${index}.company`] = t('builder.errExpCompany');
            isValid = false;
          }
          if (!(exp.role || '').trim()) {
            newErrors[`experience.${index}.role`] = t('builder.errExpRole');
            isValid = false;
          }
          if (!(exp.startDate || '').trim()) {
            newErrors[`experience.${index}.startDate`] = t('builder.errStartDate');
            isValid = false;
          }
          if (!exp.isCurrent && !(exp.endDate || '').trim()) {
            newErrors[`experience.${index}.endDate`] = t('builder.errEndDate');
            isValid = false;
          }
          if (!(exp.rawDescription || '').trim()) {
            newErrors[`experience.${index}.rawDescription`] = t('builder.errDescription');
            isValid = false;
          }
          flagIfGibberish(`experience.${index}.role`, exp.role);
          flagIfGibberish(`experience.${index}.rawDescription`, exp.rawDescription);
        });
        break;

      case AppStep.PROJECTS:
        if (resumeData.userType === 'student' && resumeData.projects.length === 0) {
          if (showToast) toast.error(t('builder.addOneProject'));
          isValid = false;
        }
        resumeData.projects.forEach((proj, index) => {
          if (!(proj.name || '').trim()) {
            newErrors[`projects.${index}.name`] = t('builder.errProjectName');
            isValid = false;
          }
          if (!(proj.rawDescription || '').trim()) {
            newErrors[`projects.${index}.rawDescription`] = t('builder.errDescription');
            isValid = false;
          }
          flagIfGibberish(`projects.${index}.name`, proj.name);
          flagIfGibberish(`projects.${index}.rawDescription`, proj.rawDescription);
        });
        break;

      case AppStep.EDUCATION:
        resumeData.education.forEach((edu, index) => {
          if (!(edu.school || '').trim()) {
            newErrors[`education.${index}.school`] = t('builder.errSchool');
            isValid = false;
          }
          if (!(edu.degree || '').trim()) {
            newErrors[`education.${index}.degree`] = t('builder.errDegree');
            isValid = false;
          }
          if (!(edu.field || '').trim()) {
            newErrors[`education.${index}.field`] = t('builder.errField');
            isValid = false;
          }
          if (!(edu.startDate || '').trim()) {
            newErrors[`education.${index}.startDate`] = t('builder.errStartYear');
            isValid = false;
          }
          if (!edu.isCurrent && !(edu.endDate || '').trim()) {
            newErrors[`education.${index}.endDate`] = t('builder.errEndYear');
            isValid = false;
          }
          flagIfGibberish(`education.${index}.field`, edu.field);
        });
        break;

      case AppStep.SKILLS:
        if (resumeData.skills.length === 0) {
          if (showToast) toast.error(t('builder.addOneSkill'));
          isValid = false;
        }
        break;

      case AppStep.EXTRACURRICULARS:
        resumeData.extracurriculars?.forEach((item, index) => {
          if (!(item.title || '').trim()) {
            newErrors[`extracurriculars.${index}.title`] = t('builder.errRole');
            isValid = false;
          }
          if (!(item.organization || '').trim()) {
            newErrors[`extracurriculars.${index}.organization`] = t('builder.errOrganization');
            isValid = false;
          }
          if (!(item.startDate || '').trim()) {
            newErrors[`extracurriculars.${index}.startDate`] = t('builder.errStartDate');
            isValid = false;
          }
          if (!(item.endDate || '').trim()) {
            newErrors[`extracurriculars.${index}.endDate`] = t('builder.errEndDate');
            isValid = false;
          }
          flagIfGibberish(`extracurriculars.${index}.title`, item.title);
          flagIfGibberish(`extracurriculars.${index}.description`, item.description);
        });
        break;

      case AppStep.AWARDS:
        resumeData.awards?.forEach((item, index) => {
          if (!(item.title || '').trim()) {
            newErrors[`awards.${index}.title`] = t('builder.errAwardTitle');
            isValid = false;
          }
          if (!(item.issuer || '').trim()) {
            newErrors[`awards.${index}.issuer`] = t('builder.errIssuer');
            isValid = false;
          }
          if (!(item.date || '').trim()) {
            newErrors[`awards.${index}.date`] = t('builder.errDate');
            isValid = false;
          }
          flagIfGibberish(`awards.${index}.title`, item.title);
          flagIfGibberish(`awards.${index}.description`, item.description);
        });
        break;

      case AppStep.CERTIFICATIONS:
        resumeData.certifications?.forEach((item, index) => {
          if (!(item.name || '').trim()) {
            newErrors[`certifications.${index}.name`] = t('builder.errCertName');
            isValid = false;
          }
          if (!(item.issuer || '').trim()) {
            newErrors[`certifications.${index}.issuer`] = t('builder.errIssuer');
            isValid = false;
          }
          if (!(item.date || '').trim()) {
            newErrors[`certifications.${index}.date`] = t('builder.errDate');
            isValid = false;
          }
        });
        break;

      case AppStep.AFFILIATIONS:
        resumeData.affiliations?.forEach((item, index) => {
          if (!(item.organization || '').trim()) {
            newErrors[`affiliations.${index}.organization`] = t('builder.errOrganization');
            isValid = false;
          }
          if (!(item.role || '').trim()) {
            newErrors[`affiliations.${index}.role`] = t('builder.errRole');
            isValid = false;
          }
          if (!(item.startDate || '').trim()) {
            newErrors[`affiliations.${index}.startDate`] = t('builder.errStartDate');
            isValid = false;
          }
          if (!(item.endDate || '').trim()) {
            newErrors[`affiliations.${index}.endDate`] = t('builder.errEndDate');
            isValid = false;
          }
          flagIfGibberish(`affiliations.${index}.role`, item.role);
        });
        break;

      case AppStep.PUBLICATIONS:
        resumeData.publications?.forEach((item, index) => {
          if (!(item.title || '').trim()) {
            newErrors[`publications.${index}.title`] = t('builder.errTitle');
            isValid = false;
          }
          if (!(item.publisher || '').trim()) {
            newErrors[`publications.${index}.publisher`] = t('builder.errPublisher');
            isValid = false;
          }
          if (!(item.date || '').trim()) {
            newErrors[`publications.${index}.date`] = t('builder.errDate');
            isValid = false;
          }
          flagIfGibberish(`publications.${index}.title`, item.title);
        });
        break;

      case AppStep.LANGUAGES:
        resumeData.languages?.forEach((item, index) => {
          if (!(item.name || '').trim()) {
            newErrors[`languages.${index}.name`] = t('builder.errLanguage');
            isValid = false;
          }
        });
        break;

      case AppStep.REFERENCES:
        resumeData.references?.forEach((item, index) => {
          if (!(item.name || '').trim()) {
            newErrors[`references.${index}.name`] = t('builder.errName');
            isValid = false;
          }
          if (!(item.position || '').trim()) {
            newErrors[`references.${index}.position`] = t('builder.errPosition');
            isValid = false;
          }
          if (!(item.organization || '').trim()) {
            newErrors[`references.${index}.organization`] = t('builder.errOrganization');
            isValid = false;
          }
          if (!(item.email || '').trim()) {
            newErrors[`references.${index}.email`] = t('builder.errEmail');
            isValid = false;
          } else if (!isValidEmail(item.email)) {
            newErrors[`references.${index}.email`] = t('builder.errEmailInvalid');
            isValid = false;
          }
          if (!(item.phone || '').trim()) {
            newErrors[`references.${index}.phone`] = t('builder.errPhone');
            isValid = false;
          } else if (!isValidPhone(item.phone)) {
            newErrors[`references.${index}.phone`] = t('builder.errPhoneInvalid');
            isValid = false;
          }
          flagIfGibberish(`references.${index}.position`, item.position);
          flagIfGibberish(`references.${index}.relationship`, item.relationship);
        });
        break;

      default:
        break;
    }

    setErrors(newErrors);
    
    // Field-level errors (red borders + inline messages) carry the detail —
    // the toast just nudges the user to look up. The fallback toast covers
    // steps that fail without setting any inline error (e.g. "add at least
    // one work experience").
    if (!isValid && showToast) {
      if (Object.keys(newErrors).length > 0) {
        toast.error(t('builder.fieldsErrorToast'));
      } else {
        toast.error(t('builder.fieldsErrorFallback'));
      }
    }
    
    return isValid;
  };

  const handleNext = () => {
    if (!validateStep(step, true)) {
      return;
    }
    setErrors({}); // clear on success

    if (step === AppStep.USER_TYPE && (!resumeData.visibleSections || resumeData.visibleSections.length === 0)) {
      const defaults = ['education', 'skills', 'projects'];
      if (resumeData.userType === 'experienced') defaults.push('experience');
      setResumeData(prev => ({ ...prev, visibleSections: defaults }));
    }

    const visibleSteps = getVisibleSteps(resumeData.userType, resumeData.visibleSections);
    const currentIndex = visibleSteps.findIndex(s => s.id === step);

    if (currentIndex < visibleSteps.length - 1) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      setStep(visibleSteps[currentIndex + 1].id);
    } else {
      handleGenerate();
    }
  };

  const handleBack = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setErrors({});
    
    const visibleSteps = getVisibleSteps(resumeData.userType, resumeData.visibleSections);
    const currentIndex = visibleSteps.findIndex(s => s.id === step);

    if (currentIndex > 0) {
      setStep(visibleSteps[currentIndex - 1].id);
    } else if (step === AppStep.PREVIEW) {
      setStep(visibleSteps[visibleSteps.length - 1].id);
    }
  };

  const handleGenerate = async (opts?: { skipCreditCheck?: boolean }) => {
    if (!resumeService) {
      toast.error(t('builder.serviceNotInit'));
      return;
    }

    console.info(`[builder] handleGenerate clicked creditsBefore=${credits ?? 'loading'} skipCreditCheck=${!!opts?.skipCreditCheck}`);

    // Client-side credit gate. The server enforces the real check (atomic in
    // /api/optimize); this just avoids a wasted round-trip when we already
    // know the user is at zero. If `credits` is null (still loading), let the
    // call go through — the server will reject with 402 if needed.
    // skipCreditCheck is set after a successful purchase: the closure here
    // still has the stale credits=0, so without the override we'd loop the
    // user back into the modal.
    if (!opts?.skipCreditCheck && credits === 0) {
      console.info('[builder] credit pre-check refused (credits=0), opening purchase modal');
      setResumeGenerateAfterPurchase(true);
      setPurchaseModalOpen(true);
      return;
    }

    setIsGenerating(true);
    setGenerationError(null);
    try {
      // Strip selected sections that have no content so they never produce an
      // empty header in the generated resume.
      const dataForGeneration: ResumeData = resumeData.visibleSections
        ? {
            ...resumeData,
            visibleSections: resumeData.visibleSections.filter(key => {
              switch (key) {
                case 'experience':      return resumeData.experience.length > 0;
                case 'projects':        return (resumeData.projects?.length ?? 0) > 0;
                case 'education':       return resumeData.education.length > 0;
                case 'skills':          return resumeData.skills.length > 0;
                case 'extracurriculars': return (resumeData.extracurriculars?.length ?? 0) > 0;
                case 'awards':          return (resumeData.awards?.length ?? 0) > 0;
                case 'certifications':  return (resumeData.certifications?.length ?? 0) > 0;
                case 'affiliations':    return (resumeData.affiliations?.length ?? 0) > 0;
                case 'publications':    return (resumeData.publications?.length ?? 0) > 0;
                case 'languages':       return (resumeData.languages?.length ?? 0) > 0;
                case 'references':      return (resumeData.references?.length ?? 0) > 0;
                default:                return true;
              }
            }),
          }
        : resumeData;

      const optimizedData = await resumeService.optimizeResume(dataForGeneration);
      const mergedData = resumeService.mergeOptimizedData(dataForGeneration, optimizedData);
      setResumeData(mergedData);
      setStep(AppStep.PREVIEW);

      // Server consumed one credit on success — keep the local count in sync.
      setCredits(prev => {
        if (prev === null) return prev;
        const next = Math.max(0, prev - 1);
        console.info(`[builder] credit decrement local: ${prev} -> ${next}`);
        return next;
      });

      // With the combined toolkit call, success is all-or-nothing on the
      // initial generation — either every toolkit item is present or every
      // one is in the failed state. The warning-card retry path lives on
      // each tab, so we just tell the user where to look.
      const errorKeys = Object.keys(mergedData.toolkit?.errors ?? {});
      const toolkitFailed = errorKeys.length > 0;
      if (!toolkitFailed) {
        console.info('[builder] generation success — full toolkit');
        toast.success(t('builder.toolkitReady'));
      } else {
        console.warn(`[builder] generation success — partial toolkit, failed slots=${errorKeys.join(',')}`);
        toast.warning(t('builder.toolkitPartial'));
      }

      if (user) {
        try {
          const title = mergedData.targetJob?.title
            ? `${mergedData.targetJob.title} Resume`
            : `Resume - ${new Date().toLocaleDateString()}`;
          // Capture the id so Regenerate buttons on toolkit cards can persist
          // without the user first having to round-trip through the dashboard.
          if (activeResumeId) {
            await resumeService.updateGeneratedResume(activeResumeId, mergedData, title);
          } else {
            const newId = await resumeService.saveGeneratedResume(user.id, mergedData, title);
            setActiveResumeId(newId);
          }
        } catch (saveErr) {
          console.error('Auto-save failed', saveErr);
          toast.error(t('builder.autosaveFailed'));
        }
      }
    } catch (err) {
      const errCode = err instanceof ApiCallError ? err.code : undefined;
      const errStatus = err instanceof ApiCallError ? err.status : undefined;
      const errName = err instanceof Error ? err.name : 'Unknown';
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[builder] generation failed name=${errName} status=${errStatus ?? '-'} code=${errCode ?? '-'} msg="${errMsg}"`);
      // Server says no credits left — open the purchase modal instead of
      // showing an error. Covers the race where the local count was stale
      // (e.g. user bought credits in another tab and they ran out, or the
      // mount fetch failed and we let the call proceed).
      if (err instanceof ApiCallError && err.code === 'insufficient_credits') {
        setCredits(0);
        setResumeGenerateAfterPurchase(true);
        setPurchaseModalOpen(true);
      } else if (err instanceof Error && err.name === 'GibberishContentError') {
        // GibberishContentError carries a user-actionable message naming the
        // offending field — surface it verbatim so the user knows where to fix.
        toast.error(err.message);
      } else {
        toast.error(t('builder.optimizeFailed'));
      }
    } finally {
      setIsGenerating(false);
    }
  };

  const handlePurchaseSuccess = () => {
    if (!user) return;
    // Re-fetch credits immediately. In dev/mock mode the credits are already
    // in the DB by the time onSuccess fires; in production they may still be
    // pending, but a single re-fetch is cheap and correct for the mock path.
    profileRepository
      .getToolkitCredits(user.id)
      .then(n => {
        setCredits(n);
        if (resumeGenerateAfterPurchase && n > 0) {
          setResumeGenerateAfterPurchase(false);
          void handleGenerate({ skipCreditCheck: true });
        } else {
          setResumeGenerateAfterPurchase(false);
        }
      })
      .catch(() => {
        setResumeGenerateAfterPurchase(false);
      });
  };

  const handlePurchaseClose = () => {
    setPurchaseModalOpen(false);
    setResumeGenerateAfterPurchase(false);
  };

  const handleExportWord = async (data: ResumeData) => {
    if (!resumeService) throw new Error(t('builder.serviceMissing'));
    await resumeService.exportToWord(data);
  };

  const handleExportPDF = async (data: ResumeData) => {
    if (!resumeService) throw new Error(t('builder.serviceMissing'));
    await resumeService.exportToPDF(data);
  };

  const handleExportCoverLetter = async (data: ResumeData) => {
    if (!resumeService) throw new Error(t('builder.serviceMissing'));
    await resumeService.exportCoverLetterToWord(data);
  };

  const handleExportCoverLetterPDF = async (data: ResumeData) => {
    if (!resumeService) throw new Error(t('builder.serviceMissing'));
    await resumeService.exportCoverLetterToPDF(data);
  };

  if (step === AppStep.PREVIEW) {
    return (
      <Preview
        data={resumeData}
        onUpdate={setResumeData}
        onGoHome={onExit}
        onExportWord={handleExportWord}
        onExportPDF={handleExportPDF}
        onExportCoverLetter={handleExportCoverLetter}
        onExportCoverLetterPDF={handleExportCoverLetterPDF}
        readOnly={!!currentResumeId && step === AppStep.PREVIEW}
        isGeneralResume={isGeneralResume}
        canRegenerate={canRegenerate}
        cooldownEndsAt={cooldownEndsAt}
        onRegenerate={handleRegenerateGeneralResume}
        onRegenerateItem={handleRegenerateItem}
        regeneratingItem={regeneratingItem}
      />
    );
  }

  const visibleStepIds = getVisibleSteps(resumeData.userType, resumeData.visibleSections);
  const stepInfoMap = new Map(stepsInfoFor(t).map(s => [s.id, s]));
  const visibleSteps = visibleStepIds.map(s => stepInfoMap.get(s.id) ?? { id: s.id, title: '' });
  const isLastStep = visibleSteps.length > 0 && visibleSteps[visibleSteps.length - 1].id === step;

  return (
    <div className="min-h-screen bg-paper flex flex-col">
      <Navbar
        onDashboardClick={onExit}
        showExitBuilder={true}
        credits={credits}
        onBuyCredits={() => setPurchaseModalOpen(true)}
      />
      <BuilderStepper steps={visibleSteps} currentStep={step} />

      <main className="flex-1 max-w-3xl mx-auto w-full p-4 md:p-8">
        <div className="bg-white rounded-xl shadow-sm border border-charcoal-100 p-6 md:p-10 min-h-[500px] relative">
          {step === AppStep.USER_TYPE && (
            <UserTypeStep
              userType={resumeData.userType}
              update={userType => setResumeData(prev => ({ ...prev, userType }))}
            />
          )}
          {step === AppStep.SECTIONS && (
            <SectionSelectionStep
              selected={resumeData.visibleSections || []}
              update={sections => setResumeData(prev => ({ ...prev, visibleSections: sections }))}
              userType={resumeData.userType}
            />
          )}
          {step === AppStep.TARGET_JOB && (
            <TargetJobStep
              data={resumeData.targetJob}
              errors={errors}
              update={d => setResumeData(prev => ({ ...prev, targetJob: d }))}
            />
          )}
          {step === AppStep.PERSONAL_INFO && (
            <PersonalInfoStep
              data={resumeData.personalInfo}
              errors={errors}
              update={d => setResumeData(prev => ({ ...prev, personalInfo: d }))}
            />
          )}
          {step === AppStep.EXPERIENCE && resumeData.userType === 'experienced' && (
            <ExperienceStep
              data={resumeData.experience}
              errors={errors}
              update={d => setResumeData(prev => ({ ...prev, experience: d }))}
            />
          )}
          {step === AppStep.PROJECTS && (
            <ProjectsStep
              data={resumeData.projects}
              errors={errors}
              update={d => setResumeData(prev => ({ ...prev, projects: d }))}
              userType={resumeData.userType}
            />
          )}
          {step === AppStep.EDUCATION && (
            <EducationStep
              data={resumeData.education}
              errors={errors}
              update={d => setResumeData(prev => ({ ...prev, education: d }))}
            />
          )}
          {step === AppStep.SKILLS && (
            <SkillsStep
              data={resumeData.skills}
              update={d => setResumeData(prev => ({ ...prev, skills: d }))}
              userType={resumeData.userType}
              jdText={resumeData.targetJob?.description}
              profilePool={profileSkills}
            />
          )}
          {step === AppStep.EXTRACURRICULARS && (
            <ExtracurricularStep
              data={resumeData.extracurriculars || []}
              errors={errors}
              update={d => setResumeData(prev => ({ ...prev, extracurriculars: d }))}
            />
          )}
          {step === AppStep.AWARDS && (
            <AwardsStep
              data={resumeData.awards || []}
              errors={errors}
              update={d => setResumeData(prev => ({ ...prev, awards: d }))}
            />
          )}
          {step === AppStep.CERTIFICATIONS && (
            <CertificationsStep
              data={resumeData.certifications || []}
              errors={errors}
              update={d => setResumeData(prev => ({ ...prev, certifications: d }))}
            />
          )}
          {step === AppStep.AFFILIATIONS && (
            <AffiliationsStep
              data={resumeData.affiliations || []}
              errors={errors}
              update={d => setResumeData(prev => ({ ...prev, affiliations: d }))}
            />
          )}
          {step === AppStep.PUBLICATIONS && (
            <PublicationsStep
              data={resumeData.publications || []}
              errors={errors}
              update={d => setResumeData(prev => ({ ...prev, publications: d }))}
            />
          )}
          {step === AppStep.LANGUAGES && (
            <LanguagesStep
              data={resumeData.languages || []}
              errors={errors}
              update={d => setResumeData(prev => ({ ...prev, languages: d }))}
            />
          )}
          {step === AppStep.REFERENCES && (
            <ReferencesStep
              data={resumeData.references || []}
              errors={errors}
              update={d => setResumeData(prev => ({ ...prev, references: d }))}
            />
          )}

          {isGenerating && (
            <div className="absolute inset-0 bg-white/90 backdrop-blur-sm z-50 flex flex-col items-center justify-center rounded-xl">
              <div className="relative">
                <div className="w-16 h-16 border-4 border-charcoal-200 border-t-brand-700 rounded-full animate-spin"></div>
                <div className="absolute inset-0 flex items-center justify-center">
                  <Sparkles size={24} className="text-accent-500 animate-pulse" />
                </div>
              </div>
              <h3 className="mt-6 font-display text-xl font-semibold text-brand-700">
                {t('builder.loadingTitle')}
              </h3>
              <p className="text-brand-500 mt-2 text-center max-w-md px-4 leading-relaxed">
                {t('builder.loadingBody')}
              </p>
            </div>
          )}
        </div>
      </main>

      <footer className="bg-white border-t border-charcoal-200 p-4 sticky bottom-0 z-10 w-full">
        <div className="max-w-3xl mx-auto flex justify-between items-center px-4 md:px-0">
          <button
            type="button"
            onClick={handleBack}
            disabled={step === AppStep.USER_TYPE || isGenerating}
            className={`flex items-center gap-2 px-6 py-3 rounded-lg text-sm font-bold transition-colors ${step === AppStep.USER_TYPE
              ? 'opacity-0 cursor-default'
              : 'text-charcoal-600 hover:bg-charcoal-100'
              }`}
          >
            <ChevronLeft size={18} /> {t('builder.backCta')}
          </button>

          <div className="flex flex-col items-end">
            {generationError && (
              <p className="text-red-500 text-xs mb-2 font-medium">
                {generationError}
              </p>
            )}
            {step === AppStep.USER_TYPE ? (
              <button
                type="button"
                onClick={handleNext}
                disabled={!resumeData.userType}
                className="flex items-center gap-2 px-8 py-3 bg-charcoal-900 text-white rounded-lg text-sm font-bold hover:bg-black transition-colors focus-visible:ring-2 focus-visible:ring-charcoal-900 focus-visible:ring-offset-2 transform active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {t('builder.nextCta')} <ChevronRight size={18} />
              </button>
            ) : isLastStep ? (
              <>
                {credits !== null && (
                  <p
                    className={`text-xs mb-2 font-medium ${credits === 0 ? 'text-accent-700' : 'text-charcoal-500'}`}
                  >
                    {credits === 0
                      ? t('builder.creditsExhausted')
                      : credits === 1
                        ? t('builder.creditsRemainingOne')
                        : t('builder.creditsRemainingMany', { count: credits })}
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => { void handleGenerate(); }}
                  disabled={isGenerating}
                  className="flex items-center gap-2 px-8 py-3 bg-brand-700 text-charcoal-50 rounded-lg text-sm font-bold hover:bg-brand-800 transition-colors focus-visible:ring-2 focus-visible:ring-accent-400 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transform active:scale-95"
                >
                  {isGenerating
                    ? t('builder.generating')
                    : credits === 0
                      ? t('builder.buyGenerationsCta')
                      : t('builder.buildToolkitCta')}{' '}
                  <Sparkles size={18} className="text-accent-400" />
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={handleNext}
                className="flex items-center gap-2 px-8 py-3 bg-charcoal-900 text-white rounded-lg text-sm font-bold hover:bg-black transition-colors focus-visible:ring-2 focus-visible:ring-charcoal-900 focus-visible:ring-offset-2 transform active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {t('builder.nextCta')} <ChevronRight size={18} />
              </button>
            )}
          </div>
        </div>
      </footer>

      <PurchaseModal
        isOpen={purchaseModalOpen}
        onClose={handlePurchaseClose}
        onSuccess={handlePurchaseSuccess}
      />
    </div>
  );
};
