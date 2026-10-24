import { PersonalInfo, WorkExperience, Education, Project, UserType, Extracurricular, Award, Certification, Affiliation, Publication, Language, Reference, NormalizedItemContent } from '../entities/Resume';

export interface CreditStatus {
    credits: number;
    masterUnlocked: boolean;
    /** Has a completed purchase that granted credits (a pack). Since the ৳50
     *  master-resume package (migration 033) this is NOT the same as
     *  `masterUnlocked`: a ৳50 buyer is unlocked but still "never bought a
     *  pack" for every free-kit / pack-nudge decision. */
    boughtPack: boolean;
    welcomePending: boolean;
}

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

    /**
     * Credits plus the two purchase-flow flags (migration 032):
     * `masterUnlocked` — any purchase has completed (a pack, or the ৳50
     * master-resume package), so the master resume can be generated/regenerated;
     * `boughtPack` — a credit-granting purchase has completed; `welcomePending` — profile complete but the
     * one-time free credit hasn't been claimed yet.
     */
    getCreditStatus(userId: string): Promise<CreditStatus>;
    /** Claims the one-time free credit. New balance when granted, null when not. */
    claimWelcomeCredit(): Promise<number | null>;

    getExperiences(userId: string): Promise<WorkExperience[]>;
    /** Returns the row id (DB-generated for new items). */
    saveExperience(userId: string, experience: WorkExperience): Promise<string>;
    /** Persist the background AI normalization ("polished profile") for a row. */
    saveExperienceNormalized(id: string, normalized: NormalizedItemContent, sourceHash: string): Promise<void>;
    deleteExperience(id: string): Promise<void>;

    getEducations(userId: string): Promise<Education[]>;
    /** Returns the row id (DB-generated for new items). */
    saveEducation(userId: string, education: Education): Promise<string>;
    deleteEducation(id: string): Promise<void>;

    getProjects(userId: string): Promise<Project[]>;
    /** Returns the row id (DB-generated for new items). */
    saveProject(userId: string, project: Project): Promise<string>;
    saveProjectNormalized(id: string, normalized: NormalizedItemContent, sourceHash: string): Promise<void>;
    deleteProject(id: string): Promise<void>;

    getSkills(userId: string): Promise<string[]>;
    saveSkills(userId: string, skills: string[]): Promise<void>;

    // New Sections
    getExtracurriculars(userId: string): Promise<Extracurricular[]>;
    /** Returns the row id (DB-generated for new items). */
    saveExtracurricular(userId: string, item: Extracurricular): Promise<string>;
    saveExtracurricularNormalized(id: string, normalized: NormalizedItemContent, sourceHash: string): Promise<void>;
    deleteExtracurricular(id: string): Promise<void>;

    getAwards(userId: string): Promise<Award[]>;
    /** Returns the row id (DB-generated for new items). */
    saveAward(userId: string, item: Award): Promise<string>;
    saveAwardNormalized(id: string, normalized: NormalizedItemContent, sourceHash: string): Promise<void>;
    deleteAward(id: string): Promise<void>;

    getCertifications(userId: string): Promise<Certification[]>;
    /** Returns the row id (DB-generated for new items). */
    saveCertification(userId: string, item: Certification): Promise<string>;
    deleteCertification(id: string): Promise<void>;

    getAffiliations(userId: string): Promise<Affiliation[]>;
    /** Returns the row id (DB-generated for new items). */
    saveAffiliation(userId: string, item: Affiliation): Promise<string>;
    deleteAffiliation(id: string): Promise<void>;

    getPublications(userId: string): Promise<Publication[]>;
    /** Returns the row id (DB-generated for new items). */
    savePublication(userId: string, item: Publication): Promise<string>;
    deletePublication(id: string): Promise<void>;

    getLanguages(userId: string): Promise<Language[]>;
    /** Returns the row id (DB-generated for new items). */
    saveLanguage(userId: string, item: Language): Promise<string>;
    deleteLanguage(id: string): Promise<void>;

    getReferences(userId: string): Promise<Reference[]>;
    /** Returns the row id (DB-generated for new items). */
    saveReference(userId: string, item: Reference): Promise<string>;
    deleteReference(id: string): Promise<void>;
}
