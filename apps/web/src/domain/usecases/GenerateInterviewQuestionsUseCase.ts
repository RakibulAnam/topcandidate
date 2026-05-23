// Domain Use Case - Interview Question Preparation

import { ResumeData, InterviewQuestion } from '../entities/Resume.js';

export interface IInterviewQuestionsGenerator {
  generate(data: ResumeData): Promise<InterviewQuestion[]>;
}

export class GenerateInterviewQuestionsUseCase {
  constructor(private generator: IInterviewQuestionsGenerator) {}

  async execute(data: ResumeData): Promise<InterviewQuestion[]> {
    if (!data.targetJob.description.trim()) {
      throw new Error('Job description is required for interview question generation');
    }
    return await this.generator.generate(data);
  }
}
