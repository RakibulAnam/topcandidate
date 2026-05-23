import React, { useState, useRef } from 'react';
import { Upload, FileText, Loader2, AlertCircle } from 'lucide-react';
import { resumeExtractor } from '../../../infrastructure/config/dependencies';
import { ExtractedProfileData } from '../../../domain/usecases/ExtractResumeUseCase';
import { toast } from 'sonner';

interface Props {
    onExtracted: (data: ExtractedProfileData) => void;
    onSkip: () => void;
}

export const ResumeUploadStep: React.FC<Props> = ({ onExtracted, onSkip }) => {
    const [isDragging, setIsDragging] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(true);
    };

    const handleDragLeave = () => {
        setIsDragging(false);
    };

    const processFile = async (file: File) => {
        if (file.type !== 'application/pdf') {
            toast.error('Please upload a PDF file.');
            return;
        }

        if (file.size > 5 * 1024 * 1024) { // 5MB limit
            toast.error('File size must be less than 5MB.');
            return;
        }

        setIsProcessing(true);

        try {
            // Convert file to base64
            const reader = new FileReader();
            reader.readAsDataURL(file);

            reader.onload = async () => {
                try {
                    const base64String = reader.result as string;
                    // Extract just the base64 part, removing the data... prefix
                    const base64Data = base64String.split(',')[1];

                    const extractedData = await resumeExtractor.extract(base64Data, file.type);
                    toast.success('Resume analyzed successfully!');
                    onExtracted(extractedData);
                } catch (error) {
                    console.error('Parsing error:', error);
                    toast.error(error instanceof Error ? error.message : 'Failed to analyze resume.');
                    setIsProcessing(false);
                }
            };

            reader.onerror = () => {
                toast.error('Failed to read file.');
                setIsProcessing(false);
            };

        } catch (error) {
            console.error('Unexpected error:', error);
            setIsProcessing(false);
            toast.error('An unexpected error occurred.');
        }
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);

        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            processFile(e.dataTransfer.files[0]);
        }
    };

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            processFile(e.target.files[0]);
        }
    };

    return (
        <div className="max-w-xl mx-auto space-y-7">
            <div className="text-center">
                <p className="text-[11px] uppercase tracking-[0.22em] text-accent-600 font-semibold mb-3">
                    Quick start · optional
                </p>
                <h2 className="font-display text-3xl font-semibold text-brand-700 leading-tight mb-3">
                    Got a resume already? Import it.
                </h2>
                <p className="text-brand-500 leading-relaxed">
                    Drop your existing PDF and we'll prefill your profile. You can review and
                    edit every field in the next steps — nothing goes live automatically.
                </p>
            </div>

            <div
                className={`relative border-2 border-dashed rounded-2xl p-8 transition-colors duration-200 ${
                    isDragging
                        ? 'border-accent-400 bg-accent-50/60'
                        : isProcessing
                            ? 'border-charcoal-200 bg-charcoal-50'
                            : 'border-charcoal-300 bg-white hover:border-accent-300 hover:bg-accent-50/30'
                }`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
            >
                <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileSelect}
                    accept="application/pdf"
                    className="hidden"
                    disabled={isProcessing}
                />

                <div className="flex flex-col items-center justify-center text-center space-y-4">
                    {isProcessing ? (
                        <>
                            <div className="w-14 h-14 bg-charcoal-100 rounded-full flex items-center justify-center">
                                <Loader2 className="w-6 h-6 text-brand-700 animate-spin" />
                            </div>
                            <div>
                                <h3 className="text-base font-semibold text-brand-700">Analyzing your resume</h3>
                                <p className="text-sm text-charcoal-500 mt-1">
                                    Extracting your work history, skills, and education.
                                </p>
                            </div>
                        </>
                    ) : (
                        <>
                            <div className="w-14 h-14 bg-accent-50 border border-accent-100 rounded-full flex items-center justify-center">
                                <Upload className="w-6 h-6 text-accent-600" />
                            </div>
                            <div>
                                <h3 className="text-base font-semibold text-brand-700">Drop your PDF here</h3>
                                <p className="text-sm text-charcoal-500 mt-1">or click to browse · max 5 MB</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => fileInputRef.current?.click()}
                                className="mt-2 inline-flex items-center gap-2 px-5 py-2.5 bg-brand-700 text-charcoal-50 rounded-full text-sm font-semibold hover:bg-brand-800 transition-colors"
                            >
                                <FileText size={14} />
                                Choose file
                            </button>
                        </>
                    )}
                </div>
            </div>

            <div className="flex items-center justify-center gap-4 text-xs uppercase tracking-[0.2em] text-charcoal-500 font-semibold">
                <div className="h-px bg-charcoal-200 flex-1" />
                <span>or</span>
                <div className="h-px bg-charcoal-200 flex-1" />
            </div>

            <button
                type="button"
                onClick={onSkip}
                disabled={isProcessing}
                className="w-full py-3 px-4 border border-charcoal-300 text-brand-700 bg-white rounded-full font-semibold text-sm hover:border-brand-700 hover:bg-charcoal-50 transition-colors disabled:opacity-50"
            >
                Start from scratch
            </button>

            <div className="bg-charcoal-100 border border-charcoal-200 p-4 rounded-xl flex items-start gap-3">
                <AlertCircle className="text-brand-500 shrink-0 mt-0.5" size={16} />
                <p className="text-xs text-brand-600 leading-relaxed">
                    <span className="font-semibold">Privacy:</span> your file is read in the
                    browser and only the extracted text is sent to our AI provider. The PDF
                    itself is not stored anywhere.
                </p>
            </div>
        </div>
    );
};
