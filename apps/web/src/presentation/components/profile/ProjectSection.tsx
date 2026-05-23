import React, { useState } from 'react';
import { Project } from '../../../domain/entities/Resume';
import { profileRepository } from '../../../infrastructure/config/dependencies';
import { useAuth } from '../../../infrastructure/auth/AuthContext';
import { toast } from 'sonner';
import { Plus, Trash2, Edit2, Save, FolderGit2 } from 'lucide-react';

interface Props {
    projects: Project[];
    onRefresh: () => void;
}

export const ProjectSection = ({ projects, onRefresh }: Props) => {
    const { user } = useAuth();
    const [isEditing, setIsEditing] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [formData, setFormData] = useState<Partial<Project>>({});
    const [saving, setSaving] = useState(false);

    const resetForm = () => {
        setFormData({ name: '', rawDescription: '', technologies: '', link: '' });
        setEditingId(null);
        setIsEditing(false);
    };

    const handleAddNew = () => { resetForm(); setIsEditing(true); };
    const handleEdit = (p: Project) => { setFormData({ ...p }); setEditingId(p.id); setIsEditing(true); };

    const handleDelete = async (id: string) => {
        if (!confirm('Delete project?')) return;
        try { await profileRepository.deleteProject(id); onRefresh(); toast.success('Deleted'); }
        catch (e) { toast.error('Failed'); }
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!user) return;
        setSaving(true);
        try {
            await profileRepository.saveProject(user.id, {
                id: editingId || '',
                name: formData.name || '',
                rawDescription: formData.rawDescription || '',
                refinedBullets: [],
                technologies: formData.technologies || '',
                link: formData.link,
            });
            toast.success('Saved');
            resetForm();
            onRefresh();
        } catch (e) { toast.error('Failed to save'); }
        finally { setSaving(false); }
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h3 className="text-lg font-semibold text-charcoal-800 flex items-center gap-2"><FolderGit2 size={20} /> Projects</h3>
                {!isEditing && (
                    <button onClick={handleAddNew} className="flex items-center gap-1 text-sm bg-brand-50 text-brand-600 px-3 py-1.5 rounded-lg hover:bg-brand-100 font-medium">
                        <Plus size={16} /> Add New
                    </button>
                )}
            </div>

            {isEditing && (
                <form onSubmit={handleSave} className="bg-charcoal-50 p-4 rounded-xl border border-charcoal-200 animate-in fade-in slide-in-from-top-2">
                    <div className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs font-semibold text-charcoal-500 uppercase mb-1">Project Name</label>
                                <input
                                    required
                                    className={`w-full p-2 border rounded-lg ${!formData.name ? 'border-red-500 ring-1 ring-red-500' : 'border-charcoal-300'}`}
                                    value={formData.name || ''}
                                    onChange={e => setFormData({ ...formData, name: e.target.value })}
                                    placeholder="e.g. Brand Relaunch Campaign, Community Health Study, E-commerce Platform"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-charcoal-500 uppercase mb-1">Link (Optional)</label>
                                <input
                                    className="w-full p-2 border rounded-lg border-charcoal-300"
                                    value={formData.link || ''}
                                    onChange={e => setFormData({ ...formData, link: e.target.value })}
                                    placeholder="e.g. https://yourportfolio.com/project, article URL, GitHub link"
                                />
                            </div>
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-charcoal-500 uppercase mb-1">Tools, Methods, or Technologies (Optional, comma separated)</label>
                            <input
                                className="w-full p-2 border rounded-lg border-charcoal-300"
                                value={formData.technologies || ''}
                                onChange={e => setFormData({ ...formData, technologies: e.target.value })}
                                placeholder="e.g. Figma & Adobe Suite • Qualitative interviews, SPSS • React, Node.js • Classroom observation, IEP planning"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-charcoal-500 uppercase mb-1">Description (Brain dump — AI will refine)</label>
                            <textarea
                                className={`w-full p-2 border rounded-lg h-32 text-sm ${!formData.rawDescription ? 'border-red-500 ring-1 ring-red-500' : 'border-charcoal-300'}`}
                                value={formData.rawDescription || ''}
                                onChange={e => setFormData({ ...formData, rawDescription: e.target.value })}
                                placeholder={`Describe what you created, delivered, or contributed to — your role, scope, and outcome. Examples:
- Led a 6-month rebrand; grew social engagement 40%.
- Designed K-5 literacy curriculum adopted district-wide.
- Built customer dashboard with React and Node.js; reduced support tickets 30%.`}
                            />
                        </div>
                        <div className="flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={resetForm}
                                className="px-4 py-2 text-charcoal-600 hover:bg-charcoal-200 rounded-lg text-sm"
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                disabled={saving}
                                className="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-50 flex items-center gap-2"
                            >
                                <Save size={16} /> Save
                            </button>
                        </div>
                    </div>
                </form>
            )}

            <div className="grid grid-cols-1 gap-4">
                {projects.length === 0 && !isEditing && <p className="text-charcoal-400 text-center text-sm">No projects added.</p>}
                {projects.map(p => (
                    <div key={p.id} className="bg-white border p-4 rounded-xl relative group">
                        <div className="flex justify-between">
                            <h4 className="font-bold">{p.name}</h4>
                            <div className="opacity-0 group-hover:opacity-100 flex gap-1">
                                <button onClick={() => handleEdit(p)} className="icon-btn"><Edit2 size={16} /></button>
                                <button onClick={() => handleDelete(p.id)} className="icon-btn-danger"><Trash2 size={16} /></button>
                            </div>
                        </div>
                        <p className="text-sm text-charcoal-600 mt-1 line-clamp-2">{p.rawDescription}</p>
                        {p.technologies && p.technologies.trim() && (
                            <div className="flex flex-wrap gap-2 mt-2">
                                {p.technologies.split(',').map((t, i) => {
                                    const trimmed = t.trim();
                                    if (!trimmed) return null;
                                    return (
                                        <span key={i} className="text-xs bg-charcoal-100 px-2 py-1 rounded text-charcoal-600">{trimmed}</span>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
};
