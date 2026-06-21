// Infrastructure - ATS-friendly PDF export using jsPDF text layer.
//
// Every character is drawn with jsPDF's text API (Standard Type 1 font),
// so the resulting PDF has a real text layer that every ATS parser
// (Workday / Greenhouse / Lever / Taleo / iCIMS / BambooHR) can extract.
// No rasterization, no images, no tables, no multi-column layout.
//
// The renderer reads its font, sizes, alignment, and spacing from the
// shared TemplateRegistry — the same registry the Preview component uses —
// so the downloaded PDF matches the on-screen preview exactly.

import { jsPDF } from 'jspdf';
import FileSaver from 'file-saver';
import { ResumeData, awardDetailText } from '../../domain/entities/Resume';
import {
  TemplateDefinition,
  resolveTemplate,
} from '../../presentation/templates/TemplateRegistry';
import {
  ContactSegment,
  buildContactSegments,
  normalizeWebUrl,
  toMailto,
  toTel,
  CONTACT_SEPARATOR,
} from '../../presentation/templates/contactLinks';

// A4 @ 72 DPI in points
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;

const BULLET_CHAR = '\u2022';

type Cursor = { y: number };

export class PdfResumeExporter {
  async exportResumeToPDF(data: ResumeData): Promise<void> {
    const template = resolveTemplate(data.template);
    const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
    this.renderResume(doc, data, template);
    const blob = doc.output('blob');
    const fileName = `${safeFileName(data.personalInfo.fullName)}_Resume.pdf`;
    FileSaver.saveAs(blob, fileName);
  }

  async exportCoverLetterToPDF(data: ResumeData): Promise<void> {
    if (!data.coverLetter) {
      throw new Error('Cover letter not available');
    }
    const template = resolveTemplate(data.template);
    const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
    this.renderCoverLetter(doc, data, template);
    const blob = doc.output('blob');
    const fileName = `${safeFileName(data.personalInfo.fullName)}_Cover_Letter.pdf`;
    FileSaver.saveAs(blob, fileName);
  }

  // ────────────────────────────────────────────────────────────
  // RESUME
  // ────────────────────────────────────────────────────────────

