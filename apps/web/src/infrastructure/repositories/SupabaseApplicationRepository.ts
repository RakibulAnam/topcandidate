import { supabase } from '../supabase/client';
import { IApplicationRepository, Application } from '../../domain/repositories/IApplicationRepository';
import { OptimizedResumeData } from '../../domain/entities/Resume';

export class SupabaseApplicationRepository implements IApplicationRepository {

    async getApplications(userId: string): Promise<Application[]> {
        const { data, error } = await supabase
            .from('applications')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false });

        if (error) throw error;

        return (data || []).map(this.mapToEntity);
    }

    async getApplication(id: string): Promise<Application | null> {
        const { data, error } = await supabase
            .from('applications')
            .select('*')
            .eq('id', id)
            .single();

        if (error) throw error;
        if (!data) return null;

        return this.mapToEntity(data);
    }

    async createApplication(userId: string, targetJob: { title: string; company: string; description: string }): Promise<Application> {
        const { data, error } = await supabase
            .from('applications')
            .insert({
                user_id: userId,
                job_title: targetJob.title,
                company: targetJob.company,
                job_description: targetJob.description,
                status: 'draft',
            })
            .select()
            .single();

        if (error) throw error;
        return this.mapToEntity(data);
    }

    async updateApplication(id: string, updates: Partial<Application>): Promise<void> {
        const payload: any = {};
        if (updates.jobTitle) payload.job_title = updates.jobTitle;
        if (updates.company) payload.company = updates.company;
        if (updates.jobDescription) payload.job_description = updates.jobDescription;
        if (updates.status) payload.status = updates.status;

        // Resume Data flattening if needed? 
        // Currently the schema stores optimized parts separately.
        // If we want to store the full resume state, we might need a JSONB column 'resume_snapshot' or similar.
        // The current schema has optimized_summary, optimized_skills, optimized_experience.

        const { error } = await supabase
            .from('applications')
            .update(payload)
            .eq('id', id);

        if (error) throw error;
    }

    async saveGeneratedResume(id: string, optimizedData: OptimizedResumeData): Promise<void> {
        const { error } = await supabase
            .from('applications')
            .update({
                status: 'generated',
                optimized_summary: optimizedData.summary,
                optimized_skills: optimizedData.skills,
                optimized_experience: optimizedData.experience, // Stores the refined bullets mapping
                cover_letter: optimizedData.coverLetter,
                updated_at: new Date().toISOString(),
            })
            .eq('id', id);

        if (error) throw error;
    }

    async deleteApplication(id: string): Promise<void> {
        const { error } = await supabase.from('applications').delete().eq('id', id);
        if (error) throw error;
    }

    private mapToEntity(row: any): Application {
        return {
            id: row.id,
            userId: row.user_id,
            jobTitle: row.job_title,
            company: row.company,
            jobDescription: row.job_description,
            status: row.status,
            createdAt: row.created_at,
            // We could reconstruct full ResumeData here if we pulled profile data + optimized data
            // For listing purposes, we don't need the full blob usually.
        };
    }
}
