// Domain Layer - Repository Interface

import { ResumeData } from '../entities/Resume';

export type ResumeListItem = { id: string; title: string; date: string; updatedAt?: string; company?: string };

export interface ResumeListPage {
    items: ResumeListItem[];
    total: number;
}

export interface ResumeListParams {
    page: number;
    pageSize: number;
    search?: string;
}

export interface IResumeRepository {
    save(data: ResumeData): void;
    load(): ResumeData | null;
    saveGeneratedResume(userId: string, data: ResumeData, title: string): Promise<string>;
    updateGeneratedResume(id: string, data: ResumeData, title: string): Promise<void>;
    getGeneratedResumes(userId: string): Promise<ResumeListItem[]>;
    getGeneratedResume(id: string): Promise<ResumeData | null>;
    deleteGeneratedResume(id: string): Promise<void>;
    getGeneratedResumesPaginated(userId: string, params: ResumeListParams): Promise<ResumeListPage>;
}