  private renderResume(
    doc: jsPDF,
    data: ResumeData,
    t: TemplateDefinition
  ): void {
    const cursor: Cursor = { y: t.margin };
    const contentWidth = PAGE_WIDTH - t.margin * 2;

    this.renderHeader(doc, data, t, cursor, contentWidth);

    if (data.summary) {
      this.renderSectionHeading(doc, 'Professional Summary', t, cursor);
      this.renderParagraph(doc, data.summary, t, cursor, contentWidth);
      cursor.y += t.itemGap;
    }

    const isVisible = (key: string) =>
      !data.visibleSections || data.visibleSections.includes(key);

    if (isVisible('experience') && data.experience.length > 0) {
      this.renderSectionHeading(doc, 'Experience', t, cursor);
      for (const exp of data.experience) {
        this.ensureSpace(doc, cursor, t.sizeItemTitle * 4, t.margin);
        const dateStr = `${exp.startDate} \u2013 ${exp.isCurrent ? 'Present' : exp.endDate}`;
        this.renderItemTitleRow(doc, exp.role, dateStr, t, cursor, contentWidth);
        this.renderItalicLine(doc, exp.company, t, cursor, contentWidth);
        const bullets =
          exp.refinedBullets && exp.refinedBullets.length > 0
            ? exp.refinedBullets
            : exp.rawDescription
              ? [exp.rawDescription]
              : [];
        for (const b of bullets)
          this.renderBullet(doc, b, t, cursor, contentWidth);
        cursor.y += t.itemGap;
      }
    }

    if (isVisible('projects') && data.projects && data.projects.length > 0) {
      this.renderSectionHeading(doc, 'Projects', t, cursor);
      for (const proj of data.projects) {
        this.ensureSpace(doc, cursor, t.sizeItemTitle * 4, t.margin);
        this.renderItemTitleRow(
          doc,
          proj.name,
          proj.technologies || '',
          t,
          cursor,
          contentWidth,
          { rightItalic: true }
        );
        if (proj.link)
          this.renderMetaLine(doc, proj.link, t, cursor, contentWidth, normalizeWebUrl(proj.link));
        const bullets =
          proj.refinedBullets && proj.refinedBullets.length > 0
            ? proj.refinedBullets
            : proj.rawDescription
              ? [proj.rawDescription]
              : [];
        for (const b of bullets)
          this.renderBullet(doc, b, t, cursor, contentWidth);
        cursor.y += t.itemGap;
      }
    }

    if (isVisible('education') && data.education.length > 0) {
      this.renderSectionHeading(doc, 'Education', t, cursor);
      for (const edu of data.education) {
        this.ensureSpace(doc, cursor, t.sizeItemTitle * 3, t.margin);
        const dateStr = `${edu.startDate} \u2013 ${edu.endDate}`;
        this.renderItemTitleRow(doc, edu.school, dateStr, t, cursor, contentWidth);
        const degreeText = `${edu.degree}${edu.field ? ` in ${edu.field}` : ''}${edu.gpa ? ` \u2022 GPA: ${edu.gpa}` : ''}`;
        this.renderBodyLine(doc, degreeText, t, cursor, contentWidth);
        cursor.y += t.itemGap;
      }
    }

    if (
      isVisible('certifications') &&
      data.certifications &&
      data.certifications.length > 0
    ) {
      this.renderSectionHeading(doc, 'Certifications', t, cursor);
      for (const cert of data.certifications) {
        this.ensureSpace(doc, cursor, t.sizeItemTitle * 3, t.margin);
        this.renderItemTitleRow(doc, cert.name, cert.date, t, cursor, contentWidth);
        this.renderItalicLine(doc, cert.issuer, t, cursor, contentWidth);
        cursor.y += t.itemGap;
      }
    }

    if (
      isVisible('extracurriculars') &&
      data.extracurriculars &&
      data.extracurriculars.length > 0
    ) {
      this.renderSectionHeading(doc, 'Extracurricular Activities', t, cursor);
      for (const extra of data.extracurriculars) {
        this.ensureSpace(doc, cursor, t.sizeItemTitle * 4, t.margin);
        const dateStr = `${extra.startDate} \u2013 ${extra.endDate}`;
        this.renderItemTitleRow(doc, extra.title, dateStr, t, cursor, contentWidth);
        this.renderItalicLine(doc, extra.organization, t, cursor, contentWidth);
        const bullets =
          extra.refinedBullets && extra.refinedBullets.length > 0
            ? extra.refinedBullets
            : extra.description
              ? [extra.description]
              : [];
        for (const b of bullets)
          this.renderBullet(doc, b, t, cursor, contentWidth);
        cursor.y += t.itemGap;
      }
    }

    if (isVisible('awards') && data.awards && data.awards.length > 0) {
      this.renderSectionHeading(doc, 'Awards & Honors', t, cursor);
      for (const award of data.awards) {
        this.ensureSpace(doc, cursor, t.sizeItemTitle * 3, t.margin);
        this.renderItemTitleRow(doc, award.title, award.date, t, cursor, contentWidth);
        const awardDetail = awardDetailText(award);
        const issuerLine = `${award.issuer}${awardDetail ? ` \u2013 ${awardDetail}` : ''}`;
        this.renderBodyLine(doc, issuerLine, t, cursor, contentWidth);
        cursor.y += t.itemGap;
      }
    }

    if (
      isVisible('publications') &&
      data.publications &&
      data.publications.length > 0
    ) {
      this.renderSectionHeading(doc, 'Publications', t, cursor);
      for (const pub of data.publications) {
        this.ensureSpace(doc, cursor, t.sizeBody * 2, t.margin);
        const prefix = `${pub.title}${pub.publisher ? `, ${pub.publisher}` : ''}, ${pub.date}`;
        const pubHref = pub.link ? normalizeWebUrl(pub.link) : undefined;
        if (pub.link && pubHref) {
          doc.setFont(t.pdfFont, 'normal');
          doc.setFontSize(t.sizeBody);
          const open = ' [';
          const close = ']';
          const total = doc.getTextWidth(prefix + open + pub.link + close);
          if (total <= contentWidth) {
            // Fits one line — render inline with the bracketed URL clickable.
            this.ensureSpace(doc, cursor, t.sizeBody * t.lineHeight, t.margin);
            cursor.y += t.sizeBody * t.lineHeight;
            let x = t.margin;
            doc.text(prefix + open, x, cursor.y);
            x += doc.getTextWidth(prefix + open);
            doc.textWithLink(pub.link, x, cursor.y, { url: pubHref });
            x += doc.getTextWidth(pub.link);
            doc.text(close, x, cursor.y);
          } else {
            // Too long for one line — text wraps, URL gets its own clickable line.
            this.renderBodyLine(doc, prefix, t, cursor, contentWidth);
            this.renderMetaLine(doc, pub.link, t, cursor, contentWidth, pubHref);
          }
        } else {
          const line = `${prefix}${pub.link ? ` [${pub.link}]` : ''}`;
          this.renderBodyLine(doc, line, t, cursor, contentWidth);
        }
        cursor.y += 2;
      }
      cursor.y += t.itemGap;
    }

    if (
      isVisible('affiliations') &&
      data.affiliations &&
      data.affiliations.length > 0
    ) {
      this.renderSectionHeading(doc, 'Affiliations', t, cursor);
      for (const aff of data.affiliations) {
        this.ensureSpace(doc, cursor, t.sizeBody * 2, t.margin);
        const affDates = aff.startDate
          ? ` (${aff.startDate} \u2013 ${aff.endDate || 'Present'})`
          : '';
        const line = `${aff.role}, ${aff.organization}${affDates}`;
        this.renderBodyLine(doc, line, t, cursor, contentWidth);
        cursor.y += 2;
      }
      cursor.y += t.itemGap;
    }

    if (isVisible('skills') && data.skills.length > 0) {
      this.renderSectionHeading(doc, 'Skills', t, cursor);
      // Categorized layout when present (one line per bucket, ATS still
      // parses comma-delimited within each); flat fallback otherwise.
      if (data.skillCategories && data.skillCategories.length > 0) {
        for (const cat of data.skillCategories) {
          if (!cat.items || cat.items.length === 0) continue;
          const label = `${cat.category}: `;
          const itemsText = cat.items.join(', ');

          // Measure bold label width (font+size must be set first for accuracy)
          doc.setFont(t.pdfFont, 'bold');
          doc.setFontSize(t.sizeBody);
          const labelWidth = (doc.getStringUnitWidth(label) * t.sizeBody) / doc.internal.scaleFactor;

          // Wrap items text to the remaining width after the label
          doc.setFont(t.pdfFont, 'normal');
          const lines = doc.splitTextToSize(itemsText, contentWidth - labelWidth);

          this.ensureSpace(doc, cursor, t.sizeBody * t.lineHeight, t.margin);
          cursor.y += t.sizeBody * t.lineHeight;

          // Bold label + first items line on the same row
          doc.setFont(t.pdfFont, 'bold');
          doc.text(label, t.margin, cursor.y);
          doc.setFont(t.pdfFont, 'normal');
          if (lines.length > 0) {
            doc.text(lines[0], t.margin + labelWidth, cursor.y);
          }

          // Subsequent wrapped lines indented to align with items text
          for (let i = 1; i < lines.length; i++) {
            this.ensureSpace(doc, cursor, t.sizeBody * t.lineHeight, t.margin);
            cursor.y += t.sizeBody * t.lineHeight;
            doc.text(lines[i], t.margin + labelWidth, cursor.y);
          }
        }
      } else {
        this.renderParagraph(doc, data.skills.join(', '), t, cursor, contentWidth);
      }
    }

    if (
      isVisible('languages') &&
      data.languages &&
      data.languages.length > 0
    ) {
      this.renderSectionHeading(doc, 'Languages', t, cursor);
      const langLine = data.languages
        .filter((l) => l.name)
        .map((l) => `${l.name} (${l.proficiency})`)
        .join(', ');
      this.renderParagraph(doc, langLine, t, cursor, contentWidth);
    }

    if (
      isVisible('references') &&
      data.references &&
      data.references.length > 0
    ) {
      this.renderSectionHeading(doc, 'References', t, cursor);
      for (const ref of data.references) {
        this.ensureSpace(doc, cursor, t.sizeBody * 4, t.margin);
        // Name in bold, then position/org line, then contact line, then optional relationship.
        doc.setFont(t.pdfFont, 'bold');
        doc.setFontSize(t.sizeBody);
        cursor.y += t.sizeBody * t.lineHeight;
        doc.text(ref.name || '', t.margin, cursor.y);
        doc.setFont(t.pdfFont, 'normal');

        const posOrg = [ref.position, ref.organization].filter(Boolean).join(', ');
        if (posOrg) this.renderBodyLine(doc, posOrg, t, cursor, contentWidth);

        const contactSegs: ContactSegment[] = [];
        if (ref.email) contactSegs.push({ text: ref.email, href: toMailto(ref.email) });
        if (ref.phone) contactSegs.push({ text: ref.phone, href: toTel(ref.phone) });
        if (contactSegs.length > 0) {
          doc.setFont(t.pdfFont, 'normal');
          doc.setFontSize(t.sizeBody);
          this.renderContactSegments(doc, contactSegs, t, cursor, contentWidth, {
            align: 'left',
            separator: ' · ',
          });
        }

        if (ref.relationship) this.renderBodyLine(doc, ref.relationship, t, cursor, contentWidth);

        cursor.y += t.itemGap;
      }
    }
  }

