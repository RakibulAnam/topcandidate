import React, { useEffect, useState } from 'react';
import { useAuth } from '../infrastructure/auth/AuthContext';
import { profileRepository, createResumeService } from '../infrastructure/config/dependencies';
import {
    PersonalInfo, WorkExperience, Education, Project,
    Extracurricular, Award, Certification, Affiliation, Publication,
    Language, Reference, UserType
} from '../domain/entities/Resume';
import { toast } from 'sonner';
import { Loader2, Save, Trash2, AlertTriangle, Sparkles } from 'lucide-react';
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

    // General resume states
    const [hasGeneralResume, setHasGeneralResume] = useState(true); // default true to hide banner until checked
    const [generatingGeneral, setGeneratingGeneral] = useState(false);

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

        } catch (error) {
            console.error(error);
            toast.error(t('common.profileLoadFailed'));
        } finally {
            setLoading(false);
        }
    };

    // Check if general resume exists
    useEffect(() => {
        const checkGeneralResume = async () => {
            if (!user) return;
            try {
                const service = createResumeService();
                const exists = await service.hasGeneralResume(user.id);
                setHasGeneralResume(exists);
            } catch {
                // Silently fail, keep banner hidden
            }
        };
        checkGeneralResume();
    }, [user]);

    const handleGenerateGeneralResume = async () => {
        if (!user) return;
        setGeneratingGeneral(true);
        try {
            const service = createResumeService();
            await service.generateGeneralResume(user.id);
            setHasGeneralResume(true);
            toast.success(t('profile.generalResumeReady'));
        } catch (error) {
            console.error('General resume generation failed:', error);
            const message = error instanceof Error ? error.message : t('profile.generalResumeFailed');
            toast.error(message);
        } finally {
            setGeneratingGeneral(false);
        }
    };

    const handleSavePersonal = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!user) return;
        // Phone is optional on the profile, but if filled it must parse as a
        // valid international number — otherwise downstream resume renders
        // will emit a broken `tel:` link.
        if (personalInfo.phone && !isValidPhone(personalInfo.phone)) {
            toast.error(t('builder.errPhoneInvalid'));
            return;
        }
        setSaving(true);
        try {
            await profileRepository.saveProfile(user.id, personalInfo);
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
            <h1 className="text-3xl font-bold mb-2 text-charcoal-900">{t('profile.pageTitle')}</h1>
            <p className="text-charcoal-500 mb-6">
                {t('profile.pageSubtitle')}
            </p>

            {/* General Resume Banner */}
            {!hasGeneralResume && (
                <div className="mb-6 bg-gradient-to-r from-brand-50 to-brand-100/60 border border-brand-200 rounded-xl p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                    <div className="flex items-start gap-3">
                        <div className="w-10 h-10 bg-brand-600 rounded-lg flex items-center justify-center text-white flex-shrink-0 mt-0.5">
                            <Sparkles size={20} />
                        </div>
                        <div>
                            <h3 className="font-bold text-charcoal-900">{t('profile.bannerTitle')}</h3>
                            <p className="text-sm text-charcoal-500 mt-0.5">
                                {t('profile.bannerBody')}
                            </p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={handleGenerateGeneralResume}
                        disabled={generatingGeneral}
                        className="flex items-center gap-2 px-5 py-2.5 bg-brand-600 text-white rounded-lg font-medium hover:bg-brand-700 transition-colors shadow-sm disabled:opacity-60 disabled:cursor-not-allowed flex-shrink-0"
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

            <div className="flex gap-2 overflow-x-auto mb-8 border-b border-charcoal-200 pb-1 scrollbar-hide">
                {TAB_IDS.map(tab => (
                    <button
                        key={tab}
                        type="button"
                        onClick={() => setActiveTab(tab)}
                        className={`px-4 py-2 font-medium text-sm transition-colors whitespace-nowrap flex-shrink-0 ${activeTab === tab
                            ? 'text-brand-600 border-b-2 border-brand-600'
                            : 'text-charcoal-500 hover:text-charcoal-700'
                            }`}
                    >
                        {t(TAB_KEYS[tab])}
                    </button>
                ))}
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
                                    className="w-full p-2 border rounded-lg focus-visible:ring-2 focus-visible:ring-brand-500"
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
                                <label className="block text-sm font-medium text-charcoal-700 mb-1">{t('profile.fieldPhone')}</label>
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
                                    className="w-full p-2 border rounded-lg focus-visible:ring-2 focus-visible:ring-brand-500"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-charcoal-700 mb-1">{t('profile.fieldLinkedin')}</label>
                                <input
                                    type="text"
                                    value={personalInfo.linkedin || ''}
                                    onChange={e => setPersonalInfo({ ...personalInfo, linkedin: e.target.value })}
                                    className="w-full p-2 border rounded-lg focus-visible:ring-2 focus-visible:ring-brand-500"
                                    placeholder={t('profile.placeholderLinkedin')}
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-charcoal-700 mb-1">{t('profile.fieldGithub')}</label>
                                <input
                                    type="text"
                                    value={personalInfo.github || ''}
                                    onChange={e => setPersonalInfo({ ...personalInfo, github: e.target.value })}
                                    className="w-full p-2 border rounded-lg focus-visible:ring-2 focus-visible:ring-brand-500"
                                    placeholder={t('profile.placeholderGithub')}
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-charcoal-700 mb-1">{t('profile.fieldWebsite')}</label>
                                <input
                                    type="text"
                                    value={personalInfo.website || ''}
                                    onChange={e => setPersonalInfo({ ...personalInfo, website: e.target.value })}
                                    className="w-full p-2 border rounded-lg focus-visible:ring-2 focus-visible:ring-brand-500"
                                    placeholder={t('profile.placeholderWebsite')}
                                />
                            </div>
                        </div>
                        <div className="flex justify-end pt-4">
                            <button
                                type="submit"
                                disabled={saving || deleting}
                                className="flex items-center gap-2 bg-brand-600 text-white px-6 py-2 rounded-lg font-medium hover:bg-brand-700 disabled:opacity-50"
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
