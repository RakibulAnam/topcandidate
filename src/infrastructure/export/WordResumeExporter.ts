// Infrastructure - Word (.docx) export.
//
// Uses the docx library's native paragraph + run primitives — no tables,
// no text boxes, no multi-column layout — so the generated document is
// fully ATS-parseable. Typography and spacing are driven by the shared
// TemplateRegistry (same one the Preview and PDF exporter read from), so
// switching templates gives a consistent visual across all three surfaces.

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  TabStopPosition,
  TabStopType,
  BorderStyle,
} from 'docx';
import FileSaver from 'file-saver';
import { ResumeData } from '../../domain/entities/Resume';
import { IResumeExporter } from '../../domain/usecases/ExportResumeUseCase';
import {
  TemplateDefinition,
  resolveTemplate,
} from '../../presentation/templates/TemplateRegistry';

// docx represents font size in half-points. helper to convert pt → half-pt.
const pt = (points: number) => Math.round(points * 2);

// docx represents paragraph spacing in twips (1/20 of a point).
const twips = (points: number) => Math.round(points * 20);

function pdfFontToWordFont(pdfFont: TemplateDefinition['pdfFont']): string {
  switch (pdfFont) {
    case 'times':
      return 'Times New Roman';
    case 'courier':
      return 'Courier New';
    case 'helvetica':
    default:
      return 'Arial';
  }
}

