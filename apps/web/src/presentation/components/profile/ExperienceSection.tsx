import React, { useState } from 'react';
import { WorkExperience } from '../../../domain/entities/Resume';
import { profileRepository, profileNormalizer } from '../../../infrastructure/config/dependencies';
import { contentHash } from '../../../application/validation/contentHash';
import { useAuth } from '../../../infrastructure/auth/AuthContext';
import { toast } from 'sonner';
import { Plus, Trash2, Edit2, Save, X, Briefcase, Sparkles, Loader2, Lightbulb } from 'lucide-react';
import { MonthPicker } from '../ui/month-picker';

interface Props {
    experiences: WorkExperience[];
    onRefresh: () => void;
}

export const ExperienceSection = ({ experiences, onRefresh }: Props) => {
    const { user } = useAuth();
    const [isEditing, setIsEditing] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [formData, setFormData] = useState<Partial<WorkExperience>>({});
    const [saving, setSaving] = useState(false);
    // Row ids with an AI normalization ("polish") currently in flight.
    const [polishingIds, setPolishingIds] = useState<Set<string>>(new Set());

    // Background "polished profile" pass: convert the raw brain dump into
    // canonical English bullets + coaching gaps, once per description change.
    // Never blocks the save — failures are silent (the raw text is always the
    // source of truth, and the next save retries).
    const polishInBackground = (id: string, exp: { role: string; company: string; rawDescription: string }) => {
        const text = exp.rawDescription.trim();
        if (!text) return;
        const hash = contentHash(text);
        setPolishingIds(prev => new Set(prev).add(id));
        profileNormalizer
            .normalize(text, { role: exp.role, company: exp.company })
            .then(async normalized => {
                await profileRepository.saveExperienceNormalized(id, normalized, hash);
                onRefresh();
            })
            .catch(err => {
                console.warn('Profile polish failed (will retry on next save):', err);
            })
            .finally(() => {
                setPolishingIds(prev => {
                    const next = new Set(prev);
                    next.delete(id);
                    return next;
                });
            });
    };

    const resetForm = () => {
        setFormData({
            company: '',
            role: '',
            startDate: '',
            endDate: '',
            isCurrent: false,
            rawDescription: '',
        });
        setEditingId(null);
        setIsEditing(false);
    };

    const handleAddNew = () => {
        resetForm();
        setIsEditing(true);
    };

    const handleEdit = (exp: WorkExperience) => {
        setFormData({
            ...exp
        });
        setEditingId(exp.id);
        setIsEditing(true);
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Are you sure you want to delete this experience?')) return;
        try {
            await profileRepository.deleteExperience(id);
            toast.success('Deleted successfully');
            onRefresh();
        } catch (error) {
            toast.error('Failed to delete');
        }
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!user) return;
        setSaving(true);
        try {
            const exp = {
                id: editingId || '', // Empty ID for new, handled by Repo
                company: formData.company || '',
                role: formData.role || '',
                startDate: formData.startDate || '',
                endDate: formData.endDate || '',
                isCurrent: formData.isCurrent || false,
                rawDescription: formData.rawDescription || '',
                refinedBullets: [],
            };
            const savedId = await profileRepository.saveExperience(user.id, exp);
            toast.success('Experience saved');

            // Re-polish only when the description actually changed since the
            // last normalization (hash comparison) — saves the AI call on
            // date/title-only edits.
            const text = exp.rawDescription.trim();
            const prior = experiences.find(x => x.id === savedId);
            const needsPolish = !!text && (!prior?.normalized || prior.normalizedSourceHash !== contentHash(text));
            if (needsPolish) polishInBackground(savedId, exp);

            resetForm();
            onRefresh();
        } catch (error) {
            console.error(error);
            toast.error('Failed to save experience');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h3 className="text-lg font-semibold text-charcoal-800 flex items-center gap-2">
                    <Briefcase size={20} /> Work Experience
                </h3>
                {!isEditing && (
                    <button
                        onClick={handleAddNew}
                        className="flex items-center gap-1 text-sm bg-brand-50 text-brand-600 px-3 py-1.5 rounded-lg hover:bg-brand-100 font-medium transition-colors"
                    >
                        <Plus size={16} /> Add New
                    </button>
                )}
            </div>

            {isEditing && (
                <form onSubmit={handleSave} className="bg-charcoal-50 p-4 rounded-xl border border-charcoal-200 animate-in fade-in slide-in-from-top-2">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                        <div>
                            <label className="block text-xs font-semibold text-charcoal-500 uppercase mb-1">Company / Organization</label>
                            <input
                                required
                                className={`w-full p-2 border rounded-lg ${!formData.company ? 'border-red-500 ring-1 ring-red-500' : 'border-charcoal-300'}`}
                                value={formData.company || ''}
                                onChange={e => setFormData({ ...formData, company: e.target.value })}
                                placeholder="e.g. Mayo Clinic, Acme Corp, Oakwood High School"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-charcoal-500 uppercase mb-1">Role / Job Title</label>
                            <input
                                required
                                className={`w-full p-2 border rounded-lg ${!formData.role ? 'border-red-500 ring-1 ring-red-500' : 'border-charcoal-300'}`}
                                value={formData.role || ''}
                                onChange={e => setFormData({ ...formData, role: e.target.value })}
                                placeholder="e.g. Registered Nurse, Marketing Manager, Software Engineer"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-charcoal-500 uppercase mb-1">Start Date</label>
                            <MonthPicker
                                isError={!formData.startDate}
                                value={formData.startDate || ''}
                                onChange={val => setFormData({ ...formData, startDate: val })}
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-charcoal-500 uppercase mb-1">End Date</label>
                            <div className="flex gap-2 items-center">
                                {formData.isCurrent ? (
                                    <div className="w-full rounded-md border border-charcoal-200 bg-charcoal-50 px-3 py-2 text-sm text-charcoal-500 font-medium h-10 flex items-center">
                                        Present
                                    </div>
                                ) : (
                                    <MonthPicker
                                        isError={!formData.isCurrent && !formData.endDate}
                                        value={formData.endDate || ''}
                                        onChange={val => setFormData({ ...formData, endDate: val })}
                                    />
                                )}
                                <label className="flex items-center gap-2 text-sm whitespace-nowrap">
                                    <input
                                        type="checkbox"
                                        checked={formData.isCurrent || false}
                                        onChange={e => setFormData({ ...formData, isCurrent: e.target.checked, endDate: e.target.checked ? 'Present' : '' })}
                                    />
                                    Current
                                </label>
                            </div>
                        </div>
                    </div>
                    <div className="mb-4">
                        <label className="block text-xs font-semibold text-charcoal-500 uppercase mb-1">Description (Brain dump — AI will refine)</label>
                        <textarea
                            className={`w-full p-2 border rounded-lg h-40 text-sm ${!formData.rawDescription ? 'border-red-500 ring-1 ring-red-500' : 'border-charcoal-300'}`}
                            value={formData.rawDescription || ''}
                            onChange={e => setFormData({ ...formData, rawDescription: e.target.value })}
                            placeholder={`List your main responsibilities, achievements, and outcomes — include real numbers where you have them.

Examples from different fields:
- Led a team of 5 and shipped features that cut site load time 50%.
- Managed a caseload of 20+ patients across 3 units; reduced readmissions 15%.
- Designed lesson plans for 120 students; raised state assessment scores 12%.
- Closed $1.2M in new business; grew territory pipeline 35% YoY.`}
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
                </form>
            )}

            <div className="space-y-3">
                {experiences.length === 0 && !isEditing && (
                    <p className="text-center text-charcoal-400 py-4 text-sm">No experience added yet.</p>
                )}
                {experiences.map(exp => (
                    <div key={exp.id} className="bg-white border border-charcoal-100 p-4 rounded-xl hover:shadow-sm transition-shadow group relative">
                        <div className="flex justify-between items-start">
                            <div>
                                <h4 className="font-bold text-charcoal-900">{exp.role}</h4>
                                <div className="text-brand-600 font-medium text-sm">{exp.company}</div>
                                <div className="text-charcoal-400 text-xs mt-1">
                                    {exp.startDate} - {exp.isCurrent ? 'Present' : exp.endDate}
                                </div>
                            </div>
                            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                    onClick={() => handleEdit(exp)}
                                    className="p-1.5 text-charcoal-400 hover:text-brand-600 hover:bg-brand-50 rounded-lg"
                                >
                                    <Edit2 size={16} />
                                </button>
                                <button
                                    onClick={() => handleDelete(exp.id)}
                                    className="p-1.5 text-charcoal-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                                >
                                    <Trash2 size={16} />
                                </button>
                            </div>
                        </div>
                        {exp.rawDescription && (
                            <p className="mt-3 text-sm text-charcoal-600 whitespace-pre-line line-clamp-2">
                                {exp.rawDescription}
                            </p>
                        )}

                        {/* Polished profile — AI-normalized rendering of the raw text */}
                        {polishingIds.has(exp.id) ? (
                            <div className="mt-3 flex items-center gap-2 text-xs text-charcoal-500 bg-charcoal-50 border border-charcoal-200 rounded-lg px-3 py-2">
                                <Loader2 size={13} className="animate-spin text-brand-600" />
                                Polishing this entry with AI…
                            </div>
                        ) : exp.normalized && exp.normalized.bullets.length > 0 && (
                            <div className="mt-3 bg-charcoal-50 border border-charcoal-200 rounded-lg px-3 py-2.5">
                                <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] font-semibold text-brand-600 mb-1.5">
                                    <Sparkles size={11} className="text-accent-500" /> Polished by AI — how resumes will present this
                                </p>
                                <ul className="space-y-1">
                                    {exp.normalized.bullets.map((b, i) => (
                                        <li key={i} className="text-sm text-charcoal-700 flex gap-1.5">
                                            <span className="text-charcoal-400 shrink-0">•</span>
                                            <span>{b}</span>
                                        </li>
                                    ))}
                                </ul>
                                {exp.normalized.gaps.length > 0 && (
                                    <div className="mt-2 pt-2 border-t border-charcoal-200 space-y-1">
                                        {exp.normalized.gaps.map((g, i) => (
                                            <p key={i} className="text-xs text-accent-700 flex gap-1.5 items-start">
                                                <Lightbulb size={12} className="shrink-0 mt-0.5" />
                                                <span>{g}</span>
                                            </p>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
};
