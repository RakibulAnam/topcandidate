// SectionAddDrawer — the inline "+ Add" slide-out on the Summary screen.
//
// The profile is the single source of truth: this writes straight to it via
// profileRepository (no resume-local copy → no duplication). Narrative sections
// (experience/project/extracurricular/award) also fire the same AI-refine path
// the profile editors use (polishInBackground → saveXNormalized), which caches
// the result by a content hash so it's never re-processed unless the text
// changes. Light brain-dump input by design.
import React, { useState } from 'react';
import { Sparkles, Loader2, Check, X } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../../../infrastructure/auth/AuthContext';
import { profileRepository } from '../../../infrastructure/config/dependencies';
import type { LanguageProficiency } from '../../../domain/entities';
import { useT } from '../../i18n/LocaleContext';
import { needsPolish, polishInBackground } from '../profile/polish';

type FieldType = 'text' | 'textarea' | 'select';
interface FieldDef { name: string; labelKey: string; type: FieldType; required?: boolean; options?: string[]; placeholderKey?: string }

const SECTION_FIELDS: Record<string, FieldDef[]> = {
  experience: [
    { name: 'company', labelKey: 'drawer.fCompany', type: 'text', required: true },
    { name: 'role', labelKey: 'drawer.fRole', type: 'text', required: true },
    { name: 'startDate', labelKey: 'drawer.fStart', type: 'text' },
    { name: 'endDate', labelKey: 'drawer.fEnd', type: 'text' },
    { name: 'description', labelKey: 'drawer.fDescription', type: 'textarea', placeholderKey: 'drawer.descPlaceholder' },
  ],
  education: [
    { name: 'school', labelKey: 'drawer.fSchool', type: 'text', required: true },
    { name: 'degree', labelKey: 'drawer.fDegree', type: 'text', required: true },
    { name: 'field', labelKey: 'drawer.fField', type: 'text' },
    { name: 'endDate', labelKey: 'drawer.fEnd', type: 'text' },
  ],
  skills: [
    { name: 'skills', labelKey: 'drawer.fSkills', type: 'textarea', required: true, placeholderKey: 'drawer.skillsHint' },
  ],
  projects: [
    { name: 'name', labelKey: 'drawer.fName', type: 'text', required: true },
    { name: 'technologies', labelKey: 'drawer.fTech', type: 'text' },
    { name: 'description', labelKey: 'drawer.fDescription', type: 'textarea', placeholderKey: 'drawer.descPlaceholder' },
  ],
  extracurriculars: [
    { name: 'title', labelKey: 'drawer.fTitle', type: 'text', required: true },
    { name: 'organization', labelKey: 'drawer.fOrganization', type: 'text' },
    { name: 'description', labelKey: 'drawer.fDescription', type: 'textarea', placeholderKey: 'drawer.descPlaceholder' },
  ],
  awards: [
    { name: 'title', labelKey: 'drawer.fTitle', type: 'text', required: true },
    { name: 'issuer', labelKey: 'drawer.fIssuer', type: 'text' },
    { name: 'date', labelKey: 'drawer.fDate', type: 'text' },
    { name: 'description', labelKey: 'drawer.fDescription', type: 'textarea', placeholderKey: 'drawer.descPlaceholder' },
  ],
  certifications: [
    { name: 'name', labelKey: 'drawer.fName', type: 'text', required: true },
    { name: 'issuer', labelKey: 'drawer.fIssuer', type: 'text' },
    { name: 'date', labelKey: 'drawer.fDate', type: 'text' },
  ],
  affiliations: [
    { name: 'organization', labelKey: 'drawer.fOrganization', type: 'text', required: true },
    { name: 'role', labelKey: 'drawer.fRole', type: 'text' },
    { name: 'startDate', labelKey: 'drawer.fStart', type: 'text' },
    { name: 'endDate', labelKey: 'drawer.fEnd', type: 'text' },
  ],
  publications: [
    { name: 'title', labelKey: 'drawer.fTitle', type: 'text', required: true },
    { name: 'publisher', labelKey: 'drawer.fPublisher', type: 'text' },
    { name: 'date', labelKey: 'drawer.fDate', type: 'text' },
  ],
  languages: [
    { name: 'name', labelKey: 'drawer.fName', type: 'text', required: true },
    { name: 'proficiency', labelKey: 'drawer.fProficiency', type: 'select', options: ['Native', 'Fluent', 'Professional', 'Conversational', 'Basic'] },
  ],
  references: [
    { name: 'name', labelKey: 'drawer.fName', type: 'text', required: true },
    { name: 'position', labelKey: 'drawer.fPosition', type: 'text' },
    { name: 'organization', labelKey: 'drawer.fOrganization', type: 'text' },
    { name: 'email', labelKey: 'drawer.fEmail', type: 'text' },
    { name: 'phone', labelKey: 'drawer.fPhone', type: 'text' },
  ],
};