export class WordResumeExporter implements IResumeExporter {
  async exportToWord(data: ResumeData): Promise<void> {
    try {
      const template = resolveTemplate(data.template);
      const doc = this.createDocument(data, template);
      const blob = await Packer.toBlob(doc);
      const fileName = `${data.personalInfo.fullName.replace(/\s+/g, '_')}_Resume.docx`;
      FileSaver.saveAs(blob, fileName);
    } catch (error) {
      console.error('Word export failed:', error);
      throw new Error(
        `Failed to generate Word document: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  async exportCoverLetterToWord(data: ResumeData): Promise<void> {
    if (!data.coverLetter) {
      throw new Error('Cover letter not available');
    }

    try {
      const template = resolveTemplate(data.template);
      const doc = this.createCoverLetterDocument(data, template);
      const blob = await Packer.toBlob(doc);
      const fileName = `${data.personalInfo.fullName.replace(/\s+/g, '_')}_Cover_Letter.docx`;
      FileSaver.saveAs(blob, fileName);
    } catch (error) {
      console.error('Cover letter export failed:', error);
      throw new Error(
        `Failed to generate cover letter document: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  // ────────────────────────────────────────────────────────────
  // RESUME
  // ────────────────────────────────────────────────────────────

  private createDocument(data: ResumeData, t: TemplateDefinition): Document {
    const fontFamily = pdfFontToWordFont(t.pdfFont);
    const headerAlignment =
      t.headerAlignment === 'center' ? AlignmentType.CENTER : AlignmentType.LEFT;

    const headerLines = this.createHeader(data, t, fontFamily, headerAlignment);
    const sections = this.createSections(data, t, fontFamily);

    return new Document({
      styles: {
        default: {
          document: {
            run: {
              font: fontFamily,
              color: '000000',
              size: pt(t.sizeBody),
            },
          },
        },
        paragraphStyles: [
          {
            id: 'Heading1',
            name: 'Heading 1',
            basedOn: 'Normal',
            next: 'Normal',
            quickFormat: true,
            run: {
              size: pt(t.sizeName),
              bold: true,
              color: '000000',
              font: fontFamily,
              allCaps: t.nameStyle === 'uppercase',
            },
            paragraph: {
              alignment: headerAlignment,
              spacing: { after: twips(4) },
            },
          },
          {
            id: 'Heading2',
            name: 'Heading 2',
            basedOn: 'Normal',
            next: 'Normal',
            quickFormat: true,
            run: {
              size: pt(t.sizeHeading),
              bold: true,
              color: '000000',
              font: fontFamily,
              allCaps: true,
            },
            paragraph: {
              alignment: AlignmentType.LEFT,
              spacing: {
                before: twips(t.sectionGapBefore),
                after: twips(t.headingGapAfter),
              },
            },
          },
        ],
      },
      sections: [
        {
          properties: {
            page: {
              margin: {
                top: twips(t.margin),
                right: twips(t.margin),
                bottom: twips(t.margin),
                left: twips(t.margin),
              },
            },
          },
          children: [...headerLines, ...sections],
        },
      ],
    });
  }

  private createHeader(
    data: ResumeData,
    t: TemplateDefinition,
    fontFamily: string,
    headerAlignment: typeof AlignmentType[keyof typeof AlignmentType]
  ): Paragraph[] {
    const headerLines: Paragraph[] = [
      new Paragraph({
        text: data.personalInfo.fullName,
        heading: HeadingLevel.HEADING_1,
      }),
    ];

    const contactParts = [
      data.personalInfo.email,
      data.personalInfo.phone,
      data.personalInfo.location,
      data.personalInfo.linkedin,
      data.personalInfo.github,
      data.personalInfo.website,
    ].filter(Boolean);

    if (contactParts.length > 0) {
      headerLines.push(
        new Paragraph({
          children: [
            new TextRun({
              text: contactParts.join('  |  '),
              size: pt(t.sizeBody),
              font: fontFamily,
            }),
          ],
          alignment: headerAlignment,
          spacing: { after: twips(t.sectionGapBefore) },
        })
      );
    }

    return headerLines;
  }

  private createSections(
    data: ResumeData,
    t: TemplateDefinition,
    fontFamily: string
  ): Paragraph[] {
    const sections: Paragraph[] = [];

    const isVisible = (key: string) =>
      !data.visibleSections || data.visibleSections.includes(key);

    if (data.summary) {
      sections.push(this.createSectionHeading('Professional Summary', t));
      sections.push(
        new Paragraph({
          children: [new TextRun({ text: data.summary, size: pt(t.sizeBody) })],
          spacing: { after: twips(t.itemGap) },
        })
      );
    }

    if (isVisible('experience') && data.experience && data.experience.length > 0) {
      sections.push(this.createSectionHeading('Experience', t));
      for (const exp of data.experience) {
        sections.push(
          new Paragraph({
            children: [
              new TextRun({ text: exp.role, bold: true, size: pt(t.sizeItemTitle) }),
              new TextRun({
                text: `\t${exp.startDate} \u2013 ${exp.isCurrent ? 'Present' : exp.endDate}`,
                bold: true,
                size: pt(t.sizeMeta),
              }),
            ],
            tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
            spacing: { before: twips(t.bulletGap + 2) },
          })
        );
        sections.push(
          new Paragraph({
            children: [
              new TextRun({ text: exp.company, italics: true, size: pt(t.sizeMeta) }),
            ],
            spacing: { after: twips(t.bulletGap + 2) },
          })
        );

        if (exp.refinedBullets && exp.refinedBullets.length > 0) {
          exp.refinedBullets.forEach((b) =>
            sections.push(this.createBullet(b, t))
          );
        } else if (exp.rawDescription) {
          sections.push(this.createBullet(exp.rawDescription, t));
        }
      }
    }

    if (isVisible('projects') && data.projects && data.projects.length > 0) {
      sections.push(this.createSectionHeading('Projects', t));
      for (const proj of data.projects) {
        sections.push(
          new Paragraph({
            children: [
              new TextRun({
                text: proj.name,
                bold: true,
                size: pt(t.sizeItemTitle),
              }),
              new TextRun({
                text: proj.technologies ? `\t${proj.technologies}` : '',
                italics: true,
                size: pt(t.sizeMeta),
              }),
            ],
            tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
            spacing: { before: twips(t.bulletGap + 2) },
          })
        );
        if (proj.link) {
          sections.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: proj.link,
                  size: pt(t.sizeMeta),
                  color: '0563C1',
                }),
              ],
              spacing: { after: twips(t.bulletGap) },
            })
          );
        }
        if (proj.refinedBullets && proj.refinedBullets.length > 0) {
          proj.refinedBullets.forEach((b) =>
            sections.push(this.createBullet(b, t))
          );
        } else if (proj.rawDescription) {
          sections.push(this.createBullet(proj.rawDescription, t));
        }
      }
    }

    if (isVisible('education') && data.education && data.education.length > 0) {
      sections.push(this.createSectionHeading('Education', t));
      for (const edu of data.education) {
        sections.push(
          new Paragraph({
            children: [
              new TextRun({
                text: edu.school,
                bold: true,
                size: pt(t.sizeItemTitle),
              }),
              new TextRun({
                text: `\t${edu.startDate} \u2013 ${edu.endDate}`,
                bold: true,
                size: pt(t.sizeMeta),
              }),
            ],
            tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
            spacing: { before: twips(t.bulletGap + 2) },
          })
        );
        const degreeText = `${edu.degree}${edu.field ? ` in ${edu.field}` : ''}${edu.gpa ? ` \u2022 GPA: ${edu.gpa}` : ''}`;
        sections.push(
          new Paragraph({
            children: [new TextRun({ text: degreeText, size: pt(t.sizeBody) })],
            spacing: { after: twips(t.itemGap) },
          })
        );
      }
    }

    if (
      isVisible('certifications') &&
      data.certifications &&
      data.certifications.length > 0
    ) {
      sections.push(this.createSectionHeading('Certifications', t));
      for (const cert of data.certifications) {
        sections.push(
          new Paragraph({
            children: [
              new TextRun({
                text: cert.name,
                bold: true,
                size: pt(t.sizeItemTitle),
              }),
              new TextRun({
                text: `\t${cert.date}`,
                bold: true,
                size: pt(t.sizeMeta),
              }),
            ],
            tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
            spacing: { before: twips(t.bulletGap + 2) },
          })
        );
        sections.push(
          new Paragraph({
            children: [
              new TextRun({ text: cert.issuer, italics: true, size: pt(t.sizeMeta) }),
            ],
            spacing: { after: twips(t.itemGap) },
          })
        );
      }
    }

    if (
      isVisible('extracurriculars') &&
      data.extracurriculars &&
      data.extracurriculars.length > 0
    ) {
      sections.push(this.createSectionHeading('Extracurricular Activities', t));
      for (const extra of data.extracurriculars) {
        sections.push(
          new Paragraph({
            children: [
              new TextRun({
                text: extra.title,
                bold: true,
                size: pt(t.sizeItemTitle),
              }),
              new TextRun({
                text: `\t${extra.startDate} \u2013 ${extra.endDate}`,
                bold: true,
                size: pt(t.sizeMeta),
              }),
            ],
            tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
            spacing: { before: twips(t.bulletGap + 2) },
          })
        );
        sections.push(
          new Paragraph({
            children: [
              new TextRun({
                text: extra.organization,
                italics: true,
                size: pt(t.sizeMeta),
              }),
            ],
            spacing: { after: twips(t.bulletGap + 2) },
          })
        );
        if (extra.refinedBullets && extra.refinedBullets.length > 0) {
          extra.refinedBullets.forEach((b) =>
            sections.push(this.createBullet(b, t))
          );
        } else if (extra.description) {
          sections.push(this.createBullet(extra.description, t));
        }
      }
    }

    if (isVisible('awards') && data.awards && data.awards.length > 0) {
      sections.push(this.createSectionHeading('Awards & Honors', t));
      for (const award of data.awards) {
        sections.push(
          new Paragraph({
            children: [
              new TextRun({ text: award.title, bold: true, size: pt(t.sizeItemTitle) }),
              new TextRun({ text: `\t${award.date}`, size: pt(t.sizeMeta) }),
            ],
            tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
            spacing: { before: twips(t.bulletGap + 2) },
          })
        );
        sections.push(
          new Paragraph({
            children: [
              new TextRun({
                text: `${award.issuer}${award.description ? ` \u2013 ${award.description}` : ''}`,
                size: pt(t.sizeBody),
              }),
            ],
            spacing: { after: twips(t.itemGap) },
          })
        );
      }
    }

    if (
      isVisible('publications') &&
      data.publications &&
      data.publications.length > 0
    ) {
      sections.push(this.createSectionHeading('Publications', t));
      for (const pub of data.publications) {
        sections.push(
          new Paragraph({
            children: [
              new TextRun({
                text: `${pub.title}${pub.publisher ? `, ${pub.publisher}` : ''}, ${pub.date}${pub.link ? ` [${pub.link}]` : ''}`,
                size: pt(t.sizeBody),
              }),
            ],
            spacing: { before: twips(t.bulletGap) },
          })
        );
      }
    }

    if (
      isVisible('affiliations') &&
      data.affiliations &&
      data.affiliations.length > 0
    ) {
      sections.push(this.createSectionHeading('Affiliations', t));
      for (const aff of data.affiliations) {
        sections.push(
          new Paragraph({
            children: [
              new TextRun({
                text: `${aff.role}, ${aff.organization} (${aff.startDate} \u2013 ${aff.endDate})`,
                size: pt(t.sizeBody),
              }),
            ],
            spacing: { before: twips(t.bulletGap) },
          })
        );
      }
    }

    if (isVisible('skills') && data.skills && data.skills.length > 0) {
      sections.push(this.createSectionHeading('Skills', t));
      if (data.skillCategories && data.skillCategories.length > 0) {
        const cats = data.skillCategories.filter(c => c.items && c.items.length > 0);
        cats.forEach((cat, i) => {
          sections.push(
            new Paragraph({
              children: [
                new TextRun({ text: `${cat.category}: `, bold: true, size: pt(t.sizeBody) }),
                new TextRun({ text: cat.items.join(', '), size: pt(t.sizeBody) }),
              ],
              spacing: { after: twips(i === cats.length - 1 ? t.itemGap : t.bulletGap) },
            })
          );
        });
      } else {
        sections.push(
          new Paragraph({
            children: [
              new TextRun({ text: data.skills.join(', '), size: pt(t.sizeBody) }),
            ],
            spacing: { after: twips(t.itemGap) },
          })
        );
      }
    }

    if (
      isVisible('languages') &&
      data.languages &&
      data.languages.length > 0
    ) {
      sections.push(this.createSectionHeading('Languages', t));
      const langLine = data.languages
        .filter((l) => l.name)
        .map((l) => `${l.name} (${l.proficiency})`)
        .join(', ');
      sections.push(
        new Paragraph({
          children: [new TextRun({ text: langLine, size: pt(t.sizeBody) })],
          spacing: { after: twips(t.itemGap) },
        })
      );
    }

    if (
      isVisible('references') &&
      data.references &&
      data.references.length > 0
    ) {
      sections.push(this.createSectionHeading('References', t));
      for (const ref of data.references) {
        sections.push(
          new Paragraph({
            children: [
              new TextRun({ text: ref.name || '', bold: true, size: pt(t.sizeBody) }),
            ],
            spacing: { before: twips(t.bulletGap) },
          })
        );
        const posOrg = [ref.position, ref.organization].filter(Boolean).join(', ');
        if (posOrg) {
          sections.push(
            new Paragraph({
              children: [new TextRun({ text: posOrg, size: pt(t.sizeBody) })],
            })
          );
        }
        const contact = [ref.email, ref.phone].filter(Boolean).join(' · ');
        if (contact) {
          sections.push(
            new Paragraph({
              children: [new TextRun({ text: contact, size: pt(t.sizeBody) })],
            })
          );
        }
        if (ref.relationship) {
          sections.push(
            new Paragraph({
              children: [new TextRun({ text: ref.relationship, size: pt(t.sizeBody) })],
              spacing: { after: twips(t.bulletGap) },
            })
          );
        }
      }
    }

    return sections;
  }

  private createSectionHeading(
    text: string,
    t: TemplateDefinition
  ): Paragraph {
    return new Paragraph({
      text,
      heading: HeadingLevel.HEADING_2,
      border:
        t.sectionDivider === 'rule'
          ? {
              bottom: {
                color: '000000',
                space: 1,
                style: BorderStyle.SINGLE,
                size: 6,
              },
            }
          : undefined,
    });
  }

  private createBullet(text: string, t: TemplateDefinition): Paragraph {
    return new Paragraph({
      children: [new TextRun({ text, size: pt(t.sizeBody) })],
      bullet: { level: 0 },
      spacing: { before: twips(t.bulletGap), after: twips(t.bulletGap) },
    });
  }

  // ────────────────────────────────────────────────────────────
  // COVER LETTER
  // ────────────────────────────────────────────────────────────

  private createCoverLetterDocument(
    data: ResumeData,
    t: TemplateDefinition
  ): Document {
    const fontFamily = pdfFontToWordFont(t.pdfFont);
    const paragraphs: Paragraph[] = [];
    const today = new Date().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    // Sender block
    paragraphs.push(
      new Paragraph({
        children: [
          new TextRun({
            text: data.personalInfo.fullName,
            bold: true,
            size: pt(t.sizeItemTitle),
            font: fontFamily,
          }),
        ],
        spacing: { after: twips(2) },
      })
    );
    const senderFields = [
      data.personalInfo.email,
      data.personalInfo.phone,
      data.personalInfo.location,
      data.personalInfo.linkedin,
    ].filter(Boolean) as string[];
    for (const line of senderFields) {
      paragraphs.push(
        new Paragraph({
          children: [
            new TextRun({ text: line, size: pt(t.sizeBody), font: fontFamily }),
          ],
          spacing: { after: twips(1) },
        })
      );
    }

    paragraphs.push(
      new Paragraph({ text: '', spacing: { after: twips(t.sectionGapBefore) } })
    );

    // Date
    paragraphs.push(
      new Paragraph({
        children: [
          new TextRun({ text: today, size: pt(t.sizeBody), font: fontFamily }),
        ],
        spacing: { after: twips(t.sectionGapBefore) },
      })
    );

    // Recipient
    paragraphs.push(
      new Paragraph({
        children: [
          new TextRun({
            text: 'Hiring Manager',
            size: pt(t.sizeBody),
            font: fontFamily,
          }),
        ],
        spacing: { after: twips(2) },
      })
    );
    if (data.targetJob.company) {
      paragraphs.push(
        new Paragraph({
          children: [
            new TextRun({
              text: data.targetJob.company,
              size: pt(t.sizeBody),
              font: fontFamily,
            }),
          ],
          spacing: { after: twips(t.sectionGapBefore) },
        })
      );
    } else {
      paragraphs.push(
        new Paragraph({ text: '', spacing: { after: twips(t.itemGap) } })
      );
    }

    // Salutation
    paragraphs.push(
      new Paragraph({
        children: [
          new TextRun({
            text: 'Dear Hiring Manager,',
            size: pt(t.sizeBody),
            font: fontFamily,
          }),
        ],
        spacing: { after: twips(t.sectionGapBefore) },
      })
    );

    // Body
    const coverLetterText = data.coverLetter || '';
    const bodyParagraphs = coverLetterText
      .split(/\n\s*\n/)
      .filter((p) => p.trim().length > 0)
      .map((p) => p.trim());

    bodyParagraphs.forEach((para, index) => {
      paragraphs.push(
        new Paragraph({
          children: [
            new TextRun({ text: para, size: pt(t.sizeBody), font: fontFamily }),
          ],
          spacing: {
            after: twips(
              index < bodyParagraphs.length - 1 ? t.itemGap : t.sectionGapBefore
            ),
          },
          alignment: AlignmentType.JUSTIFIED,
        })
      );
    });

    // Closing
    paragraphs.push(
      new Paragraph({
        children: [
          new TextRun({
            text: 'Sincerely,',
            size: pt(t.sizeBody),
            font: fontFamily,
          }),
        ],
        spacing: { before: twips(t.sectionGapBefore), after: twips(t.sectionGapBefore * 2) },
      })
    );

    // Signature
    paragraphs.push(
      new Paragraph({
        children: [
          new TextRun({
            text: data.personalInfo.fullName,
            bold: true,
            size: pt(t.sizeBody),
            font: fontFamily,
          }),
        ],
        spacing: { after: twips(t.bulletGap) },
      })
    );

    return new Document({
      sections: [
        {
          properties: {
            page: {
              margin: {
                top: twips(t.margin),
                right: twips(t.margin),
                bottom: twips(t.margin),
                left: twips(t.margin),
              },
            },
          },
          children: paragraphs,
        },
      ],
    });
  }
}