  private renderHeader(
    doc: jsPDF,
    data: ResumeData,
    t: TemplateDefinition,
    cursor: Cursor,
    contentWidth: number
  ): void {
    doc.setFont(t.pdfFont, 'bold');
    doc.setFontSize(t.sizeName);
    const name = data.personalInfo.fullName || '';
    cursor.y += t.sizeName;
    const nameX = t.headerAlignment === 'center' ? PAGE_WIDTH / 2 : t.margin;
    doc.text(name, nameX, cursor.y, {
      align: t.headerAlignment === 'center' ? 'center' : 'left',
    });
    cursor.y += 4;

    const segments = buildContactSegments(data.personalInfo);
    if (segments.length > 0) {
      doc.setFont(t.pdfFont, 'normal');
      doc.setFontSize(t.sizeBody);
      this.renderContactSegments(doc, segments, t, cursor, contentWidth, {
        align: t.headerAlignment === 'center' ? 'center' : 'left',
      });
    }

    cursor.y += t.sectionGapBefore;
  }

  /**
   * Renders a contact line as individually-linkable segments. Segments with an
   * `href` are drawn with `doc.textWithLink` (a real clickable annotation over
   * the same visible text — ATS still extracts the text); others (and the
   * separators) with `doc.text`. Because we manage per-segment x advancement,
   * this also reproduces the previous left/center alignment and wrapping
   * behavior, but without ever splitting a link mid-URL.
   */
  private renderContactSegments(
    doc: jsPDF,
    segments: ContactSegment[],
    t: TemplateDefinition,
    cursor: Cursor,
    contentWidth: number,
    opts?: { align?: 'left' | 'center'; separator?: string }
  ): void {
    const align = opts?.align ?? 'left';
    const separator = opts?.separator ?? CONTACT_SEPARATOR;
    // Font/size must already be set by the caller so getTextWidth is accurate.
    const sepWidth = doc.getTextWidth(separator);

    type Piece = { text: string; href?: string; width: number };
    const lines: Piece[][] = [];
    let current: Piece[] = [];
    let currentWidth = 0;

    for (const seg of segments) {
      const segWidth = doc.getTextWidth(seg.text);
      const hasPreceding = current.length > 0;
      const projected = currentWidth + (hasPreceding ? sepWidth : 0) + segWidth;
      if (hasPreceding && projected > contentWidth) {
        // Wrap: the separator that would precede this segment is dropped.
        lines.push(current);
        current = [{ text: seg.text, href: seg.href, width: segWidth }];
        currentWidth = segWidth;
      } else {
        if (hasPreceding) {
          current.push({ text: separator, width: sepWidth });
          currentWidth += sepWidth;
        }
        current.push({ text: seg.text, href: seg.href, width: segWidth });
        currentWidth += segWidth;
      }
    }
    if (current.length > 0) lines.push(current);

    for (const line of lines) {
      cursor.y += t.sizeBody * t.lineHeight;
      const lineWidth = line.reduce((sum, p) => sum + p.width, 0);
      let x = align === 'center' ? PAGE_WIDTH / 2 - lineWidth / 2 : t.margin;
      for (const p of line) {
        if (p.href) {
          doc.textWithLink(p.text, x, cursor.y, { url: p.href });
        } else {
          doc.text(p.text, x, cursor.y);
        }
        x += p.width;
      }
    }
  }

