// Domain Use Case - Interview Preparation Guide

import { ResumeData, InterviewQuestion, PrepTopic } from '../entities/Resume.js';

/**
 * The full Preparation Guide: questions the interviewer will likely ask, plus
 * topics to study drawn from the JD gap.
 *
 * The two travel together because they answer the same user need from opposite
 * sides — "what will they ask me" and "what do I not yet know". Returning them as
 * one value is also what keeps a per-item regenerate from refreshing the
 * questions while leaving stale study topics beside them.
 */
export interface InterviewPrep {
  questions: InterviewQuestion[];
  prepTopics: PrepTopic[];
}

export interface IInterviewQuestionsGenerator {
  generate(data: ResumeData): Promise<InterviewPrep>;
}

export class GenerateInterviewQuestionsUseCase {
  constructor(private generator: IInterviewQuestionsGenerator) {}

  async execute(data: ResumeData): Promise<InterviewPrep> {
    if (!data.targetJob.description.trim()) {
      throw new Error('Job description is required for interview question generation');
    }
    return await this.generator.generate(data);
  }
}
