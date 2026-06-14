import React, { useState } from 'react';
import { Extracurricular } from '../../../domain/entities/Resume';
import { profileRepository } from '../../../infrastructure/config/dependencies';
import { useAuth } from '../../../infrastructure/auth/AuthContext';
import { toast } from 'sonner';
import { Plus, Trash2, Edit2, Save, X, Users } from 'lucide-react';
import { MonthPicker } from '../ui/month-picker';
import { needsPolish, polishInBackground, PolishedPreview, fieldsEqual, tryConsumeRenorm } from './polish';
import { GuidedModeField } from './GuidedModeField';
import { assembleGuided, guidedRequiredFilled, GUIDED_VERSION } from './guidedQuestions';

const EXTRACURRICULAR_FIELDS = ['organization', 'title', 'description', 'startDate', 'endDate', 'inputMode', 'guided'];

interface Props {
    items: Extracurricular[];
    onRefresh: () => void;
}

export const ExtracurricularSection = ({ items, onRefresh }: Props) => {
    const { user } = useAuth();
    const [isEditing, setIsEditing] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [formData, setFormData] = useState<Partial<Extracurricular>>({});
    const [saving, setSaving] = useState(false);
    const [polishingIds, setPolishingIds] = useState<Set<string>>(new Set());
    const markPolishing = (id: string, on: boolean) =>
        setPolishingIds(prev => {
            const next = new Set(prev);
            if (on) next.add(id); else next.delete(id);
            return next;
        });

    const resetForm = () => {
        setFormData({
            organization: '',
            title: '',
            description: '',
            startDate: '',
            endDate: '',
            inputMode: 'guided',
            guided: {},
        });
        setEditingId(null);
        setIsEditing(false);
    };

    const handleAddNew = () => {
        resetForm();
        setIsEditing(true);
    };

    const handleEdit = (item: Extracurricular) => {
        setFormData({ ...item });
        setEditingId(item.id);
        setIsEditing(true);
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Are you sure you want to delete this activity?')) return;
        try {
            await profileRepository.deleteExtracurricular(id);
            toast.success('Deleted successfully');
            onRefresh();
        } catch (error) {
            toast.error('Failed to delete');
        }
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!user) return;

        const mode = formData.inputMode ?? 'guided';
        const answers = formData.guided ?? {};
        const description = mode === 'guided'
            ? assembleGuided('extracurricular', answers)
            : (formData.description || '');

        if (mode === 'guided' && !guidedRequiredFilled('extracurricular', answers)) {
            toast.error('Please answer the first question.');
            return;
        }
        if (mode === 'free' && !description.trim()) {
            toast.error('Please add a short description.');
            return;
        }

        setSaving(true);
        try {
            const item: Extracurricular = {
                id: editingId || '',
                organization: formData.organization || '',
                title: formData.title || '',
                description,
                startDate: formData.startDate || '',
                endDate: formData.endDate || '',
                refinedBullets: [],
                inputMode: mode,
                guided: answers,
                guidedVersion: mode === 'guided' ? GUIDED_VERSION : formData.guidedVersion,
            };
            const savedId = await profileRepository.saveExtracurricular(user.id, item);
            toast.success('Activity saved');

            if (needsPolish(item.description, items.find(x => x.id === savedId))) {
                if (tryConsumeRenorm('extracurricular')) {
                    polishInBackground({
                        text: item.description,
                        context: { kind: 'extracurricular', title: item.title, organization: item.organization, guided: mode === 'guided' },
                        persist: (n, h) => profileRepository.saveExtracurricularNormalized(savedId, n, h),
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
        } catch (error) {
            console.error(error);
            toast.error('Failed to save activity');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h3 className="text-lg font-semibold text-charcoal-800 flex items-center gap-2">
                    <Users size={20} /> Extracurricular Activities
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
                            <label className="block text-xs font-semibold text-charcoal-500 uppercase mb-1">Organization</label>
                            <input required className={`w-full p-2 border rounded-lg ${!formData.organization ? 'border-red-500 ring-1 ring-red-500' : 'border-charcoal-300'}`} value={formData.organization || ''} onChange={e => setFormData({ ...formData, organization: e.target.value })} placeholder="e.g. University Debate Club" />
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-charcoal-500 uppercase mb-1">Role/Title</label>
                            <input required className={`w-full p-2 border rounded-lg ${!formData.title ? 'border-red-500 ring-1 ring-red-500' : 'border-charcoal-300'}`} value={formData.title || ''} onChange={e => setFormData({ ...formData, title: e.target.value })} placeholder="e.g. Team Captain" />
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-charcoal-500 uppercase mb-1">Start Date</label>
                            <MonthPicker isError={!formData.startDate} value={formData.startDate || ''} onChange={val => setFormData({ ...formData, startDate: val })} />
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-charcoal-500 uppercase mb-1">End Date</label>
                            <MonthPicker isError={!formData.endDate} value={formData.endDate || ''} onChange={val => setFormData({ ...formData, endDate: val })} />
                        </div>
                    </div>
                    <div className="mb-4">
                        <GuidedModeField
                            section="extracurricular"
                            mode={formData.inputMode ?? 'guided'}
                            answers={formData.guided ?? {}}
                            freeText={formData.description ?? ''}
                            freePlaceholder="e.g. Organized regional tournaments and mentored junior members."
                            onModeChange={m => setFormData({ ...formData, inputMode: m })}
                            onAnswersChange={a => setFormData({ ...formData, guided: a })}
                            onFreeTextChange={t => setFormData({ ...formData, description: t })}
                        />
                    </div>
                    <div className="flex justify-end gap-2">
                        {editingId && fieldsEqual(formData as Record<string, unknown>, items.find(x => x.id === editingId) as Record<string, unknown> | undefined, EXTRACURRICULAR_FIELDS) ? (
                            <button type="button" onClick={resetForm} className="px-4 py-2 bg-charcoal-200 text-charcoal-700 rounded-lg text-sm font-medium hover:bg-charcoal-300 flex items-center gap-2"><X size={16} /> Close</button>
                        ) : (
                            <>
                                <button type="button" onClick={resetForm} className="px-4 py-2 text-charcoal-600 hover:bg-charcoal-200 rounded-lg text-sm">Cancel</button>
                                <button type="submit" disabled={saving} className="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-50 flex items-center gap-2"><Save size={16} /> Save</button>
                            </>
                        )}
                    </div>
                </form>
            )}

            <div className="space-y-3">
                {items.length === 0 && !isEditing && <p className="text-center text-charcoal-400 py-4 text-sm">No extracurriculars added yet.</p>}
                {items.map(item => (
                    <div key={item.id} className="bg-white border border-charcoal-100 p-4 rounded-xl hover:shadow-sm transition-shadow group relative">
                        <div className="flex justify-between items-start">
                            <div>
                                <h4 className="font-bold text-charcoal-900">{item.title}</h4>
                                <div className="text-brand-600 font-medium text-sm">{item.organization}</div>
                            </div>
                            <div className="flex gap-1 shrink-0">
                                <button type="button" onClick={() => handleEdit(item)} aria-label="Edit activity" className="p-1.5 text-charcoal-500 hover:text-brand-600 hover:bg-brand-50 rounded-lg"><Edit2 size={16} /></button>
                                <button type="button" onClick={() => handleDelete(item.id)} aria-label="Delete activity" className="p-1.5 text-charcoal-500 hover:text-red-600 hover:bg-red-50 rounded-lg"><Trash2 size={16} /></button>
                            </div>
                        </div>
                        {item.description && <p className="mt-2 text-sm text-charcoal-600 whitespace-pre-line">{item.description}</p>}
                        <PolishedPreview normalized={item.normalized} polishing={polishingIds.has(item.id)} />
                    </div>
                ))}
            </div>
        </div>
    );
};
