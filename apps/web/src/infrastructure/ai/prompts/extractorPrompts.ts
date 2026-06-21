// Shared prompt + schema for the resume extractor.
//
// Extracted from GeminiResumeExtractor (migration Phase 0) so the OpenRouter
// port (Phase 5) reuses the same instruction. The Gemini Type-based response
// schema stays in the generator class (SDK-specific); the OpenRouter path uses
// EXTRACTOR_SCHEMA below (strict structured outputs — see OpenRouterClient).
//
// 2026-06 quality pass: the prompt was de-biased (it over-emphasised work
// experience, so education/skills/certs/awards were dropped under token
// pressure), certifications/affiliations/publications were added (the mapping
// + post-parse already expected them, but no schema produced them), and the
// OpenRouter path moved from `json_object` (no enforcement, truncates) to
// strict `json_schema`.

export const EXTRACTOR_PROMPT = `
      You are an expert ATS resume parser. I am providing you with a Resume/CV document.
      Extract ALL structured information from this document with high accuracy AND completeness.

      Give EVERY section equal attention — do NOT stop after work experience. Actively look
      for, and extract whenever present, each of:
        • personal info (full name, email, phone, location, LinkedIn, GitHub, website)
        • work experience
        • projects
        • education (degrees, schools, fields of study, dates, GPA/CGPA)
        • skills (technical AND soft skills, tools, frameworks, spoken languages)
        • extracurriculars / volunteering / leadership / activities
        • awards & honors
        • certifications & licenses
        • professional affiliations / memberships
        • publications

      A resume often lists education, certifications, awards and skills AFTER work experience —
      do not skip a section just because it appears late in the document. Return an EMPTY ARRAY
      for any section that is genuinely absent; never omit a key and never drop a present section.

      CRUCIAL FORMATTING: Set 'rawDescription' / 'description' fields to the exact text from the
      resume — we will format it later.
      CRUCIAL DATE FORMATTING: ALL date fields (startDate, endDate, date) MUST be strictly in
      YYYY-MM format (e.g. 2023-05). If only the year is known, use YYYY-01. If a date is
      genuinely unknown, use an empty string "". For current/ongoing roles, set endDate exactly
      to "Present" and isCurrent to true.
    `;

// JSON shape spec — guidance shown to the model alongside the enforced schema.
// Mirrors EXTRACTOR_SCHEMA / the Gemini responseSchema field-for-field. `id`
// fields are regenerated server-side after parsing, so the model's values
// there don't matter.
export const EXTRACTOR_JSON_SHAPE = `
Return ONE JSON object with EXACTLY this shape. Include EVERY key; use an empty array (or empty
string for absent optional text) when a section is absent. No markdown, no code fences, no commentary.
{
  "userType": "student" | "experienced",                 // infer from the resume
  "personalInfo": { "fullName": string, "email": string, "phone": string, "location": string, "linkedin": string, "github": string, "website": string },
  "experience": [ { "id": string, "company": string, "role": string, "startDate": "YYYY-MM", "endDate": "YYYY-MM" | "Present", "isCurrent": boolean, "rawDescription": string } ],
  "projects": [ { "id": string, "name": string, "technologies": string, "rawDescription": string, "link": string } ],
  "education": [ { "id": string, "school": string, "degree": string, "field": string, "startDate": "YYYY-MM", "endDate": "YYYY-MM", "gpa": string } ],
  "skills": [ string ],
  "extracurriculars": [ { "id": string, "title": string, "organization": string, "startDate": "YYYY-MM", "endDate": "YYYY-MM", "description": string } ],
  "awards": [ { "id": string, "title": string, "issuer": string, "date": "YYYY-MM", "description": string } ],
  "certifications": [ { "id": string, "name": string, "issuer": string, "date": "YYYY-MM", "link": string } ],
  "affiliations": [ { "id": string, "organization": string, "role": string, "startDate": "YYYY-MM", "endDate": "YYYY-MM" } ],
  "publications": [ { "id": string, "title": string, "publisher": string, "date": "YYYY-MM", "link": string } ]
}
"technologies" is a comma-separated string (tools/methods/software/media), or "" if none.`;

// Strict json_schema for the OpenRouter extractor (structured outputs). Follows
// the same convention as INTERVIEW_SCHEMA / NORMALIZER_SCHEMA: every property is
// listed in `required` and `additionalProperties: false`. Absent sections come
// back as empty arrays; absent optional strings come back as "". This is what
// stops the large multi-section JSON from truncating mid-output (the old
// `json_object` mode silently dropped trailing sections like education/awards).
const str = { type: 'string' } as const;

export const EXTRACTOR_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    userType: { type: 'string', enum: ['student', 'experienced'] },
    personalInfo: {
      type: 'object',
      properties: {
        fullName: str, email: str, phone: str, location: str,
        linkedin: str, github: str, website: str,
      },
      required: ['fullName', 'email', 'phone', 'location', 'linkedin', 'github', 'website'],
      additionalProperties: false,
    },
    experience: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: str, company: str, role: str, startDate: str, endDate: str,
          isCurrent: { type: 'boolean' }, rawDescription: str,
        },
        required: ['id', 'company', 'role', 'startDate', 'endDate', 'isCurrent', 'rawDescription'],
        additionalProperties: false,
      },
    },
    projects: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: str, name: str, technologies: str, rawDescription: str, link: str },
        required: ['id', 'name', 'technologies', 'rawDescription', 'link'],
        additionalProperties: false,
      },
    },
    education: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: str, school: str, degree: str, field: str, startDate: str, endDate: str, gpa: str },
        required: ['id', 'school', 'degree', 'field', 'startDate', 'endDate', 'gpa'],
        additionalProperties: false,
      },
    },
    skills: { type: 'array', items: str },
    extracurriculars: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: str, title: str, organization: str, startDate: str, endDate: str, description: str },
        required: ['id', 'title', 'organization', 'startDate', 'endDate', 'description'],
        additionalProperties: false,
      },
    },
    awards: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: str, title: str, issuer: str, date: str, description: str },
        required: ['id', 'title', 'issuer', 'date', 'description'],
        additionalProperties: false,
      },
    },
    certifications: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: str, name: str, issuer: str, date: str, link: str },
        required: ['id', 'name', 'issuer', 'date', 'link'],
        additionalProperties: false,
      },
    },
    affiliations: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: str, organization: str, role: str, startDate: str, endDate: str },
        required: ['id', 'organization', 'role', 'startDate', 'endDate'],
        additionalProperties: false,
      },
    },
    publications: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: str, title: str, publisher: str, date: str, link: str },
        required: ['id', 'title', 'publisher', 'date', 'link'],
        additionalProperties: false,
      },
    },
  },
  required: [
    'userType', 'personalInfo', 'experience', 'projects', 'education', 'skills',
    'extracurriculars', 'awards', 'certifications', 'affiliations', 'publications',
  ],
  additionalProperties: false,
};