  private renderSectionHeading(
    doc: jsPDF,
    title: string,
    t: TemplateDefinition,
    cursor: Cursor
  ): void {
    this.ensureSpace(doc, cursor, t.sizeHeading * 3, t.margin);
    cursor.y += t.sectionGapBefore - t.itemGap;

    doc.setFont(t.pdfFont, 'bold');
    doc.setFontSize(t.sizeHeading);
    cursor.y += t.sizeHeading;
    doc.text(title.toUpperCase(), t.margin, cursor.y);

    if (t.sectionDivider === 'rule') {
      cursor.y += t.headingGapAfter / 2;
      doc.setLineWidth(0.6);
      doc.setDrawColor(20);
      doc.line(t.margin, cursor.y, PAGE_WIDTH - t.margin, cursor.y);
      cursor.y += t.headingGapAfter / 2;
    } else {
      cursor.y += t.headingGapAfter;
    }
  }

  private renderItemTitleRow(
    doc: jsPDF,
    left: string,
    right: string,
    t: TemplateDefinition,
    cursor: Cursor,
    contentWidth: number,
    opts?: { rightItalic?: boolean }
  ): void {
    doc.setFont(t.pdfFont, 'bold');
    doc.setFontSize(t.sizeItemTitle);
    cursor.y += t.sizeItemTitle * t.lineHeight;

    const rightWidth = right
      ? (doc.getStringUnitWidth(right) * t.sizeItemTitle) /
        doc.internal.scaleFactor
      : 0;
    const leftMaxWidth = contentWidth - rightWidth - 12;

    const leftLines = doc.splitTextToSize(left, leftMaxWidth);
    doc.text(leftLines[0] ?? '', t.margin, cursor.y);

    if (right) {
      if (opts?.rightItalic) {
        doc.setFont(t.pdfFont, 'italic');
      } else {
        doc.setFont(t.pdfFont, 'bold');
      }
      doc.setFontSize(t.sizeMeta);
      doc.text(right, PAGE_WIDTH - t.margin, cursor.y, { align: 'right' });
    }

    if (leftLines.length > 1) {
      doc.setFont(t.pdfFont, 'bold');
      doc.setFontSize(t.sizeItemTitle);
      for (let i = 1; i < leftLines.length; i++) {
        cursor.y += t.sizeItemTitle * t.lineHeight;
        doc.text(leftLines[i], t.margin, cursor.y);
      }
    }
  }

