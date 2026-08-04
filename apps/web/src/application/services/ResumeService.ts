// Application Service - Orchestrates use cases

import { ResumeData, OptimizedResumeData, JobToolkit, ToolkitItem, ToolkitErrors, NormalizedItemContent, inferUserType } from '../../domain/entities/Resume';
import { OptimizeResumeUseCase, IResumeOptimizer } from '../../domain/usecases/OptimizeResumeUseCase';
import { NormalizeProfileItemUseCase, IProfileItemNormalizer, ProfileItemContext } from '../../domain/usecases/NormalizeProfileItemUseCase';
import { ExportResumeUseCase, IResumeExporter } from '../../domain/usecases/ExportResumeUseCase';
import { GenerateCoverLetterUseCase, ICoverLetterGenerator } from '../../domain/usecases/GenerateCoverLetterUseCase';
import { GenerateOutreachEmailUseCase, IOutreachEmailGenerator } from '../../domain/usecases/GenerateOutreachEmailUseCase';
import { GenerateLinkedInMessageUseCase, ILinkedInMessageGenerator } from '../../domain/usecases/GenerateLinkedInMessageUseCase';
import { GenerateInterviewQuestionsUseCase, IInterviewQuestionsGenerator } from '../../domain/usecases/GenerateInterviewQuestionsUseCase';
import { GenerateToolkitUseCase, IToolkitGenerator } from '../../domain/usecases/GenerateToolkitUseCase';
import { IResumeRepository } from '../../domain/repositories/IResumeRepository';
import { IProfileRepository } from '../../domain/repositories/IProfileRepository';
import { assertNotGibberish, FieldCheck } from '../validation/gibberishDetector';
import { computeProfileHash } from '../validation/profileHash';
import { contentHash } from '../validation/contentHash';
import { track } from '../../infrastructure/analytics/track';

export class ResumeService {
  private optimizeUseCase: OptimizeResumeUseCase;
  private generalOptimizeUseCase: OptimizeResumeUseCase;
  private exportUseCase: ExportResumeUseCase;
  private coverLetterUseCase: GenerateCoverLetterUseCase;
  private outreachEmailUseCase: GenerateOutreachEmailUseCase;
  private linkedInMessageUseCase: GenerateLinkedInMessageUseCase;
  private interviewQuestionsUseCase: GenerateInterviewQuestionsUseCase;
  private toolkitUseCase: GenerateToolkitUseCase;
  // Per-item AI polish, reused by the general-resume fallback to convert raw
  // (possibly Banglish) descriptions into professional bullets on demand.
  private normalizeItemUseCase?: NormalizeProfileItemUseCase;

  constructor(
    resumeOptimizer: IResumeOptimizer,
    resumeExporter: IResumeExporter,
    coverLetterGenerator: ICoverLetterGenerator,
    outreachEmailGenerator: IOutreachEmailGenerator,
    linkedInMessageGenerator: ILinkedInMessageGenerator,
    interviewQuestionsGenerator: IInterviewQuestionsGenerator,
    toolkitGenerator: IToolkitGenerator,
    private repository: IResumeRepository,
    private profileRepository?: IProfileRepository,
    generalResumeOptimizer?: IResumeOptimizer,
    profileItemNormalizer?: IProfileItemNormalizer
  ) {
    if (profileItemNormalizer) {
      this.normalizeItemUseCase = new NormalizeProfileItemUseCase(profileItemNormalizer);
    }
    this.optimizeUseCase = new OptimizeResumeUseCase(resumeOptimizer);
    // Falls back to the regular optimizer if no dedicated general-resume
    // optimizer is wired (e.g. in local dev without the new endpoint).
    this.generalOptimizeUseCase = new OptimizeResumeUseCase(generalResumeOptimizer ?? resumeOptimizer);
    this.exportUseCase = new ExportResumeUseCase(resumeExporter);
    this.coverLetterUseCase = new GenerateCoverLetterUseCase(coverLetterGenerator);
    this.outreachEmailUseCase = new GenerateOutreachEmailUseCase(outreachEmailGenerator);
    this.linkedInMessageUseCase = new GenerateLinkedInMessageUseCase(linkedInMessageGenerator);
    this.interviewQuestionsUseCase = new GenerateInterviewQuestionsUseCase(interviewQuestionsGenerator);
    this.toolkitUseCase = new GenerateToolkitUseCase(toolkitGenerator);
  }

