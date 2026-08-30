import React, { useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { ResumeData, AppStep, ToolkitItem } from '../domain/entities';
import { Preview } from './components/Preview';
import { ResumeService } from '../application/services/ResumeService';
import { isGibberish } from '../application/validation/gibberishDetector';
import { isValidEmail } from './components/ui/EmailInput';
import { isValidPhone } from './components/ui/PhoneInput';
import { useAuth } from '../infrastructure/auth/AuthContext';
import { Sparkles, AlertTriangle, RefreshCw } from 'lucide-react';
import { Navbar } from './components/Layout/Navbar';
import { PurchaseModal } from './components/PurchaseModal';
import { profileRepository } from '../infrastructure/config/dependencies';
import { ApiCallError } from '../infrastructure/ai/proxy/ProxyClients';
import { apiErrorMessage, isRetryPointless } from './i18n/apiErrorMessage.js';
import { useT } from './i18n/LocaleContext';


interface BuilderScreenProps {
  initialData: ResumeData;
  initialStep: AppStep;
  currentResumeId: string | null;
  resumeService: ResumeService | null;
  onExit: () => void;
  // When true (entered from the Summary screen), generation fires automatically
  // once credits are known and this screen renders only Generating → Preview
  // (or an error + retry). The step wizard has been retired.
  autoGenerate?: boolean;
}

export const BuilderScreen: React.FC<BuilderScreenProps> = ({
  initialData,
  initialStep,
  currentResumeId,
  resumeService,
  onExit,
  autoGenerate = false,
}) => {
  const { user } = useAuth();
  const t = useT();
  const [step, setStep] = useState<AppStep>(initialStep);
  const [resumeData, setResumeData] = useState<ResumeData>(initialData);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  // Localized replacement copy for the full-screen error panel. The panel used to
  // render a HARDCODED body ("Your credit was not charged. Give it another
  // try…") while `generationError` held the real reason and was used only as a
  // boolean — so a user who hit the daily cap was told to try again, next to a
  // Retry button that could only fail. Null = keep the default copy.
  const [generationErrorBody, setGenerationErrorBody] = useState<string | null>(null);
  // Whether the full-screen panel should offer Retry at all. The panel used to
  // offer it unconditionally — including after a refund failure (where the user
  // WAS charged and retrying spends a second credit) and after the daily cap
  // (where every press is a guaranteed rejection). The toast already reasoned
  // about this via isRetryPointless; the persistent surface did not.
  const [generationRetryable, setGenerationRetryable] = useState(true);

  // Toolkit credits — null while loading, integer once fetched. We fetch on
  // mount and after every purchase so the user always sees a fresh balance
  // before clicking Generate. The server is the source of truth; this number
  // only drives the UI (the gate is enforced in /api/optimize).
  const [credits, setCredits] = useState<number | null>(null);
  // Whether the credits fetch has SETTLED, regardless of outcome. Distinct from
  // `credits !== null`: a failed fetch leaves credits null forever, and gating
  // auto-generation on a non-null value therefore deadlocked the screen on a
  // progress panel for a request that was never sent.
  const [creditsLoaded, setCreditsLoaded] = useState(false);
  const [purchaseModalOpen, setPurchaseModalOpen] = useState(false);
  // Set when the user hit the zero-credit gate — after the credits actually
  // land we resume the generation rather than making them ask again.
  //
  // A ref, not state, and deliberately NOT cleared when the modal closes. bKash
  // credits can land seconds after the sheet is dismissed (the watcher confirms
  // out of band), and clearing on close threw away the intent of someone who
  // had genuinely paid — leaving them on a progress screen with credits in
  // their account and no control to spend them. Cleared only when a generation
  // actually starts, or when the user leaves.
  const resumeAfterPurchaseRef = useRef(false);
  // Guards against two triggers racing into one generation — the navbar pill's
  // onCredited and the modal's onSuccess both fire on a purchase, and the retry
  // toast stays tappable while a retry is already running. Each duplicate costs
  // a real credit and writes a duplicate resume row.
  const generatingRef = useRef(false);
  // False after unmount, so a late callback cannot start a generation the user
  // can no longer see.
  const mountedRef = useRef(true);
  // MUST re-arm on mount, not only clear on unmount. React 18 StrictMode runs
  // effects mount -> cleanup -> mount in development, so a cleanup-only version
  // left this false for the component's entire life: handlePurchaseSuccess
  // early-returned (no credit refresh, no post-purchase resume) and the
  // autosave's teardown flush fired on every keystroke instead of on teardown.
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Validation errors map field paths (e.g. "personalInfo.fullName") to error messages
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Mirror the prop so we can capture the row id right after the initial
  // auto-save. Without this, regeneration buttons click-bail (no id) until
  // the user round-trips through the dashboard to load the resume again.
  const [activeResumeId, setActiveResumeId] = useState<string | null>(currentResumeId);
  useEffect(() => {
    setActiveResumeId(currentResumeId);
  }, [currentResumeId]);

  // Autosave draft to localStorage — 500 ms after the last change. Without
  // this, a user who fills 6 steps and closes the tab loses everything
  // (App.tsx reads `service.loadDraft()` on mount, but nothing was writing).
  // We skip saving once a resume has been generated (activeResumeId set) —
  // that row lives in Supabase and is the source of truth.
  useEffect(() => {
    if (!resumeService) return;
    if (activeResumeId) return; // generated resume — Supabase owns it now
    const handle = window.setTimeout(() => {
      resumeService.saveDraft(resumeData);
    }, 500);
    return () => window.clearTimeout(handle);
  }, [resumeService, resumeData, activeResumeId]);

  const [isGeneralResume, setIsGeneralResume] = useState(false);
  const [regeneratingItem, setRegeneratingItem] = useState<ToolkitItem | null>(null);
  // True while the initial toolkit bundle (/api/toolkit) is in flight. The
  // resume preview is already visible at that point; toolkit tabs show
  // per-item "generating" spinners until the bundle lands.
  const [toolkitPending, setToolkitPending] = useState(false);

  // Keyboard-aware footer: on mobile the soft keyboard covers the sticky
  // Back/Next bar. Track how far the visual viewport bottom sits above the
  // layout viewport bottom (≈ keyboard height) and lift the footer by it.
  // Desktop never fires a meaningful inset, so it's a no-op there.
  const [keyboardInset, setKeyboardInset] = useState(0);
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!vv) return;
    const update = () => {
      const inset = window.innerHeight - vv.height - vv.offsetTop;
      // Ignore small URL-bar deltas; a keyboard is always > ~120px.
      setKeyboardInset(inset > 120 ? Math.round(inset) : 0);
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);

  // Always-fresh mirror of resumeData for async continuations (the toolkit
  // bundle resolves long after the user may have started editing the preview;
  // merging against a stale closure would wipe those edits).
  const resumeDataRef = useRef(resumeData);
  useEffect(() => {
    resumeDataRef.current = resumeData;
  }, [resumeData]);

  // Persist preview edits to Supabase — 1.5 s after the last change. Inline
  // edits (EditableElement) only update local state; before this effect, a
  // user who polished wording in the preview and navigated away silently lost
  // every edit (the saved row still held the original generation). Snapshot
  // ref avoids redundant writes (e.g. right after handleGenerate already
  // saved the merged data, or when opening an existing resume read-only).
  const lastPersistedRef = useRef<string>(JSON.stringify(initialData));
  // The not-yet-written autosave, and a flag that distinguishes a genuine
  // teardown from the effect simply re-running on the next keystroke.
  // Teardown detection reuses mountedRef, which is declared above this effect —
  // React runs cleanups in definition order, so mountedRef is already false by
  // the time the autosave cleanup below asks.
  const pendingSaveRef = useRef<null | (() => Promise<void>)>(null);
  useEffect(() => {
    if (!resumeService || !activeResumeId || isGenerating) return;
    if (step !== AppStep.PREVIEW) return;
    const snapshot = JSON.stringify(resumeData);
    if (snapshot === lastPersistedRef.current) return;
    // General resumes are identified by their fixed title — never rename
    // them here or isGeneralResume detection breaks on next load.
    const title = isGeneralResume
      ? ResumeService.GENERAL_RESUME_TITLE
      : resumeData.targetJob?.title
        ? `${resumeData.targetJob.title} Resume`
        : `Resume - ${new Date().toLocaleDateString()}`;

    const persist = async () => {
      try {
        await resumeService.updateGeneratedResume(activeResumeId, resumeData, title);
        lastPersistedRef.current = snapshot;
        console.info('[builder] preview edits persisted');
      } catch (err) {
        console.error('Preview edit autosave failed', err);
        toast.error(t('builder.autosaveFailed'));
      }
    };

    const handle = window.setTimeout(() => { pendingSaveRef.current = null; void persist(); }, 1500);
    // Hold the un-flushed write so a teardown can still send it. Without this
    // the cleanup below only cancelled the timer, so an edit whose committing
    // blur was the SAME click that left the screen was silently dropped — the
    // exact loss this effect exists to prevent. Deterministic, not a race: any
    // exit within 1.5s of the last keystroke lost it.
    pendingSaveRef.current = persist;
    return () => {
      window.clearTimeout(handle);
      const flush = pendingSaveRef.current;
      pendingSaveRef.current = null;
      // Only flush on a real teardown (unmount / leaving PREVIEW), not on the
      // re-run that every keystroke causes — otherwise every character writes.
      if (flush && !mountedRef.current) void flush();
    };
  }, [resumeService, resumeData, activeResumeId, step, isGenerating, isGeneralResume, t]);

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
  // changes). On failure we leave the balance null — the server still gates the
  // call — but we MUST still mark the fetch as settled, or the auto-generate
  // effect below waits forever for a number that will never arrive.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    profileRepository
      .getToolkitCredits(user.id)
      .then(n => {
        if (!cancelled) setCredits(n);
      })
      .catch(err => console.warn('Could not load toolkit credits', err))
      .finally(() => {
        if (!cancelled) setCreditsLoaded(true);
      });
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
    };
    checkResumeStatus();
  }, [user, resumeService, activeResumeId]);

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




  const handleGenerate = async (opts?: { skipCreditCheck?: boolean }) => {
    if (!resumeService) {
      toast.error(t('builder.serviceNotInit'));
      return;
    }

    // Content gate: a resume + toolkit can only be built from real content.
    // Block (before any credit spend) unless there's at least one education or
    // experience entry.
    if (resumeData.education.length === 0 && resumeData.experience.length === 0) {
      toast.error(t('builder.noResumeWarn'));
      return;
    }

    // One generation at a time. Two triggers can arrive for a single user
    // action (purchase success from both the modal and the navbar pill; the
    // retry toast still tappable during a retry), and each duplicate spends a
    // real credit and saves a duplicate resume row.
    if (generatingRef.current) {
      console.info('[builder] handleGenerate ignored — a generation is already in flight');
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
      resumeAfterPurchaseRef.current = true;
      setPurchaseModalOpen(true);
      return;
    }

    // Past every precondition — this generation is really starting, so the
    // queued intent is spent and the in-flight guard goes up.
    resumeAfterPurchaseRef.current = false;
    generatingRef.current = true;
    setGenerationRetryable(true);
    setIsGenerating(true);
    setGenerationError(null);
      setGenerationErrorBody(null);
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

      // Fire the toolkit bundle in PARALLEL with the optimizer — separate
      // /api/toolkit request, free (the optimizer's credit covers the whole
      // generation), never throws (failures land in its errors map). The
      // resume renders the moment the optimizer resolves; the toolkit fills
      // its tabs in when this promise settles.
      setToolkitPending(true);
      const toolkitPromise = resumeService.generateToolkitBundle(dataForGeneration);

      const optimizedData = await resumeService.optimizeResume(dataForGeneration);
      const mergedData: ResumeData = {
        ...resumeService.mergeOptimizedData(dataForGeneration, optimizedData),
        // Clear artifacts from any previous generation — the new bundle is in
        // flight, and stale artifacts must not render as "success" meanwhile.
        coverLetter: undefined,
        toolkit: undefined,
      };
      setResumeData(mergedData);
      resumeDataRef.current = mergedData;
      setStep(AppStep.PREVIEW);

      // Server consumed one credit on success — keep the local count in sync.
      setCredits(prev => {
        if (prev === null) return prev;
        const next = Math.max(0, prev - 1);
        console.info(`[builder] credit decrement local: ${prev} -> ${next}`);
        return next;
      });

      // Persist the resume right away (the toolkit lands in a second write) —
      // the user's core artifact must survive even if they close the tab
      // before the toolkit finishes.
      let savedId = activeResumeId;
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
            savedId = newId;
          }
          // Just persisted — sync the preview-edit autosave snapshot so the
          // effect doesn't immediately re-write the same data.
          lastPersistedRef.current = JSON.stringify(mergedData);
        } catch (saveErr) {
          console.error('Auto-save failed', saveErr);
          toast.error(t('builder.autosaveFailed'));
        }
      }

      // Toolkit continuation — merge against the LATEST data (the user may be
      // editing the preview while this resolves), toast the outcome, persist.
      void toolkitPromise.then(async ({ coverLetter, toolkit }) => {
        const latest = resumeDataRef.current;
        const withToolkit: ResumeData = {
          ...latest,
          coverLetter: coverLetter ?? latest.coverLetter,
          toolkit,
        };
        setResumeData(withToolkit);
        resumeDataRef.current = withToolkit;
        setToolkitPending(false);

        const errorKeys = Object.keys(toolkit.errors ?? {});
        if (errorKeys.length === 0) {
          console.info('[builder] toolkit bundle complete — all slots');
          toast.success(t('builder.toolkitReady'));
        } else {
          console.warn(`[builder] toolkit bundle partial, failed slots=${errorKeys.join(',')}`);
          // Name the failed artifacts so the user knows exactly which tabs to
          // retry instead of hunting for the empty ones.
          const itemLabelKeys: Record<string, string> = {
            coverLetter: 'preview.tabCoverLetter',
            outreachEmail: 'preview.tabOutreachEmail',
            linkedInMessage: 'preview.tabLinkedIn',
            interviewQuestions: 'preview.tabQuestionPrep',
          };
          const failedNames = errorKeys
            .map(k => (itemLabelKeys[k] ? t(itemLabelKeys[k]) : k))
            .join(', ');
          toast.warning(t('builder.toolkitPartialNamed', { items: failedNames }), { duration: 8000 });
        }

        if (user && savedId) {
          try {
            const title = withToolkit.targetJob?.title
              ? `${withToolkit.targetJob.title} Resume`
              : `Resume - ${new Date().toLocaleDateString()}`;
            await resumeService.updateGeneratedResume(savedId, withToolkit, title);
            lastPersistedRef.current = JSON.stringify(withToolkit);
          } catch (saveErr) {
            console.error('Toolkit auto-save failed', saveErr);
            toast.error(t('builder.autosaveFailed'));
          }
        }
      });
    } catch (err) {
      // Optimizer failed — the toolkit promise (if started) resolves into an
      // errors map on its own and is irrelevant now; drop the pending state.
      setToolkitPending(false);
      const errCode = err instanceof ApiCallError ? err.code : undefined;
      const errStatus = err instanceof ApiCallError ? err.status : undefined;
      const errName = err instanceof Error ? err.name : 'Unknown';
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[builder] generation failed name=${errName} status=${errStatus ?? '-'} code=${errCode ?? '-'} msg="${errMsg}"`);
      setGenerationError(errMsg);
      const localized = apiErrorMessage(err, t);
      setGenerationErrorBody(localized);
      // Server says no credits left — open the purchase modal instead of
      // showing an error. Covers the race where the local count was stale
      // (e.g. user bought credits in another tab and they ran out, or the
      // mount fetch failed and we let the call proceed).
      if (err instanceof ApiCallError && err.code === 'insufficient_credits') {
        setCredits(0);
        resumeAfterPurchaseRef.current = true;
        setPurchaseModalOpen(true);
      } else if (err instanceof Error && err.name === 'GibberishContentError') {
        // GibberishContentError carries a user-actionable message naming the
        // offending field — surface it verbatim so the user knows where to fix.
        // Retrying the identical content is deterministic: it fails again.
        setGenerationErrorBody(err.message);
        setGenerationRetryable(false);
        toast.error(err.message);
      } else if (errCode === 'refund_failed') {
        // The user was charged but got nothing AND the automatic refund
        // failed — never leave this ambiguous. Long duration: this one matters.
        //
        // The persistent panel must say the same thing. It used to fall back to
        // generationErrorBody's default copy — "Your credit was not charged" —
        // which is the exact opposite of the truth here, sitting next to a
        // Retry that would spend another credit. The toast vanishes; the panel
        // is what the user is left staring at.
        setGenerationErrorBody(t('builder.refundFailed'));
        setGenerationRetryable(false);
        setCredits(prev => (prev === null ? prev : Math.max(0, prev - 1)));
        toast.error(t('builder.refundFailed'), { duration: 15000 });
      } else if (errCode === 'client_timeout' || errCode === 'network_error') {
        // Hung connection or offline — retryable, so offer the retry inline
        // instead of making the user re-find the Generate button.
        toast.error(
          errCode === 'client_timeout' ? t('builder.generationTimeout') : t('builder.networkError'),
          {
            duration: 12000,
            action: {
              label: t('builder.retryCta'),
              onClick: () => { void handleGenerate(opts); },
            },
          },
        );
      } else if (localized) {
        // A recognized server failure: show WHY, localized. Offer Retry only when
        // retrying can actually succeed — on a daily-cap 429 every press is a
        // guaranteed rejection, so the button is removed rather than lying.
        if (isRetryPointless(err)) setGenerationRetryable(false);
        toast.error(localized, {
          duration: 12000,
          ...(isRetryPointless(err) ? {} : {
            action: {
              label: t('builder.retryCta'),
              onClick: () => { void handleGenerate(opts); },
            },
          }),
        });
      } else {
        toast.error(t('builder.optimizeFailed'), {
          duration: 10000,
          action: {
            label: t('builder.retryCta'),
            onClick: () => { void handleGenerate(opts); },
          },
        });
      }
    } finally {
      generatingRef.current = false;
      setIsGenerating(false);
    }
  };

  // Summary-screen fast path: once credits are known, fire generation once.
  // Everything (profile data, targetJob, visibleSections) is already set on
  // initialData by App before navigating here, so no step input is needed.
  const autoGenFired = useRef(false);
  useEffect(() => {
    // `creditsLoaded`, not `credits !== null`: a failed balance fetch must not
    // strand the screen. handleGenerate already tolerates a null balance and
    // lets the server enforce the real gate.
    if (autoGenerate && !autoGenFired.current && resumeService && creditsLoaded) {
      autoGenFired.current = true;
      void handleGenerate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoGenerate, resumeService, creditsLoaded]);

  // Fires from BOTH the modal's onSuccess and the navbar pill's onCredited —
  // one purchase can trigger it twice. The intent is read-and-cleared
  // synchronously, before any await, so the second caller finds it spent
  // instead of starting a second paid generation.
  const handlePurchaseSuccess = () => {
    if (!user) return;
    profileRepository
      .getToolkitCredits(user.id)
      .then(n => {
        if (!mountedRef.current) return;
        setCredits(n);
        setCreditsLoaded(true);
        if (!resumeAfterPurchaseRef.current || n <= 0) return;
        resumeAfterPurchaseRef.current = false;
        void handleGenerate({ skipCreditCheck: true });
      })
      .catch(err => console.warn('Could not refresh credits after purchase', err));
  };

  // Closing the sheet is NOT abandoning the purchase. bKash credits can land
  // after it closes, and the intent must outlive the dismissal so the pill's
  // onCredited can still resume the generation the user paid for. The intent is
  // cleared when a generation starts, or when the user leaves the builder.
  const handlePurchaseClose = () => {
    setPurchaseModalOpen(false);
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
        onRegenerateItem={handleRegenerateItem}
        regeneratingItem={regeneratingItem}
        toolkitPending={toolkitPending}
      />
    );
  }

  // Tailored flow (entered from the Summary screen): there is no step wizard.
  // autoGenerate fires generation on mount; this shows a calm progress screen
  // while it runs and a retry on failure. Opening an existing resume returns
  // <Preview> above, so this render only ever shows generate / error states.
  // Auto-generate is armed but has not fired yet — the credits pre-flight is
  // still in the air. This IS work in progress from the user's point of view
  // (they just pressed Generate), so it must render as progress. Without it the
  // new idle panel flashed "Nothing is building right now" on the happy path of
  // every tailored generation, for the length of one Supabase round-trip.
  const startingUp = autoGenerate && !autoGenFired.current;

  const artifactChips = ['chipResume', 'chipCover', 'chipEmail', 'chipLinkedin', 'chipInterview'];
  return (
    <div className="flex min-h-screen flex-col" style={{ background: '#F6F4EE' }}>
      <Navbar
        onDashboardClick={onExit}
        showExitBuilder={true}
        credits={credits}
        onBuyCredits={() => setPurchaseModalOpen(true)}
        onCredited={handlePurchaseSuccess}
      />
      <main className="flex flex-1 items-center justify-center px-6 py-16">
        {generationError && !isGenerating ? (
          <div className="w-full max-w-md text-center">
            <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50">
              <AlertTriangle className="text-red-500" size={26} />
            </div>
            <h1 className="font-display text-2xl font-semibold text-brand-700">{t('builder.generationErrorTitle')}</h1>
            <p className="mt-2 text-[15px] leading-relaxed text-charcoal-500">{generationErrorBody ?? t('builder.generationErrorBody')}</p>
            <div className="mt-6 flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={onExit}
                className="rounded-full border border-charcoal-300 px-5 py-3 text-sm font-semibold text-brand-700 transition-colors hover:border-brand-700"
              >
                {t('builder.backToDashboard')}
              </button>
              {generationRetryable && (
                <button
                  type="button"
                  onClick={() => { void handleGenerate(); }}
                  className="inline-flex items-center gap-2 rounded-full bg-accent-400 px-6 py-3 text-sm font-bold text-brand-800 transition-colors hover:bg-accent-300"
                >
                  <RefreshCw size={15} /> {t('builder.retryCta')}
                </button>
              )}
            </div>
          </div>
        ) : !isGenerating && !startingUp ? (
          /* NOT generating, and no error to show. Previously this fell through
             to the progress panel below, which then animated "Building your
             application…" for work that was never started — the zero-credit
             gate returns early, a failed credits fetch never fired, and a
             Back/Forward replay lands here too. A screen that lies about
             working is worse than one that admits it is idle, so say so and
             give the user the two controls that actually help. */
          <div className="w-full max-w-md text-center">
            <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-100">
              <Sparkles size={26} className="text-accent-600" />
            </div>
            <h1 className="font-display text-2xl font-semibold text-brand-700">{t('builder.idleTitle')}</h1>
            <p className="mt-2 text-[15px] leading-relaxed text-charcoal-500">
              {credits === 0 ? t('builder.idleBodyNoCredits') : t('builder.idleBody')}
            </p>
            <div className="mt-6 flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={onExit}
                className="rounded-full border border-charcoal-300 px-5 py-3 text-sm font-semibold text-brand-700 transition-colors hover:border-brand-700"
              >
                {t('builder.backToDashboard')}
              </button>
              {credits === 0 ? (
                <button
                  type="button"
                  onClick={() => { resumeAfterPurchaseRef.current = true; setPurchaseModalOpen(true); }}
                  className="inline-flex items-center gap-2 rounded-full bg-accent-400 px-6 py-3 text-sm font-bold text-brand-800 transition-colors hover:bg-accent-300"
                >
                  {t('builder.idleBuyCta')}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => { void handleGenerate(); }}
                  className="inline-flex items-center gap-2 rounded-full bg-accent-400 px-6 py-3 text-sm font-bold text-brand-800 transition-colors hover:bg-accent-300"
                >
                  <Sparkles size={15} /> {t('builder.idleGenerateCta')}
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="w-full max-w-md text-center">
            <div className="relative mx-auto mb-6 flex h-16 w-16 items-center justify-center">
              <span className="absolute inset-0 animate-ping rounded-2xl bg-accent-200 opacity-40" />
              <span
                className="relative flex h-16 w-16 items-center justify-center rounded-2xl"
                style={{ background: 'linear-gradient(135deg, #E8960F, #C7590E)' }}
              >
                <Sparkles size={26} className="text-[#FFF7EA]" fill="#FFF7EA" />
              </span>
            </div>
            <h1 className="font-display text-[26px] font-semibold text-brand-700">{t('builder.generatingTitle')}</h1>
            <p className="mt-2 text-[15px] leading-relaxed text-charcoal-500">{t('builder.generatingBody')}</p>
            <div className="mt-7 flex flex-wrap items-center justify-center gap-2">
              {artifactChips.map((k) => (
                <span
                  key={k}
                  className="rounded-full border border-charcoal-200 bg-white px-3.5 py-1.5 text-[12px] font-semibold text-charcoal-500"
                >
                  {t(`dashboard.${k}` as any)}
                </span>
              ))}
            </div>
          </div>
        )}
      </main>

      <PurchaseModal
        isOpen={purchaseModalOpen}
        onClose={handlePurchaseClose}
        onSuccess={handlePurchaseSuccess}
      />
    </div>
  );
};
