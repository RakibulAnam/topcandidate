import React, { useState } from 'react';
import { Affiliation } from '../../../domain/entities/Resume';
import { profileRepository } from '../../../infrastructure/config/dependencies';
import { useAuth } from '../../../infrastructure/auth/AuthContext';
import { toast } from 'sonner';
import { Plus, Trash2, Edit2, Save, Users } from 'lucide-react';
import { MonthPicker } from '../ui/month-picker';

interface Props {
    items: Affiliation[];
    onRefresh: () => void;
}

export const AffiliationSection = ({ items, onRefresh }: Props) => {
    const { user } = useAuth();
    const [isEditing, setIsEditing] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [formData, setFormData] = useState<Partial<Affiliation>>({});
    const [saving, setSaving] = useState(false);

    const resetForm = () => {
        setFormData({ organization: '', role: '', startDate: '', endDate: '' });
        setEditingId(null);
        setIsEditing(false);
    };

    const handleAddNew = () => { resetForm(); setIsEditing(true); };

    const handleEdit = (item: Affiliation) => {
        setFormData({ ...item });
        setEditingId(item.id);
        setIsEditing(true);
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Are you sure you want to delete this affiliation?')) return;
        try {
            await profileRepository.deleteAffiliation(id);
            toast.success('Deleted successfully');
            onRefresh();
        } catch (error) { toast.error('Failed to delete'); }
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!user) return;
        setSaving(true);
        try {
            await profileRepository.saveAffiliation(user.id, {
                id: editingId || '',
                organization: formData.organization || '',
                role: formData.role || '',
                startDate: formData.startDate || '',
                endDate: formData.endDate || '',
            });
            toast.success('Affiliation saved');
            resetForm();
            onRefresh();
        } catch (error) { toast.error('Failed to save affiliation'); } finally { setSaving(false); }
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h3 className="text-lg font-semibold text-charcoal-800 flex items-center gap-2"><Users size={20} /> Affiliations</h3>
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
                            <label className="block text-xs font-semibold text-charcoal-500 uppercase mb-1">Organization</label>
                            <input required className={`w-full p-2 border rounded-lg ${!formData.organization ? 'border-red-500 ring-1 ring-red-500' : 'border-charcoal-300'}`} value={formData.organization || ''} onChange={e => setFormData({ ...formData, organization: e.target.value })} placeholder="e.g. IEEE" />
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-charcoal-500 uppercase mb-1">Role</label>
                            <input required className={`w-full p-2 border rounded-lg ${!formData.role ? 'border-red-500 ring-1 ring-red-500' : 'border-charcoal-300'}`} value={formData.role || ''} onChange={e => setFormData({ ...formData, role: e.target.value })} placeholder="e.g. Student Member" />
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
                    <div className="flex justify-end gap-2">
                        <button type="button" onClick={resetForm} className="px-4 py-2 text-charcoal-600 hover:bg-charcoal-200 rounded-lg text-sm">Cancel</button>
                        <button type="submit" disabled={saving} className="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-50 flex items-center gap-2"><Save size={16} /> Save</button>
                    </div>
                </form>
            )}

            <div className="space-y-3">
                {items.length === 0 && !isEditing && <p className="text-center text-charcoal-400 py-4 text-sm">No affiliations added yet.</p>}
                {items.map(item => (
                    <div key={item.id} className="bg-white border border-charcoal-100 p-4 rounded-xl hover:shadow-sm transition-shadow group relative">
                        <div className="flex justify-between items-start">
                            <div>
                                <h4 className="font-bold text-charcoal-900">{item.organization}</h4>
                                <div className="text-brand-600 font-medium text-sm">{item.role}</div>
                                <div className="text-charcoal-400 text-xs mt-1">{item.startDate} - {item.endDate}</div>
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
