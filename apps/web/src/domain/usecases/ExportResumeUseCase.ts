// Domain Use Case - Resume Export

import { ResumeData } from '../entities/Resume';

export interface IResumeExporter {
  exportToWord(data: ResumeData): Promise<void>;
  exportToPDF?(data: ResumeData): Promise<void>;
  exportCoverLetterToWord?(data: ResumeData): Promise<void>;
  exportCoverLetterToPDF?(data: ResumeData): Promise<void>;
}

export class ExportResumeUseCase {
  constructor(private resumeExporter: IResumeExporter) {}

  async executeWordExport(data: ResumeData): Promise<void> {
    if (!data.personalInfo.fullName.trim()) {
      throw new Error('Personal information is required for export');
    }

    return await this.resumeExporter.exportToWord(data);
  }

  async executePDFExport(data: ResumeData): Promise<void> {
    if (!this.resumeExporter.exportToPDF) {
      throw new Error('PDF export is not supported');
    }

    if (!data.personalInfo.fullName.trim()) {
      throw new Error('Personal information is required for export');
    }

    return await this.resumeExporter.exportToPDF(data);
  }
}

