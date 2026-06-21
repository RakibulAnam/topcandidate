// Presentation Layer - Preview Component
//
// Renders the resume on screen using the SAME numeric values (in pt) that
// the PDF exporter consumes, so what the user sees is what they download.
// All variants are single-column, real-text, no icons / no tables — i.e.
// structurally ATS-safe regardless of which template the user picks.

import React, { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { toast } from 'sonner';
import { ResumeData, ToolkitItem, awardDetailText } from '../../domain/entities/Resume';
import {
  templateRegistry,
  resolveTemplate,
  TemplateDefinition,
} from '../templates/TemplateRegistry';
import {
  buildContactSegments,
  normalizeWebUrl,
  toMailto,
  toTel,
  CONTACT_SEPARATOR,
  type ContactSegment,
} from '../templates/contactLinks';
import {
  Download,
  FileText,
  ArrowLeft,
  FileCheck,
  RefreshCw,
  Lock,
  Loader2,
  Mail,
  Linkedin,
  MessageSquare,
  AlertTriangle,
  Circle,
  Pencil,
  PencilOff,
  X,
  ChevronDown,
  MoreVertical,
  Check,
  LayoutTemplate,
} from 'lucide-react';
import { EditableElement } from './EditableElement';
import {
  OutreachEmailViewer,
  LinkedInMessageViewer,
  InterviewPrepViewer,
  ToolkitStatusCard,
  ToolkitItemStatus,
} from './Builder/ToolkitViewers';
import { useT } from '../i18n/LocaleContext';

type PreviewTab = 'resume' | 'coverLetter' | 'outreachEmail' | 'linkedInMessage' | 'interviewPrep';

const getItemStatus = (
  data: ResumeData,
  item: ToolkitItem,
  regeneratingItem: ToolkitItem | null,
  toolkitPending = false,
): ToolkitItemStatus => {
  if (regeneratingItem === item) return 'regenerating';
  if (data.toolkit?.errors?.[item]) return 'failed';
  let present: boolean;
  switch (item) {
    case 'coverLetter':
      present = !!data.coverLetter;
      break;
    case 'outreachEmail':
      present = !!data.toolkit?.outreachEmail;
      break;
    case 'linkedInMessage':
      present = !!data.toolkit?.linkedInMessage;
      break;
    case 'interviewQuestions':
      present = (data.toolkit?.interviewQuestions?.length ?? 0) > 0;
      break;
  }
  if (present) return 'success';
  // The initial toolkit bundle runs as its own request after the resume
  // appears — while it's in flight, absent slots are "generating", not
  // "missing" (missing implies the user has to act).
  return toolkitPending ? 'regenerating' : 'missing';
};

const StatusDot: React.FC<{ status: ToolkitItemStatus }> = ({ status }) => {
  if (status === 'success') {
    return null;
  }
  if (status === 'regenerating') {
    return <Loader2 size={12} className="animate-spin text-brand-500 shrink-0" />;
  }
  if (status === 'failed') {
    return <AlertTriangle size={12} className="text-red-600 shrink-0" aria-label="Generation failed" />;
  }
  return <Circle size={10} className="text-charcoal-400 shrink-0" aria-label="Not generated" />;
};

// A4 page dimensions in points (matches PDF exporter exactly)
const PAGE_WIDTH_PT = 595.28;
const PAGE_HEIGHT_PT = 841.89;

// The fixed resume sheet is sized in pt and must stay pixel-identical to the
// PDF (CLAUDE.md rule 7) — so on narrow screens we do NOT reflow it; we SCALE
// the whole pt sheet to fit the viewport width via a CSS transform.
// 1pt = 1/72in, 1 CSS px = 1/96in → pt × 96/72 = CSS px.
const SHEET_PX_WIDTH = PAGE_WIDTH_PT * (96 / 72); // ≈ 793.7

type ZoomMode = 'fit' | 'actual';

/**
 * Wraps a fixed-width pt "sheet" and scales it to fit the available width.
 *  - zoom 'fit'    → scale = min(1, containerWidth / sheetWidth). On desktop
 *    (container ≥ ~794px) scale clamps to 1, so desktop is visually unchanged.
 *  - zoom 'actual' → scale = 1 (the pane scrolls horizontally; an explicit
 *    user choice to view at full size and pan).
 * The transform is compositor-only (no reflow). An outer box reserves the
 * SCALED footprint so there's no spurious horizontal scroll and vertical space
 * is correct even as the document grows multi-page (ResizeObserver re-measures).
 */
const ScaledDocument: React.FC<{ zoom: ZoomMode; children: React.ReactNode }> = ({
  zoom,
  children,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [scaledHeight, setScaledHeight] = useState(0);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const sheet = sheetRef.current;
    if (!container || !sheet) return;

    const recompute = () => {
      const avail = container.clientWidth;
      const s = zoom === 'actual' ? 1 : Math.min(1, avail / SHEET_PX_WIDTH);
      setScale(s);
      // offsetHeight is the UNSCALED layout height (transform doesn't change it).
      setScaledHeight(sheet.offsetHeight * s);
    };

    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(container); // width changes (viewport/orientation)
    ro.observe(sheet); // height changes (template switch, edits, page growth)
    return () => ro.disconnect();
  }, [zoom]);

  return (
    <div
      ref={containerRef}
      className={`w-full flex ${zoom === 'actual' ? 'justify-start' : 'justify-center'}`}
    >
      <div
        style={{
          width: SHEET_PX_WIDTH * scale,
          height: scaledHeight || undefined,
          // Don't let the flex parent shrink this below its explicit width —
          // otherwise at 100% (scale 1, box = 794px) it collapses to the pane
          // width and `overflow: hidden` clips the sheet's right edge instead
          // of letting the scroll pane pan. In 'fit' mode the box already
          // equals the container width, so this is a no-op there.
          flexShrink: 0,
          // Clip the unscaled layout box so it never leaks into the pane's
          // horizontal scroll width. The visible scaled sheet fills this box
          // exactly (transformOrigin top-left + matching scale), so nothing
          // visible is clipped. At 100% the box matches the sheet 1:1, so the
          // ancestor pane (overflow-x: auto) provides the horizontal pan.
          overflow: 'hidden',
        }}
      >
        <div
          ref={sheetRef}
          style={{
            width: SHEET_PX_WIDTH,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
};

/** Renders text as an external link when an href is present, else plain text.
 *  `color: inherit` keeps the resume's #000 ink (brand forbids blue/purple);
 *  affordance is a hover underline. ATS reads the visible URL regardless. */
const LinkableText: React.FC<{ href?: string; children: React.ReactNode }> = ({
  href,
  children,
}) =>
  href ? (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="hover:underline focus-visible:underline"
      style={{ color: 'inherit' }}
    >
      {children}
    </a>
  ) : (
    <>{children}</>
  );

/** The pipe-separated contact line, with linkable segments wrapped in <a>. */
const ContactSegmentsLine: React.FC<{
  segments: ContactSegment[];
  style: React.CSSProperties;
}> = ({ segments, style }) => (
  <div style={style}>
    {segments.map((seg, i) => (
      <React.Fragment key={i}>
        {i > 0 && <span>{CONTACT_SEPARATOR}</span>}
        <LinkableText href={seg.href}>{seg.text}</LinkableText>
      </React.Fragment>
    ))}
  </div>
);

const formatDate = (dateString: string | undefined): string => {
  if (!dateString) return '';
  const s = dateString.toLowerCase();
  if (s === 'present' || s === 'current') return 'Present';

  const match = dateString.match(/^(\d{4})-(\d{2})$/);
  if (match) {
    const year = parseInt(match[1], 10);
    const month = parseInt(match[2], 10) - 1;
    const date = new Date(year, month);
    return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  }
  return dateString;
};

interface PreviewProps {
  data: ResumeData;
  onUpdate: (data: ResumeData) => void;
  onExportWord: (data: ResumeData) => Promise<void>;
  onExportPDF: (data: ResumeData) => Promise<void>;
  onExportCoverLetter?: (data: ResumeData) => Promise<void>;
  onExportCoverLetterPDF?: (data: ResumeData) => Promise<void>;
  onGoHome: () => void;
  readOnly?: boolean;
  isGeneralResume?: boolean;
  onRegenerate?: () => Promise<void>;
  canRegenerate?: boolean;
  cooldownEndsAt?: Date | null;
  onRegenerateItem?: (item: ToolkitItem) => Promise<void>;
  regeneratingItem?: ToolkitItem | null;
  // True while the initial toolkit bundle (/api/toolkit) is still in flight —
  // absent artifacts render as "generating" spinners instead of "missing".
  toolkitPending?: boolean;
}

export const Preview: React.FC<PreviewProps> = ({
  data,
  onUpdate,
  onExportWord,
  onExportPDF,
  onExportCoverLetter,
  onExportCoverLetterPDF,
  onGoHome,
  readOnly = false,
  isGeneralResume = false,
  onRegenerate,
  canRegenerate = true,
  cooldownEndsAt,
  onRegenerateItem,
  regeneratingItem = null,
  toolkitPending = false,
}) => {
  const t = useT();
  const [isExporting, setIsExporting] = useState(false);
  const [activeTab, setActiveTab] = useState<PreviewTab>('resume');
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [cooldownText, setCooldownText] = useState<string | null>(null);
  const [isPdfGenerating, setIsPdfGenerating] = useState(false);
  // Document zoom for the resume / cover-letter sheet. 'fit' scales the pt
  // sheet to the viewport width (default — the right call on phones; clamps to
  // 100% on desktop). 'actual' shows it at full size and lets the pane pan.
  const [zoom, setZoom] = useState<ZoomMode>('fit');
  // Template picker is a quiet, opt-in control — never the start of the show.
  // `templatesOpen` drives the desktop sidebar disclosure (collapsed by
  // default) and the mobile bottom sheet. `showMenu` is the mobile app-bar
  // overflow (edit / regenerate / Word).
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  // Editing starts ON for a fresh generation (readOnly=false) and OFF for a
  // reopened/saved resume (readOnly=true) — but it's no longer permanent: the
  // user can toggle editing back on at any time, and edits autosave to the
  // saved resume (BuilderScreen persists them). So a typo found later is fixable.
  const [editModeActive, setEditModeActive] = useState(!readOnly);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  // Actual read-only state fed to EditableElement instances — driven purely by
  // the edit toggle now, not the (initial) readOnly prop.
  const isReadOnly = !editModeActive;

  useEffect(() => {
    if (!cooldownEndsAt || canRegenerate) {
      setCooldownText(null);
      return;
    }

    const updateCooldownText = () => {
      const now = new Date();
      const diffStr = cooldownEndsAt.getTime() - now.getTime();
      if (diffStr <= 0) {
        setCooldownText(null);
        return;
      }
      const hours = Math.floor(diffStr / (1000 * 60 * 60));
      const minutes = Math.floor((diffStr % (1000 * 60 * 60)) / (1000 * 60));
      setCooldownText(t('preview.cooldownText', { h: hours, m: minutes }));
    };

    updateCooldownText();
    const interval = setInterval(updateCooldownText, 60000);
    return () => clearInterval(interval);
  }, [cooldownEndsAt, canRegenerate]);

  const template: TemplateDefinition = resolveTemplate(data.template);

  // Pipe-separated contact line as ordered segments (email · phone · location
  // · linkedin · github · website). Mirrors the PDF/Word exporters exactly via
  // the shared helper. Linkable segments render as <a>; the VISIBLE text stays
  // the full URL/address so ATS parsers still read it. Avoids Unicode icons
  // (✉ ☎ ⌂) which can confuse some ATS parsers.
  const contactSegments = buildContactSegments(data.personalInfo);

  // Wrapper sheet — A4 in pt. Padding = template.margin pt on all sides.
  const sheetStyle: React.CSSProperties = {
    width: `${PAGE_WIDTH_PT}pt`,
    minHeight: `${PAGE_HEIGHT_PT}pt`,
    padding: `${template.margin}pt`,
    backgroundColor: '#fff',
    color: '#000',
    fontFamily: template.cssFont,
    fontSize: `${template.sizeBody}pt`,
    lineHeight: template.lineHeight,
    boxSizing: 'border-box',
  };

  const headerStyle: React.CSSProperties = {
    textAlign: template.headerAlignment,
    marginBottom: `${template.sectionGapBefore}pt`,
  };

  const nameStyle: React.CSSProperties = {
    fontSize: `${template.sizeName}pt`,
    fontWeight: 700,
    margin: 0,
    lineHeight: 1.1,
    letterSpacing: template.nameStyle === 'uppercase' ? '0.06em' : 'normal',
    textTransform: template.nameStyle === 'uppercase' ? 'uppercase' : 'none',
  };

  const contactLineStyle: React.CSSProperties = {
    fontSize: `${template.sizeBody}pt`,
    marginTop: `${template.sizeBody * 0.4}pt`,
    color: '#000',
    wordBreak: 'break-word',
  };

  const sectionStyle: React.CSSProperties = {
    marginTop: `${template.sectionGapBefore}pt`,
  };

  const sectionHeadingStyle: React.CSSProperties = {
    fontSize: `${template.sizeHeading}pt`,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    margin: 0,
    paddingBottom:
      template.sectionDivider === 'rule' ? `${template.headingGapAfter / 2}pt` : 0,
    borderBottom:
      template.sectionDivider === 'rule' ? '0.6pt solid #000' : 'none',
    marginBottom: `${template.headingGapAfter}pt`,
  };

  const itemBlockStyle: React.CSSProperties = {
    marginBottom: `${template.itemGap}pt`,
  };

  const itemTitleRowStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    flexWrap: 'wrap',
    gap: '8pt',
  };

  const itemTitleStyle: React.CSSProperties = {
    fontSize: `${template.sizeItemTitle}pt`,
    fontWeight: 700,
    margin: 0,
  };

  const itemMetaStyle: React.CSSProperties = {
    fontSize: `${template.sizeMeta}pt`,
    fontWeight: 600,
    whiteSpace: 'nowrap',
  };

  const italicLineStyle: React.CSSProperties = {
    fontSize: `${template.sizeMeta}pt`,
    fontStyle: 'italic',
    margin: `2pt 0 ${template.bulletGap + 2}pt 0`,
  };

  const bulletListStyle: React.CSSProperties = {
    listStyleType: 'disc',
    paddingLeft: '14pt',
    margin: 0,
  };

  const bulletItemStyle: React.CSSProperties = {
    fontSize: `${template.sizeBody}pt`,
    marginBottom: `${template.bulletGap}pt`,
    lineHeight: template.lineHeight,
  };

  const bodyTextStyle: React.CSSProperties = {
    fontSize: `${template.sizeBody}pt`,
    margin: `2pt 0`,
    whiteSpace: 'pre-line',
  };

  const isVisible = (key: string) =>
    !data.visibleSections || data.visibleSections.includes(key);

  // ────────────────────────────────────────────────────────────
  // EXPORT HANDLERS
  // ────────────────────────────────────────────────────────────

  const handleWordExport = async () => {
    setIsExporting(true);
    try {
      await onExportWord(data);
      toast.success(t('preview.resumeWordSuccess'));
    } catch (error) {
      console.error('Export failed', error);
      toast.error(
        t('preview.wordExportFailed', { message: error instanceof Error ? error.message : t('preview.unknownError') })
      );
    } finally {
      setIsExporting(false);
    }
  };

  const handleCoverLetterExport = async () => {
    if (!onExportCoverLetter) return;
    setIsExporting(true);
    try {
      await onExportCoverLetter(data);
      toast.success(t('preview.coverLetterWordSuccess'));
    } catch (error) {
      console.error('Cover letter export failed', error);
      toast.error(
        t('preview.coverLetterExportFailed', { message: error instanceof Error ? error.message : t('preview.unknownError') })
      );
    } finally {
      setIsExporting(false);
    }
  };

  const handlePDFExport = async () => {
    if (isPdfGenerating) return;

    if (activeTab === 'coverLetter' && !onExportCoverLetterPDF) {
      toast.error(t('preview.pdfNotAvailable'));
      return;
    }

    setIsPdfGenerating(true);
    try {
      if (activeTab === 'resume') {
        await onExportPDF(data);
      } else if (onExportCoverLetterPDF) {
        await onExportCoverLetterPDF(data);
      }
      toast.success(t('preview.pdfSuccess'));
    } catch (error) {
      console.error('PDF export failed:', error);
      toast.error(
        t('preview.pdfExportFailed', { message: error instanceof Error ? error.message : t('preview.unknownError') })
      );
    } finally {
      setIsPdfGenerating(false);
    }
  };

  // ────────────────────────────────────────────────────────────
  // RESUME BODY (mirrors PdfResumeExporter section by section)
  // ────────────────────────────────────────────────────────────

  const resumeContent = (
    <div id="resume-source" style={sheetStyle}>
      {/* Header — name + plain pipe-separated contact line (no icons) */}
      <header style={headerStyle}>
        <EditableElement
          as="h1"
          value={data.personalInfo.fullName}
          onSave={(val) =>
            onUpdate({
              ...data,
              personalInfo: { ...data.personalInfo, fullName: val },
            })
          }
          style={nameStyle}
          placeholder="YOUR NAME"
          readOnly={isReadOnly}
        />
        {contactSegments.length > 0 && (
          <ContactSegmentsLine segments={contactSegments} style={contactLineStyle} />
        )}
      </header>

      {data.summary && (
        <section style={sectionStyle}>
          <h3 style={sectionHeadingStyle}>Professional Summary</h3>
          <EditableElement
            as="p"
            multiline
            value={data.summary || ''}
            onSave={(val) => onUpdate({ ...data, summary: val })}
            style={{
              fontSize: `${template.sizeBody}pt`,
              lineHeight: template.lineHeight,
              margin: 0,
              whiteSpace: 'pre-line',
            }}
            placeholder="Add a professional summary..."
            readOnly={isReadOnly}
          />
        </section>
      )}

      {isVisible('experience') && data.experience.length > 0 && (
        <section style={sectionStyle}>
          <h3 style={sectionHeadingStyle}>Experience</h3>
          {data.experience.map((exp, expIdx) => (
            <div key={exp.id} style={itemBlockStyle}>
              <div style={itemTitleRowStyle}>
                <EditableElement
                  as="h4"
                  value={exp.role}
                  onSave={(val) => {
                    const newExp = [...data.experience];
                    newExp[expIdx] = { ...newExp[expIdx], role: val };
                    onUpdate({ ...data, experience: newExp });
                  }}
                  style={itemTitleStyle}
                  placeholder="Role"
                  readOnly={isReadOnly}
                />
                <span style={itemMetaStyle}>
                  {formatDate(exp.startDate)} –{' '}
                  {exp.isCurrent ? 'Present' : formatDate(exp.endDate)}
                </span>
              </div>
              <EditableElement
                value={exp.company}
                onSave={(val) => {
                  const newExp = [...data.experience];
                  newExp[expIdx] = { ...newExp[expIdx], company: val };
                  onUpdate({ ...data, experience: newExp });
                }}
                style={italicLineStyle}
                placeholder="Company"
                readOnly={isReadOnly}
              />
              {exp.refinedBullets && exp.refinedBullets.length > 0 ? (
                <ul style={bulletListStyle}>
                  {exp.refinedBullets.map((bullet, idx) => (
                    <li key={idx} style={bulletItemStyle}>
                      <EditableElement
                        multiline
                        value={bullet}
                        onSave={(val) => {
                          const newExp = [...data.experience];
                          const newBullets = [
                            ...(newExp[expIdx].refinedBullets || []),
                          ];
                          newBullets[idx] = val;
                          newExp[expIdx] = {
                            ...newExp[expIdx],
                            refinedBullets: newBullets,
                          };
                          onUpdate({ ...data, experience: newExp });
                        }}
                        readOnly={isReadOnly}
                      />
                    </li>
                  ))}
                </ul>
              ) : (
                <EditableElement
                  multiline
                  value={exp.rawDescription || ''}
                  onSave={(val) => {
                    const newExp = [...data.experience];
                    newExp[expIdx] = { ...newExp[expIdx], rawDescription: val };
                    onUpdate({ ...data, experience: newExp });
                  }}
                  placeholder="No description provided. Click to add one."
                  style={{ ...bodyTextStyle, fontStyle: 'italic' }}
                  readOnly={isReadOnly}
                />
              )}
            </div>
          ))}
        </section>
      )}

      {isVisible('projects') && data.projects && data.projects.length > 0 && (
        <section style={sectionStyle}>
          <h3 style={sectionHeadingStyle}>Projects</h3>
          {data.projects.map((project, projIdx) => (
            <div key={project.id} style={itemBlockStyle}>
              <div style={itemTitleRowStyle}>
                <h4 style={itemTitleStyle}>{project.name}</h4>
                {project.technologies && (
                  <span style={itemMetaStyle}>{project.technologies}</span>
                )}
              </div>
              {project.link && (
                <div style={{ ...italicLineStyle, fontStyle: 'normal' }}>
                  <LinkableText href={normalizeWebUrl(project.link)}>
                    {project.link}
                  </LinkableText>
                </div>
              )}
              {project.refinedBullets && project.refinedBullets.length > 0 ? (
                <ul style={bulletListStyle}>
                  {project.refinedBullets.map((bullet, idx) => (
                    <li key={idx} style={bulletItemStyle}>
                      <EditableElement
                        multiline
                        value={bullet}
                        onSave={(val) => {
                          const newProjects = [...data.projects];
                          const newBullets = [
                            ...(newProjects[projIdx].refinedBullets || []),
                          ];
                          newBullets[idx] = val;
                          newProjects[projIdx] = {
                            ...newProjects[projIdx],
                            refinedBullets: newBullets,
                          };
                          onUpdate({ ...data, projects: newProjects });
                        }}
                        readOnly={isReadOnly}
                      />
                    </li>
                  ))}
                </ul>
              ) : (
                <EditableElement
                  multiline
                  value={project.rawDescription || ''}
                  onSave={(val) => {
                    const newProjects = [...data.projects];
                    newProjects[projIdx] = {
                      ...newProjects[projIdx],
                      rawDescription: val,
                    };
                    onUpdate({ ...data, projects: newProjects });
                  }}
                  placeholder="No description provided. Click to add one."
                  style={{ ...bodyTextStyle, fontStyle: 'italic' }}
                  readOnly={isReadOnly}
                />
              )}
            </div>
          ))}
        </section>
      )}

      {isVisible('education') && data.education.length > 0 && (
        <section style={sectionStyle}>
          <h3 style={sectionHeadingStyle}>Education</h3>
          {data.education.map((edu) => (
            <div key={edu.id} style={itemBlockStyle}>
              <div style={itemTitleRowStyle}>
                <h4 style={itemTitleStyle}>{edu.school}</h4>
                <span style={itemMetaStyle}>
                  {formatDate(edu.startDate)} – {formatDate(edu.endDate)}
                </span>
              </div>
              <div style={bodyTextStyle}>
                {edu.degree}
                {edu.field ? ` in ${edu.field}` : ''}
                {edu.gpa ? ` • GPA: ${edu.gpa}` : ''}
              </div>
            </div>
          ))}
        </section>
      )}

      {isVisible('certifications') &&
        data.certifications &&
        data.certifications.length > 0 && (
          <section style={sectionStyle}>
            <h3 style={sectionHeadingStyle}>Certifications</h3>
            {data.certifications.map((cert) => (
              <div key={cert.id} style={itemBlockStyle}>
                <div style={itemTitleRowStyle}>
                  <h4 style={itemTitleStyle}>{cert.name}</h4>
                  <span style={itemMetaStyle}>{cert.date}</span>
                </div>
                <div style={italicLineStyle}>{cert.issuer}</div>
              </div>
            ))}
          </section>
        )}

      {isVisible('extracurriculars') &&
        data.extracurriculars &&
        data.extracurriculars.length > 0 && (
          <section style={sectionStyle}>
            <h3 style={sectionHeadingStyle}>Extracurricular Activities</h3>
            {data.extracurriculars.map((activity) => (
              <div key={activity.id} style={itemBlockStyle}>
                <div style={itemTitleRowStyle}>
                  <h4 style={itemTitleStyle}>{activity.title}</h4>
                  <span style={itemMetaStyle}>
                    {activity.startDate} – {activity.endDate}
                  </span>
                </div>
                <div style={italicLineStyle}>{activity.organization}</div>
                {activity.refinedBullets && activity.refinedBullets.length > 0 ? (
                  <ul style={bulletListStyle}>
                    {activity.refinedBullets.map((bullet, i) => (
                      <li key={i} style={bulletItemStyle}>
                        {bullet}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p style={bodyTextStyle}>
                    {activity.description || 'No description provided.'}
                  </p>
                )}
              </div>
            ))}
          </section>
        )}

      {isVisible('awards') && data.awards && data.awards.length > 0 && (
        <section style={sectionStyle}>
          <h3 style={sectionHeadingStyle}>Awards & Honors</h3>
          {data.awards.map((award) => (
            <div key={award.id} style={itemBlockStyle}>
              <div style={itemTitleRowStyle}>
                <h4 style={itemTitleStyle}>{award.title}</h4>
                <span style={itemMetaStyle}>{award.date}</span>
              </div>
              <div style={bodyTextStyle}>
                {award.issuer}
                {awardDetailText(award) ? ` – ${awardDetailText(award)}` : ''}
              </div>
            </div>
          ))}
        </section>
      )}

      {isVisible('publications') &&
        data.publications &&
        data.publications.length > 0 && (
          <section style={sectionStyle}>
            <h3 style={sectionHeadingStyle}>Publications</h3>
            {data.publications.map((pub) => (
              <div key={pub.id} style={bodyTextStyle}>
                {pub.title}
                {pub.publisher ? `, ${pub.publisher}` : ''}, {pub.date}
                {pub.link ? (
                  <>
                    {' ['}
                    <LinkableText href={normalizeWebUrl(pub.link)}>{pub.link}</LinkableText>
                    {']'}
                  </>
                ) : ''}
              </div>
            ))}
          </section>
        )}

      {isVisible('affiliations') &&
        data.affiliations &&
        data.affiliations.length > 0 && (
          <section style={sectionStyle}>
            <h3 style={sectionHeadingStyle}>Affiliations</h3>
            {data.affiliations.map((aff) => (
              <div key={aff.id} style={bodyTextStyle}>
                {aff.role}, {aff.organization}
                {aff.startDate
                  ? ` (${aff.startDate}${aff.endDate ? ` – ${aff.endDate}` : ' – Present'})`
                  : ''}
              </div>
            ))}
          </section>
        )}

      {isVisible('skills') && data.skills.length > 0 && (
        <section style={sectionStyle}>
          <h3 style={sectionHeadingStyle}>Skills</h3>
          {data.skillCategories && data.skillCategories.length > 0 ? (
            data.skillCategories.map((cat) => (
              <div key={cat.category} style={bodyTextStyle}>
                <span style={{ fontWeight: 600 }}>{cat.category}:</span>{' '}
                {cat.items.join(', ')}
              </div>
            ))
          ) : (
            <div style={bodyTextStyle}>{data.skills.join(', ')}</div>
          )}
        </section>
      )}

      {isVisible('languages') &&
        data.languages &&
        data.languages.length > 0 && (
          <section style={sectionStyle}>
            <h3 style={sectionHeadingStyle}>Languages</h3>
            <div style={bodyTextStyle}>
              {data.languages
                .filter((l) => l.name)
                .map((l) => `${l.name} (${l.proficiency})`)
                .join(', ')}
            </div>
          </section>
        )}

      {isVisible('references') &&
        data.references &&
        data.references.length > 0 && (
          <section style={sectionStyle}>
            <h3 style={sectionHeadingStyle}>References</h3>
            {data.references.map((ref) => (
              <div key={ref.id} style={{ ...bodyTextStyle, marginBottom: '6pt' }}>
                <div style={{ fontWeight: 600 }}>{ref.name}</div>
                <div>
                  {[ref.position, ref.organization].filter(Boolean).join(', ')}
                </div>
                <div>
                  {ref.email && (
                    <LinkableText href={toMailto(ref.email)}>{ref.email}</LinkableText>
                  )}
                  {ref.email && ref.phone && ' · '}
                  {ref.phone && (
                    <LinkableText href={toTel(ref.phone)}>{ref.phone}</LinkableText>
                  )}
                </div>
                {ref.relationship && <div>{ref.relationship}</div>}
              </div>
            ))}
          </section>
        )}
    </div>
  );

  // ────────────────────────────────────────────────────────────
  // COVER LETTER (matches PDF cover letter rendering)
  // ────────────────────────────────────────────────────────────

  const coverLetterFont = template.cssFont;
  const coverLetterContent = data.coverLetter && (
    <div
      id="cover-letter-source"
      style={{
        ...sheetStyle,
        fontFamily: coverLetterFont,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div style={{ marginBottom: `${template.sectionGapBefore}pt` }}>
        <div style={{ fontWeight: 700, fontSize: `${template.sizeItemTitle}pt` }}>
          {data.personalInfo.fullName}
        </div>
        <div style={{ fontSize: `${template.sizeBody}pt`, marginTop: '2pt' }}>
          {data.personalInfo.email && (
            <div>
              <LinkableText href={toMailto(data.personalInfo.email)}>
                {data.personalInfo.email}
              </LinkableText>
            </div>
          )}
          {data.personalInfo.phone && (
            <div>
              <LinkableText href={toTel(data.personalInfo.phone)}>
                {data.personalInfo.phone}
              </LinkableText>
            </div>
          )}
          {data.personalInfo.location && <div>{data.personalInfo.location}</div>}
          {data.personalInfo.linkedin && (
            <div>
              <LinkableText href={normalizeWebUrl(data.personalInfo.linkedin)}>
                {data.personalInfo.linkedin}
              </LinkableText>
            </div>
          )}
        </div>
      </div>

      <div
        style={{
          marginBottom: `${template.sectionGapBefore}pt`,
          fontSize: `${template.sizeBody}pt`,
        }}
      >
        {new Date().toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        })}
      </div>

      <div
        style={{
          marginBottom: `${template.sectionGapBefore}pt`,
          fontSize: `${template.sizeBody}pt`,
        }}
      >
        <div>Hiring Manager</div>
        {data.targetJob.company && <div>{data.targetJob.company}</div>}
      </div>

      <div
        style={{
          marginBottom: `${template.itemGap}pt`,
          fontSize: `${template.sizeBody}pt`,
        }}
      >
        Dear Hiring Manager,
      </div>

      <div style={{ flex: 1 }}>
        {data.coverLetter
          .split(/\n\s*\n/)
          .filter((p) => p.trim().length > 0)
          .map((paragraph, idx) => (
            <p
              key={idx}
              style={{
                fontSize: `${template.sizeBody}pt`,
                lineHeight: template.lineHeight,
                margin: `0 0 ${template.itemGap}pt 0`,
                textAlign: 'justify',
              }}
            >
              {paragraph.trim()}
            </p>
          ))}
      </div>

      <div style={{ marginTop: `${template.sectionGapBefore}pt` }}>
        <div
          style={{
            fontSize: `${template.sizeBody}pt`,
            marginBottom: `${template.sectionGapBefore * 2}pt`,
          }}
        >
          Sincerely,
        </div>
        <div style={{ fontWeight: 700, fontSize: `${template.sizeBody}pt` }}>
          {data.personalInfo.fullName}
        </div>
      </div>
    </div>
  );

  // ────────────────────────────────────────────────────────────
  // SHELL
  // ────────────────────────────────────────────────────────────

  // Unified artifact navigation. "Resume" is now ONE destination (the template
  // is a separate, opt-in control) — so the document, not the template grid, is
  // the start of the show. Used by both the mobile tab rail and desktop sidebar.
  const statusOf = (item: ToolkitItem) => getItemStatus(data, item, regeneratingItem, toolkitPending);
  const TABS: { id: PreviewTab; label: string; icon: typeof FileText; status?: ToolkitItem }[] = [
    { id: 'resume', label: t('preview.tabResume'), icon: FileText },
    { id: 'coverLetter', label: t('preview.tabCoverLetter'), icon: FileCheck, status: 'coverLetter' },
    { id: 'outreachEmail', label: t('preview.tabOutreachEmail'), icon: Mail, status: 'outreachEmail' },
    { id: 'linkedInMessage', label: t('preview.tabLinkedIn'), icon: Linkedin, status: 'linkedInMessage' },
    { id: 'interviewPrep', label: t('preview.tabQuestionPrep'), icon: MessageSquare, status: 'interviewQuestions' },
  ];
  const isDocTab = activeTab === 'resume' || activeTab === 'coverLetter';

  // Template option rows — reused by the desktop sidebar disclosure and the
  // mobile bottom sheet. Picking one selects the Resume tab and closes the sheet.
  const renderTemplateOptions = (onPick?: () => void) => (
    <div className="flex flex-col gap-1.5">
      {Object.values(templateRegistry).map((tpl) => {
        const active = template.id === tpl.id;
        return (
          <button
            type="button"
            key={tpl.id}
            onClick={() => {
              setActiveTab('resume');
              onUpdate({ ...data, template: tpl.id });
              onPick?.();
            }}
            className={`flex items-start gap-3 text-left px-3 py-2.5 rounded-lg border transition-colors ${
              active ? 'bg-accent-50 border-accent-200' : 'bg-white border-charcoal-200 hover:bg-charcoal-50'
            }`}
          >
            <Check size={16} className={`mt-0.5 shrink-0 ${active ? 'text-accent-600' : 'text-transparent'}`} />
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-brand-700">{tpl.displayName}</span>
              <span className="block text-[11px] text-brand-500 leading-snug mt-0.5">{tpl.description}</span>
            </span>
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="flex flex-col h-dvh bg-charcoal-50 overflow-hidden">
      {/* ── Mobile app bar — slim identity + overflow menu. The document is the
          hero; chrome stays out of its way. ───────────────────────────────── */}
      <header className="md:hidden sticky top-0 z-20 flex items-center gap-1 px-3 h-14 bg-white border-b border-charcoal-200 shrink-0">
        <button
          type="button"
          onClick={onGoHome}
          aria-label={t('preview.backToDashboard')}
          className="p-2 -ml-1 text-charcoal-600 hover:text-charcoal-900 rounded-lg shrink-0"
        >
          <ArrowLeft size={20} />
        </button>
        <h1 className="flex-1 min-w-0 truncate text-[15px] font-semibold text-charcoal-800">
          {data.targetJob?.title
            ? `${data.targetJob.title} ${t('preview.resumeTitleSuffix')}`
            : t('preview.resumeTitleFallback')}
        </h1>
        {(!isGeneralResume || isDocTab) && (
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setShowMenu(v => !v)}
              aria-label={t('preview.moreActions')}
              aria-expanded={showMenu}
              className="p-2 -mr-1 text-charcoal-600 hover:text-charcoal-900 rounded-lg"
            >
              <MoreVertical size={20} />
            </button>
            {showMenu && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setShowMenu(false)} aria-hidden />
                <div className="absolute right-0 top-full mt-1 z-30 w-56 bg-white border border-charcoal-200 rounded-xl shadow-lg py-1.5">
                  {!isGeneralResume && (
                    <button
                      type="button"
                      onClick={() => { setEditModeActive(v => !v); setShowMenu(false); }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm font-medium text-charcoal-700 hover:bg-charcoal-50 text-left"
                    >
                      {editModeActive ? <Pencil size={16} /> : <PencilOff size={16} />}
                      {editModeActive ? t('preview.editModeOn') : t('preview.editModeOff')}
                    </button>
                  )}
                  {isGeneralResume && (
                    <button
                      type="button"
                      disabled={!canRegenerate || isRegenerating}
                      onClick={async () => {
                        setShowMenu(false);
                        if (onRegenerate) {
                          setIsRegenerating(true);
                          try { await onRegenerate(); } finally { setIsRegenerating(false); }
                        }
                      }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm font-medium text-charcoal-700 hover:bg-charcoal-50 text-left disabled:opacity-50"
                    >
                      {isRegenerating ? <Loader2 size={16} className="animate-spin" /> : !canRegenerate ? <Lock size={16} /> : <RefreshCw size={16} />}
                      {!canRegenerate ? t('preview.regenerateLocked') : t('preview.regenerate')}
                    </button>
                  )}
                  {isDocTab && (
                    <button
                      type="button"
                      disabled={isExporting || (activeTab === 'coverLetter' && (!onExportCoverLetter || statusOf('coverLetter') !== 'success'))}
                      onClick={() => { setShowMenu(false); (activeTab === 'resume' ? handleWordExport : handleCoverLetterExport)(); }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm font-medium text-charcoal-700 hover:bg-charcoal-50 text-left disabled:opacity-50"
                    >
                      <FileText size={16} /> {t('preview.downloadWord')}
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </header>

      {/* ── Desktop header (unchanged identity + actions; zoom lives only on
          phones, where it earns its place) ────────────────────────────────── */}
      <header className="hidden md:flex sticky top-0 z-10 items-center justify-between px-6 py-4 bg-white border-b border-charcoal-200 shadow-sm shrink-0 gap-4">
        <div className="flex items-center justify-start gap-6">
          <button
            type="button"
            onClick={onGoHome}
            className="flex items-center gap-2 text-charcoal-500 hover:text-charcoal-900 transition-colors text-sm font-medium"
          >
            <ArrowLeft size={18} /> {t('preview.backToDashboard')}
          </button>

          <div className="h-6 w-px bg-charcoal-300"></div>

          <h1 className="text-lg font-semibold text-charcoal-800">
            {data.targetJob?.title
              ? `${data.targetJob.title} ${t('preview.resumeTitleSuffix')} - `
              : `${t('preview.resumeTitleFallback')} - `}
            {new Date().getFullYear()}
          </h1>
        </div>

        <div className="flex items-center gap-3 md:gap-4 w-full md:w-auto justify-end flex-wrap overflow-x-auto scrollbar-hide">
          {/* Edit mode toggle — always available; edits autosave so a resume
              can be re-edited later, not just on first generation. */}
          {!isGeneralResume && (
            <button
              type="button"
              onClick={() => setEditModeActive(v => !v)}
              className={`flex items-center gap-2 px-3.5 min-h-11 text-sm font-semibold rounded-md border shadow-sm transition-colors ${
                editModeActive
                  ? 'bg-accent-400 border-accent-500 text-brand-900 hover:bg-accent-500'
                  : 'bg-white border-charcoal-300 text-charcoal-600 hover:bg-charcoal-50'
              }`}
              title={editModeActive ? t('preview.editModeOn') : t('preview.editModeOff')}
            >
              {editModeActive
                ? <Pencil size={15} />
                : <PencilOff size={15} />}
              {editModeActive ? t('preview.editModeOn') : t('preview.editModeOff')}
            </button>
          )}
          {isGeneralResume && (
            <button
              type="button"
              onClick={async () => {
                if (onRegenerate) {
                  setIsRegenerating(true);
                  try {
                    await onRegenerate();
                  } finally {
                    setIsRegenerating(false);
                  }
                }
              }}
              disabled={!canRegenerate || isRegenerating}
              className="flex items-center gap-2 px-4 min-h-11 text-sm font-semibold rounded-md border shadow-sm transition-colors disabled:opacity-50 bg-white border-brand-200 text-brand-700 hover:bg-brand-50"
              title={cooldownText || t('preview.regenerateLockedTitle')}
            >
              {isRegenerating ? (
                <Loader2 size={16} className="animate-spin" />
              ) : !canRegenerate ? (
                <Lock size={16} className="text-brand-400" />
              ) : (
                <RefreshCw size={16} />
              )}
              {!canRegenerate ? t('preview.regenerateLocked') : t('preview.regenerate')}
            </button>
          )}

          {(activeTab === 'resume' || activeTab === 'coverLetter') && (
            <>
              <button
                type="button"
                onClick={
                  activeTab === 'resume' ? handleWordExport : handleCoverLetterExport
                }
                disabled={
                  isExporting || 
                  (activeTab === 'coverLetter' && (!onExportCoverLetter || getItemStatus(data, 'coverLetter', regeneratingItem, toolkitPending) !== 'success')) ||
                  (activeTab !== 'resume' && activeTab !== 'coverLetter')
                }
                className="flex items-center gap-2 px-4 min-h-11 text-sm font-semibold text-brand-700 bg-charcoal-50 border border-charcoal-300 rounded-md hover:border-brand-700 shadow-sm transition-colors disabled:opacity-50"
              >
                <FileText size={16} />
                {t('preview.downloadWord')}
              </button>

              <button
                type="button"
                onClick={handlePDFExport}
                disabled={isPdfGenerating || (activeTab === 'coverLetter' && getItemStatus(data, 'coverLetter', regeneratingItem, toolkitPending) !== 'success')}
                className="flex items-center gap-2 px-4 min-h-11 text-sm font-semibold text-charcoal-50 bg-brand-700 rounded-md hover:bg-brand-800 shadow-sm transition-colors disabled:opacity-50"
              >
                {isPdfGenerating ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Download size={16} />
                )}
                {isPdfGenerating ? t('preview.generatingPDF') : t('preview.downloadPDF')}
              </button>
            </>
          )}
        </div>
      </header>

      {/* Edit banner — shown whenever editing is active (fresh or reopened). */}
      {!isGeneralResume && editModeActive && !bannerDismissed && (
        <div className="shrink-0 flex items-start gap-4 bg-accent-50 border-b border-accent-300 px-4 md:px-6 py-3.5">
          <div className="w-8 h-8 rounded-full bg-accent-400 text-brand-900 flex items-center justify-center shrink-0 mt-0.5">
            <Pencil size={15} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-brand-800">{t('preview.editBannerHeading')}</p>
            <p className="text-[13px] text-brand-700 mt-0.5 leading-relaxed">{t('preview.editBannerBody')}</p>
          </div>
          <button
            type="button"
            onClick={() => setBannerDismissed(true)}
            className="p-1.5 text-brand-600 hover:text-brand-900 hover:bg-accent-200 rounded-lg transition-colors shrink-0"
            aria-label={t('preview.editBannerDismiss')}
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* ── Mobile artifact rail — the single piece of persistent navigation:
          Resume · Cover Letter · Outreach · LinkedIn · Interview. ─────────── */}
      <nav
        className="md:hidden shrink-0 bg-white border-b border-charcoal-200 overflow-x-auto scrollbar-hide"
        aria-label={t('preview.sidebarDocs')}
      >
        <div className="flex items-center gap-1.5 px-3 py-2 min-w-max">
          {TABS.map((tab) => {
            const active = activeTab === tab.id;
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                aria-pressed={active}
                className={`flex items-center gap-1.5 pl-3 pr-3.5 min-h-9 rounded-full text-[13px] font-semibold whitespace-nowrap transition-colors ${
                  active ? 'bg-brand-700 text-charcoal-50' : 'bg-charcoal-100 text-brand-600'
                }`}
              >
                <Icon size={14} className={active ? 'text-accent-300' : 'text-brand-400'} />
                {tab.label}
                {tab.status && <StatusDot status={statusOf(tab.status)} />}
              </button>
            );
          })}
        </div>
      </nav>

      <div className="flex flex-1 overflow-hidden">
        {/* ── Desktop sidebar — artifact nav first; the template is a quiet,
            collapsible control nested under the active Resume tab. ───────── */}
        <aside className="hidden md:flex md:w-[260px] bg-white border-r border-charcoal-200 overflow-y-auto flex-shrink-0 flex-col">
          <nav className="p-4 flex flex-col gap-1">
            {TABS.map((tab) => {
              const active = activeTab === tab.id;
              const Icon = tab.icon;
              return (
                <div key={tab.id}>
                  <button
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={`w-full relative flex items-center justify-between text-left px-3 py-2.5 rounded-lg transition-colors ${
                      active
                        ? 'bg-accent-50 text-brand-700 border border-accent-200'
                        : 'text-brand-600 border border-transparent hover:bg-charcoal-100'
                    }`}
                  >
                    <span className="flex items-center gap-3 min-w-0">
                      <Icon size={18} className={active ? 'text-accent-600' : 'text-brand-400'} />
                      <span className="text-sm font-semibold truncate">
                        {tab.label}
                        {tab.id === 'interviewPrep' && data.toolkit?.interviewQuestions?.length ? (
                          <span className="ml-1.5 text-[11px] font-normal text-brand-500">
                            · {data.toolkit.interviewQuestions.length}
                          </span>
                        ) : null}
                      </span>
                    </span>
                    {tab.status && <StatusDot status={statusOf(tab.status)} />}
                  </button>

                  {tab.id === 'resume' && active && (
                    <div className="mt-1 ml-3 pl-3 border-l border-charcoal-200">
                      <button
                        type="button"
                        onClick={() => setTemplatesOpen((v) => !v)}
                        aria-expanded={templatesOpen}
                        className="w-full flex items-center justify-between gap-2 px-2 py-2 rounded-md text-left hover:bg-charcoal-50"
                      >
                        <span className="flex items-center gap-2 min-w-0">
                          <LayoutTemplate size={15} className="text-brand-400 shrink-0" />
                          <span className="text-[13px] text-brand-600 truncate">
                            <span className="text-brand-400">{t('preview.templateLabel')}: </span>
                            {template.displayName}
                          </span>
                        </span>
                        <ChevronDown
                          size={15}
                          className={`text-brand-400 shrink-0 transition-transform ${templatesOpen ? 'rotate-180' : ''}`}
                        />
                      </button>
                      {templatesOpen && <div className="mt-1.5 pb-1">{renderTemplateOptions()}</div>}
                    </div>
                  )}
                </div>
              );
            })}
          </nav>
          <p className="text-[11px] text-brand-500 leading-snug mt-auto p-4 border-t border-charcoal-200">
            {t('preview.sidebarFootnote')}
          </p>
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 bg-charcoal-50 overflow-auto relative">
          {activeTab === 'resume' && (
            <div className="p-4 md:py-12">
              <ScaledDocument zoom={zoom}>{resumeContent}</ScaledDocument>
            </div>
          )}
          {activeTab === 'coverLetter' && (
            <div className="p-4 md:py-12">
              {getItemStatus(data, 'coverLetter', regeneratingItem, toolkitPending) === 'success' ? (
                <ScaledDocument zoom={zoom}>{coverLetterContent}</ScaledDocument>
              ) : (
                <ToolkitStatusCard
                  icon={FileCheck}
                  eyebrow={t('preview.tabCoverLetter')}
                  title={t('preview.statusCoverLetterTitle')}
                  description={t('preview.statusCoverLetterDesc')}
                  status={getItemStatus(data, 'coverLetter', regeneratingItem, toolkitPending) as Exclude<ToolkitItemStatus, 'success'>}
                  errorMessage={data.toolkit?.errors?.coverLetter}
                  onRetry={() => onRegenerateItem?.('coverLetter')}
                  busy={!!regeneratingItem && regeneratingItem !== 'coverLetter'}
                />
              )}
            </div>
          )}
          {activeTab === 'outreachEmail' && (
            <div className="p-4 md:py-12 w-full">
              {getItemStatus(data, 'outreachEmail', regeneratingItem, toolkitPending) === 'success' ? (
                <OutreachEmailViewer email={data.toolkit!.outreachEmail!} />
              ) : (
                <ToolkitStatusCard
                  icon={Mail}
                  eyebrow={t('preview.sidebarOutreach')}
                  title={t('preview.statusOutreachTitle')}
                  description={t('preview.statusOutreachDesc')}
                  status={getItemStatus(data, 'outreachEmail', regeneratingItem, toolkitPending) as Exclude<ToolkitItemStatus, 'success'>}
                  errorMessage={data.toolkit?.errors?.outreachEmail}
                  onRetry={() => onRegenerateItem?.('outreachEmail')}
                  busy={!!regeneratingItem && regeneratingItem !== 'outreachEmail'}
                />
              )}
            </div>
          )}
          {activeTab === 'linkedInMessage' && (
            <div className="p-4 md:py-12 w-full">
              {getItemStatus(data, 'linkedInMessage', regeneratingItem, toolkitPending) === 'success' ? (
                <LinkedInMessageViewer message={data.toolkit!.linkedInMessage!} />
              ) : (
                <ToolkitStatusCard
                  icon={Linkedin}
                  eyebrow={t('preview.sidebarOutreach')}
                  title={t('preview.statusLinkedInTitle')}
                  description={t('preview.statusLinkedInDesc')}
                  status={getItemStatus(data, 'linkedInMessage', regeneratingItem, toolkitPending) as Exclude<ToolkitItemStatus, 'success'>}
                  errorMessage={data.toolkit?.errors?.linkedInMessage}
                  onRetry={() => onRegenerateItem?.('linkedInMessage')}
                  busy={!!regeneratingItem && regeneratingItem !== 'linkedInMessage'}
                />
              )}
            </div>
          )}
          {activeTab === 'interviewPrep' && (
            <div className="p-4 md:py-12 w-full">
              {getItemStatus(data, 'interviewQuestions', regeneratingItem, toolkitPending) === 'success' ? (
                <InterviewPrepViewer questions={data.toolkit!.interviewQuestions!} />
              ) : (
                <ToolkitStatusCard
                  icon={MessageSquare}
                  eyebrow={t('preview.sidebarInterview')}
                  title={t('preview.statusInterviewTitle')}
                  description={t('preview.statusInterviewDesc')}
                  status={getItemStatus(data, 'interviewQuestions', regeneratingItem, toolkitPending) as Exclude<ToolkitItemStatus, 'success'>}
                  errorMessage={data.toolkit?.errors?.interviewQuestions}
                  onRetry={() => onRegenerateItem?.('interviewQuestions')}
                  busy={!!regeneratingItem && regeneratingItem !== 'interviewQuestions'}
                />
              )}
            </div>
          )}
        </main>
      </div>

      {/* ── Mobile action dock — primary actions in the thumb zone. Shown only
          for the document tabs (toolkit viewers carry their own Copy actions). */}
      {isDocTab && (
        <div className="md:hidden shrink-0 flex items-center gap-2 px-3 py-2.5 bg-white border-t border-charcoal-200">
          {activeTab === 'resume' && (
            <button
              type="button"
              onClick={() => setTemplatesOpen(true)}
              className="flex items-center gap-1.5 px-3 min-h-11 rounded-lg border border-charcoal-300 text-sm font-semibold text-brand-700 bg-white max-w-[42%]"
            >
              <LayoutTemplate size={16} className="text-brand-400 shrink-0" />
              <span className="truncate">{template.displayName}</span>
            </button>
          )}

          {/* Fit / 100% — genuinely useful here, where the page can't show at
              full size on a phone. */}
          <div
            role="group"
            aria-label={t('preview.zoomLabel')}
            className="flex items-center rounded-lg border border-charcoal-300 overflow-hidden shrink-0"
          >
            <button
              type="button"
              onClick={() => setZoom('fit')}
              aria-pressed={zoom === 'fit'}
              className={`px-3 min-h-11 text-sm font-semibold ${zoom === 'fit' ? 'bg-brand-700 text-charcoal-50' : 'bg-white text-charcoal-600'}`}
            >
              {t('preview.zoomFit')}
            </button>
            <button
              type="button"
              onClick={() => setZoom('actual')}
              aria-pressed={zoom === 'actual'}
              className={`px-3 min-h-11 text-sm font-semibold border-l border-charcoal-300 ${zoom === 'actual' ? 'bg-brand-700 text-charcoal-50' : 'bg-white text-charcoal-600'}`}
            >
              {t('preview.zoomActual')}
            </button>
          </div>

          <button
            type="button"
            onClick={handlePDFExport}
            disabled={isPdfGenerating || (activeTab === 'coverLetter' && statusOf('coverLetter') !== 'success')}
            className="flex-1 flex items-center justify-center gap-2 px-4 min-h-11 text-sm font-semibold text-charcoal-50 bg-brand-700 rounded-lg shadow-sm disabled:opacity-50"
          >
            {isPdfGenerating ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
            {isPdfGenerating ? t('preview.generatingPDF') : t('preview.downloadPDF')}
          </button>
        </div>
      )}

      {/* ── Mobile template bottom sheet — the opt-in way to change template. */}
      {templatesOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 flex flex-col justify-end"
          role="dialog"
          aria-modal="true"
          aria-label={t('preview.templatePick')}
        >
          <div className="absolute inset-0 bg-brand-900/40" onClick={() => setTemplatesOpen(false)} aria-hidden />
          <div className="relative bg-white rounded-t-2xl shadow-xl max-h-[75vh] overflow-y-auto p-4 pb-6 animate-in slide-in-from-bottom-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold text-brand-700">{t('preview.templatePick')}</h2>
              <button
                type="button"
                onClick={() => setTemplatesOpen(false)}
                aria-label={t('preview.editBannerDismiss')}
                className="p-1.5 -mr-1 text-brand-500 hover:text-brand-800 rounded-lg"
              >
                <X size={18} />
              </button>
            </div>
            {renderTemplateOptions(() => setTemplatesOpen(false))}
          </div>
        </div>
      )}
    </div>
  );
};
