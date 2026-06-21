import React, { useState, useRef } from 'react';
import { Upload, FileText, Loader2, AlertCircle } from 'lucide-react';
import { resumeExtractor } from '../../../infrastructure/config/dependencies';
import { ExtractedProfileData } from '../../../domain/usecases/ExtractResumeUseCase';
import { extractTextFromPdf, MIN_TEXT_LENGTH } from '../../utils/pdfText';
import { toast } from 'sonner';

// pdf.js reads the file in-browser; for text-based PDFs we send only the
// extracted text (a few KB), so the file size barely matters — keep a generous
// ceiling. The smaller cap applies ONLY to the scanned-PDF fallback that must
// send the raw file over the wire (Vercel rejects request bodies > 4.5MB, and
// base64 inflates ×1.333, so ~3.3MB raw is the real limit there).
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_FALLBACK_BYTES = 3 * 1024 * 1024;

const readAsBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(',')[1] ?? '');
        reader.onerror = () => reject(new Error('Failed to read file.'));
        reader.readAsDataURL(file);
    });

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

        if (file.size > MAX_FILE_BYTES) {
            toast.error('This file is too large (max 10 MB). Try a smaller PDF, or skip and fill in your profile manually.');
            return;
        }

        setIsProcessing(true);

        try {
            // 1) Try to pull selectable text out of the PDF in the browser.
            //    Normal (text-based) resumes send only this text — a few KB —
            //    so the request never approaches the server body limit.
            let mode: 'text' | 'file' = 'text';
            let payload = '';
            try {
                const { text } = await extractTextFromPdf(file);
                if (text.length >= MIN_TEXT_LENGTH) {
                    payload = text;
                } else {
                    mode = 'file'; // little/no text layer → likely scanned/image
                }
            } catch (err) {
                console.error('In-browser PDF text extraction failed:', err);
                mode = 'file'; // unreadable text layer → fall back to native read
            }

            // 2) Scanned/image fallback: send the raw file for Gemini's native
            //    multimodal read. This path is bounded by the Vercel body limit.
            if (mode === 'file') {
                if (file.size > MAX_FALLBACK_BYTES) {
                    toast.error("We couldn't read this PDF's text (it may be scanned or image-based), and it's too large to process as an image (max 3 MB). Try a text-based PDF or a smaller file, or skip and fill in your profile manually.");
                    setIsProcessing(false);
                    return;
                }
                payload = await readAsBase64(file);
            }

            const extractedData = await resumeExtractor.extract(
                payload,
                mode === 'text' ? 'text/plain' : file.type,
            );

            // If almost nothing came back, the PDF was likely a scanned image
            // (no selectable text) — guide the user rather than dropping them
            // into an empty form with a "success" toast.
            const gotSomething =
                !!extractedData.experience?.length ||
                !!extractedData.education?.length ||
                !!extractedData.skills?.length ||
                !!extractedData.projects?.length ||
                !!extractedData.personalInfo?.fullName;
            if (!gotSomething) {
                toast.error("We couldn't read much from this PDF — it may be a scanned image. Try a text-based PDF, or skip and fill in your profile manually.");
                setIsProcessing(false);
                return;
            }

            toast.success('Resume analyzed successfully!');
            onExtracted(extractedData);
        } catch (error) {
            console.error('Parsing error:', error);
            toast.error(error instanceof Error ? error.message : "We couldn't analyze this resume. Try a text-based PDF, or skip and fill in your profile manually.");
            setIsProcessing(false);
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
                                <p className="text-sm text-charcoal-500 mt-1">or click to browse · max 10 MB</p>
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
                    <span className="font-semibold">Privacy:</span> your file is sent securely to
                    our AI provider only to extract its contents. It is not stored anywhere after
                    analysis.
                </p>
            </div>
        </div>
    );
};