const newId = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `tmp-${Date.now()}`);

async function saveSection(sectionKey: string, userId: string, v: Record<string, string>): Promise<void> {
  const id = newId();
  switch (sectionKey) {
    case 'experience': {
      const savedId = await profileRepository.saveExperience(userId, { id, company: v.company, role: v.role, startDate: v.startDate || '', endDate: v.endDate || '', isCurrent: false, rawDescription: v.description || '', refinedBullets: [] });
      if (v.description && needsPolish(v.description)) polishInBackground({ text: v.description, context: { kind: 'experience', title: v.role, organization: v.company }, persist: (n, h) => profileRepository.saveExperienceNormalized(savedId, n, h) });
      return;
    }
    case 'projects': {
      const savedId = await profileRepository.saveProject(userId, { id, name: v.name, rawDescription: v.description || '', refinedBullets: [], technologies: v.technologies || '' });
      if (v.description && needsPolish(v.description)) polishInBackground({ text: v.description, context: { kind: 'project', title: v.name, technologies: v.technologies }, persist: (n, h) => profileRepository.saveProjectNormalized(savedId, n, h) });
      return;
    }
    case 'extracurriculars': {
      const savedId = await profileRepository.saveExtracurricular(userId, { id, title: v.title, organization: v.organization || '', startDate: '', endDate: '', description: v.description || '', refinedBullets: [] });
      if (v.description && needsPolish(v.description)) polishInBackground({ text: v.description, context: { kind: 'extracurricular', title: v.title, organization: v.organization }, persist: (n, h) => profileRepository.saveExtracurricularNormalized(savedId, n, h) });
      return;
    }
    case 'awards': {
      const savedId = await profileRepository.saveAward(userId, { id, title: v.title, issuer: v.issuer || '', date: v.date || '', description: v.description || '' });
      if (v.description && needsPolish(v.description)) polishInBackground({ text: v.description, context: { kind: 'award', title: v.title, organization: v.issuer }, persist: (n, h) => profileRepository.saveAwardNormalized(savedId, n, h) });
      return;
    }
    case 'education':
      return profileRepository.saveEducation(userId, { id, school: v.school, degree: v.degree, field: v.field || '', endDate: v.endDate || '' });
    case 'skills':
      return profileRepository.saveSkills(userId, (v.skills || '').split(/[,\n]/).map(s => s.trim()).filter(Boolean));
    case 'certifications':
      return profileRepository.saveCertification(userId, { id, name: v.name, issuer: v.issuer || '', date: v.date || '' });
    case 'affiliations':
      return profileRepository.saveAffiliation(userId, { id, organization: v.organization, role: v.role || '', startDate: v.startDate || '', endDate: v.endDate || '' });
    case 'publications':
      return profileRepository.savePublication(userId, { id, title: v.title, publisher: v.publisher || '', date: v.date || '' });
    case 'languages':
      return profileRepository.saveLanguage(userId, { id, name: v.name, proficiency: (v.proficiency || 'Fluent') as LanguageProficiency });
    case 'references':
      return profileRepository.saveReference(userId, { id, name: v.name, position: v.position || '', organization: v.organization || '', email: v.email || '', phone: v.phone || '' });
  }
}

interface Props {
  sectionKey: string;
  sectionLabel: string;
  onClose: () => void;
  onSaved: (sectionKey: string) => void;
}

