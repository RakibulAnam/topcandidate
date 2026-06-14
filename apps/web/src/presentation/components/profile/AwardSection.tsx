import React, { useState } from 'react';
import { Award } from '../../../domain/entities/Resume';
import { profileRepository } from '../../../infrastructure/config/dependencies';
import { useAuth } from '../../../infrastructure/auth/AuthContext';
import { toast } from 'sonner';
import { Plus, Trash2, Edit2, Save, X, Award as AwardIcon } from 'lucide-react';
import { MonthPicker } from '../ui/month-picker';
import { needsPolish, polishInBackground, PolishedPreview, fieldsEqual, tryConsumeRenorm } from './polish';
import { GuidedModeField } from './GuidedModeField';
import { assembleGuided, guidedRequiredFilled, GUIDED_VERSION, uiText } from './guidedQuestions';
import { useLocale } from '../../i18n/LocaleContext';

const AWARD_FIELDS = ['title', 'issuer', 'date', 'description', 'inputMode', 'guided'];

interface Props {
    items: Award[];
    onRefresh: () => void;
}

export const AwardSection = ({ items, onRefresh }: Props) => {
    const { user } = useAuth();
    const { locale } = useLocale();
    const [isEditing, setIsEditing] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [formData, setFormData] = useState<Partial<Award>>({});
    const [saving, setSaving] = useState(false);
    const [polishingIds, setPolishingIds] = useState<Set<string>>(new Set());
    const markPolishing = (id: string, on: boolean) =>
        setPolishingIds(prev => {
            const next = new Set(prev);
            if (on) next.add(id); else next.delete(id);
            return next;
        });

    const resetForm = () => {
        setFormData({ title: '', issuer: '', date: '', description: '', inputMode: 'guided', guided: {} });
        setEditingId(null);
        setIsEditing(false);
    };

    const handleAddNew = () => { resetForm(); setIsEditing(true); };

    const handleEdit = (item: Award) => {
        setFormData({ ...item });
        setEditingId(item.id);
        setIsEditing(true);
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Are you sure you want to delete this award?')) return;
        try {
            await profileRepository.deleteAward(id);
            toast.success('Deleted successfully');
            onRefresh();
        } catch (error) { toast.error('Failed to delete'); }
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!user) return;

        const mode = formData.inputMode ?? 'guided';
        const answers = formData.guided ?? {};
        const description = mode === 'guided'
            ? assembleGuided('award', answers)
            : (formData.description || '');

        if (mode === 'guided' && !guidedRequiredFilled('award', answers)) {
            toast.error(uiText('answerFirst', locale));
            return;
        }
        // Awards: the description is optional in free mode (title + issuer carry
        // it), so no free-mode block — assembling an empty block is fine.

        setSaving(true);
        try {
            const award: Award = {
                id: editingId || '',
                title: formData.title || '',
                issuer: formData.issuer || '',
                date: formData.date || '',
                description,
                inputMode: mode,
                guided: answers,
                guidedVersion: mode === 'guided' ? GUIDED_VERSION : formData.guidedVersion,
            };
            const savedId = await profileRepository.saveAward(user.id, award);
            toast.success('Award saved');

            if (description.trim() && needsPolish(description, items.find(x => x.id === savedId))) {
                if (tryConsumeRenorm('award')) {
                    polishInBackground({
                        text: description,
                        context: { kind: 'award', title: award.title, organization: award.issuer, guided: mode === 'guided' },
                        persist: (n, h) => profileRepository.saveAwardNormalized(savedId, n, h),
                        onStart: () => markPolishing(savedId, true),
                        onSettle: () => markPolishing(savedId, false),
                        onDone: onRefresh,
                    });
                } else {
                    toast(uiText('capReached', locale));
                }
            }

            resetForm();
            onRefresh();
        } catch (error) { toast.error('Failed to save award'); } finally { setSaving(false); }
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h3 className="text-lg font-semibold text-charcoal-800 flex items-center gap-2"><AwardIcon size={20} /> Awards</h3>
                {!isEditing && (
                    <button onClick={handleAddNew} className="flex items-center gap-1 text-sm bg-brand-50 text-brand-600 px-3 py-1.5 rounded-lg hover:bg-brand-100 font-medium transition-colors">
                        <Plus size={16} /> Add New
                    </button>
                )}
            </div>

            {isEditing && (
                <form onSubmit={handleSave} className="bg-charcoal-50 p-4 rounded-xl border border-charcoal-200 animate-in fade-in slide-in-from-top-2">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                        <div>
                            <label className="block text-xs font-semibold text-charcoal-500 uppercase mb-1">Title</label>
                            <input required className={`w-full p-2 border rounded-lg ${!formData.title ? 'border-red-500 ring-1 ring-red-500' : 'border-charcoal-300'}`} value={formData.title || ''} onChange={e => setFormData({ ...formData, title: e.target.value })} placeholder="e.g. Employee of the Month" />
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-charcoal-500 uppercase mb-1">Issuer</label>
                            <input required className={`w-full p-2 border rounded-lg ${!formData.issuer ? 'border-red-500 ring-1 ring-red-500' : 'border-charcoal-300'}`} value={formData.issuer || ''} onChange={e => setFormData({ ...formData, issuer: e.target.value })} placeholder="e.g. Acme Corp, Dhaka University" />
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-charcoal-500 uppercase mb-1">Date</label>
                            <MonthPicker isError={!formData.date} value={formData.date || ''} onChange={val => setFormData({ ...formData, date: val })} />
                        </div>
                    </div>
                    <div className="mb-4">
                        <GuidedModeField
                            section="award"
                            mode={formData.inputMode ?? 'guided'}
                            answers={formData.guided ?? {}}
                            freeText={formData.description ?? ''}
                            freePlaceholder="e.g. Recognized for outstanding sales performance, chosen out of 200 staff."
                            onModeChange={m => setFormData({ ...formData, inputMode: m })}
                            onAnswersChange={a => setFormData({ ...formData, guided: a })}
                            onFreeTextChange={t => setFormData({ ...formData, description: t })}
                        />
                    </div>
                    <div className="flex justify-end gap-2">
                        {editingId && fieldsEqual(formData as Record<string, unknown>, items.find(x => x.id === editingId) as Record<string, unknown> | undefined, AWARD_FIELDS) ? (
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
                {items.length === 0 && !isEditing && <p className="text-center text-charcoal-400 py-4 text-sm">No awards added yet.</p>}
                {items.map(item => (
                    <div key={item.id} className="bg-white border border-charcoal-100 p-4 rounded-xl hover:shadow-sm transition-shadow group relative">
                        <div className="flex justify-between items-start">
                            <div>
                                <h4 className="font-bold text-charcoal-900">{item.title}</h4>
                                <div className="text-brand-600 font-medium text-sm">{item.issuer}</div>
                                <div className="text-charcoal-400 text-xs mt-1">{item.date}</div>
                            </div>
                            <div className="flex gap-1 shrink-0">
                                <button type="button" onClick={() => handleEdit(item)} aria-label="Edit award" className="p-1.5 text-charcoal-500 hover:text-brand-600 hover:bg-brand-50 rounded-lg"><Edit2 size={16} /></button>
                                <button type="button" onClick={() => handleDelete(item.id)} aria-label="Delete award" className="p-1.5 text-charcoal-500 hover:text-red-600 hover:bg-red-50 rounded-lg"><Trash2 size={16} /></button>
                            </div>
                        </div>
                        {item.description && <p className="mt-2 text-sm text-charcoal-600 whitespace-pre-line">{item.description}</p>}
                        <PolishedPreview normalized={item.normalized} polishing={polishingIds.has(item.id)} sourceText={item.description} sourceHash={item.normalizedSourceHash} />
                    </div>
                ))}
            </div>
        </div>
    );
};
