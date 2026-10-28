// Infrastructure - Composite exporter that delegates Word → WordResumeExporter,
// PDF → PdfResumeExporter (text-layer, ATS-parseable).
//
// Both are loaded on first use, not imported: they pull in jsPDF, docx and
// file-saver (~270 KB gzipped), and this composite is constructed by
// dependencies.ts, which every screen — the landing page included — imports.
// A static import put that whole library on the first load of every visitor.

import { ResumeData } from '../../domain/entities/Resume';
import { IResumeExporter } from '../../domain/usecases/ExportResumeUseCase';
import type { WordResumeExporter } from './WordResumeExporter';
import type { PdfResumeExporter } from './PdfResumeExporter';

let wordExporter: Promise<WordResumeExporter> | null = null;
let pdfExporter: Promise<PdfResumeExporter> | null = null;

// A failed chunk download (flaky network) must not stick: the next click
// retries instead of rethrowing the cached rejection forever.
const word = (): Promise<WordResumeExporter> =>
  (wordExporter ??= import('./WordResumeExporter')
    .then((m) => new m.WordResumeExporter())
    .catch((err) => { wordExporter = null; throw err; }));

const pdf = (): Promise<PdfResumeExporter> =>
  (pdfExporter ??= import('./PdfResumeExporter')
    .then((m) => new m.PdfResumeExporter())
    .catch((err) => { pdfExporter = null; throw err; }));

/** Start downloading both exporters now (e.g. when a resume preview opens),
 *  so the first Download click doesn't wait on a ~265 KB chunk — on a slow
 *  link that wait can outlast the click's user activation, and some mobile /
 *  in-app browsers then block the file save. Failures are ignored here; the
 *  click retries. */
export function warmResumeExporters(): void {
  word().catch(() => {});
  pdf().catch(() => {});
}

export class CompositeResumeExporter implements IResumeExporter {
  async exportToWord(data: ResumeData): Promise<void> {
    return (await word()).exportToWord(data);
  }

  async exportCoverLetterToWord(data: ResumeData): Promise<void> {
    return (await word()).exportCoverLetterToWord(data);
  }

  async exportToPDF(data: ResumeData): Promise<void> {
    return (await pdf()).exportResumeToPDF(data);
  }

  async exportCoverLetterToPDF(data: ResumeData): Promise<void> {
    return (await pdf()).exportCoverLetterToPDF(data);
  }
}
