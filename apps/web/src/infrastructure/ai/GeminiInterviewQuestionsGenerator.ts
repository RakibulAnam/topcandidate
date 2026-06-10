// Infrastructure - Gemini AI Interview Questions Generator

import { GoogleGenAI, Type } from '@google/genai';
import {
  ResumeData,
  InterviewQuestion,
  InterviewQuestionCategory,
} from '../../domain/entities/Resume.js';
import { IInterviewQuestionsGenerator } from '../../domain/usecases/GenerateInterviewQuestionsUseCase.js';
import {
  classifyFitMode,
} from './prompts/toolkitContext.js';
import {
  INTERVIEW_SYSTEM_INSTRUCTION,
  buildInterviewUserPrompt,
} from './prompts/toolkitPrompts.js';

const VALID_CATEGORIES: InterviewQuestionCategory[] = [
  'Behavioral',
  'Technical',
  'Role-specific',
  'Values & Culture',
  'Situational',
];

export class GeminiInterviewQuestionsGenerator implements IInterviewQuestionsGenerator {
  private genAI: GoogleGenAI;
  private readonly model = 'gemini-2.5-flash';

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error('Gemini API key is required');
    }
    this.genAI = new GoogleGenAI({ apiKey });
  }

  async generate(data: ResumeData): Promise<InterviewQuestion[]> {
    const fit = classifyFitMode(data);
    console.info(`[interview-gen] fit=${fit.mode} overlap=${fit.overlap.toFixed(2)} matched=${fit.matched}/${fit.jdVocabSize}`);
    const result = await this.genAI.models.generateContent({
      model: this.model,
      contents: buildInterviewUserPrompt(data, fit.mode),
      config: {
        temperature: fit.mode === 'stretch' ? 0.55 : 0.4,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            questions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  question: { type: Type.STRING },
                  category: { type: Type.STRING },
                  whyAsked: { type: Type.STRING },
                  answerStrategy: { type: Type.STRING },
                  // Bengali (Bangla) translations — see system instruction
                  // for register & terminology rules. Bilingual prep is the
                  // BD-market default; English is authoritative.
                  questionBn: { type: Type.STRING },
                  whyAskedBn: { type: Type.STRING },
                  answerStrategyBn: { type: Type.STRING },
                },
                required: ['question', 'category', 'whyAsked', 'answerStrategy', 'questionBn', 'whyAskedBn', 'answerStrategyBn'],
              },
            },
          },
          required: ['questions'],
        },
        systemInstruction: INTERVIEW_SYSTEM_INSTRUCTION,
      },
    });

    const text = result.text;
    if (!text) throw new Error('No response from AI');

    const parsed = JSON.parse(text) as { questions?: InterviewQuestion[] };
    if (!parsed.questions || !Array.isArray(parsed.questions) || parsed.questions.length === 0) {
      throw new Error('Interview questions response was empty');
    }

    const questions = parsed.questions.map((q) => {
      // Bengali fields tolerated as missing — UI falls back to English for
      // any slot that comes back empty. Schema requires them, but we don't
      // want a single missed translation to fail the whole retry.
      const questionBn = (q.questionBn ?? '').trim();
      const whyAskedBn = (q.whyAskedBn ?? '').trim();
      const answerStrategyBn = (q.answerStrategyBn ?? '').trim();
      return {
      question: (q.question ?? '').trim(),
      category: this.normalizeCategory(q.category),
      whyAsked: (q.whyAsked ?? '').trim(),
      answerStrategy: (q.answerStrategy ?? '').trim(),
      ...(questionBn ? { questionBn } : {}),
      ...(whyAskedBn ? { whyAskedBn } : {}),
      ...(answerStrategyBn ? { answerStrategyBn } : {}),
      };
    });

    // NO fabrication / anchor-coverage hard-fail on interview prep — questions
    // are meant to probe the JD (incl. tech the candidate hasn't used) so they
    // can rehearse. The prompt steers quality + honest answer coaching. (Kept in
    // sync with OpenRouterInterviewQuestionsGenerator.)
    return questions;
  }

  private normalizeCategory(raw: unknown): InterviewQuestionCategory {
    const value = String(raw ?? '').trim();
    const match = VALID_CATEGORIES.find(
      (c) => c.toLowerCase() === value.toLowerCase(),
    );
    return match ?? 'Role-specific';
  }

}