  private renderItalicLine(
    doc: jsPDF,
    text: string,
    t: TemplateDefinition,
    cursor: Cursor,
    contentWidth: number
  ): void {
    if (!text) return;
    doc.setFont(t.pdfFont, 'italic');
    doc.setFontSize(t.sizeMeta);
    cursor.y += t.sizeMeta * t.lineHeight;
    const lines = doc.splitTextToSize(text, contentWidth);
    for (let i = 0; i < lines.length; i++) {
      if (i > 0) cursor.y += t.sizeMeta * t.lineHeight;
      doc.text(lines[i], t.margin, cursor.y);
    }
  }

  private renderMetaLine(
    doc: jsPDF,
    text: string,
    t: TemplateDefinition,
    cursor: Cursor,
    contentWidth: number,
    url?: string
  ): void {
    if (!text) return;
    doc.setFont(t.pdfFont, 'normal');
    doc.setFontSize(t.sizeMeta);
    cursor.y += t.sizeMeta * t.lineHeight;
    const lines = doc.splitTextToSize(text, contentWidth);
    for (let i = 0; i < lines.length; i++) {
      if (i > 0) cursor.y += t.sizeMeta * t.lineHeight;
      // When the whole meta line IS a single URL (e.g. a project link), make it
      // clickable; otherwise plain text. (We only linkify when the text didn't
      // wrap, so the annotation covers exactly the visible URL.)
      if (url && lines.length === 1) {
        doc.textWithLink(lines[i], t.margin, cursor.y, { url });
      } else {
        doc.text(lines[i], t.margin, cursor.y);
      }
    }
  }

