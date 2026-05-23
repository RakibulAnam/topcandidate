import { ResumeData, OptimizedResumeData } from '../entities/Resume';

export interface Application {
    id: string;
    userId: string;
    jobTitle: string;
    company: string;
    jobDescription: string;
    status: 'draft' | 'generated';
    resumeData?: ResumeData; // The full resume data for this application
    createdAt: string;
}

export interface IApplicationRepository {
    getApplications(userId: string): Promise<Application[]>;
    getApplication(id: string): Promise<Application | null>;
    createApplication(userId: string, targetJob: { title: string; company: string; description: string }): Promise<Application>;
    updateApplication(id: string, data: Partial<Application>): Promise<void>;
    saveGeneratedResume(id: string, optimizedData: OptimizedResumeData): Promise<void>;
    deleteApplication(id: string): Promise<void>;
}
