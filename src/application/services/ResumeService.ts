// Application Service - Orchestrates use cases

import { ResumeData, OptimizedResumeData, JobToolkit, ToolkitItem, ToolkitErrors } from '../../domain/entities/Resume';
import { OptimizeResumeUseCase, IResumeOptimizer } from '../../domain/usecases/OptimizeResumeUseCase';
import { ExportResumeUseCase, IResumeExporter } from '../../domain/usecases/ExportResumeUseCase';
import { GenerateCoverLetterUseCase, ICoverLetterGenerator } from '../../domain/usecases/GenerateCoverLetterUseCase';
import { GenerateOutreachEmailUseCase, IOutreachEmailGenerator } from '../../domain/usecases/GenerateOutreachEmailUseCase';
import { GenerateLinkedInMessageUseCase, ILinkedInMessageGenerator } from '../../domain/usecases/GenerateLinkedInMessageUseCase';
import { GenerateInterviewQuestionsUseCase, IInterviewQuestionsGenerator } from '../../domain/usecases/GenerateInterviewQuestionsUseCase';
import { GenerateToolkitUseCase, IToolkitGenerator } from '../../domain/usecases/GenerateToolkitUseCase';
import { IResumeRepository } from '../../domain/repositories/IResumeRepository';
import { IProfileRepository } from '../../domain/repositories/IProfileRepository';
import { assertNotGibberish, FieldCheck } from '../validation/gibberishDetector';

