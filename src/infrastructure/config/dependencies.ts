// Dependency injection container — CLIENT side.
//
// All AI work is now proxied through Vercel Functions in /api/*. Client
// holds NO provider keys. The proxy classes implement the same interfaces
// the rest of the app already consumes; ResumeService is unchanged.

import {
  ProxyResumeOptimizer,
  ProxyGeneralResumeOptimizer,
  ProxyToolkitGenerator,
  ProxyCoverLetterGenerator,
  ProxyOutreachEmailGenerator,
  ProxyLinkedInMessageGenerator,
  ProxyInterviewQuestionsGenerator,
  ProxyResumeExtractor,
} from '../ai/proxy/ProxyClients';
import { CompositeResumeExporter } from '../export/CompositeResumeExporter';
import { ResumeService } from '../../application/services/ResumeService';
import { SupabaseResumeRepository } from '../repositories/SupabaseResumeRepository';
import { SupabaseProfileRepository } from '../repositories/SupabaseProfileRepository';
import { SupabaseApplicationRepository } from '../repositories/SupabaseApplicationRepository';

const resumeOptimizer = new ProxyResumeOptimizer();
const generalResumeOptimizer = new ProxyGeneralResumeOptimizer();
const toolkitGenerator = new ProxyToolkitGenerator();
const coverLetterGenerator = new ProxyCoverLetterGenerator();
const outreachEmailGenerator = new ProxyOutreachEmailGenerator();
const linkedInMessageGenerator = new ProxyLinkedInMessageGenerator();
const interviewQuestionsGenerator = new ProxyInterviewQuestionsGenerator();
const resumeExporter = new CompositeResumeExporter();
const resumeRepository = new SupabaseResumeRepository();

export const resumeExtractor = new ProxyResumeExtractor();

// Supabase Repositories
export const profileRepository = new SupabaseProfileRepository();
export const applicationRepository = new SupabaseApplicationRepository();

export const createResumeService = () => {
  return new ResumeService(
    resumeOptimizer,
    resumeExporter,
    coverLetterGenerator,
    outreachEmailGenerator,
    linkedInMessageGenerator,
    interviewQuestionsGenerator,
    toolkitGenerator,
    resumeRepository,
    profileRepository,
    generalResumeOptimizer
  );
};
