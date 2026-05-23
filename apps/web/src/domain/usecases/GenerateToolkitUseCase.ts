// Domain Use Case — Combined Application Toolkit Generation
//
// Produces the cover letter, outreach email, LinkedIn note, and interview
// questions in ONE AI call instead of four parallel ones, so the initial
// generation stays well inside Gemini's free-tier RPM budget.

import { ResumeData, GeneratedToolkit } from '../entities/Resume.js';

export interface IToolkitGenerator {
  generate(data: ResumeData): Promise<GeneratedToolkit>;
}

export class GenerateToolkitUseCase {
  constructor(private generator: IToolkitGenerator) {}

  async execute(data: ResumeData): Promise<GeneratedToolkit> {
    if (!data.targetJob.description.trim()) {
      throw new Error('Job description is required for toolkit generation');
    }
    if (!data.personalInfo.fullName.trim()) {
      throw new Error('Candidate name is required for toolkit generation');
    }
    return await this.generator.generate(data);
  }
}