  saveDraft(data: ResumeData): void {
    this.repository.save(data);
  }

  loadDraft(): ResumeData | null {
    return this.repository.load();
  }

  async saveGeneratedResume(userId: string, data: ResumeData, title: string): Promise<string> {
    return this.repository.saveGeneratedResume(userId, data, title);
  }

  async updateGeneratedResume(id: string, data: ResumeData, title: string): Promise<void> {
    return this.repository.updateGeneratedResume(id, data, title);
  }

  async getGeneratedResumes(userId: string): Promise<{ id: string; title: string; date: string; updatedAt?: string; company?: string }[]> {
    return this.repository.getGeneratedResumes(userId);
  }

  async getGeneratedResumesPaginated(
    userId: string,
    params: { page: number; pageSize: number; search?: string },
  ) {
    return this.repository.getGeneratedResumesPaginated(userId, params);
  }

  async getGeneratedResume(id: string): Promise<ResumeData | null> {
    return this.repository.getGeneratedResume(id);
  }

  async deleteGeneratedResume(id: string): Promise<void> {
    return this.repository.deleteGeneratedResume(id);
  }

  async optimizeResume(rawData: ResumeData): Promise<OptimizedResumeData> {
    // userType is derived, never selected — recompute it from the data so AI
    // framing (seniority, tone) is always consistent with the actual content.
    const data: ResumeData = { ...rawData, userType: inferUserType(rawData.experience) };
    const t0 = performance.now();
    console.info(`[resume-service] optimizeResume start jdLen=${data.targetJob?.description?.length ?? 0} exp=${data.experience?.length ?? 0} proj=${data.projects?.length ?? 0}`);

    // Pre-flight gate: refuse to spend tokens on keyboard mashing. Throws a
    // GibberishContentError listing the offending fields so the UI can show a
    // meaningful message. We only check the long, free-form fields the user
    // typed themselves — short structured fields (names, dates, locations)
    // are too noisy to score and not where waste comes from.
    try {
      this.assertContentIsReal(data);
    } catch (gateErr) {
      console.warn('[resume-service] gibberish gate refused generation:', this.errorMessage(gateErr));
      throw gateErr;
    }

    // Optimizer only. The combined toolkit bundle runs as a SEPARATE request
    // (/api/toolkit via generateToolkitBundle) fired by the builder in
    // parallel with this call — each gets its own Vercel 60s window, and the
    // user sees the tailored resume as soon as the optimizer resolves instead
    // of waiting for the slower toolkit half.
    track('resume_generation_started', { type: 'paid_tailored' });

    let optimizedData: OptimizedResumeData;
    try {
      optimizedData = await this.optimizeUseCase.execute(data);
    } catch (err) {
      console.error('[resume-service] optimizer rejected:', this.errorMessage(err));
      track('resume_generation_completed', { type: 'paid_tailored', success: false });
      throw err instanceof Error ? err : new Error(this.errorMessage(err));
    }

    console.info(`[resume-service] optimizeResume done total=${Math.round(performance.now() - t0)}ms`);
    track('resume_generation_completed', { type: 'paid_tailored', success: true });
    return optimizedData;
  }

