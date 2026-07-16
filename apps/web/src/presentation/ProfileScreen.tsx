import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '../infrastructure/auth/AuthContext';
import { profileRepository, createResumeService } from '../infrastructure/config/dependencies';
import { computeProfileHash } from '../application/validation/profileHash';
import {
    PersonalInfo, WorkExperience, Education, Project,
    Extracurricular, Award, Certification, Affiliation, Publication,
    Language, Reference, UserType
} from '../domain/entities/Resume';
import { toast } from 'sonner';
import { Loader2, Save, Trash2, AlertTriangle, Sparkles, ChevronRight, RefreshCw } from 'lucide-react';
import { ExperienceSection } from './components/profile/ExperienceSection';
import { ProjectSection } from './components/profile/ProjectSection';
import { EducationSection } from './components/profile/EducationSection';
import { SkillSection } from './components/profile/SkillSection';
import { ExtracurricularSection } from './components/profile/ExtracurricularSection';
import { AwardSection } from './components/profile/AwardSection';
import { CertificationSection } from './components/profile/CertificationSection';
import { AffiliationSection } from './components/profile/AffiliationSection';
import { PublicationSection } from './components/profile/PublicationSection';
import { LanguageSection } from './components/profile/LanguageSection';
import { ReferenceSection } from './components/profile/ReferenceSection';
import { PhoneInput, isValidPhone } from './components/ui/PhoneInput';
import { useT } from './i18n/LocaleContext';

type TabId =
    | 'Personal' | 'Experience' | 'Projects' | 'Education' | 'Skills'
    | 'Activities' | 'Awards' | 'Certifications' | 'Affiliations'
    | 'Publications' | 'Languages' | 'References';

const TAB_IDS: TabId[] = [
    'Personal', 'Experience', 'Projects', 'Education', 'Skills',
    'Activities', 'Awards', 'Certifications', 'Affiliations',
    'Publications', 'Languages', 'References',
];

const TAB_KEYS: Record<TabId, 'profile.tabPersonal'> = {
    Personal: 'profile.tabPersonal',
    Experience: 'profile.tabExperience' as 'profile.tabPersonal',
    Projects: 'profile.tabProjects' as 'profile.tabPersonal',
    Education: 'profile.tabEducation' as 'profile.tabPersonal',
    Skills: 'profile.tabSkills' as 'profile.tabPersonal',
    Activities: 'profile.tabActivities' as 'profile.tabPersonal',
    Awards: 'profile.tabAwards' as 'profile.tabPersonal',
    Certifications: 'profile.tabCertifications' as 'profile.tabPersonal',
    Affiliations: 'profile.tabAffiliations' as 'profile.tabPersonal',
    Publications: 'profile.tabPublications' as 'profile.tabPersonal',
    Languages: 'profile.tabLanguages' as 'profile.tabPersonal',
    References: 'profile.tabReferences' as 'profile.tabPersonal',
};

