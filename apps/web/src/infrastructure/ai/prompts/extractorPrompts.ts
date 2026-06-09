// Shared prompt for the resume extractor.
//
// Extracted verbatim from GeminiResumeExtractor (migration Phase 0) so the
// OpenRouter port (Phase 5) reuses a byte-identical instruction. The Gemini
// Type-based response schema stays in the generator class (SDK-specific); the
// OpenRouter path supplies its own JSON-schema / prompt-embedded equivalent.
//
// Whitespace is significant — preserved exactly as the original inline literal
// so the prompt sent to the model is unchanged.

export const EXTRACTOR_PROMPT = `
      You are an expert ATS parsing system. I am providing you with a Resume/CV document.
      Your task is to extract all the structured information from this document with high accuracy.
      Extract personal information, work experience, projects, education, skills, extracurriculars, and awards.
      If a section does not exist in the resume, omit it or return an empty array.
      CRUCIAL FORMATTING: Set 'rawDescription' fields as the exact text from the resume, we will format it later.
      CRUCIAL DATE FORMATTING: ALL date fields (startDate, endDate, date) MUST be strictly in YYYY-MM format (e.g., 2023-05). If only the year is known, use YYYY-01. If a date is completely unknown, OMIT the field (do not use "Unknown" or similar). For current/ongoing roles, set the endDate exactly to "Present".
    `;

// JSON shape spec — used ONLY by the OpenRouter extractor. The Gemini extractor
// enforces shape via the SDK's responseSchema, so it doesn't need this; OpenRouter
// `json_object` does NOT enforce a schema, so we describe the exact shape in the
// prompt. Mirrors the Gemini responseSchema field-for-field. `id` fields are
// regenerated server-side after parsing, so the model's values there don't matter.
export const EXTRACTOR_JSON_SHAPE = `
Return ONE JSON object with EXACTLY this shape (omit a key or use an empty array if a section is absent). No markdown, no code fences, no commentary.
{
  "userType": "student" | "experienced",                 // infer from the resume
  "personalInfo": { "fullName": string, "email": string, "phone": string, "location": string, "linkedin"?: string, "github"?: string, "website"?: string },
  "experience": [ { "id": string, "company": string, "role": string, "startDate": "YYYY-MM", "endDate": "YYYY-MM" | "Present", "isCurrent": boolean, "rawDescription": string } ],
  "projects": [ { "id": string, "name": string, "technologies": string, "rawDescription": string, "link"?: string } ],
  "education": [ { "id": string, "school": string, "degree": string, "field": string, "startDate": "YYYY-MM", "endDate": "YYYY-MM", "gpa"?: string } ],
  "skills": [ string ],
  "extracurriculars": [ { "id": string, "title": string, "organization": string, "startDate"?: "YYYY-MM", "endDate"?: "YYYY-MM", "description"?: string } ],
  "awards": [ { "id": string, "title": string, "issuer": string, "date"?: "YYYY-MM", "description"?: string } ]
}
"technologies" is a comma-separated string (tools/methods/software/media), or "" if none. Required keys: userType, personalInfo.`;
