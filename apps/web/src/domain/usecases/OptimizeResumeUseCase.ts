// Domain Use Case - Resume Optimization

import { ResumeData, OptimizedResumeData } from '../entities/Resume.js';

export interface IResumeOptimizer {
  optimize(data: ResumeData): Promise<OptimizedResumeData>;
}

export class OptimizeResumeUseCase {
  constructor(private resumeOptimizer: IResumeOptimizer) {}

  async execute(data: ResumeData): Promise<OptimizedResumeData> {
    if (!data.targetJob.description.trim()) {
      throw new Error('Job description is required for optimization');
    }

    // A resume can only be built when the profile has real content to work
    // from: at least one EDUCATION or one EXPERIENCE entry. userType is no
    // longer user-selected (it's inferred upstream), so we no longer gate on
    // it — and skills alone are no longer enough, since the optimizer derives
    // skills from experience/project descriptions anyway.
    const hasExperience = data.experience.length > 0;
    const hasEducation = data.education.length > 0;

    if (!hasExperience && !hasEducation) {
      throw new Error('Add at least one education or work experience entry to generate a resume.');
    }

    return await this.resumeOptimizer.optimize(data);
  }
}

