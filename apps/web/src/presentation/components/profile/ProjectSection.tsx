import React, { useState } from 'react';
import { Project } from '../../../domain/entities/Resume';
import { profileRepository } from '../../../infrastructure/config/dependencies';
import { useAuth } from '../../../infrastructure/auth/AuthContext';
import { toast } from 'sonner';
import { Plus, Trash2, Edit2, Save, X, FolderGit2 } from 'lucide-react';
import { needsPolish, polishInBackground, PolishedPreview, fieldsEqual, tryConsumeRenorm } from './polish';
import { GuidedModeField } from './GuidedModeField';
import { assembleGuided, guidedRequiredFilled, GUIDED_VERSION } from './guidedQuestions';

const PROJECT_FIELDS = ['name', 'rawDescription', 'technologies', 'link', 'inputMode', 'guided'];

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
    const [polishingIds, setPolishingIds] = useState<Set<string>>(new Set());
    const markPolishing = (id: string, on: boolean) =>
        setPolishingIds(prev => {
            const next = new Set(prev);
            if (on) next.add(id); else next.delete(id);
            return next;
        });

    const resetForm = () => {
        setFormData({ name: '', rawDescription: '', technologies: '', link: '', inputMode: 'guided', guided: {} });
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

        const mode = formData.inputMode ?? 'guided';
        const answers = formData.guided ?? {};
        const description = mode === 'guided'
            ? assembleGuided('project', answers)
            : (formData.rawDescription || '');

        if (mode === 'guided' && !guidedRequiredFilled('project', answers)) {
            toast.error('Please answer the first question.');
            return;
        }
        if (mode === 'free' && !description.trim()) {
            toast.error('Please add a short description.');
            return;
        }

        setSaving(true);
        try {
            const proj: Project = {
                id: editingId || '',
                name: formData.name || '',
                rawDescription: description,
                refinedBullets: [],
                technologies: formData.technologies || '',
                link: formData.link,
                inputMode: mode,
                guided: answers,
                guidedVersion: mode === 'guided' ? GUIDED_VERSION : formData.guidedVersion,
            };
            const savedId = await profileRepository.saveProject(user.id, proj);
            toast.success('Saved');

            if (needsPolish(proj.rawDescription, projects.find(x => x.id === savedId))) {
                if (tryConsumeRenorm('project')) {
                    polishInBackground({
                        text: proj.rawDescription,
                        context: { kind: 'project', title: proj.name, technologies: proj.technologies, guided: mode === 'guided' },
                        persist: (n, h) => profileRepository.saveProjectNormalized(savedId, n, h),
                        onStart: () => markPolishing(savedId, true),
                        onSettle: () => markPolishing(savedId, false),
                        onDone: onRefresh,
                    });
                } else {
                    toast('Saved. AI polish for this section has refreshed 5 times today — it’ll refresh again tomorrow.');
                }
            }

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
                            <GuidedModeField
                                section="project"
                                mode={formData.inputMode ?? 'guided'}
                                answers={formData.guided ?? {}}
                                freeText={formData.rawDescription ?? ''}
                                freePlaceholder={`Describe what you created, delivered, or contributed to — your role, scope, and outcome. Examples:
- Led a 6-month rebrand; grew social engagement 40%.
- Designed a literacy programme adopted across the district.
- Built a customer dashboard; reduced support calls 30%.`}
                                onModeChange={m => setFormData({ ...formData, inputMode: m })}
                                onAnswersChange={a => setFormData({ ...formData, guided: a })}
                                onFreeTextChange={t => setFormData({ ...formData, rawDescription: t })}
                            />
                        </div>
                        <div className="flex justify-end gap-2">
                            {editingId && fieldsEqual(formData as Record<string, unknown>, projects.find(x => x.id === editingId) as Record<string, unknown> | undefined, PROJECT_FIELDS) ? (
                                <button
                                    type="button"
                                    onClick={resetForm}
                                    className="px-4 py-2 bg-charcoal-200 text-charcoal-700 rounded-lg text-sm font-medium hover:bg-charcoal-300 flex items-center gap-2"
                                >
                                    <X size={16} /> Close
                                </button>
                            ) : (
                                <>
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
                                </>
                            )}
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
                            <div className="flex gap-1 shrink-0">
                                <button type="button" onClick={() => handleEdit(p)} aria-label="Edit project" className="p-1.5 text-charcoal-500 hover:text-brand-600 hover:bg-brand-50 rounded-lg"><Edit2 size={16} /></button>
                                <button type="button" onClick={() => handleDelete(p.id)} aria-label="Delete project" className="p-1.5 text-charcoal-500 hover:text-red-600 hover:bg-red-50 rounded-lg"><Trash2 size={16} /></button>
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
                        <PolishedPreview normalized={p.normalized} polishing={polishingIds.has(p.id)} sourceText={p.rawDescription} sourceHash={p.normalizedSourceHash} />
                    </div>
                ))}
            </div>
        </div>
    );
};
