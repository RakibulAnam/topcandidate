import React, { useState } from 'react';
import { Reference } from '../../../domain/entities/Resume';
import { profileRepository } from '../../../infrastructure/config/dependencies';
import { useAuth } from '../../../infrastructure/auth/AuthContext';
import { toast } from 'sonner';
import { Plus, Trash2, Edit2, Save, Users } from 'lucide-react';
import { EmailInput, isValidEmail } from '../ui/EmailInput';
import { PhoneInput, isValidPhone } from '../ui/PhoneInput';

interface Props {
    items: Reference[];
    onRefresh: () => void;
}

export const ReferenceSection = ({ items, onRefresh }: Props) => {
    const { user } = useAuth();
    const [isEditing, setIsEditing] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [formData, setFormData] = useState<Partial<Reference>>({});
    const [saving, setSaving] = useState(false);

    const resetForm = () => {
        setFormData({ name: '', position: '', organization: '', email: '', phone: '', relationship: '' });
        setEditingId(null);
        setIsEditing(false);
    };

    const handleAddNew = () => { resetForm(); setIsEditing(true); };

    const handleEdit = (item: Reference) => {
        setFormData({ ...item });
        setEditingId(item.id);
        setIsEditing(true);
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Delete this reference?')) return;
        try {
            await profileRepository.deleteReference(id);
            toast.success('Deleted');
            onRefresh();
        } catch { toast.error('Failed to delete'); }
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!user) return;
        if (!isValidEmail(formData.email || '')) {
            toast.error('Please enter a valid email address.');
            return;
        }
        if (!isValidPhone(formData.phone || '')) {
            toast.error('Please enter a valid phone number.');
            return;
        }
        setSaving(true);
        try {
            await profileRepository.saveReference(user.id, {
                id: editingId || '',
                name: formData.name || '',
                position: formData.position || '',
                organization: formData.organization || '',
                email: formData.email || '',
                phone: formData.phone || '',
                relationship: formData.relationship || '',
            });
            toast.success('Reference saved');
            resetForm();
            onRefresh();
        } catch { toast.error('Failed to save reference'); } finally { setSaving(false); }
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h3 className="text-lg font-semibold text-charcoal-800 flex items-center gap-2"><Users size={20} /> References</h3>
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
                            <label className="block text-xs font-semibold text-charcoal-500 uppercase mb-1">Full Name</label>
                            <input required className={`w-full p-2 border rounded-lg ${!formData.name ? 'border-red-500 ring-1 ring-red-500' : 'border-charcoal-300'}`} value={formData.name || ''} onChange={e => setFormData({ ...formData, name: e.target.value })} placeholder="e.g. Dr. Aminul Islam" />
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-charcoal-500 uppercase mb-1">Position / Title</label>
                            <input required className={`w-full p-2 border rounded-lg ${!formData.position ? 'border-red-500 ring-1 ring-red-500' : 'border-charcoal-300'}`} value={formData.position || ''} onChange={e => setFormData({ ...formData, position: e.target.value })} placeholder="e.g. Head of Engineering" />
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-charcoal-500 uppercase mb-1">Organization</label>
                            <input required className={`w-full p-2 border rounded-lg ${!formData.organization ? 'border-red-500 ring-1 ring-red-500' : 'border-charcoal-300'}`} value={formData.organization || ''} onChange={e => setFormData({ ...formData, organization: e.target.value })} placeholder="e.g. Grameenphone Ltd." />
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-charcoal-500 uppercase mb-1">Email</label>
                            <EmailInput
                                value={formData.email || ''}
                                onChange={v => setFormData({ ...formData, email: v })}
                                placeholder="e.g. a.islam@company.com"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-charcoal-500 uppercase mb-1">Phone</label>
                            <PhoneInput
                                value={formData.phone || ''}
                                onChange={v => setFormData({ ...formData, phone: v })}
                                placeholder="e.g. 1711-000000"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-charcoal-500 uppercase mb-1">Relationship (Optional)</label>
                            <input className="w-full p-2 border border-charcoal-300 rounded-lg" value={formData.relationship || ''} onChange={e => setFormData({ ...formData, relationship: e.target.value })} placeholder="e.g. Direct manager at Northwind, 2022–2024" />
                        </div>
                    </div>
                    <div className="flex justify-end gap-2">
                        <button type="button" onClick={resetForm} className="px-4 py-2 text-charcoal-600 hover:bg-charcoal-200 rounded-lg text-sm">Cancel</button>
                        <button type="submit" disabled={saving} className="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-50 flex items-center gap-2"><Save size={16} /> Save</button>
                    </div>
                </form>
            )}

            <div className="space-y-3">
                {items.length === 0 && !isEditing && <p className="text-center text-charcoal-400 py-4 text-sm">No references added yet.</p>}
                {items.map(item => (
                    <div key={item.id} className="bg-white border border-charcoal-100 p-4 rounded-xl hover:shadow-sm transition-shadow group relative">
                        <div className="flex justify-between items-start">
                            <div>
                                <h4 className="font-bold text-charcoal-900">{item.name}</h4>
                                <div className="text-brand-600 font-medium text-sm">{item.position}</div>
                                <div className="text-charcoal-500 text-sm">{item.organization}</div>
                                <div className="text-charcoal-400 text-xs mt-1">{item.email} · {item.phone}</div>
                                {item.relationship && <div className="text-charcoal-400 text-xs mt-0.5">{item.relationship}</div>}
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