export class ResumeService {
  private optimizeUseCase: OptimizeResumeUseCase;
  private generalOptimizeUseCase: OptimizeResumeUseCase;
  private exportUseCase: ExportResumeUseCase;
  private coverLetterUseCase: GenerateCoverLetterUseCase;
  private outreachEmailUseCase: GenerateOutreachEmailUseCase;
  private linkedInMessageUseCase: GenerateLinkedInMessageUseCase;
  private interviewQuestionsUseCase: GenerateInterviewQuestionsUseCase;
  private toolkitUseCase: GenerateToolkitUseCase;

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
    generalResumeOptimizer?: IResumeOptimizer
  ) {
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

  async optimizeResume(data: ResumeData): Promise<OptimizedResumeData> {
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

    // Two concurrent Gemini calls instead of five — the optimizer refines the
    // resume itself while the combined toolkit generator produces cover
    // letter + outreach email + LinkedIn note + interview questions in one
    // shot. Keeping them independent means the user still gets a tailored
    // resume even if the toolkit call fails (and vice versa), and they share
    // the same raw input, so the toolkit doesn't need the refined bullets.
    //
    // Do NOT wrap the toolkit call in withRetry here: in the proxy build, both
    // halves are served by the same /api/optimize request (deduped via an
    // inflight cache keyed by the ResumeData reference). A retry triggers a
    // brand-new POST to /api/optimize, which the server treats as a fresh
    // generation and charges another toolkit credit — so a transient toolkit
    // failure would silently burn a second credit. Per-item retries go through
    // /api/toolkit-item, which is free; the warning-card retry buttons in the
    // Preview tabs are the supported recovery path.
    const [optimizeResult, toolkitResult] = await Promise.allSettled([
      this.optimizeUseCase.execute(data),
      this.toolkitUseCase.execute(data),
    ]);

    console.info(`[resume-service] AI settled in ${Math.round(performance.now() - t0)}ms optimizer=${optimizeResult.status} toolkit=${toolkitResult.status}`);

    // Optimizer is the core artifact — if it failed, the whole flow failed
    // and we surface the error to the caller the same way as before.
    if (optimizeResult.status === 'rejected') {
      console.error('[resume-service] optimizer rejected:', this.errorMessage(optimizeResult.reason));
      throw optimizeResult.reason instanceof Error
        ? optimizeResult.reason
        : new Error(this.errorMessage(optimizeResult.reason));
    }

    const optimizedData = optimizeResult.value;
    const toolkit: JobToolkit = {};
    let coverLetter: string | undefined;

    if (toolkitResult.status === 'fulfilled' && toolkitResult.value) {
      // Per-artifact partial result: each slot is independently populated or
      // missing, and `errors` carries the per-item reason for any failures.
      // Successful slots flow through verbatim; failed slots stay undefined
      // and surface as "failed" cards with retry buttons in Preview.
      const value = toolkitResult.value;
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
    } else {
      // Hard failure (network / no API key / call rejected before the
      // per-artifact validation runs). Record the same reason under every
      // toolkit slot so the UI shows four retryable failure cards.
      const reason =
        toolkitResult.status === 'rejected' ? toolkitResult.reason : 'Generator returned no data';
      const friendlyMessage = this.errorMessage(reason);
      console.error('[resume-service] toolkit hard-failed:', friendlyMessage);
      toolkit.errors = {
        coverLetter: friendlyMessage,
        outreachEmail: friendlyMessage,
        linkedInMessage: friendlyMessage,
        interviewQuestions: friendlyMessage,
      };
    }

    console.info(`[resume-service] optimizeResume done total=${Math.round(performance.now() - t0)}ms`);

    return {
      ...optimizedData,
      coverLetter,
      // Always return a toolkit object once generation has been attempted, so
      // failures are visible in the UI rather than silently collapsing into
      // "nothing generated".
      toolkit,
    };
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

  // Retry transient failures (rate limits, timeouts, network blips). One extra
  // attempt with a short backoff is enough in practice — persistent errors
  // surface via `toolkit.errors` for the user to retry from the Preview.
  private async withRetry<T>(fn: () => Promise<T>, attempts = 1, delayMs = 1200): Promise<T> {
    let lastErr: unknown;
    for (let i = 0; i <= attempts; i++) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
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
  async getGeneralResumeInfo(userId: string): Promise<{ id: string; canRegenerate: boolean; cooldownEndsAt: Date | null } | null> {
    const resumes = await this.repository.getGeneratedResumes(userId);
    const generalResume = resumes.find(r => r.title === ResumeService.GENERAL_RESUME_TITLE);
    if (!generalResume) return null;

    const lastUpdated = new Date(generalResume.updatedAt || generalResume.date);
    const cooldownEnd = new Date(lastUpdated.getTime() + 24 * 60 * 60 * 1000);
    const now = new Date();
    const canRegenerate = now >= cooldownEnd;

    return {
      id: generalResume.id,
      canRegenerate,
      cooldownEndsAt: canRegenerate ? null : cooldownEnd,
    };
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
    const visibleSections: string[] = ['skills', 'education', 'projects'];
    if (uType === 'experienced') visibleSections.push('experience');
    if (uType === 'student') visibleSections.push('extracurriculars');
    if (extras.length > 0 && !visibleSections.includes('extracurriculars')) visibleSections.push('extracurriculars');
    if (awds.length > 0) visibleSections.push('awards');
    if (certs.length > 0) visibleSections.push('certifications');
    if (affs.length > 0) visibleSections.push('affiliations');
    if (pubs.length > 0) visibleSections.push('publications');
    if (langs.length > 0) visibleSections.push('languages');
    if (refs.length > 0) visibleSections.push('references');

    // Assemble ResumeData with a generic target job
    const resumeData: ResumeData = {
      userType: uType || undefined,
      targetJob: {
        title: 'General Purpose Resume',
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

    // Optimize via the free general-resume path (no credit gate, no toolkit).
    const optimizedData = await this.generalOptimizeUseCase.execute(resumeData);
    const mergedData = this.mergeOptimizedData(resumeData, optimizedData);

    // Save and return ID
    const id = await this.saveGeneratedResume(userId, mergedData, ResumeService.GENERAL_RESUME_TITLE);
    return id;
  }

  /**
   * Regenerate the General Resume from updated profile data.
   * Enforces a 24-hour cooldown between regenerations.
   */
  async regenerateGeneralResume(userId: string, existingResumeId: string): Promise<ResumeData> {
    if (!this.profileRepository) {
      throw new Error('Profile repository is required for general resume regeneration');
    }

    // Check cooldown
    const info = await this.getGeneralResumeInfo(userId);
    if (info && !info.canRegenerate && info.cooldownEndsAt) {
      const hoursLeft = Math.ceil((info.cooldownEndsAt.getTime() - Date.now()) / (1000 * 60 * 60));
      throw new Error(`General Resume can only be regenerated once every 24 hours. Try again in ~${hoursLeft} hour${hoursLeft !== 1 ? 's' : ''}.`);
    }

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

    // Determine visible sections
    const visibleSections: string[] = ['skills', 'education', 'projects'];
    if (uType === 'experienced') visibleSections.push('experience');
    if (uType === 'student') visibleSections.push('extracurriculars');
    if (extras.length > 0 && !visibleSections.includes('extracurriculars')) visibleSections.push('extracurriculars');
    if (awds.length > 0) visibleSections.push('awards');
    if (certs.length > 0) visibleSections.push('certifications');
    if (affs.length > 0) visibleSections.push('affiliations');
    if (pubs.length > 0) visibleSections.push('publications');
    if (langs.length > 0) visibleSections.push('languages');
    if (refs.length > 0) visibleSections.push('references');

    // Assemble fresh ResumeData
    const resumeData: ResumeData = {
      userType: uType || undefined,
      targetJob: {
        title: 'General Purpose Resume',
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

    // Optimize via the free general-resume path (no credit gate, no toolkit).
    const optimizedData = await this.generalOptimizeUseCase.execute(resumeData);
    const mergedData = this.mergeOptimizedData(resumeData, optimizedData);

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

