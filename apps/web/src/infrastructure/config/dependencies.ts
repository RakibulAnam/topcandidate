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
  ProxyProfileNormalizer,
} from '../ai/proxy/ProxyClients';
import { CompositeResumeExporter } from '../export/CompositeResumeExporter';
import { ResumeService } from '../../application/services/ResumeService';
import { SupabaseResumeRepository } from '../repositories/SupabaseResumeRepository';
import { SupabaseProfileRepository } from '../repositories/SupabaseProfileRepository';
import { SupabaseApplicationRepository } from '../repositories/SupabaseApplicationRepository';
import { SupabasePurchaseRepository } from '../repositories/SupabasePurchaseRepository';

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

// Profile-item normalizer ("polished profile") — fired in the background on
// profile save by the profile sections; not part of ResumeService's
// generation flow.
export const profileNormalizer = new ProxyProfileNormalizer();

// Supabase Repositories
export const profileRepository = new SupabaseProfileRepository();
export const applicationRepository = new SupabaseApplicationRepository();
export const purchaseRepository = new SupabasePurchaseRepository();

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
