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