  private renderBodyLine(
    doc: jsPDF,
    text: string,
    t: TemplateDefinition,
    cursor: Cursor,
    contentWidth: number
  ): void {
    if (!text) return;
    doc.setFont(t.pdfFont, 'normal');
    doc.setFontSize(t.sizeBody);
    const lines = doc.splitTextToSize(text, contentWidth);
    for (const line of lines) {
      this.ensureSpace(doc, cursor, t.sizeBody * t.lineHeight, t.margin);
      cursor.y += t.sizeBody * t.lineHeight;
      doc.text(line, t.margin, cursor.y);
    }
  }

  private renderParagraph(
    doc: jsPDF,
    text: string,
    t: TemplateDefinition,
    cursor: Cursor,
    contentWidth: number
  ): void {
    if (!text) return;
    doc.setFont(t.pdfFont, 'normal');
    doc.setFontSize(t.sizeBody);
    const paragraphs = text.split(/\n\s*\n/);
    paragraphs.forEach((para, idx) => {
      const lines = doc.splitTextToSize(para.trim(), contentWidth);
      for (const line of lines) {
        this.ensureSpace(doc, cursor, t.sizeBody * t.lineHeight, t.margin);
        cursor.y += t.sizeBody * t.lineHeight;
        doc.text(line, t.margin, cursor.y);
      }
      if (idx < paragraphs.length - 1) cursor.y += t.sizeBody * 0.6;
    });
  }

  private renderBullet(
    doc: jsPDF,
    text: string,
    t: TemplateDefinition,
    cursor: Cursor,
    contentWidth: number
  ): void {
    if (!text) return;
    doc.setFont(t.pdfFont, 'normal');
    doc.setFontSize(t.sizeBody);

    const bulletIndent = 14;
    const textX = t.margin + bulletIndent;
    const textWidth = contentWidth - bulletIndent;
    const lines = doc.splitTextToSize(text, textWidth);

    for (let i = 0; i < lines.length; i++) {
      this.ensureSpace(doc, cursor, t.sizeBody * t.lineHeight, t.margin);
      cursor.y += t.sizeBody * t.lineHeight;
      if (i === 0) doc.text(BULLET_CHAR, t.margin + 2, cursor.y);
      doc.text(lines[i], textX, cursor.y);
    }
    cursor.y += t.bulletGap;
  }

