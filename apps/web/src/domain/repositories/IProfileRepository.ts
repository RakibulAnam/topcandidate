import { PersonalInfo, WorkExperience, Education, Project, UserType, Extracurricular, Award, Certification, Affiliation, Publication, Language, Reference } from '../entities/Resume';

export interface IProfileRepository {
    // Profile completeness
    getUserType(userId: string): Promise<UserType | null>;
    saveUserType(userId: string, userType: UserType): Promise<void>;
    isProfileComplete(userId: string): Promise<boolean>;
    markProfileComplete(userId: string): Promise<void>;

    getProfile(userId: string): Promise<PersonalInfo | null>;
    saveProfile(userId: string, data: PersonalInfo): Promise<void>;
    deleteProfile(userId: string): Promise<void>;

    /** Returns the user's current toolkit_credits balance (0 if missing). */
    getToolkitCredits(userId: string): Promise<number>;

    getExperiences(userId: string): Promise<WorkExperience[]>;
    saveExperience(userId: string, experience: WorkExperience): Promise<void>;
    deleteExperience(id: string): Promise<void>;

    getEducations(userId: string): Promise<Education[]>;
    saveEducation(userId: string, education: Education): Promise<void>;
    deleteEducation(id: string): Promise<void>;

    getProjects(userId: string): Promise<Project[]>;
    saveProject(userId: string, project: Project): Promise<void>;
    deleteProject(id: string): Promise<void>;

    getSkills(userId: string): Promise<string[]>;
    saveSkills(userId: string, skills: string[]): Promise<void>;

    // New Sections
    getExtracurriculars(userId: string): Promise<Extracurricular[]>;
    saveExtracurricular(userId: string, item: Extracurricular): Promise<void>;
    deleteExtracurricular(id: string): Promise<void>;

    getAwards(userId: string): Promise<Award[]>;
    saveAward(userId: string, item: Award): Promise<void>;
    deleteAward(id: string): Promise<void>;

    getCertifications(userId: string): Promise<Certification[]>;
    saveCertification(userId: string, item: Certification): Promise<void>;
    deleteCertification(id: string): Promise<void>;

    getAffiliations(userId: string): Promise<Affiliation[]>;
    saveAffiliation(userId: string, item: Affiliation): Promise<void>;
    deleteAffiliation(id: string): Promise<void>;

    getPublications(userId: string): Promise<Publication[]>;
    savePublication(userId: string, item: Publication): Promise<void>;
    deletePublication(id: string): Promise<void>;

    getLanguages(userId: string): Promise<Language[]>;
    saveLanguage(userId: string, item: Language): Promise<void>;
    deleteLanguage(id: string): Promise<void>;

    getReferences(userId: string): Promise<Reference[]>;
    saveReference(userId: string, item: Reference): Promise<void>;
    deleteReference(id: string): Promise<void>;
}
