// Domain Use Case - LinkedIn Connection Note

import { ResumeData } from '../entities/Resume.js';

export interface ILinkedInMessageGenerator {
  generate(data: ResumeData): Promise<string>;
}

export class GenerateLinkedInMessageUseCase {
  constructor(private generator: ILinkedInMessageGenerator) {}

  async execute(data: ResumeData): Promise<string> {
    if (!data.targetJob.description.trim()) {
      throw new Error('Job description is required for LinkedIn message generation');
    }
    if (!data.personalInfo.fullName.trim()) {
      throw new Error('Candidate name is required for LinkedIn message generation');
    }
    return await this.generator.generate(data);
  }
}
