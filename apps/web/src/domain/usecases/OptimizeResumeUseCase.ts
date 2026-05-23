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

    if (!data.userType) {
      throw new Error('User type must be selected');
    }

    const hasExperience = data.experience.length > 0;
    const hasSkills = data.skills.length > 0;
    const hasEducation = data.education.length > 0;

    if (data.userType === 'experienced') {
      // Experienced users should have experience or skills
      if (!hasExperience && !hasSkills) {
        throw new Error('Please provide at least work experience or skills');
      }
    } else {
      // Students should have education or skills
      if (!hasEducation && !hasSkills) {
        throw new Error('Please provide at least education or skills');
      }
    }

    return await this.resumeOptimizer.optimize(data);
  }
}

