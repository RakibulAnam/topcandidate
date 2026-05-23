import React, { useState, useEffect } from 'react';
import { profileRepository } from '../../../infrastructure/config/dependencies';
import { useAuth } from '../../../infrastructure/auth/AuthContext';
import { toast } from 'sonner';
import { Code, Save, X, Plus } from 'lucide-react';

interface Props {
    skills: string[];
    onRefresh: () => void;
}

export const SkillSection = ({ skills, onRefresh }: Props) => {
    const { user } = useAuth();
    const [localSkills, setLocalSkills] = useState<string[]>(skills);
    const [newSkill, setNewSkill] = useState('');
    const [saving, setSaving] = useState(false);
    const [hasChanges, setHasChanges] = useState(false);

    useEffect(() => {
        setLocalSkills(skills);
        setHasChanges(false);
    }, [skills]);

    const addSkill = (e: React.FormEvent) => {
        e.preventDefault();
        if (newSkill.trim()) {
            setLocalSkills([...localSkills, newSkill.trim()]);
            setNewSkill('');
            setHasChanges(true);
        }
    };

    const removeSkill = (index: number) => {
        const newS = [...localSkills];
        newS.splice(index, 1);
        setLocalSkills(newS);
        setHasChanges(true);
    };

    const handleSave = async () => {
        if (!user) return;
        setSaving(true);
        try {
            await profileRepository.saveSkills(user.id, localSkills);
            toast.success('Skills saved');
            setHasChanges(false);
            onRefresh();
        } catch (e) { toast.error('Failed to save'); }
        finally { setSaving(false); }
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h3 className="text-lg font-semibold text-charcoal-800 flex items-center gap-2">
                    <Code size={20} /> Skills
                </h3>
                {hasChanges && (
                    <button onClick={handleSave} disabled={saving} className="flex items-center gap-2 text-sm bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 font-medium transition-colors shadow-sm">
                        <Save size={16} /> Save Changes
                    </button>
                )}
            </div>

            <form onSubmit={addSkill} className="flex gap-2">
                <input
                    className="flex-1 p-2 border rounded-lg"
                    value={newSkill}
                    onChange={e => setNewSkill(e.target.value)}
                    placeholder="Add a skill (e.g. Patient Care, Negotiation, Leadership, Excel, Python)"
                />
                <button type="submit" className="bg-charcoal-900 text-white px-4 rounded-lg hover:bg-black">
                    <Plus size={20} />
                </button>
            </form>

            <div className="flex flex-wrap gap-2 min-h-[100px] p-4 bg-charcoal-50 rounded-xl border border-charcoal-100">
                {localSkills.length === 0 && <span className="text-charcoal-400 italic text-sm">No skills added yet.</span>}
                {localSkills.map((skill, idx) => (
                    <span key={idx} className="inline-flex items-center gap-1 bg-white border border-charcoal-200 px-3 py-1.5 rounded-full text-sm text-charcoal-700 shadow-sm">
                        {skill}
                        <button onClick={() => removeSkill(idx)} className="text-charcoal-400 hover:text-red-500 rounded-full p-0.5 hover:bg-red-50 transition-colors">
                            <X size={14} />
                        </button>
                    </span>
                ))}
            </div>
        </div>
    );
};