export const SectionAddDrawer = ({ sectionKey, sectionLabel, onClose, onSaved }: Props) => {
  const { user } = useAuth();
  const t = useT();
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const fields = SECTION_FIELDS[sectionKey] ?? [];
  const hasNarrative = fields.some(f => f.name === 'description');

  const set = (name: string, val: string) => setValues(prev => ({ ...prev, [name]: val }));

  const handleSave = async () => {
    if (!user || saving) return;
    const missing = fields.find(f => f.required && !(values[f.name] || '').trim());
    if (missing) { toast.message(t('drawer.requiredHint', { field: t(missing.labelKey as any) })); return; }
    setSaving(true);
    try {
      await saveSection(sectionKey, user.id, values);
      toast.success(t('drawer.saved'));
      onSaved(sectionKey);
    } catch (err) {
      console.error('section add failed', err);
      toast.error(t('drawer.saveFailed'));
      setSaving(false);
    }
  };

  const inputCls = 'w-full rounded-[10px] border border-charcoal-300 bg-white px-3.5 py-2.5 text-sm text-brand-700 outline-none transition-colors focus-visible:border-accent-400 focus-visible:ring-2 focus-visible:ring-accent-400/40 placeholder:text-charcoal-400';

  return (
    <>
      <div className="fixed inset-0 z-[90] bg-[rgba(25,23,18,0.4)] backdrop-blur-[3px]" onClick={onClose} aria-hidden />
      <aside
        className="fixed inset-y-0 right-0 z-[91] flex w-[min(480px,100%)] flex-col bg-white shadow-[-24px_0_60px_-20px_rgba(25,23,18,0.4)]"
        role="dialog"
        aria-modal="true"
      >
        <div className="border-b border-[#F0EBDF] px-6 py-5">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-[0.14em] text-accent-600">{t('drawer.eyebrow')}</span>
            <button type="button" onClick={onClose} className="text-charcoal-400 transition-colors hover:text-brand-700"><X size={18} /></button>
          </div>
          <h3 className="font-display text-xl font-semibold text-brand-700">{t('drawer.addTitle', { section: sectionLabel })}</h3>
          <p className="mt-1.5 text-[13px] leading-relaxed text-charcoal-500">{t('drawer.intro')}</p>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {fields.map(f => (
            <div key={f.name} className="mb-4">
              <label className="mb-1.5 block text-[12.5px] font-semibold text-brand-700">
                {t(f.labelKey as any)}{!f.required && <span className="ml-1 font-normal text-charcoal-400">({t('drawer.optional')})</span>}
              </label>
              {f.type === 'textarea' ? (
                <textarea
                  value={values[f.name] || ''}
                  onChange={(e) => set(f.name, e.target.value)}
                  placeholder={f.placeholderKey ? t(f.placeholderKey as any) : ''}
                  className={`${inputCls} min-h-[110px] resize-y leading-relaxed`}
                />
              ) : f.type === 'select' ? (
                <select value={values[f.name] || (f.options?.[1] ?? '')} onChange={(e) => set(f.name, e.target.value)} className={inputCls}>
                  {f.options?.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <input
                  type="text"
                  value={values[f.name] || ''}
                  onChange={(e) => set(f.name, e.target.value)}
                  placeholder={f.placeholderKey ? t(f.placeholderKey as any) : ''}
                  className={inputCls}
                />
              )}
            </div>
          ))}

          {hasNarrative && (
            <div className="mt-1 flex gap-2.5 rounded-xl border border-[#F2E4C6] bg-accent-50 px-3.5 py-3 text-[12.5px] leading-relaxed text-[#7A5A16]">
              <Sparkles size={16} className="mt-px shrink-0 text-accent-600" />
              <span>{t('drawer.aiHint')}</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 border-t border-[#F0EBDF] px-6 py-4">
          <button type="button" onClick={onClose} className="text-[13.5px] font-semibold text-charcoal-500 transition-colors hover:text-brand-700">{t('drawer.cancel')}</button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="ml-auto inline-flex items-center gap-2 rounded-[10px] bg-brand-700 px-5 py-2.5 text-[13.5px] font-semibold text-charcoal-50 transition-colors hover:bg-brand-800 disabled:opacity-60"
          >
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
            {saving ? t('drawer.saving') : t('drawer.save')}
          </button>
        </div>
      </aside>
    </>
  );
};
