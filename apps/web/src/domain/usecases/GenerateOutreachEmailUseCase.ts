// Domain Use Case - Hiring Manager Outreach Email

import { ResumeData, OutreachEmail } from '../entities/Resume.js';

export interface IOutreachEmailGenerator {
  generate(data: ResumeData): Promise<OutreachEmail>;
}

export class GenerateOutreachEmailUseCase {
  constructor(private generator: IOutreachEmailGenerator) {}

  async execute(data: ResumeData): Promise<OutreachEmail> {
    if (!data.targetJob.description.trim()) {
      throw new Error('Job description is required for outreach email generation');
    }
    if (!data.personalInfo.fullName.trim()) {
      throw new Error('Candidate name is required for outreach email generation');
    }
    return await this.generator.generate(data);
  }
}
