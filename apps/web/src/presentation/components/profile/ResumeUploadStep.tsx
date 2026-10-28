import React, { useState, useRef } from 'react';
import { Upload, FileText, Loader2, AlertCircle, PenLine } from 'lucide-react';
import { ResumeWritingHero } from './ResumeWritingHero';
import { useT } from '../../i18n/LocaleContext';
import { resumeExtractor } from '../../../infrastructure/config/dependencies';
import { ExtractedProfileData } from '../../../domain/usecases/ExtractResumeUseCase';
import { extractTextFromPdf, MIN_TEXT_LENGTH } from '../../utils/pdfText';
import { toast } from 'sonner';
import { track } from '../../../infrastructure/analytics/track';

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
    /** Name from sign-up, for the greeting. */
    fullName?: string;
    /** Profile completeness so far (LiveSheet's sheetPercent). */
    percent: number;
}

export const ResumeUploadStep: React.FC<Props> = ({ onExtracted, onSkip, fullName, percent }) => {
    const t = useT();
    const [isDragging, setIsDragging] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(true);
    };

    // dragleave also fires when the pointer crosses into a child element; only
    // a leave out of the whole step ends the drag.
    const handleDragLeave = (e: React.DragEvent) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setIsDragging(false);
    };

    const processFile = async (file: File) => {
        if (file.type !== 'application/pdf') {
            toast.error('Please upload a PDF file.');
            track('resume_import_result', { ok: false, reason: 'not_pdf' });
            return;
        }

        if (file.size > MAX_FILE_BYTES) {
            track('resume_import_result', { ok: false, reason: 'too_large' });
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
                    track('resume_import_result', { ok: false, reason: 'scanned_too_large', via: mode });
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
                track('resume_import_result', { ok: false, reason: 'empty', via: mode });
                toast.error("We couldn't read much from this PDF — it may be a scanned image. Try a text-based PDF, or skip and fill in your profile manually.");
                setIsProcessing(false);
                return;
            }

            track('resume_import_result', { ok: true, via: mode });
            toast.success('Resume analyzed successfully!');
            onExtracted(extractedData);
        } catch (error) {
            console.error('Parsing error:', error);
            track('resume_import_result', { ok: false, reason: 'extract_failed' });
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

    const firstName = (fullName ?? '').trim().split(/\s+/)[0] ?? '';

    return (
        // The whole step is the drop target, so a PDF dragged anywhere over it
        // imports — there is no separate box to aim for.
        <div
            className="relative space-y-6"
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

            {/* The primary button must be on screen without scrolling, down to a
                360×640 phone. So: side by side from md (animation | message +
                actions), and on phones a shorter animation frame (it crops only
                empty desk) with the explanation moved under the buttons. */}
            <div className="space-y-5 md:space-y-0 md:grid md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] md:items-center md:gap-8 lg:gap-10">
                <ResumeWritingHero
                    label={t('profileSetup.heroAlt')}
                    className="aspect-[640/400] md:aspect-[640/440]"
                />

                <div className="text-center md:text-left">
                    <p className="text-[11px] uppercase tracking-[0.14em] sm:tracking-[0.22em] text-accent-600 font-semibold mb-2.5 setup-eyebrow">
                        {/* Up to 20% is only what sign-up supplied (name, email, phone). */}
                        {percent > 20
                            ? t('profileSetup.heroEyebrowResume', { pct: percent })
                            : percent > 0
                                ? t('profileSetup.heroEyebrowStarted', { pct: percent })
                                : t('profileSetup.heroEyebrow')}
                    </p>
                    <h2 className="font-display text-[24px] sm:text-[28px] lg:text-3xl font-semibold text-brand-700 leading-tight text-balance">
                        {firstName
                            ? t('profileSetup.heroTitleNamed', { name: firstName })
                            : t('profileSetup.heroTitle')}
                    </h2>
                    <p className="hidden md:block mt-3 text-brand-500 leading-relaxed text-pretty">
                        {t('profileSetup.heroBody')}
                    </p>

                    <div className="mt-5">
                        {isProcessing ? (
                            <div className="rounded-2xl border border-charcoal-200 bg-charcoal-50 p-5 flex items-center gap-4 text-left" role="status" aria-live="polite">
                                <div className="w-12 h-12 shrink-0 bg-white rounded-full flex items-center justify-center">
                                    <Loader2 className="w-6 h-6 text-brand-700 animate-spin" />
                                </div>
                                <div>
                                    <h3 className="text-base font-semibold text-brand-700">Analyzing your resume</h3>
                                    <p className="text-sm text-charcoal-500 mt-1">
                                        Extracting your work history, skills, and education.
                                    </p>
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-2.5">
                                <button
                                    type="button"
                                    onClick={() => { track('resume_import_skipped'); onSkip(); }}
                                    className="w-full inline-flex items-center justify-center gap-2 py-3.5 px-5 min-h-12 bg-brand-700 text-charcoal-50 rounded-full font-semibold hover:bg-brand-800 transition-colors"
                                >
                                    <PenLine size={17} className="text-accent-400" />
                                    {percent > 20 ? t('profileSetup.heroContinueCta') : t('profileSetup.heroStartCta')}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => fileInputRef.current?.click()}
                                    className="w-full inline-flex items-center justify-center gap-2 py-3 px-5 min-h-12 border border-charcoal-300 text-brand-700 bg-white rounded-full font-semibold text-sm hover:border-brand-700 hover:bg-charcoal-50 transition-colors"
                                >
                                    <Upload size={15} className="text-accent-600" />
                                    {t('profileSetup.heroUploadCta')}
                                </button>
                                {/* Phones cannot drag files, so the drop hint is desktop-only. */}
                                <p className="hidden md:block text-center text-xs text-charcoal-500">{t('profileSetup.heroUploadHint')}</p>
                            </div>
                        )}
                    </div>

                    {/* On phones the explanation follows the buttons, so it never
                        pushes them below the fold. */}
                    <p className="md:hidden mt-4 text-sm text-charcoal-500 leading-relaxed text-pretty">
                        {t('profileSetup.heroBody')}
                    </p>
                </div>
            </div>

            {isDragging && !isProcessing && (
                <div className="pointer-events-none absolute inset-0 -m-3 rounded-3xl border-2 border-dashed border-accent-400 bg-accent-50/90 flex flex-col items-center justify-center gap-3">
                    <FileText className="w-8 h-8 text-accent-600" />
                    <p className="font-semibold text-brand-700">{t('profileSetup.heroDropHere')}</p>
                </div>
            )}

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
