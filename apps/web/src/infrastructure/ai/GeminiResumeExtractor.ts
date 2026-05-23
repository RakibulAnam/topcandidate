import { GoogleGenAI, Type, Schema } from '@google/genai';
import { ExtractedProfileData, IResumeExtractor } from '../../domain/usecases/ExtractResumeUseCase.js';

export class GeminiResumeExtractor implements IResumeExtractor {
    private genAI: GoogleGenAI;

    constructor(apiKey: string) {
        if (!apiKey) {
            throw new Error('Gemini API key is required');
        }
        this.genAI = new GoogleGenAI({ apiKey });
    }

    async extract(fileData: string, mimeType: string): Promise<ExtractedProfileData> {
        const extractionSchema: Schema = {
            type: Type.OBJECT,
            properties: {
                userType: {
                    type: Type.STRING,
                    enum: ['student', 'experienced'],
                    description: "Infer if the candidate is a 'student' (or entry-level/recent grad) or 'experienced' (has significant work experience)."
                },
                personalInfo: {
                    type: Type.OBJECT,
                    properties: {
                        fullName: { type: Type.STRING },
                        email: { type: Type.STRING },
                        phone: { type: Type.STRING },
                        location: { type: Type.STRING },
                        linkedin: { type: Type.STRING },
                        github: { type: Type.STRING },
                        website: { type: Type.STRING },
                    }
                },
                experience: {
                    type: Type.ARRAY,
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            id: { type: Type.STRING, description: "Generate a unique UUID or random string for this item." },
                            company: { type: Type.STRING },
                            role: { type: Type.STRING },
                            startDate: { type: Type.STRING, description: "Format: YYYY-MM or Month YYYY" },
                            endDate: { type: Type.STRING, description: "Format: YYYY-MM or 'Present'" },
                            isCurrent: { type: Type.BOOLEAN },
                            rawDescription: { type: Type.STRING, description: "The original description of responsibilities and achievements." },
                        },
                        required: ['id', 'company', 'role', 'startDate', 'rawDescription']
                    }
                },
                projects: {
                    type: Type.ARRAY,
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            id: { type: Type.STRING, description: "Generate a unique UUID or random string for this item." },
                            name: { type: Type.STRING },
                            technologies: { type: Type.STRING, description: "Comma-separated tools, methods, software, or media used. May be tech ('React, Node.js'), design tools ('Figma, Illustrator'), research methods ('qualitative interviews, SPSS'), media ('oil paint, video'), or empty string if none apply. Do not invent." },
                            rawDescription: { type: Type.STRING, description: "The original description of the project." },
                            link: { type: Type.STRING }
                        },
                        required: ['id', 'name', 'rawDescription']
                    }
                },
                education: {
                    type: Type.ARRAY,
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            id: { type: Type.STRING, description: "Generate a unique UUID or random string for this item." },
                            school: { type: Type.STRING },
                            degree: { type: Type.STRING },
                            field: { type: Type.STRING },
                            startDate: { type: Type.STRING },
                            endDate: { type: Type.STRING },
                            gpa: { type: Type.STRING }
                        },
                        required: ['id', 'school', 'degree', 'field']
                    }
                },
                skills: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                    description: "List of extracted skills (technical, soft, languages, etc.)"
                },
                extracurriculars: {
                    type: Type.ARRAY,
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            id: { type: Type.STRING, description: "Generate a unique ID." },
                            title: { type: Type.STRING },
                            organization: { type: Type.STRING },
                            startDate: { type: Type.STRING },
                            endDate: { type: Type.STRING },
                            description: { type: Type.STRING },
                        },
                        required: ['id', 'title', 'organization']
                    }
                },
                awards: {
                    type: Type.ARRAY,
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            id: { type: Type.STRING, description: "Generate a unique ID." },
                            title: { type: Type.STRING },
                            issuer: { type: Type.STRING },
                            date: { type: Type.STRING },
                            description: { type: Type.STRING }
                        },
                        required: ['id', 'title', 'issuer']
                    }
                }
            },
            required: ['personalInfo', 'userType']
        };

        const prompt = `
      You are an expert ATS parsing system. I am providing you with a Resume/CV document.
      Your task is to extract all the structured information from this document with high accuracy.
      Extract personal information, work experience, projects, education, skills, extracurriculars, and awards.
      If a section does not exist in the resume, omit it or return an empty array.
      CRUCIAL FORMATTING: Set 'rawDescription' fields as the exact text from the resume, we will format it later.
      CRUCIAL DATE FORMATTING: ALL date fields (startDate, endDate, date) MUST be strictly in YYYY-MM format (e.g., 2023-05). If only the year is known, use YYYY-01. If a date is completely unknown, OMIT the field (do not use "Unknown" or similar). For current/ongoing roles, set the endDate exactly to "Present".
    `;

        try {
            const result = await this.genAI.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: [
                    { inlineData: { data: fileData, mimeType } },
                    { text: prompt }
                ],
                config: {
                    responseMimeType: 'application/json',
                    responseSchema: extractionSchema,
                }
            });

            const responseText = result.text;
            if (!responseText) {
                throw new Error('No response from AI');
            }

            const parsed = JSON.parse(responseText) as ExtractedProfileData;

            const sanitizeDate = (d?: string) => {
                if (!d || d === 'Present') return d || '';
                return /^\d{4}-\d{2}$/.test(d) ? d : '';
            };

            if (parsed.experience) {
                parsed.experience = parsed.experience.map(e => ({ ...e, id: crypto.randomUUID(), startDate: sanitizeDate(e.startDate), endDate: sanitizeDate(e.endDate) }));
            }
            if (parsed.projects) {
                parsed.projects = parsed.projects.map(e => ({ ...e, id: crypto.randomUUID() }));
            }
            if (parsed.education) {
                parsed.education = parsed.education.map(e => ({ ...e, id: crypto.randomUUID(), startDate: sanitizeDate(e.startDate), endDate: sanitizeDate(e.endDate) }));
            }
            if (parsed.extracurriculars) {
                parsed.extracurriculars = parsed.extracurriculars.map(e => ({ ...e, id: crypto.randomUUID(), startDate: sanitizeDate(e.startDate), endDate: sanitizeDate(e.endDate) }));
            }
            if (parsed.awards) {
                parsed.awards = parsed.awards.map(e => ({ ...e, id: crypto.randomUUID(), date: sanitizeDate(e.date) }));
            }
            if (parsed.certifications) {
                parsed.certifications = parsed.certifications.map(e => ({ ...e, id: crypto.randomUUID(), date: sanitizeDate(e.date) }));
            }
            if (parsed.affiliations) {
                parsed.affiliations = parsed.affiliations.map(e => ({ ...e, id: crypto.randomUUID(), startDate: sanitizeDate(e.startDate), endDate: sanitizeDate(e.endDate) }));
            }
            if (parsed.publications) {
                parsed.publications = parsed.publications.map(e => ({ ...e, id: crypto.randomUUID(), date: sanitizeDate(e.date) }));
            }

            return parsed;
        } catch (error) {
            console.error('Gemini extraction failed:', error);
            throw new Error('Failed to extract resume data. Please make sure the PDF is valid or try entering manually.');
        }
    }
}
