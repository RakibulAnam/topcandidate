// Resume Source Dialog - Modal for choosing between profile data or starting fresh

import React from 'react';
import { User, FileText, X } from 'lucide-react';
import { useT } from '../i18n/LocaleContext';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    onChooseProfile: () => void;
    onChooseFresh: () => void;
}

export const ResumeSourceDialog: React.FC<Props> = ({
    isOpen,
    onClose,
    onChooseProfile,
    onChooseFresh
}) => {
    const t = useT();
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/50 backdrop-blur-sm"
                onClick={onClose}
            />

            {/* Dialog */}
            <div className="relative bg-white rounded-2xl shadow-2xl max-w-lg w-full mx-4 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-charcoal-100">
                    <h2 className="text-xl font-bold text-charcoal-900">{t('resumeSourceDialog.title')}</h2>
                    <button
                        type="button"
                        onClick={onClose}
                        className="p-2 text-charcoal-400 hover:text-charcoal-600 hover:bg-charcoal-100 rounded-full transition-colors"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Content */}
                <div className="p-6">
                    <p className="text-charcoal-600 mb-6">
                        {t('resumeSourceDialog.subtitle')}
                    </p>

                    <div className="space-y-4">
                        {/* Option 1: From Profile */}
                        <button
                            type="button"
                            onClick={onChooseProfile}
                            className="w-full p-5 border-2 border-charcoal-200 rounded-xl hover:border-brand-500 hover:bg-brand-50/50 transition-colors text-left group"
                        >
                            <div className="flex items-start gap-4">
                                <div className="w-12 h-12 bg-brand-100 rounded-xl flex items-center justify-center text-brand-600 group-hover:bg-brand-600 group-hover:text-white transition-colors">
                                    <User size={24} />
                                </div>
                                <div className="flex-1">
                                    <h3 className="font-semibold text-charcoal-900 mb-1">{t('resumeSourceDialog.useProfileTitle')}</h3>
                                    <p className="text-sm text-charcoal-500">
                                        {t('resumeSourceDialog.useProfileBody')}
                                    </p>
                                </div>
                            </div>
                        </button>

                        {/* Option 2: Start Fresh */}
                        <button
                            type="button"
                            onClick={onChooseFresh}
                            className="w-full p-5 border-2 border-charcoal-200 rounded-xl hover:border-brand-500 hover:bg-brand-50/50 transition-colors text-left group"
                        >
                            <div className="flex items-start gap-4">
                                <div className="w-12 h-12 bg-brand-100 rounded-xl flex items-center justify-center text-brand-600 group-hover:bg-brand-600 group-hover:text-white transition-colors">
                                    <FileText size={24} />
                                </div>
                                <div className="flex-1">
                                    <h3 className="font-semibold text-charcoal-900 mb-1">{t('resumeSourceDialog.startFreshTitle')}</h3>
                                    <p className="text-sm text-charcoal-500">
                                        {t('resumeSourceDialog.startFreshBody')}
                                    </p>
                                </div>
                            </div>
                        </button>
                    </div>
                </div>

                {/* Footer */}
                <div className="p-6 pt-0">
                    <button
                        type="button"
                        onClick={onClose}
                        className="w-full py-2.5 text-charcoal-600 hover:text-charcoal-900 font-medium transition-colors"
                    >
                        {t('resumeSourceDialog.cancel')}
                    </button>
                </div>
            </div>
        </div>
    );
};
