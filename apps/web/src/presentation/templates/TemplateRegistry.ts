// Template definitions for ATS-safe resume variants.
//
// All values are in POINTS (pt). The PDF exporter consumes them directly
// (jsPDF's default unit is pt). The Preview component consumes them as CSS
// `pt` values (CSS supports pt natively). This guarantees WYSIWYG between
// preview and downloaded PDF — no separate sizing constants to drift apart.
//
// Every template is single-column, real-text, no icons / no tables / no
// columns / no rasterization — i.e. structurally ATS-safe regardless of
// which one the user picks. Templates differ in typography (font family,
// sizes), header treatment (alignment + an optional full-width letterhead
// rule), section-heading style (full underline / rule-to-the-right / plain
// tracked caps), name treatment (bold title-case vs tracked uppercase), and
// whitespace density. None of these affect parseability.

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
    // A full-width horizontal rule beneath the header block (name + contact) —
    // a "letterhead" divider. ATS-safe (it's a paragraph border / drawn line,
    // not a table).
    headerRule: boolean;
    // Section-heading treatment:
    //  - 'rule-under'  : bold caps above a full-width underline (Classic/Modern)
    //  - 'rule-right'  : bold caps with a thin rule filling the width to its right
    //  - 'plain-caps'  : bold tracked caps, no rule (Compact)
    headingStyle: 'rule-under' | 'rule-right' | 'plain-caps';
    nameStyle: 'bold' | 'uppercase';
}

export const templateRegistry: Record<ResumeTemplate, TemplateDefinition> = {
    'ats-classic': {
        id: 'ats-classic',
        displayName: 'Classic',
        description:
            'Left-aligned Helvetica, underlined section headings. The most universally compatible layout — the safe default for any application.',
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
        headerRule: false,
        headingStyle: 'rule-under',
        nameStyle: 'bold',
    },
    'ats-modern': {
        id: 'ats-modern',
        displayName: 'Modern',
        description:
            'Centered name and contact under a full-width letterhead rule, with underlined headings. Balanced and contemporary.',
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
        headerRule: true,
        headingStyle: 'rule-under',
        nameStyle: 'bold',
    },
    'ats-serif': {
        id: 'ats-serif',
        displayName: 'Serif',
        description:
            'Times Roman with headings that trail a thin rule to the right margin. Traditional tone preferred in finance, law, and academia.',
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
        headerRule: false,
        headingStyle: 'rule-right',
        nameStyle: 'bold',
    },
    'ats-compact': {
        id: 'ats-compact',
        displayName: 'Compact',
        description:
            'Tighter spacing, smaller type, and rule-free tracked headings so longer histories fit on one page.',
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
        headerRule: false,
        headingStyle: 'plain-caps',
        nameStyle: 'bold',
    },
    'ats-executive': {
        id: 'ats-executive',
        displayName: 'Executive',
        description:
            'A tracked uppercase name over a full-width letterhead rule, with headings that trail a rule to the right. An authoritative, senior look.',
        pdfFont: 'helvetica',
        cssFont:
            "'Helvetica Neue', Helvetica, Arial, 'Liberation Sans', sans-serif",
        sizeName: 21,
        sizeHeading: 11,
        sizeItemTitle: 10.5,
        sizeBody: 10,
        sizeMeta: 9.5,
        lineHeight: 1.3,
        margin: 44,
        sectionGapBefore: 16,
        headingGapAfter: 8,
        itemGap: 9,
        bulletGap: 2,
        headerAlignment: 'left',
        headerRule: true,
        headingStyle: 'rule-right',
        nameStyle: 'uppercase',
    },
};

// Backward-compatibility map for resumes saved before the template overhaul.
// Old IDs ('classic', 'executive', 'minimal', 'compact', 'technical') are
// transparently resolved to their closest current equivalent so existing
// saved resumes continue to render without forcing a data migration.
const LEGACY_TEMPLATE_MAP: Record<string, ResumeTemplate> = {
    classic: 'ats-classic',
    executive: 'ats-executive',
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
