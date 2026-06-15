// Domain Entities - Core business objects

export type UserType = 'experienced' | 'student';

export interface PersonalInfo {
  fullName: string;
  email: string;
  phone: string;
  location: string;
  linkedin?: string;
  github?: string;
  website?: string;
}

// AI-normalized rendering of one profile item's raw description ("polished
// profile"). Computed once on profile save (cheap flash-lite call), stored
// beside the raw text — NEVER replacing it — and reused by every subsequent
// generation as pre-cleaned evidence. `gaps` are coaching hints shown to the
// user (e.g. "No measurable outcome — add team size or % improvement").
export interface NormalizedItemContent {
  bullets: string[];
  skills: string[];
  gaps: string[];
}

// Guided Mode: how a description-bearing item was filled in.
//   'free'   — single brain-dump box (the original experience).
//   'guided' — a short questionnaire; answers stored in `guided` and
//              deterministically assembled into the item's description text,
//              which the AI then refines exactly as a free brain dump.
export type InputMode = 'free' | 'guided';

// Structured guided answers, keyed by stable question id (see
// presentation/components/profile/guidedQuestions.ts). Only answered keys are
// present. Stored verbatim (any language) as the user's original input.
export type GuidedAnswers = Record<string, string>;

// Fields shared by every description-bearing item that supports Guided Mode.
// `inputMode` defaults to 'guided'. `guidedVersion` records which question-set
// version `guided` maps to, so the questions can evolve without orphaning data.
export interface GuidedFields {
  inputMode?: InputMode;
  guided?: GuidedAnswers;
  guidedVersion?: number;
}

export interface WorkExperience extends GuidedFields {
  id: string;
  company: string;
  role: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
  rawDescription: string; // User input (free mode) OR assembled from `guided` (guided mode)
  refinedBullets: string[]; // AI Generated
  normalized?: NormalizedItemContent; // AI-polished profile evidence (see above)
  normalizedSourceHash?: string; // hash of the rawDescription `normalized` was computed from
}

export interface Education {
  id: string;
  school: string;
  degree: string;
  field: string;
  startDate: string;
  endDate: string;
  gpa?: string; // Optional GPA/CGPA (e.g., "3.8/4.0" or "8.5/10")
}

export interface TargetJob {
  title: string;
  company: string;
  description: string;
}

export interface Project extends GuidedFields {
  id: string;
  name: string;
  rawDescription: string;
  refinedBullets: string[];
  // Optional — tools, methods, software, or media used. Not all fields have
  // "technologies" in the tech sense (e.g. a marketing campaign, a research
  // study, a curriculum design, a legal case). Leave blank when not applicable.
  technologies?: string;
  link?: string;
  normalized?: NormalizedItemContent; // AI-polished profile evidence
  normalizedSourceHash?: string; // hash of the rawDescription `normalized` was computed from
}


export interface Extracurricular extends GuidedFields {
  id: string;
  title: string;
  organization: string;
  startDate: string;
  endDate: string;
  description: string; // raw description OR assembled from `guided`
  refinedBullets: string[]; // AI refined
  normalized?: NormalizedItemContent; // AI-polished profile evidence
  normalizedSourceHash?: string; // hash of the description `normalized` was computed from
}

export interface Award extends GuidedFields {
  id: string;
  title: string;
  issuer: string;
  date: string;
  description: string; // raw description OR assembled from `guided`
  normalized?: NormalizedItemContent; // AI-polished profile evidence (added with Guided Mode)
  normalizedSourceHash?: string; // hash of the description `normalized` was computed from
}

// The detail text to render for an award on the resume. Awards do NOT go
// through the optimizer (it only refines experience/projects/extracurriculars),
// so their raw `description` would otherwise show verbatim — which for a Guided
// Mode award is the assembled "Topic: answer" block (possibly Banglish). Prefer
// the AI-polished bullets; fall back to the raw description only when there's
// no polish (free-text awards typed directly, or pre-polish data).
export function awardDetailText(award: Pick<Award, 'description' | 'normalized'>): string {
  if (award.normalized?.bullets?.length) return award.normalized.bullets.join(' ');
  return award.description ?? '';
}

export interface Certification {
  id: string;
  name: string;
  issuer: string;
  date: string;
  link?: string;
}

export interface Affiliation {
  id: string;
  organization: string;
  role: string;
  startDate: string;
  endDate: string;
}

export interface Publication {
  id: string;
  title: string;
  publisher?: string;
  date: string;
  link?: string;
}

// Spoken / written language proficiency. Common in Bangladesh CVs (Bengali +
// English at minimum) and useful for global multilingual roles. ATS-safe:
// flat list of name + proficiency, no flags or icons.
export type LanguageProficiency = 'Native' | 'Fluent' | 'Professional' | 'Conversational' | 'Basic';

export interface Language {
  id: string;
  name: string;            // e.g. "Bengali", "English", "Hindi"
  proficiency: LanguageProficiency;
}

// Professional reference. Standard expectation in Bangladeshi CVs (2–3
// referees with phone + email). Optional in most global resumes (where
// "References available upon request" is the norm), so guarded behind the
// section selector.
export interface Reference {
  id: string;
  name: string;
  position: string;        // e.g. "Head of Engineering"
  organization: string;
  email: string;
  phone: string;
  relationship?: string;   // e.g. "Direct manager at Northwind, 2023–present"
}

