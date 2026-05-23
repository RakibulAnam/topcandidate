import {
    PersonalInfo,
    WorkExperience,
    Project,
    Education,
    Extracurricular,
    Award,
    Certification,
    Affiliation,
    Publication,
    UserType
} from '../entities/Resume.js';

export interface ExtractedProfileData {
    userType?: UserType;
    personalInfo?: Partial<PersonalInfo>;
    experience?: WorkExperience[];
    projects?: Project[];
    education?: Education[];
    skills?: string[];
    extracurriculars?: Extracurricular[];
    awards?: Award[];
    certifications?: Certification[];
    affiliations?: Affiliation[];
    publications?: Publication[];
}

export interface IResumeExtractor {
    extract(fileData: string, mimeType: string): Promise<ExtractedProfileData>;
}