  /**
   * Generate the combined toolkit bundle (cover letter + outreach email +
   * LinkedIn note + interview questions) for a generation. Runs as its own
   * /api/toolkit request — free (the optimizer's credit covers the whole
   * generation), so callers may fire it in parallel with optimizeResume.
   *
   * NEVER throws: a hard failure (network, provider down) is recorded under
   * every toolkit slot so the UI renders four retryable failure cards, same
   * contract as the per-artifact validation errors.
   */
  async generateToolkitBundle(
    data: ResumeData,
  ): Promise<{ coverLetter?: string; toolkit: JobToolkit }> {
    const t0 = performance.now();
    const toolkit: JobToolkit = {};
    let coverLetter: string | undefined;

    try {
      // Same pre-flight gate as optimizeResume — callers fire both in
      // parallel, and gibberish must not burn a toolkit AI call either. The
      // failure lands in the errors map (this method never throws); the
      // parallel optimizeResume call throws the user-facing
      // GibberishContentError, so the builder never shows these cards.
      this.assertContentIsReal(data);

      const value = await this.toolkitUseCase.execute(data);
      if (!value) throw new Error('Generator returned no data');
      // Per-artifact partial result: each slot is independently populated or
      // missing, and `errors` carries the per-item reason for any failures.
      coverLetter = value.coverLetter;
      toolkit.outreachEmail = value.outreachEmail;
      toolkit.linkedInMessage = value.linkedInMessage;
      toolkit.interviewQuestions = value.interviewQuestions;
      if (Object.keys(value.errors).length > 0) {
        toolkit.errors = { ...value.errors };
        console.warn(`[resume-service] toolkit partial — errors=${JSON.stringify(value.errors)}`);
      } else {
        console.info('[resume-service] toolkit full — all 4 slots populated');
      }
    } catch (err) {
      const friendlyMessage = this.errorMessage(err);
      console.error('[resume-service] toolkit hard-failed:', friendlyMessage);
      toolkit.errors = {
        coverLetter: friendlyMessage,
        outreachEmail: friendlyMessage,
        linkedInMessage: friendlyMessage,
        interviewQuestions: friendlyMessage,
      };
    }

    console.info(`[resume-service] generateToolkitBundle done total=${Math.round(performance.now() - t0)}ms`);
    return { coverLetter, toolkit };
  }

  /**
   * Regenerate a single toolkit item for an already-optimized resume. Returns
   * an updated ResumeData with the new value on success, or with an error
   * message recorded on failure. When a resumeId is supplied, the change is
   * also persisted via the repository so subsequent reloads see it.
   *
   * Never throws for AI failures — the failure is captured on `toolkit.errors`
   * so the UI can render the "failed" state. Throws only for persistence
   * failures, which callers may surface as a toast.
   */
  async regenerateToolkitItem(
    userId: string | null,
    resumeId: string | null,
    data: ResumeData,
    item: ToolkitItem,
  ): Promise<ResumeData> {
    const t0 = performance.now();
    console.info(`[resume-service] regenerateToolkitItem start item=${item} resumeId=${resumeId ?? '(unsaved)'}`);
    const nextToolkit: JobToolkit = { ...(data.toolkit ?? {}) };
    const nextErrors: ToolkitErrors = { ...(nextToolkit.errors ?? {}) };
    const next: ResumeData = { ...data, toolkit: nextToolkit };

    try {
      if (item === 'coverLetter') {
        const v = await this.withRetry(() => this.coverLetterUseCase.execute(data));
        if (!v) throw new Error('Generator returned an empty cover letter');
        next.coverLetter = v;
      } else if (item === 'outreachEmail') {
        const v = await this.withRetry(() => this.outreachEmailUseCase.execute(data));
        if (!v?.subject || !v?.body) throw new Error('Generator returned an empty outreach email');
        nextToolkit.outreachEmail = v;
      } else if (item === 'linkedInMessage') {
        const v = await this.withRetry(() => this.linkedInMessageUseCase.execute(data));
        if (!v) throw new Error('Generator returned an empty LinkedIn note');
        nextToolkit.linkedInMessage = v;
      } else if (item === 'interviewQuestions') {
        const v = await this.withRetry(() => this.interviewQuestionsUseCase.execute(data));
        if (!v?.length) throw new Error('Generator returned no interview questions');
        nextToolkit.interviewQuestions = v;
      }
      delete nextErrors[item];
      console.info(`[resume-service] regenerateToolkitItem ok item=${item} took=${Math.round(performance.now() - t0)}ms`);
    } catch (err) {
      nextErrors[item] = this.errorMessage(err);
      console.error(`[resume-service] regenerateToolkitItem failed item=${item} took=${Math.round(performance.now() - t0)}ms:`, this.errorMessage(err));
    }

    nextToolkit.errors = Object.keys(nextErrors).length > 0 ? nextErrors : undefined;

    if (userId && resumeId) {
      try {
        const title = next.targetJob?.title
          ? `${next.targetJob.title} Resume`
          : `Resume - ${new Date().toLocaleDateString()}`;
        await this.repository.updateGeneratedResume(resumeId, next, title);
      } catch (persistErr) {
        console.error('Persisting regenerated toolkit item failed:', persistErr);
        throw persistErr instanceof Error
          ? persistErr
          : new Error('Failed to save the regenerated item');
      }
    }

    return next;
  }

