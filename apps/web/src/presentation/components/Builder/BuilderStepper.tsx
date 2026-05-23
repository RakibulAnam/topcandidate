import React from 'react';
import { Check } from 'lucide-react';
import { AppStep } from '../../../domain/entities';
import { useT } from '../../i18n/LocaleContext';

interface StepInfo {
    id: AppStep;
    title: string;
}

interface BuilderStepperProps {
    steps: StepInfo[];
    currentStep: AppStep;
}

export const BuilderStepper = ({ steps, currentStep }: BuilderStepperProps) => {
    const t = useT();
    const currentStepIndex = steps.findIndex(s => s.id === currentStep);
    const progress = steps.length > 0 ? ((currentStepIndex + 1) / steps.length) * 100 : 0;

    return (
        <div className="bg-white border-b border-charcoal-200">
            <div className="max-w-5xl mx-auto px-4 py-4">
                {/* Desktop */}
                <div className="hidden md:flex items-center justify-between relative">
                    <div className="absolute top-[14px] left-0 w-full h-px bg-charcoal-200" aria-hidden />
                    {steps.map((s, idx) => {
                        const isActive = s.id === currentStep;
                        const isCompleted = idx < currentStepIndex;
                        return (
                            <div key={s.id} className="flex flex-col items-center relative z-10 bg-white px-2">
                                <div
                                    className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold transition-colors duration-200 border ${
                                        isActive
                                            ? 'bg-accent-500 border-accent-500 text-brand-800 ring-4 ring-accent-100'
                                            : isCompleted
                                                ? 'bg-brand-700 border-brand-700 text-accent-300'
                                                : 'bg-white border-charcoal-300 text-charcoal-500'
                                    }`}
                                >
                                    {isCompleted ? <Check size={13} strokeWidth={3} /> : idx + 1}
                                </div>
                                <div
                                    className={`mt-2 text-[10px] font-semibold uppercase tracking-[0.14em] whitespace-nowrap ${
                                        isActive
                                            ? 'text-brand-700'
                                            : isCompleted
                                                ? 'text-brand-500'
                                                : 'text-charcoal-400'
                                    }`}
                                >
                                    {s.title}
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* Mobile */}
                <div className="md:hidden">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-[10px] font-semibold text-charcoal-500 uppercase tracking-[0.2em]">
                            {t('profileSetup.stepCount', { n: currentStepIndex + 1, total: steps.length })}
                        </span>
                        <span className="text-sm font-semibold text-brand-700">
                            {steps[currentStepIndex]?.title}
                        </span>
                    </div>
                    <div className="w-full h-1 bg-charcoal-200 rounded-full overflow-hidden">
                        <div
                            className="h-full bg-accent-500 transition-[width] duration-300 ease-out"
                            style={{ width: `${progress}%` }}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
};