  // ────────────────────────────────────────────────────────────
  // COVER LETTER
  // ────────────────────────────────────────────────────────────

  private renderCoverLetter(
    doc: jsPDF,
    data: ResumeData,
    t: TemplateDefinition
  ): void {
    const cursor: Cursor = { y: t.margin };
    const contentWidth = PAGE_WIDTH - t.margin * 2;

    doc.setFont(t.pdfFont, 'bold');
    doc.setFontSize(t.sizeItemTitle);
    cursor.y += t.sizeItemTitle;
    doc.text(data.personalInfo.fullName || '', t.margin, cursor.y);

    doc.setFont(t.pdfFont, 'normal');
    doc.setFontSize(t.sizeBody);
    // One field per line; each linkable field is clickable. Same derivation as
    // the resume header so the two surfaces agree.
    const senderSegs: ContactSegment[] = [];
    if (data.personalInfo.email)
      senderSegs.push({ text: data.personalInfo.email, href: toMailto(data.personalInfo.email) });
    if (data.personalInfo.phone)
      senderSegs.push({ text: data.personalInfo.phone, href: toTel(data.personalInfo.phone) });
    if (data.personalInfo.location)
      senderSegs.push({ text: data.personalInfo.location });
    if (data.personalInfo.linkedin)
      senderSegs.push({ text: data.personalInfo.linkedin, href: normalizeWebUrl(data.personalInfo.linkedin) });
    for (const seg of senderSegs) {
      cursor.y += t.sizeBody * t.lineHeight;
      if (seg.href) {
        doc.textWithLink(seg.text, t.margin, cursor.y, { url: seg.href });
      } else {
        doc.text(seg.text, t.margin, cursor.y);
      }
    }

    cursor.y += t.sectionGapBefore;

    const today = new Date().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    cursor.y += t.sizeBody * t.lineHeight;
    doc.text(today, t.margin, cursor.y);
    cursor.y += t.sectionGapBefore;

    cursor.y += t.sizeBody * t.lineHeight;
    doc.text('Hiring Manager', t.margin, cursor.y);
    if (data.targetJob.company) {
      cursor.y += t.sizeBody * t.lineHeight;
      doc.text(data.targetJob.company, t.margin, cursor.y);
    }
    cursor.y += t.sectionGapBefore;

    cursor.y += t.sizeBody * t.lineHeight;
    doc.text('Dear Hiring Manager,', t.margin, cursor.y);
    cursor.y += t.sectionGapBefore * 0.8;

    const body = data.coverLetter || '';
    const paragraphs = body
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean);
    for (const para of paragraphs) {
      const lines = doc.splitTextToSize(para, contentWidth);
      for (const line of lines) {
        this.ensureSpace(doc, cursor, t.sizeBody * t.lineHeight, t.margin);
        cursor.y += t.sizeBody * t.lineHeight;
        doc.text(line, t.margin, cursor.y);
      }
      cursor.y += t.sizeBody * 0.9;
    }

    cursor.y += t.sizeBody;
    this.ensureSpace(doc, cursor, 60, t.margin);
    cursor.y += t.sizeBody * t.lineHeight;
    doc.text('Sincerely,', t.margin, cursor.y);

    cursor.y += t.sizeBody * 3;
    doc.setFont(t.pdfFont, 'bold');
    cursor.y += t.sizeItemTitle * t.lineHeight;
    doc.text(data.personalInfo.fullName || '', t.margin, cursor.y);
  }

  // ────────────────────────────────────────────────────────────
  // UTILITIES
  // ────────────────────────────────────────────────────────────

  private ensureSpace(
    doc: jsPDF,
    cursor: Cursor,
    needed: number,
    margin: number
  ): void {
    if (cursor.y + needed > PAGE_HEIGHT - margin) {
      doc.addPage();
      cursor.y = margin;
    }
  }
}

function safeFileName(name: string): string {
  return (name || 'Resume').replace(/\s+/g, '_').replace(/[^\w-]/g, '');
}
