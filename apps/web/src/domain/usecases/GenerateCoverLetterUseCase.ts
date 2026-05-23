// Domain Use Case - Cover Letter Generation

import { ResumeData } from '../entities/Resume.js';

export interface ICoverLetterGenerator {
  generate(data: ResumeData): Promise<string>;
}

export class GenerateCoverLetterUseCase {
  constructor(private coverLetterGenerator: ICoverLetterGenerator) {}

  async execute(data: ResumeData): Promise<string> {
    if (!data.targetJob.description.trim()) {
      throw new Error('Job description is required for cover letter generation');
    }

    if (!data.personalInfo.fullName.trim()) {
      throw new Error('Personal information is required for cover letter generation');
    }

    return await this.coverLetterGenerator.generate(data);
  }
}