export const ProfileScreen = () => {
    const { user, signOut } = useAuth();
    const t = useT();
    const [activeTab, setActiveTab] = useState<TabId>('Personal');
    // Keep the selected tab scrolled into view on the mobile tab rail.
    const activeTabRef = useRef<HTMLButtonElement>(null);
    useEffect(() => {
        activeTabRef.current?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
    }, [activeTab]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    // Deletion states
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [deleting, setDeleting] = useState(false);

    // State for each section
    const [personalInfo, setPersonalInfo] = useState<PersonalInfo>({ fullName: '', email: '', phone: '', location: '' });
    const [userType, setUserType] = useState<UserType | undefined>();
    const [experiences, setExperiences] = useState<WorkExperience[]>([]);
    const [educations, setEducations] = useState<Education[]>([]);
    const [projects, setProjects] = useState<Project[]>([]);
    const [skills, setSkills] = useState<string[]>([]);
    const [extracurriculars, setExtracurriculars] = useState<Extracurricular[]>([]);
    const [awards, setAwards] = useState<Award[]>([]);
    const [certifications, setCertifications] = useState<Certification[]>([]);
    const [affiliations, setAffiliations] = useState<Affiliation[]>([]);
    const [publications, setPublications] = useState<Publication[]>([]);
    const [languages, setLanguages] = useState<Language[]>([]);
    const [references, setReferences] = useState<Reference[]>([]);

    // General resume state: null = none yet; else the existing resume's id, the
    // profile-hash it was built from, and its 24h-cooldown status.
    const [generalResume, setGeneralResume] = useState<{ id: string; storedHash?: string } | null>(null);
    const [generalChecked, setGeneralChecked] = useState(false);
    const [generatingGeneral, setGeneratingGeneral] = useState(false);
    const [regeneratingGeneral, setRegeneratingGeneral] = useState(false);

    // Hash of the profile AS SAVED — set on load and after each successful save,
    // never from live edit state. Compared against the hash the general resume
    // was generated from so the regenerate nudge reflects *saved* changes and
    // doesn't flicker while the user is mid-edit in the Personal tab.
    const [savedProfileHash, setSavedProfileHash] = useState('');

    const computeSavedHash = () => computeProfileHash({
        personalInfo, experiences, projects, educations, skills, extracurriculars,
        awards, certifications, affiliations, publications, languages, references,
    });

    const generalResumeStale = !!generalResume && !!savedProfileHash && generalResume.storedHash !== savedProfileHash;

    useEffect(() => {
        if (user?.id) {
            loadProfileData();
        }
    }, [user?.id]);

    const loadProfileData = async () => {
        // Only show full page loader if we haven't loaded anything yet
        if (!personalInfo.email) {
            setLoading(true);
        }

        try {
            if (!user) return;

            const [pInfo, uType, exps, edus, projs, skls, extras, awds, certs, affs, pubs, langs, refs] = await Promise.all([
                profileRepository.getProfile(user.id),
                profileRepository.getUserType(user.id),
                profileRepository.getExperiences(user.id),
                profileRepository.getEducations(user.id),
                profileRepository.getProjects(user.id),
                profileRepository.getSkills(user.id),
                profileRepository.getExtracurriculars(user.id),
                profileRepository.getAwards(user.id),
                profileRepository.getCertifications(user.id),
                profileRepository.getAffiliations(user.id),
                profileRepository.getPublications(user.id),
                profileRepository.getLanguages(user.id),
                profileRepository.getReferences(user.id),
            ]);

            if (pInfo) setPersonalInfo(pInfo);
            if (uType) setUserType(uType);
            setExperiences(exps);
            setEducations(edus);
            setProjects(projs);
            setSkills(skls);
            setExtracurriculars(extras);
            setAwards(awds);
            setCertifications(certs);
            setAffiliations(affs);
            setPublications(pubs);
            setLanguages(langs);
            setReferences(refs);

            // Snapshot the persisted profile so staleness compares against saved
            // data. personalInfo default mirrors the service's general-resume path
            // so the hashes align exactly (see ResumeService.profileHashOf).
            setSavedProfileHash(computeProfileHash({
                personalInfo: pInfo ?? { fullName: '', email: '', phone: '', location: '' },
                experiences: exps, projects: projs, educations: edus, skills: skls,
                extracurriculars: extras, awards: awds, certifications: certs,
                affiliations: affs, publications: pubs, languages: langs, references: refs,
            }));

        } catch (error) {
            console.error(error);
            toast.error(t('common.profileLoadFailed'));
        } finally {
            setLoading(false);
        }
    };

    // Load the general resume's id + the profile-hash it was built from (to
    // detect staleness) and its cooldown status.
    useEffect(() => {
        const check = async () => {
            if (!user) return;
            try {
                const service = createResumeService();
                const info = await service.getGeneralResumeInfo(user.id);
                if (!info) { setGeneralResume(null); return; }
                const data = await service.getGeneratedResume(info.id);
                setGeneralResume({ id: info.id, storedHash: data?.sourceProfileHash });
            } catch {
                // Silently fail — leave state as-is (banner stays hidden).
            } finally {
                setGeneralChecked(true);
            }
        };
        check();
    }, [user]);

    const handleGenerateGeneralResume = async () => {
        if (!user) return;
        setGeneratingGeneral(true);
        try {
            const service = createResumeService();
            const id = await service.generateGeneralResume(user.id);
            setGeneralResume({ id, storedHash: savedProfileHash });
            toast.success(t('profile.generalResumeReady'));
        } catch (error) {
            console.error('General resume generation failed:', error);
            const message = error instanceof Error ? error.message : t('profile.generalResumeFailed');
            toast.error(message);
        } finally {
            setGeneratingGeneral(false);
        }
    };

    const handleRegenerateGeneralResume = async () => {
        if (!user || !generalResume) return;
        setRegeneratingGeneral(true);
        try {
            const service = createResumeService();
            await service.regenerateGeneralResume(user.id, generalResume.id);
            setGeneralResume({ ...generalResume, storedHash: savedProfileHash });
            toast.success(t('profile.regenSuccess'));
        } catch (error) {
            console.error('General resume regeneration failed:', error);
            const message = error instanceof Error ? error.message : t('profile.generalResumeFailed');
            toast.error(message);
        } finally {
            setRegeneratingGeneral(false);
        }
    };

    const handleSavePersonal = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!user) return;
        // Phone is required (recruiters call) and must parse as a valid
        // international number — otherwise downstream resume renders would emit
        // a broken `tel:` link.
        if (!(personalInfo.phone || '').trim()) {
            toast.error(t('profileSetup.valPhoneRequired'));
            return;
        }
        if (!isValidPhone(personalInfo.phone)) {
            toast.error(t('builder.errPhoneInvalid'));
            return;
        }
        setSaving(true);
        try {
            await profileRepository.saveProfile(user.id, personalInfo);
            // Refresh the saved snapshot so the regenerate nudge appears now that
            // the persisted profile differs from the general resume.
            setSavedProfileHash(computeSavedHash());
            toast.success(t('profile.savedSuccess'));
        } catch (error) {
            toast.error(t('profile.saveError'));
        } finally {
            setSaving(false);
        }
    };

    const handleDeleteAccount = async () => {
        if (!user) return;
        setDeleting(true);
        try {
            await profileRepository.deleteProfile(user.id);
            toast.success(t('profile.deletedSuccess'));
            await signOut();
        } catch (error) {
            console.error('Failed to delete account', error);
            toast.error(t('profile.deleteError'));
            setDeleting(false);
        }
    };

    if (loading) {
        return <div className="flex justify-center p-10"><Loader2 className="animate-spin" /></div>;
    }

    return (
        <div className="max-w-6xl mx-auto p-4 md:p-8">
            <h1 className="mb-2 font-display text-3xl font-semibold text-brand-700 sm:text-4xl">{t('profile.pageTitle')}</h1>
            <p className="text-charcoal-500 mb-6">
                {t('profile.pageSubtitle')}
            </p>

            {/* No content to generate from — a resume/toolkit needs at least one
                education or experience entry. Shown instead of the generate CTA,
                since generation would just fail. */}
            {experiences.length === 0 && educations.length === 0 && (
                <div className="mb-6 bg-accent-50 border border-accent-200 rounded-xl p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                    <div className="flex items-start gap-3">
                        <div className="w-10 h-10 bg-accent-500 rounded-lg flex items-center justify-center text-white flex-shrink-0 mt-0.5">
                            <AlertTriangle size={20} />
                        </div>
                        <div>
                            <h3 className="font-display text-lg font-semibold text-brand-700">{t('profile.noContentWarnTitle')}</h3>
                            <p className="text-sm text-charcoal-600 mt-0.5">
                                {t('profile.noContentWarnBody')}
                            </p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={() => setActiveTab('Education')}
                        className="flex items-center gap-2 px-5 py-2.5 bg-accent-500 text-white rounded-lg font-medium hover:bg-accent-600 transition-colors shadow-sm flex-shrink-0"
                    >
                        {t('profile.noContentWarnCta')}
                        <ChevronRight size={18} />
                    </button>
                </div>
            )}

            {/* General Resume — offer to generate (none yet) once there's content. */}
            {generalChecked && !generalResume && (experiences.length > 0 || educations.length > 0) && (
                <div className="mb-6 bg-brand-50 border border-brand-200 rounded-xl p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                    <div className="flex items-start gap-3">
                        <div className="w-10 h-10 bg-brand-600 rounded-lg flex items-center justify-center text-white flex-shrink-0 mt-0.5">
                            <Sparkles size={20} />
                        </div>
                        <div>
                            <h3 className="font-display text-lg font-semibold text-brand-700">{t('profile.bannerTitle')}</h3>
                            <p className="text-sm text-charcoal-500 mt-0.5">
                                {t('profile.bannerBody')}
                            </p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={handleGenerateGeneralResume}
                        disabled={generatingGeneral}
                        className="flex items-center justify-center gap-2 px-5 py-2.5 bg-brand-600 text-white rounded-lg font-medium hover:bg-brand-700 transition-colors shadow-sm disabled:opacity-60 disabled:cursor-not-allowed flex-shrink-0 w-full sm:w-auto"
                    >
                        {generatingGeneral ? (
                            <>
                                <Loader2 className="animate-spin" size={18} />
                                {t('profile.bannerGenerating')}
                            </>
                        ) : (
                            <>
                                <Sparkles size={18} />
                                {t('profile.bannerCta')}
                            </>
                        )}
                    </button>
                </div>
            )}

            {/* General Resume — profile changed since it was generated: nudge to regenerate. */}
            {generalChecked && generalResume && generalResumeStale && (
                <div className="mb-6 bg-accent-50 border border-accent-200 rounded-xl p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                    <div className="flex items-start gap-3">
                        <div className="w-10 h-10 bg-accent-500 rounded-lg flex items-center justify-center text-white flex-shrink-0 mt-0.5">
                            <RefreshCw size={18} />
                        </div>
                        <div>
                            <h3 className="font-display text-lg font-semibold text-brand-700">{t('profile.regenTitle')}</h3>
                            <p className="text-sm text-charcoal-600 mt-0.5">{t('profile.regenBody')}</p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={handleRegenerateGeneralResume}
                        disabled={regeneratingGeneral}
                        className="flex items-center justify-center gap-2 px-5 py-2.5 bg-brand-600 text-white rounded-lg font-medium hover:bg-brand-700 transition-colors shadow-sm disabled:opacity-60 disabled:cursor-not-allowed flex-shrink-0 w-full sm:w-auto"
                    >
                        {regeneratingGeneral ? (
                            <>
                                <Loader2 className="animate-spin" size={18} />
                                {t('profile.regenerating')}
                            </>
                        ) : (
                            <>
                                <RefreshCw size={18} />
                                {t('profile.regenCta')}
                            </>
                        )}
                    </button>
                </div>
            )}

            {/* Tab rail with right-edge fade hint so users can tell on mobile there's more (audit). */}
            <div className="relative mb-8 border-b border-charcoal-200">
                <div className="flex gap-2 overflow-x-auto pb-1 pr-8 md:pr-0 scrollbar-hide" role="tablist">
                    {TAB_IDS.map(tab => (
                        <button
                            key={tab}
                            ref={activeTab === tab ? activeTabRef : undefined}
                            type="button"
                            role="tab"
                            aria-selected={activeTab === tab}
                            onClick={() => setActiveTab(tab)}
                            className={`inline-flex items-center px-4 py-3 min-h-11 font-medium text-sm transition-colors whitespace-nowrap flex-shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 focus-visible:ring-offset-2 rounded-sm ${activeTab === tab
                                ? 'text-brand-600 border-b-2 border-brand-600'
                                : 'text-charcoal-500 hover:text-charcoal-700'
                                }`}
                        >
                            {t(TAB_KEYS[tab])}
                        </button>
                    ))}
                </div>
                {/* Right-edge scroll hint on mobile (chevron only — gradients are off-brand per CLAUDE.md). */}
                <div className="pointer-events-none absolute top-1.5 right-0 h-7 w-7 flex items-center justify-end pr-1 text-charcoal-400 md:hidden bg-charcoal-50" aria-hidden="true">
                    <ChevronRight size={14} />
                </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-charcoal-100 p-6">
                {activeTab === 'Personal' && (
                    <form onSubmit={handleSavePersonal} className="space-y-4 animate-in fade-in">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-charcoal-700 mb-1">{t('profile.fieldFullName')}</label>
                                <input
                                    type="text"
                                    value={personalInfo.fullName}
                                    onChange={e => setPersonalInfo({ ...personalInfo, fullName: e.target.value })}
                                    className="w-full rounded-xl border border-charcoal-200 px-3.5 py-2.5 text-brand-700 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent-400"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-charcoal-700 mb-1">{t('profile.fieldEmail')}</label>
                                <input
                                    type="email"
                                    value={personalInfo.email}
                                    disabled
                                    className="w-full p-2 border rounded-lg bg-charcoal-100 text-charcoal-500"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-charcoal-700 mb-1">{t('profile.fieldPhone')} <span className="text-accent-500">*</span></label>
                                <PhoneInput
                                    value={personalInfo.phone}
                                    onChange={v => setPersonalInfo({ ...personalInfo, phone: v })}
                                    invalidMessage={t('builder.errPhoneInvalid')}
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-charcoal-700 mb-1">{t('profile.fieldLocation')}</label>
                                <input
                                    type="text"
                                    value={personalInfo.location}
                                    onChange={e => setPersonalInfo({ ...personalInfo, location: e.target.value })}
                                    className="w-full rounded-xl border border-charcoal-200 px-3.5 py-2.5 text-brand-700 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent-400"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-charcoal-700 mb-1">{t('profile.fieldLinkedin')}</label>
                                <input
                                    type="text"
                                    value={personalInfo.linkedin || ''}
                                    onChange={e => setPersonalInfo({ ...personalInfo, linkedin: e.target.value })}
                                    className="w-full rounded-xl border border-charcoal-200 px-3.5 py-2.5 text-brand-700 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent-400"
                                    placeholder={t('profile.placeholderLinkedin')}
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-charcoal-700 mb-1">{t('profile.fieldGithub')}</label>
                                <input
                                    type="text"
                                    value={personalInfo.github || ''}
                                    onChange={e => setPersonalInfo({ ...personalInfo, github: e.target.value })}
                                    className="w-full rounded-xl border border-charcoal-200 px-3.5 py-2.5 text-brand-700 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent-400"
                                    placeholder={t('profile.placeholderGithub')}
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-charcoal-700 mb-1">{t('profile.fieldWebsite')}</label>
                                <input
                                    type="text"
                                    value={personalInfo.website || ''}
                                    onChange={e => setPersonalInfo({ ...personalInfo, website: e.target.value })}
                                    className="w-full rounded-xl border border-charcoal-200 px-3.5 py-2.5 text-brand-700 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent-400"
                                    placeholder={t('profile.placeholderWebsite')}
                                />
                            </div>
                        </div>
                        <div className="flex justify-end pt-4">
                            <button
                                type="submit"
                                disabled={saving || deleting}
                                className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-brand-700 px-6 py-3 min-h-11 font-semibold text-charcoal-50 transition-colors hover:bg-brand-800 disabled:opacity-50 sm:w-auto"
                            >
                                {saving ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
                                {t('profile.saveCta')}
                            </button>
                        </div>
                    </form>
                )}

                {activeTab === 'Personal' && (
                    <div className="mt-12 pt-8 border-t border-red-100">
                        <h3 className="text-lg font-semibold text-red-600 mb-2">{t('profile.dangerHeader')}</h3>
                        <p className="text-charcoal-500 mb-4 text-sm">
                            {t('profile.dangerBody')}
                        </p>

                        {!showDeleteConfirm ? (
                            <button
                                onClick={() => setShowDeleteConfirm(true)}
                                type="button"
                                className="px-4 py-2 border border-red-200 text-red-600 rounded-lg hover:bg-red-50 text-sm font-medium transition-colors"
                            >
                                {t('profile.deleteCta')}
                            </button>
                        ) : (
                            <div className="bg-red-50 p-4 rounded-lg border border-red-200 animate-in fade-in slide-in-from-top-2">
                                <div className="flex items-start gap-3">
                                    <AlertTriangle className="text-red-500 mt-0.5" size={20} />
                                    <div>
                                        <h4 className="font-medium text-red-800">{t('profile.deleteConfirmTitle')}</h4>
                                        <p className="text-red-600 text-sm mt-1 mb-4">
                                            {t('profile.deleteConfirmBody')}
                                        </p>
                                        <div className="flex gap-3">
                                            <button
                                                onClick={() => setShowDeleteConfirm(false)}
                                                disabled={deleting}
                                                type="button"
                                                className="px-4 py-2 bg-white border border-charcoal-300 text-charcoal-700 rounded-lg hover:bg-charcoal-50 text-sm font-medium transition-colors disabled:opacity-50"
                                            >
                                                {t('profile.cancelCta')}
                                            </button>
                                            <button
                                                onClick={handleDeleteAccount}
                                                disabled={deleting}
                                                type="button"
                                                className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm font-medium transition-colors disabled:opacity-50"
                                            >
                                                {deleting ? <Loader2 className="animate-spin" size={16} /> : <Trash2 size={16} />}
                                                {t('profile.confirmDeleteCta')}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {activeTab === 'Experience' && <ExperienceSection experiences={experiences} onRefresh={loadProfileData} />}
                {activeTab === 'Projects' && <ProjectSection projects={projects} onRefresh={loadProfileData} />}
                {activeTab === 'Education' && <EducationSection educations={educations} onRefresh={loadProfileData} />}
                {activeTab === 'Skills' && <SkillSection skills={skills} onRefresh={loadProfileData} />}
                {activeTab === 'Activities' && <ExtracurricularSection items={extracurriculars} onRefresh={loadProfileData} />}
                {activeTab === 'Awards' && <AwardSection items={awards} onRefresh={loadProfileData} />}
                {activeTab === 'Certifications' && <CertificationSection items={certifications} onRefresh={loadProfileData} />}
                {activeTab === 'Affiliations' && <AffiliationSection items={affiliations} onRefresh={loadProfileData} />}
                {activeTab === 'Publications' && <PublicationSection items={publications} onRefresh={loadProfileData} />}
                {activeTab === 'Languages' && <LanguageSection items={languages} onRefresh={loadProfileData} />}
                {activeTab === 'References' && <ReferenceSection items={references} onRefresh={loadProfileData} />}
            </div>
        </div>
    );
};
