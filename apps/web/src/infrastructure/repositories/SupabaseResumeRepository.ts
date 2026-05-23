import { IResumeRepository, ResumeListItem, ResumeListPage, ResumeListParams } from '../../domain/repositories/IResumeRepository';
import { ResumeData, JobToolkit } from '../../domain/entities/Resume';
import { supabase } from '../supabase/client';

export class SupabaseResumeRepository implements IResumeRepository {
    private readonly DRAFT_KEY = 'resume_draft';

    // Local Storage for Drafts (Current Work in Progress)
    save(data: ResumeData): void {
        try {
            localStorage.setItem(this.DRAFT_KEY, JSON.stringify(data));
        } catch (error) {
            console.error('Error saving draft to local storage:', error);
        }
    }

    load(): ResumeData | null {
        try {
            const data = localStorage.getItem(this.DRAFT_KEY);
            return data ? JSON.parse(data) : null;
        } catch (error) {
            console.error('Error loading draft from local storage:', error);
            return null;
        }
    }

    // Supabase for Generated/Finalized Resumes.
    //
    // The toolkit (outreach email, LinkedIn note, interview questions) lives in
    // its own JSONB column so the resume payload stays clean and the toolkit is
    // queryable/inspectable on its own.
    async saveGeneratedResume(userId: string, data: ResumeData, title: string): Promise<string> {
        const { toolkit, ...resumePayload } = data;
        const { data: inserted, error } = await supabase
            .from('generated_resumes')
            .insert({
                user_id: userId,
                title,
                data: resumePayload,
                toolkit: toolkit ?? null,
            })
            .select('id')
            .single();

        if (error) throw error;
        return inserted.id;
    }

    async updateGeneratedResume(id: string, data: ResumeData, title: string): Promise<void> {
        const { toolkit, ...resumePayload } = data;
        const { error } = await supabase
            .from('generated_resumes')
            .update({
                title,
                data: resumePayload,
                toolkit: toolkit ?? null,
                updated_at: new Date().toISOString(),
            })
            .eq('id', id);

        if (error) throw error;
    }

    async getGeneratedResumes(userId: string): Promise<ResumeListItem[]> {
        const { data, error } = await supabase
            .from('generated_resumes')
            .select('id, title, created_at, updated_at, company')
            .eq('user_id', userId)
            .order('created_at', { ascending: false });

        if (error) throw error;

        return data.map(item => ({
            id: item.id,
            title: item.title,
            date: item.created_at,
            updatedAt: item.updated_at || item.created_at,
            company: item.company ?? undefined,
        }));
    }

    async getGeneratedResumesPaginated(userId: string, params: ResumeListParams): Promise<ResumeListPage> {
        const { page, pageSize, search } = params;

        let query = supabase
            .from('generated_resumes')
            .select('id, title, created_at, updated_at, company', { count: 'exact' })
            .eq('user_id', userId)
            .neq('title', 'General Resume')
            .order('created_at', { ascending: false });

        const term = search?.trim();
        if (term) {
            query = query.or(`title.ilike.%${term}%,company.ilike.%${term}%`);
        }

        const from = (page - 1) * pageSize;
        const to = from + pageSize - 1;
        const { data, count, error } = await query.range(from, to);

        if (error) throw error;

        return {
            items: (data ?? []).map(item => ({
                id: item.id,
                title: item.title,
                date: item.created_at,
                updatedAt: item.updated_at || item.created_at,
                company: item.company ?? undefined,
            })),
            total: count ?? 0,
        };
    }

    async getGeneratedResume(id: string): Promise<ResumeData | null> {
        const { data, error } = await supabase
            .from('generated_resumes')
            .select('data, toolkit')
            .eq('id', id)
            .single();

        if (error) throw error;
        if (!data) return null;

        const payload = (data.data || {}) as ResumeData;
        const toolkit = (data.toolkit ?? undefined) as JobToolkit | undefined;
        return { ...payload, toolkit };
    }

    async deleteGeneratedResume(id: string): Promise<void> {
        // Prevent deletion of the protected General Resume
        const { data: resumeData, error: fetchError } = await supabase
            .from('generated_resumes')
            .select('title')
            .eq('id', id)
            .single();

        if (fetchError) throw fetchError;

        if (resumeData?.title === 'General Resume') {
            throw new Error('The General Resume cannot be deleted.');
        }

        const { error } = await supabase
            .from('generated_resumes')
            .delete()
            .eq('id', id);

        if (error) throw error;
    }
}
