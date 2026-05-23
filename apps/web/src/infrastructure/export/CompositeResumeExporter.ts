// Infrastructure - Composite exporter that delegates Word → WordResumeExporter,
// PDF → PdfResumeExporter (text-layer, ATS-parseable).

import { ResumeData } from '../../domain/entities/Resume';
import { IResumeExporter } from '../../domain/usecases/ExportResumeUseCase';
import { WordResumeExporter } from './WordResumeExporter';
import { PdfResumeExporter } from './PdfResumeExporter';

export class CompositeResumeExporter implements IResumeExporter {
  constructor(
    private readonly word: WordResumeExporter = new WordResumeExporter(),
    private readonly pdf: PdfResumeExporter = new PdfResumeExporter()
  ) {}

  exportToWord(data: ResumeData): Promise<void> {
    return this.word.exportToWord(data);
  }

  exportCoverLetterToWord(data: ResumeData): Promise<void> {
    return this.word.exportCoverLetterToWord(data);
  }

  exportToPDF(data: ResumeData): Promise<void> {
    return this.pdf.exportResumeToPDF(data);
  }

  exportCoverLetterToPDF(data: ResumeData): Promise<void> {
    return this.pdf.exportCoverLetterToPDF(data);
  }
}