export interface OutreachEmail {
  subject: string;
  body: string; // Plain text, paragraph breaks as blank lines.
}

export type InterviewQuestionCategory =
  | 'Behavioral'
  | 'Technical'
  | 'Role-specific'
  | 'Values & Culture'
  | 'Situational';

export interface InterviewQuestion {
  question: string;
  category: InterviewQuestionCategory;
  whyAsked: string;       // What the interviewer is evaluating.
  answerStrategy: string; // Notes on how to structure a strong answer.
  // Bengali (Bangla) translations. Optional for back-compat with resumes
  // generated before bilingual prep landed — the UI falls back to the English
  // field when these are absent. The English fields stay authoritative
  // (recruiters scan English; copy-paste-to-LinkedIn / brief exports default
  // to English). The Bn versions are for the candidate's own rehearsal, since
  // BD interviews routinely swing between languages even at MNCs.
  questionBn?: string;
  whyAskedBn?: string;
  answerStrategyBn?: string;
}

export type ToolkitItem =
  | 'coverLetter'
  | 'outreachEmail'
  | 'linkedInMessage'
  | 'interviewQuestions';

export type ToolkitErrors = Partial<Record<ToolkitItem, string>>;

/**
 * AI-generated artifacts that accompany a tailored resume. Persisted in the
 * dedicated `toolkit` JSONB column on generated_resumes (kept separate from
 * the resume payload itself). All fields optional — partial generation
 * (Promise.allSettled) can leave any one unset.
 *
 * `errors` records the reason each item failed on its most recent attempt.
 * The cover letter itself still lives on ResumeData.coverLetter for historic
 * reasons, but its error status lives here so everything generation-related
 * is in one place.
 */
export interface JobToolkit {
  outreachEmail?: OutreachEmail;
  linkedInMessage?: string;        // <= 280 chars.
  interviewQuestions?: InterviewQuestion[];
  errors?: ToolkitErrors;
}

/**
 * Shape returned by the combined toolkit generator — cover letter + outreach
 * email + LinkedIn note + interview questions produced in a single AI call
 * to stay under Gemini's free-tier RPM budget.
 *
 * Each artifact is OPTIONAL and validated in isolation. If one slot fails
 * (empty payload, fabricated tokens, missing specificity anchor, etc.), the
 * generator records the reason in `errors[<item>]` and continues — the other
 * three artifacts are still returned so the user gets whatever the model
 * produced cleanly. The all-or-nothing behaviour we used to have caused the
 * whole toolkit to disappear on a single weak interview answer, forcing the
 * user to manually regenerate every item via the per-card retry buttons.
 *
 * `errors` may be empty (perfect generation) or contain up to 4 keys (total
 * failure). Per-item failures are recovered via /api/toolkit-item which is
 * free and ungated; the bundled call costs one toolkit credit regardless.
 */
export interface GeneratedToolkit {
  coverLetter?: string;
  outreachEmail?: OutreachEmail;
  linkedInMessage?: string;
  interviewQuestions?: InterviewQuestion[];
  errors: ToolkitErrors;
}

// Categorized skills bucket (AI-generated). Each category groups related
// items in JD casing (Languages, Frameworks, Tools, Cloud & Infra, Databases,
// Testing, Methodologies, Domain). Renderers use skillCategories when present
// and fall back to the flat skills[] for back-compat with older saved
// resumes. The flat skills[] stays authoritative as well — JD-ordered, used
// by exporters that need a single line.
export interface SkillCategory {
  category: string;
  items: string[];
}

export interface ResumeData {
  userType?: UserType; // User type: experienced or student
  targetJob: TargetJob;
  personalInfo: PersonalInfo;
  summary: string; // AI Generated
  experience: WorkExperience[];
  projects: Project[]; // Added Projects
  education: Education[];
  skills: string[]; // User input -> AI Refined (JD-ordered flat list)
  skillCategories?: SkillCategory[]; // AI-generated grouped view of skills

  // New Sections
  extracurriculars?: Extracurricular[];
  awards?: Award[];
  certifications?: Certification[];
  affiliations?: Affiliation[];
  publications?: Publication[];
  languages?: Language[];
  references?: Reference[];

  coverLetter?: string; // AI Generated cover letter
  toolkit?: JobToolkit; // Additional AI-generated application artifacts.
  customSections?: { title: string; items: string[] }[];
  visibleSections?: string[]; // User selected sections
  template?: ResumeTemplate; // ATS Template selection
}

// All variants are single-column, real-text, no icons / no tables — i.e.
// structurally ATS-safe. They differ only in typography, alignment, and
// density. Legacy IDs from earlier versions are still accepted via
// `resolveTemplate()` in TemplateRegistry.ts.
export type ResumeTemplate =
  | 'ats-classic'
  | 'ats-modern'
  | 'ats-serif'
  | 'ats-compact';

export interface OptimizedResumeData {
  summary: string;
  skills: string[];
  skillCategories?: SkillCategory[];
  experience: {
    id: string;
    refinedBullets: string[];
  }[];
  projects?: {
    id: string;
    refinedBullets: string[];
  }[];
  extracurriculars?: {
    id: string;
    refinedBullets: string[];
  }[];
  coverLetter?: string; // AI Generated cover letter
  toolkit?: JobToolkit; // Outreach email, LinkedIn note, interview prep.
}

