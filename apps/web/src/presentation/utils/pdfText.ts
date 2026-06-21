// Client-side PDF text extraction (pdf.js).
//
// Why: the resume extractor used to base64-encode the whole PDF into the
// request body. Base64 inflates ×1.333 and Vercel rejects bodies > 4.5MB, so
// uploads silently failed above ~3.3MB. Extracting the text in the browser and
// sending only the text (a few KB) removes that ceiling entirely for normal,
// text-based PDFs. Scanned/image PDFs yield little/no text — the caller detects
// that and falls back to sending the file itself (still subject to the size
// cap) so Gemini's native multimodal read can OCR it.
//
// pdf.js is dynamically imported so its ~1MB bundle (worker included) only loads
// when a user actually imports a resume, keeping the initial app bundle lean.

/** Minimum extracted-text length below which we treat a PDF as scanned/image. */
export const MIN_TEXT_LENGTH = 80;

export interface PdfTextResult {
  /** Concatenated, lightly-normalized text across all pages. */
  text: string;
  pageCount: number;
}

/**
 * Extract selectable text from a PDF File entirely in the browser.
 * Throws if the file isn't a parseable PDF (caller should fall back to the
 * file-send path or surface a friendly error).
 */
export async function extractTextFromPdf(file: File): Promise<PdfTextResult> {
  // Dynamic import keeps pdf.js out of the initial bundle.
  const pdfjs = await import('pdfjs-dist');
  // Vite resolves this to a hashed asset URL at build time and serves the
  // worker as a module. Setting it once per load is idempotent.
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
  ).toString();

  const data = new Uint8Array(await file.arrayBuffer());
  const loadingTask = pdfjs.getDocument({ data });
  const doc = await loadingTask.promise;

  try {
    const pages: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ');
      pages.push(pageText);
      page.cleanup();
    }
    // Collapse runs of whitespace; keep page breaks as newlines so section
    // boundaries the model relies on aren't lost.
    const text = pages
      .map((p) => p.replace(/[ \t ]+/g, ' ').trim())
      .filter(Boolean)
      .join('\n\n')
      .trim();
    return { text, pageCount: doc.numPages };
  } finally {
    // Release the document + worker resources (destroy lives on the task).
    await loadingTask.destroy();
  }
}