  /**
   * Failures a second attempt cannot fix. Retrying these is not merely useless —
   * for a per-item regenerate each attempt is its own HTTP request that writes
   * its own ai_call_log row, so one Retry click spent TWO of the user's 8 daily
   * toolkit_item slots. On a 429 that meant the app answered "you're over the
   * daily limit" by immediately consuming another slot from that same limit.
   *
   * Duck-typed on `status`/`code` rather than importing ApiCallError: this is the
   * application layer and must not depend on infrastructure (see the Clean
   * Architecture rule in CLAUDE.md). The proxy sets both fields.
   */
  private static isPermanent(err: unknown): boolean {
    const e = err as { status?: number; code?: string; name?: string };
    // 401 unauthenticated, 402 out of credits, 403 forbidden, 404 no such route,
    // 429 over cap, 503 provider not configured. None improves in 1.2s.
    if (typeof e?.status === 'number' && [401, 402, 403, 404, 429, 503].includes(e.status)) return true;
    if (e?.code === 'insufficient_credits' || e?.code === 'rate_limited') return true;
    // Client-side content gates already told the user what to fix.
    return e?.name === 'GibberishContentError';
  }

  // Retry transient failures (provider throttling, timeouts, network blips). One
  // extra attempt with a short backoff is enough in practice — persistent errors
  // surface via `toolkit.errors` for the user to retry from the Preview.
  private async withRetry<T>(fn: () => Promise<T>, attempts = 1, delayMs = 1200): Promise<T> {
    let lastErr: unknown;
    for (let i = 0; i <= attempts; i++) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        if (ResumeService.isPermanent(err)) throw err;
        if (i < attempts) {
          await new Promise((r) => setTimeout(r, delayMs * Math.pow(2, i)));
        }
      }
    }
    throw lastErr;
  }

  // Build the field list for the gibberish gate. Pulls out the long
  // free-form fields where users brain-dump (and where keyboard mashing
  // would burn the most tokens). Friendly labels are used so the surfaced
  // error message reads naturally in the UI.
  private assertContentIsReal(data: ResumeData): void {
    const checks: FieldCheck[] = [
      { field: 'Job title', text: data.targetJob?.title },
      { field: 'Job description', text: data.targetJob?.description },
      { field: 'Summary', text: data.summary },
    ];
    (data.experience || []).forEach((exp, i) => {
      const label = exp.role || exp.company || `Experience ${i + 1}`;
      checks.push({ field: `${label} — what you did`, text: exp.rawDescription });
    });
    (data.projects || []).forEach((proj, i) => {
      const label = proj.name || `Project ${i + 1}`;
      checks.push({ field: `${label} — description`, text: proj.rawDescription });
    });
    (data.extracurriculars || []).forEach((extra, i) => {
      const label = extra.title || extra.organization || `Activity ${i + 1}`;
      checks.push({ field: `${label} — description`, text: extra.description });
    });
    assertNotGibberish(checks);
  }

  private errorMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    if (typeof err === 'string') return err;
    try {
      return JSON.stringify(err);
    } catch {
      return 'Unknown error';
    }
  }

  async exportToWord(data: ResumeData): Promise<void> {
    return await this.exportUseCase.executeWordExport(data);
  }

  async exportToPDF(data: ResumeData): Promise<void> {
    return await this.exportUseCase.executePDFExport(data);
  }

  async exportCoverLetterToWord(data: ResumeData): Promise<void> {
    if (!data.coverLetter) {
      throw new Error('Cover letter not available');
    }
    const exporter = this.exportUseCase['resumeExporter'] as IResumeExporter;
    if (exporter.exportCoverLetterToWord) {
      return await exporter.exportCoverLetterToWord(data);
    }
    throw new Error('Cover letter export not supported');
  }

  async exportCoverLetterToPDF(data: ResumeData): Promise<void> {
    if (!data.coverLetter) {
      throw new Error('Cover letter not available');
    }
    const exporter = this.exportUseCase['resumeExporter'] as IResumeExporter;
    if (exporter.exportCoverLetterToPDF) {
      return await exporter.exportCoverLetterToPDF(data);
    }
    throw new Error('Cover letter PDF export not supported');
  }

  mergeOptimizedData(
    originalData: ResumeData,
    optimizedData: OptimizedResumeData
  ): ResumeData {
    return {
      ...originalData,
      summary: optimizedData.summary || originalData.summary,
      skills: optimizedData.skills || originalData.skills,
      skillCategories: optimizedData.skillCategories ?? originalData.skillCategories,
      coverLetter: optimizedData.coverLetter || originalData.coverLetter,
      toolkit: optimizedData.toolkit || originalData.toolkit,
      experience: originalData.experience.length > 0
        ? originalData.experience.map(exp => {
          const refinedExp = optimizedData.experience?.find(e => e.id === exp.id);
          return refinedExp
            ? { ...exp, refinedBullets: refinedExp.refinedBullets }
            : exp;
        })
        : [], // Return empty array if no experience (for students)
      // Projects follow the optimizer's order — reorderProjectsByJDFit may
      // have moved the most JD-relevant project to the top. Fall back to the
      // candidate's input order if the optimizer omitted any.
      projects: originalData.projects.length > 0
        ? reorderProjectsByOptimizer(originalData.projects, optimizedData.projects)
        : [],
      extracurriculars: originalData.extracurriculars && originalData.extracurriculars.length > 0
        ? originalData.extracurriculars.map(extra => {
          const refined = optimizedData.extracurriculars?.find(e => e.id === extra.id);
          return refined ? { ...extra, refinedBullets: refined.refinedBullets } : extra;
        })
        : [],
    };
  }

  // Resolve professional bullets for one profile item WITHOUT ever surfacing
  // the user's raw text. Prefers the item's stored AI-normalized bullets; when
  // those are missing (seeded/legacy data, or a polish that never landed) it
  // runs the per-item normalizer on the raw text so the AI extracts and cleans
  // it (Banglish included), and persists the result so the profile carries the
  // polished version from then on. If the AI is unavailable or fails, it
  // returns no bullets rather than leaking raw text — raw input must NEVER
  // appear in a résumé.
  private async polishedBulletsFor(
    raw: string,
    existing: NormalizedItemContent | undefined,
    context: ProfileItemContext,
    persist: (normalized: NormalizedItemContent, sourceHash: string) => Promise<void>,
  ): Promise<string[]> {
    const have = existing?.bullets;
    if (have && have.length > 0) return have;

    const text = (raw ?? '').trim();
    if (!text || !this.normalizeItemUseCase) return [];

    // Provider failures here are usually transient (the same fast-fail the
    // optimizer's own retry recovers from), so retry a few times before giving
    // up. We NEVER fall back to the raw text — empty bullets beat unpolished,
    // possibly non-English input in a résumé.
    const MAX_ATTEMPTS = 3;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const normalized = await this.normalizeItemUseCase.execute(text, context);
        const bullets = normalized.bullets ?? [];
        if (bullets.length > 0) {
          // Best-effort backfill — don't let a persistence hiccup block the résumé.
          persist(normalized, contentHash(text)).catch(err =>
            console.warn('[general-resume] failed to persist on-demand normalization:', err));
        }
        return bullets;
      } catch (err) {
        if (attempt === MAX_ATTEMPTS) {
          console.warn(`[general-resume] normalize failed after ${MAX_ATTEMPTS} attempts — omitting raw text for this item:`, err);
          return [];
        }
        await new Promise(resolve => setTimeout(resolve, 500 * attempt));
      }
    }
    return [];
  }

  // Build a general résumé WITHOUT the full optimizer, from each item's polished
  // bullets — using stored normalization where present and normalizing raw text
  // on demand (per-item, far more robust than the all-at-once optimizer) where
  // it isn't. The reliability backstop for the general resume; still AI-clean.
  private async assembleGeneralFallback(data: ResumeData, prevSummary = ''): Promise<ResumeData> {
    const repo = this.profileRepository;
    const [experience, projects, extracurriculars] = await Promise.all([
      Promise.all(data.experience.map(async e => ({
        ...e,
        refinedBullets: await this.polishedBulletsFor(
          e.rawDescription ?? '', e.normalized,
          { kind: 'experience', title: e.role, organization: e.company, guided: e.inputMode === 'guided' },
          (n, h) => repo?.saveExperienceNormalized(e.id, n, h) ?? Promise.resolve(),
        ),
      }))),
      Promise.all(data.projects.map(async p => ({
        ...p,
        refinedBullets: await this.polishedBulletsFor(
          p.rawDescription ?? '', p.normalized,
          { kind: 'project', title: p.name, technologies: p.technologies, guided: p.inputMode === 'guided' },
          (n, h) => repo?.saveProjectNormalized(p.id, n, h) ?? Promise.resolve(),
        ),
      }))),
      Promise.all((data.extracurriculars ?? []).map(async x => ({
        ...x,
        refinedBullets: await this.polishedBulletsFor(
          x.description ?? '', x.normalized,
          { kind: 'extracurricular', title: x.title, organization: x.organization, guided: x.inputMode === 'guided' },
          (n, h) => repo?.saveExtracurricularNormalized(x.id, n, h) ?? Promise.resolve(),
        ),
      }))),
    ]);

    return {
      ...data,
      summary: prevSummary || data.summary || '',
      experience,
      projects,
      extracurriculars,
    };
  }

  // Try the AI optimizer for the general résumé; if it fails (e.g. strict
  // structured-output validation rejects a large, JD-less profile), fall back
  // to the per-item polished assembly so generation NEVER hard-fails and NEVER
  // shows raw text.
  private async optimizeOrAssembleGeneral(data: ResumeData, prevSummary = ''): Promise<ResumeData> {
    try {
      const optimized = await this.generalOptimizeUseCase.execute(data);
      return this.mergeOptimizedData(data, optimized);
    } catch (err) {
      console.warn('[general-resume] optimizer failed — assembling from per-item polished content:', err);
      track('general_resume_fallback_used');
      return this.assembleGeneralFallback(data, prevSummary);
    }
  }

  private profileHashOf(d: ResumeData): string {
    return computeProfileHash({
      personalInfo: d.personalInfo,
      experiences: d.experience,
      projects: d.projects,
      educations: d.education,
      skills: d.skills,
      extracurriculars: d.extracurriculars,
      awards: d.awards,
      certifications: d.certifications,
      affiliations: d.affiliations,
      publications: d.publications,
      languages: d.languages,
      references: d.references,
    });
  }

  // ================================
  // General Resume Generation
  // ================================

  static readonly GENERAL_RESUME_TITLE = 'General Resume';

  async hasGeneralResume(userId: string): Promise<boolean> {
    const resumes = await this.repository.getGeneratedResumes(userId);
    return resumes.some(r => r.title === ResumeService.GENERAL_RESUME_TITLE);
  }

  /**
   * Returns info about the general resume including cooldown status.
   * Returns null if no general resume exists.
   */
  // Returns the id of the user's General Resume (or null if none). There is no
  // regeneration cooldown: regeneration is gated by an actual profile change
  // (surfaced as the ProfileScreen nudge) and bounded by the free-tier daily cap
  // on /api/optimize-general (KIND_DAILY_CAPS.optimize_general) for cost control.
  async getGeneralResumeInfo(userId: string): Promise<{ id: string } | null> {
    const resumes = await this.repository.getGeneratedResumes(userId);
    const generalResume = resumes.find(r => r.title === ResumeService.GENERAL_RESUME_TITLE);
    if (!generalResume) return null;
    return { id: generalResume.id };
  }

  async generateGeneralResume(userId: string): Promise<string> {
    if (!this.profileRepository) {
      throw new Error('Profile repository is required for general resume generation');
    }

    // Check if general resume already exists
    const exists = await this.hasGeneralResume(userId);
    if (exists) {
      throw new Error('A General Resume already exists. You can only generate one.');
    }

    // Load all profile data
    const [profile, uType, exps, projs, skls, edus, extras, awds, certs, affs, pubs, langs, refs] = await Promise.all([
      this.profileRepository.getProfile(userId),
      this.profileRepository.getUserType(userId),
      this.profileRepository.getExperiences(userId),
      this.profileRepository.getProjects(userId),
      this.profileRepository.getSkills(userId),
      this.profileRepository.getEducations(userId),
      this.profileRepository.getExtracurriculars(userId),
      this.profileRepository.getAwards(userId),
      this.profileRepository.getCertifications(userId),
      this.profileRepository.getAffiliations(userId),
      this.profileRepository.getPublications(userId),
      this.profileRepository.getLanguages(userId),
      this.profileRepository.getReferences(userId),
    ]);

    // Determine visible sections based on user type and available data
    // userType is derived from the data, not the (removed) selector.
    const uTypeInferred = inferUserType(exps);
    const visibleSections: string[] = ['skills', 'education', 'projects'];
    if (uTypeInferred === 'experienced') visibleSections.push('experience');
    if (uTypeInferred === 'student') visibleSections.push('extracurriculars');
    if (extras.length > 0 && !visibleSections.includes('extracurriculars')) visibleSections.push('extracurriculars');
    if (awds.length > 0) visibleSections.push('awards');
    if (certs.length > 0) visibleSections.push('certifications');
    if (affs.length > 0) visibleSections.push('affiliations');
    if (pubs.length > 0) visibleSections.push('publications');
    if (langs.length > 0) visibleSections.push('languages');
    if (refs.length > 0) visibleSections.push('references');

    // Assemble ResumeData with a generic target job
    const resumeData: ResumeData = {
      userType: uTypeInferred,
      targetJob: {
        title: 'General Purpose', // header appends " Resume - <year>"; avoid "Resume Resume"
        company: '',
        description: 'Create a strong, general-purpose professional resume that highlights the candidate\'s key strengths, experiences, and skills. Focus on versatility and broad appeal to multiple industries and roles. Emphasize transferable skills, measurable achievements, and professional growth.',
      },
      personalInfo: profile || { fullName: '', email: '', phone: '', location: '' },
      summary: '',
      experience: exps,
      projects: projs,
      skills: skls,
      education: edus,
      extracurriculars: extras,
      awards: awds,
      certifications: certs,
      affiliations: affs,
      publications: pubs,
      languages: langs,
      references: refs,
      visibleSections: Array.from(new Set(visibleSections)),
      template: 'ats-classic',
    };

    // Pre-flight gibberish gate — same one the paid path uses. Profile data
    // can still contain keyboard-mashing in long-form fields (experience /
    // project / activity descriptions) and we shouldn't spend AI tokens on it.
    this.assertContentIsReal(resumeData);

    track('resume_generation_started', { type: 'free_general' });

    // Optimize via the free general-resume path; fall back to profile-based
    // assembly if the optimizer fails, so this never hard-fails.
    const mergedData = await this.optimizeOrAssembleGeneral(resumeData);
    mergedData.sourceProfileHash = this.profileHashOf(resumeData);

    // Save and return ID
    const id = await this.saveGeneratedResume(userId, mergedData, ResumeService.GENERAL_RESUME_TITLE);
    track('resume_generation_completed', { type: 'free_general', success: true });
    return id;
  }

  /**
   * Regenerate the General Resume from updated profile data. No cooldown — it's
   * offered only when the profile actually changed, and the free-tier daily cap
   * on /api/optimize-general is the cost backstop.
   */
  async regenerateGeneralResume(userId: string, existingResumeId: string): Promise<ResumeData> {
    if (!this.profileRepository) {
      throw new Error('Profile repository is required for general resume regeneration');
    }

    // No cooldown: regeneration is gated by an actual profile change and bounded
    // by the free-tier daily cap on /api/optimize-general for cost control.

    // Load fresh profile data
    const [profile, uType, exps, projs, skls, edus, extras, awds, certs, affs, pubs, langs, refs] = await Promise.all([
      this.profileRepository.getProfile(userId),
      this.profileRepository.getUserType(userId),
      this.profileRepository.getExperiences(userId),
      this.profileRepository.getProjects(userId),
      this.profileRepository.getSkills(userId),
      this.profileRepository.getEducations(userId),
      this.profileRepository.getExtracurriculars(userId),
      this.profileRepository.getAwards(userId),
      this.profileRepository.getCertifications(userId),
      this.profileRepository.getAffiliations(userId),
      this.profileRepository.getPublications(userId),
      this.profileRepository.getLanguages(userId),
      this.profileRepository.getReferences(userId),
    ]);

    // Determine visible sections. userType is derived from the data.
    const uTypeInferred = inferUserType(exps);
    const visibleSections: string[] = ['skills', 'education', 'projects'];
    if (uTypeInferred === 'experienced') visibleSections.push('experience');
    if (uTypeInferred === 'student') visibleSections.push('extracurriculars');
    if (extras.length > 0 && !visibleSections.includes('extracurriculars')) visibleSections.push('extracurriculars');
    if (awds.length > 0) visibleSections.push('awards');
    if (certs.length > 0) visibleSections.push('certifications');
    if (affs.length > 0) visibleSections.push('affiliations');
    if (pubs.length > 0) visibleSections.push('publications');
    if (langs.length > 0) visibleSections.push('languages');
    if (refs.length > 0) visibleSections.push('references');

    // Assemble fresh ResumeData
    const resumeData: ResumeData = {
      userType: uTypeInferred,
      targetJob: {
        title: 'General Purpose', // header appends " Resume - <year>"; avoid "Resume Resume"
        company: '',
        description: 'Create a strong, general-purpose professional resume that highlights the candidate\'s key strengths, experiences, and skills. Focus on versatility and broad appeal to multiple industries and roles. Emphasize transferable skills, measurable achievements, and professional growth.',
      },
      personalInfo: profile || { fullName: '', email: '', phone: '', location: '' },
      summary: '',
      experience: exps,
      projects: projs,
      skills: skls,
      education: edus,
      extracurriculars: extras,
      awards: awds,
      certifications: certs,
      affiliations: affs,
      publications: pubs,
      languages: langs,
      references: refs,
      visibleSections: Array.from(new Set(visibleSections)),
      template: 'ats-classic',
    };

    // Pre-flight gibberish gate — same as the initial general-resume path.
    this.assertContentIsReal(resumeData);

    // Optimize via the free general-resume path; fall back to profile-based
    // assembly if the optimizer fails, so regenerate never hard-fails.
    const mergedData = await this.optimizeOrAssembleGeneral(resumeData);
    mergedData.sourceProfileHash = this.profileHashOf(resumeData);

    // Update existing resume
    await this.updateGeneratedResume(existingResumeId, mergedData, ResumeService.GENERAL_RESUME_TITLE);
    return mergedData;
  }
}

// Reorder the candidate's projects to match the optimizer's output order
// (which has been JD-reordered by reorderProjectsByJDFit) while still
// reattaching refinedBullets to the original input project. Any project
// the optimizer omitted gets appended in original order so we don't lose
// data on a partial response.
function reorderProjectsByOptimizer<P extends { id: string }>(
  inputs: P[],
  optimized: { id: string; refinedBullets: string[] }[] | undefined
): (P & { refinedBullets: string[] })[] {
  if (!optimized || optimized.length === 0) {
    return inputs.map(p => ({ ...p, refinedBullets: (p as P & { refinedBullets?: string[] }).refinedBullets ?? [] }));
  }
  const inputById = new Map(inputs.map(p => [p.id, p]));
  const seen = new Set<string>();
  const ordered: (P & { refinedBullets: string[] })[] = [];

  for (const o of optimized) {
    const original = inputById.get(o.id);
    if (!original) continue;
    seen.add(o.id);
    ordered.push({ ...original, refinedBullets: o.refinedBullets });
  }
  for (const p of inputs) {
    if (seen.has(p.id)) continue;
    ordered.push({ ...p, refinedBullets: (p as P & { refinedBullets?: string[] }).refinedBullets ?? [] });
  }
  return ordered;
}

