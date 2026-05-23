import React, { useState } from 'react';
import { Language, LanguageProficiency } from '../../../domain/entities/Resume';
import { profileRepository } from '../../../infrastructure/config/dependencies';
import { useAuth } from '../../../infrastructure/auth/AuthContext';
import { toast } from 'sonner';
import { Plus, Trash2, Edit2, Save, Languages } from 'lucide-react';
import { LanguagePicker } from '../ui/LanguagePicker';

const PROFICIENCIES: LanguageProficiency[] = ['Native', 'Fluent', 'Professional', 'Conversational', 'Basic'];

interface Props {
    items: Language[];
    onRefresh: () => void;
}

export const LanguageSection = ({ items, onRefresh }: Props) => {
    const { user } = useAuth();
    const [isEditing, setIsEditing] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [formData, setFormData] = useState<Partial<Language>>({});
    const [saving, setSaving] = useState(false);

    const resetForm = () => {
        setFormData({ name: '', proficiency: 'Professional' });
        setEditingId(null);
        setIsEditing(false);
    };

    const handleAddNew = () => { resetForm(); setIsEditing(true); };

    const handleEdit = (item: Language) => {
        setFormData({ ...item });
        setEditingId(item.id);
        setIsEditing(true);
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Delete this language?')) return;
        try {
            await profileRepository.deleteLanguage(id);
            toast.success('Deleted');
            onRefresh();
        } catch { toast.error('Failed to delete'); }
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!user) return;
        setSaving(true);
        try {
            await profileRepository.saveLanguage(user.id, {
                id: editingId || '',
                name: formData.name || '',
                proficiency: formData.proficiency || 'Professional',
            });
            toast.success('Language saved');
            resetForm();
            onRefresh();
        } catch { toast.error('Failed to save language'); } finally { setSaving(false); }
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h3 className="text-lg font-semibold text-charcoal-800 flex items-center gap-2"><Languages size={20} /> Languages</h3>
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
                            <label className="block text-xs font-semibold text-charcoal-500 uppercase mb-1">Language</label>
                            <LanguagePicker
                                isError={!formData.name}
                                value={formData.name || ''}
                                onChange={name => setFormData({ ...formData, name })}
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-charcoal-500 uppercase mb-1">Proficiency</label>
                            <select
                                className="w-full p-2 border border-charcoal-300 rounded-lg bg-white"
                                value={formData.proficiency || 'Professional'}
                                onChange={e => setFormData({ ...formData, proficiency: e.target.value as LanguageProficiency })}
                            >
                                {PROFICIENCIES.map(p => <option key={p} value={p}>{p}</option>)}
                            </select>
                        </div>
                    </div>
                    <div className="flex justify-end gap-2">
                        <button type="button" onClick={resetForm} className="px-4 py-2 text-charcoal-600 hover:bg-charcoal-200 rounded-lg text-sm">Cancel</button>
                        <button type="submit" disabled={saving} className="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-50 flex items-center gap-2"><Save size={16} /> Save</button>
                    </div>
                </form>
            )}

            <div className="space-y-3">
                {items.length === 0 && !isEditing && <p className="text-center text-charcoal-400 py-4 text-sm">No languages added yet.</p>}
                {items.map(item => (
                    <div key={item.id} className="bg-white border border-charcoal-100 p-4 rounded-xl hover:shadow-sm transition-shadow group relative">
                        <div className="flex justify-between items-center">
                            <div>
                                <h4 className="font-bold text-charcoal-900">{item.name}</h4>
                                <div className="text-charcoal-500 text-sm">{item.proficiency}</div>
                            </div>
                            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button onClick={() => handleEdit(item)} className="p-1.5 text-charcoal-400 hover:text-brand-600 hover:bg-brand-50 rounded-lg"><Edit2 size={16} /></button>
                                <button onClick={() => handleDelete(item.id)} className="p-1.5 text-charcoal-400 hover:text-red-600 hover:bg-red-50 rounded-lg"><Trash2 size={16} /></button>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};
