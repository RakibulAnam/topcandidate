// Template definitions for ATS-safe resume variants.
//
// All values are in POINTS (pt). The PDF exporter consumes them directly
// (jsPDF's default unit is pt). The Preview component consumes them as CSS
// `pt` values (CSS supports pt natively). This guarantees WYSIWYG between
// preview and downloaded PDF — no separate sizing constants to drift apart.
//
// Every template is single-column, real-text, no icons / no tables / no
// columns / no rasterization — i.e. structurally ATS-safe regardless of
// which one the user picks. The only differences between templates are
// typography (font family, sizes), header alignment, and whitespace density.

import { ResumeTemplate } from '../../domain/entities/Resume';

export interface TemplateDefinition {
    id: ResumeTemplate;
    displayName: string;
    description: string;

    // Font — must map to a jsPDF Standard Type 1 font (helvetica | times |
    // courier). These are guaranteed text-extractable by every ATS parser.
    pdfFont: 'helvetica' | 'times' | 'courier';
    // CSS font-family used by Preview to mirror the PDF visual.
    cssFont: string;

    // Font sizes in points
    sizeName: number;
    sizeHeading: number;     // section heading (EXPERIENCE, EDUCATION…)
    sizeItemTitle: number;   // role / school / project name
    sizeBody: number;        // bullet text, summary
    sizeMeta: number;        // dates, company italic line

    // Line height multiplier
    lineHeight: number;

    // Page margin in points
    margin: number;

    // Spacing in points
    sectionGapBefore: number; // vertical gap before each section heading
    headingGapAfter: number;  // gap between heading underline and first item
    itemGap: number;          // gap between items within a section
    bulletGap: number;        // gap between bullets within an item

    // Layout
    headerAlignment: 'left' | 'center';
    sectionDivider: 'rule' | 'none';
    nameStyle: 'bold' | 'uppercase';
}

export const templateRegistry: Record<ResumeTemplate, TemplateDefinition> = {
    'ats-classic': {
        id: 'ats-classic',
        displayName: 'ATS Classic',
        description:
            'Left-aligned Helvetica with bold uppercase section headings and a thin underline. The most universally compatible layout — the safest default for any application.',
        pdfFont: 'helvetica',
        cssFont:
            "'Helvetica Neue', Helvetica, Arial, 'Liberation Sans', sans-serif",
        sizeName: 20,
        sizeHeading: 11,
        sizeItemTitle: 10.5,
        sizeBody: 10,
        sizeMeta: 9.5,
        lineHeight: 1.25,
        margin: 40,
        sectionGapBefore: 14,
        headingGapAfter: 8,
        itemGap: 8,
        bulletGap: 2,
        headerAlignment: 'left',
        sectionDivider: 'rule',
        nameStyle: 'bold',
    },
    'ats-modern': {
        id: 'ats-modern',
        displayName: 'ATS Modern',
        description:
            'Centered name and contact line with bold uppercase section headings. Same parser-safe structure as Classic — just a more modern, balanced visual.',
        pdfFont: 'helvetica',
        cssFont:
            "'Helvetica Neue', Helvetica, Arial, 'Liberation Sans', sans-serif",
        sizeName: 22,
        sizeHeading: 11,
        sizeItemTitle: 10.5,
        sizeBody: 10,
        sizeMeta: 9.5,
        lineHeight: 1.3,
        margin: 42,
        sectionGapBefore: 16,
        headingGapAfter: 8,
        itemGap: 9,
        bulletGap: 2,
        headerAlignment: 'center',
        sectionDivider: 'rule',
        nameStyle: 'bold',
    },
    'ats-serif': {
        id: 'ats-serif',
        displayName: 'ATS Serif',
        description:
            'Times Roman, left-aligned, with bold uppercase headings and a thin underline. Traditional, conservative tone preferred in finance, law, and academia.',
        pdfFont: 'times',
        cssFont:
            "'Times New Roman', 'Liberation Serif', 'DejaVu Serif', Times, serif",
        sizeName: 20,
        sizeHeading: 11.5,
        sizeItemTitle: 11,
        sizeBody: 10.5,
        sizeMeta: 10,
        lineHeight: 1.3,
        margin: 44,
        sectionGapBefore: 14,
        headingGapAfter: 7,
        itemGap: 8,
        bulletGap: 2,
        headerAlignment: 'left',
        sectionDivider: 'rule',
        nameStyle: 'bold',
    },
    'ats-compact': {
        id: 'ats-compact',
        displayName: 'ATS Compact',
        description:
            'Helvetica with tighter spacing and slightly smaller type so longer histories fit on one page. Same parser-safe structure as Classic.',
        pdfFont: 'helvetica',
        cssFont:
            "'Helvetica Neue', Helvetica, Arial, 'Liberation Sans', sans-serif",
        sizeName: 18,
        sizeHeading: 10.5,
        sizeItemTitle: 10,
        sizeBody: 9.5,
        sizeMeta: 9,
        lineHeight: 1.2,
        margin: 32,
        sectionGapBefore: 10,
        headingGapAfter: 5,
        itemGap: 5,
        bulletGap: 1,
        headerAlignment: 'left',
        sectionDivider: 'rule',
        nameStyle: 'bold',
    },
};

// Backward-compatibility map for resumes saved before the template overhaul.
// Old IDs ('classic', 'executive', 'minimal', 'compact', 'technical') are
// transparently resolved to their closest current equivalent so existing
// saved resumes continue to render without forcing a data migration.
const LEGACY_TEMPLATE_MAP: Record<string, ResumeTemplate> = {
    classic: 'ats-classic',
    executive: 'ats-modern',
    minimal: 'ats-classic',
    compact: 'ats-compact',
    technical: 'ats-classic',
};

export function resolveTemplate(id: string | undefined | null): TemplateDefinition {
    if (id && id in templateRegistry) {
        return templateRegistry[id as ResumeTemplate];
    }
    if (id && id in LEGACY_TEMPLATE_MAP) {
        return templateRegistry[LEGACY_TEMPLATE_MAP[id]];
    }
    return templateRegistry['ats-classic'];
}

export const DEFAULT_TEMPLATE_ID: ResumeTemplate = 'ats-classic';
