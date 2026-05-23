// Presentation — read-only viewers for the AI-generated job toolkit.
// Siblings to Preview.tsx. Each viewer is a pure display + copy-to-clipboard
// widget for one toolkit artifact.

import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Copy,
  Check,
  Mail,
  Linkedin,
  MessageSquare,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Sparkles,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import {
  OutreachEmail,
  InterviewQuestion,
} from '../../../domain/entities/Resume';
import { useT } from '../../i18n/LocaleContext';

// ─────────────────────────────────────────────────────────────
// Status card (missing / failed / regenerating)
// ─────────────────────────────────────────────────────────────

export type ToolkitItemStatus = 'success' | 'failed' | 'missing' | 'regenerating';

interface ToolkitStatusCardProps {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  eyebrow: string;
  title: string;
  description: string;
  status: Exclude<ToolkitItemStatus, 'success'>;
  errorMessage?: string;
  onRetry?: () => void;
  // True while any toolkit item is being regenerated — we disable retry
  // buttons on other items to avoid stacking up concurrent AI calls.
  busy?: boolean;
}

export const ToolkitStatusCard: React.FC<ToolkitStatusCardProps> = ({
  icon: Icon,
  eyebrow,
  title,
  description,
  status,
  errorMessage,
  onRetry,
  busy = false,
}) => {
  const t = useT();
  useEffect(() => {
    if (status === 'failed' && errorMessage) {
      console.debug(`[${eyebrow}] generation error:`, errorMessage);
    }
  }, [status, errorMessage, eyebrow]);

  return (
  <div className="w-full max-w-3xl mx-auto p-6 md:p-10">
    <div className="flex items-start gap-4 mb-8">
      <div className="w-11 h-11 rounded-xl bg-brand-700 text-charcoal-50 flex items-center justify-center shrink-0">
        <Icon size={20} />
      </div>
      <div>
        <p className="text-[11px] uppercase tracking-[0.22em] text-accent-600 font-semibold mb-1">
          {eyebrow}
        </p>
        <h2 className="font-display text-2xl font-semibold text-brand-700 leading-tight mb-2">
          {title}
        </h2>
        <p className="text-sm text-brand-500 leading-relaxed">{description}</p>
      </div>
    </div>

    {status === 'regenerating' && (
      <div className="bg-charcoal-50 border border-charcoal-200 rounded-2xl p-8 flex flex-col items-center text-center">
        <Loader2 size={28} className="text-brand-700 animate-spin mb-4" />
        <p className="font-display text-lg font-semibold text-brand-700 mb-1">
          {t('toolkit.statusRegenerating')}
        </p>
        <p className="text-sm text-brand-500">
          {t('toolkit.statusRegenSubtitle')}
        </p>
      </div>
    )}

    {status === 'failed' && (
      <div className="bg-charcoal-50 border border-charcoal-200 rounded-2xl p-6">
        <div className="flex items-start gap-3 mb-5">
          <div className="w-9 h-9 rounded-lg bg-accent-50 text-accent-600 flex items-center justify-center shrink-0">
            <AlertTriangle size={18} />
          </div>
          <div>
            <p className="font-display text-base font-semibold text-brand-700 mb-1">
              {t('toolkit.failedTitle')}
            </p>
            <p className="text-sm text-brand-500 leading-relaxed">
              {t('toolkit.failedBody')}
            </p>
          </div>
        </div>

        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            disabled={busy}
            className="inline-flex items-center gap-2 text-sm font-semibold bg-brand-700 text-charcoal-50 rounded-md px-4 py-2 hover:bg-brand-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            {busy ? t('toolkit.busy') : t('toolkit.tryAgain')}
          </button>
        )}
      </div>
    )}

    {status === 'missing' && (
      <div className="bg-charcoal-50 border border-charcoal-200 rounded-2xl p-6">
        <p className="text-sm text-brand-500 leading-relaxed mb-5">
          {t('toolkit.missingBody')}
        </p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            disabled={busy}
            className="inline-flex items-center gap-2 text-sm font-semibold bg-brand-700 text-charcoal-50 rounded-md px-4 py-2 hover:bg-brand-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} className="text-accent-400" />}
            {busy ? t('toolkit.busy') : t('toolkit.generateNow')}
          </button>
        )}
      </div>
    )}
  </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Shared primitives
// ─────────────────────────────────────────────────────────────

const copyToClipboard = async (text: string, label: string, t: ReturnType<typeof useT>) => {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(t('toolkit.copySuccess', { label }));
    return true;
  } catch (error) {
    console.error('Clipboard write failed:', error);
    toast.error(t('toolkit.copyFailed'));
    return false;
  }
};

const CopyButton = ({
  text,
  label,
  variant = 'secondary',
}: {
  text: string;
  label: string;
  variant?: 'primary' | 'secondary';
}) => {
  const t = useT();
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    const ok = await copyToClipboard(text, label, t);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const base =
    'inline-flex items-center gap-1.5 text-sm font-semibold rounded-md px-3 py-1.5 transition-colors disabled:opacity-50';
  const styles =
    variant === 'primary'
      ? 'bg-brand-700 text-charcoal-50 hover:bg-brand-800'
      : 'bg-charcoal-50 text-brand-700 border border-charcoal-300 hover:border-brand-700';

  return (
    <button type="button" onClick={onCopy} className={`${base} ${styles}`}>
      {copied ? <Check size={14} /> : <Copy size={14} />}
      {copied ? t('toolkit.copied') : t('toolkit.copyLabel', { label })}
    </button>
  );
};

const ViewerShell = ({
  icon: Icon,
  eyebrow,
  title,
  description,
  children,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  eyebrow: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) => (
  <div className="w-full max-w-3xl mx-auto p-6 md:p-10">
    <div className="flex items-start gap-4 mb-8">
      <div className="w-11 h-11 rounded-xl bg-brand-700 text-charcoal-50 flex items-center justify-center shrink-0">
        <Icon size={20} />
      </div>
      <div>
        <p className="text-[11px] uppercase tracking-[0.22em] text-accent-600 font-semibold mb-1">
          {eyebrow}
        </p>
        <h2 className="font-display text-2xl font-semibold text-brand-700 leading-tight mb-2">
          {title}
        </h2>
        <p className="text-sm text-brand-500 leading-relaxed">{description}</p>
      </div>
    </div>
    {children}
  </div>
);

// ─────────────────────────────────────────────────────────────
// Outreach email
// ─────────────────────────────────────────────────────────────

export const OutreachEmailViewer = ({ email }: { email: OutreachEmail }) => {
  const t = useT();
  const fullText = `${t('toolkit.outreachSubject')}: ${email.subject}\n\n${email.body}`;

  return (
    <ViewerShell
      icon={Mail}
      eyebrow={t('toolkit.outreachEyebrow')}
      title={t('toolkit.outreachTitle')}
      description={t('toolkit.outreachDesc')}
    >
      <div className="bg-charcoal-50 border border-charcoal-200 rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-charcoal-200 bg-charcoal-100">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.18em] text-brand-500 font-semibold mb-0.5">
              {t('toolkit.outreachSubject')}
            </p>
            <p className="font-semibold text-brand-700 truncate">{email.subject}</p>
          </div>
          <CopyButton text={email.subject} label={t('toolkit.outreachSubject')} />
        </div>

        <div className="px-5 py-5">
          <pre className="whitespace-pre-wrap font-sans text-[15px] leading-relaxed text-brand-700 mb-5">
            {email.body}
          </pre>
          <div className="flex flex-wrap gap-2">
            <CopyButton text={email.body} label={t('toolkit.outreachBody')} />
            <CopyButton text={fullText} label={t('toolkit.outreachSubjectAndBody')} variant="primary" />
          </div>
        </div>
      </div>

      <p className="text-xs text-brand-500 mt-4 leading-relaxed">
        {t('toolkit.outreachTip')}
      </p>
    </ViewerShell>
  );
};

// ─────────────────────────────────────────────────────────────
// LinkedIn connection note
// ─────────────────────────────────────────────────────────────

export const LinkedInMessageViewer = ({ message }: { message: string }) => {
  const t = useT();
  const charCount = message.length;
  const overLimit = charCount > 280;

  return (
    <ViewerShell
      icon={Linkedin}
      eyebrow={t('toolkit.linkedinEyebrow')}
      title={t('toolkit.linkedinTitle')}
      description={t('toolkit.linkedinDesc')}
    >
      <div className="bg-charcoal-50 border border-charcoal-200 rounded-2xl p-5">
        <p className="font-sans text-[15px] leading-relaxed text-brand-700 mb-4">{message}</p>
        <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-charcoal-200">
          <div className="text-xs flex items-center gap-2">
            <span className={overLimit ? 'text-red-600 font-semibold' : 'text-brand-500'}>
              {t('toolkit.linkedinCharCount', { n: charCount })}
            </span>
            {overLimit && (
              <span className="text-red-600">{t('toolkit.linkedinTrim')}</span>
            )}
          </div>
          <CopyButton text={message} label={t('toolkit.linkedinNote')} variant="primary" />
        </div>
      </div>
    </ViewerShell>
  );
};

// ─────────────────────────────────────────────────────────────
// Interview prep
// ─────────────────────────────────────────────────────────────

const CATEGORY_STYLES: Record<string, string> = {
  Behavioral: 'bg-accent-50 text-accent-700 border-accent-200',
  Technical: 'bg-brand-700 text-charcoal-50 border-brand-700',
  'Role-specific': 'bg-charcoal-100 text-brand-700 border-charcoal-300',
  'Values & Culture': 'bg-accent-100 text-accent-800 border-accent-200',
  Situational: 'bg-charcoal-200 text-brand-700 border-charcoal-300',
};

interface QuestionCardProps {
  q: InterviewQuestion;
  index: number;
  expanded: boolean;
  onToggle: () => void;
  lang: 'en' | 'bn';
}

const QuestionCard: React.FC<QuestionCardProps> = ({
  q,
  index,
  expanded,
  onToggle,
  lang,
}) => {
  const t = useT();
  const categoryLabels: Record<string, string> = {
    Behavioral: t('toolkit.catBehavioral'),
    Technical: t('toolkit.catTechnical'),
    'Role-specific': t('toolkit.catRoleSpecific'),
    'Values & Culture': t('toolkit.catValuesCulture'),
    Situational: t('toolkit.catSituational'),
  };
  const badge = CATEGORY_STYLES[q.category] ?? CATEGORY_STYLES['Role-specific'];
  // English text is authoritative; fall back to it whenever the requested
  // Bengali field is missing (older resumes, or a translation Gemini skipped).
  const question = lang === 'bn' && q.questionBn?.trim() ? q.questionBn : q.question;
  const whyAsked = lang === 'bn' && q.whyAskedBn?.trim() ? q.whyAskedBn : q.whyAsked;
  const answerStrategy = lang === 'bn' && q.answerStrategyBn?.trim() ? q.answerStrategyBn : q.answerStrategy;
  const fullText = `Q${index + 1}. ${question}\n\n${t('toolkit.interviewWhy')}: ${whyAsked}\n\n${t('toolkit.interviewHow')}: ${answerStrategy}`;

  return (
    <div className="bg-charcoal-50 border border-charcoal-200 rounded-2xl overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full text-left px-5 py-4 flex items-start gap-4 hover:bg-charcoal-100 transition-colors"
      >
        <span className="font-display text-lg font-semibold text-accent-500 w-8 shrink-0 pt-0.5">
          {String(index + 1).padStart(2, '0')}
        </span>
        <div className="flex-1 min-w-0">
          <p className="font-display text-base font-semibold text-brand-700 mb-2 leading-snug">
            {question}
          </p>
          <span
            className={`inline-block text-[10px] uppercase tracking-[0.14em] font-semibold px-2 py-0.5 rounded-full border ${badge}`}
          >
            {categoryLabels[q.category] ?? q.category}
          </span>
        </div>
        <span className="text-brand-500 shrink-0 pt-1">
          {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </span>
      </button>

      {expanded && (
        <div className="px-5 pb-5 pl-[4.25rem] space-y-4 text-sm leading-relaxed">
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-brand-500 font-semibold mb-1.5">
              {t('toolkit.interviewWhy')}
            </p>
            <p className="text-brand-700">{whyAsked}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-brand-500 font-semibold mb-1.5">
              {t('toolkit.interviewHow')}
            </p>
            <p className="text-brand-700">{answerStrategy}</p>
          </div>
          <div className="pt-2">
            <CopyButton text={fullText} label={t('toolkit.interviewQNotes')} />
          </div>
        </div>
      )}
    </div>
  );
};

// Persisted user preference for which language (English vs Bangla) the
// interview prep should display. Defaults to English. Stored at the
// localStorage layer so the toggle survives refreshes and tab switches.
type PrepLang = 'en' | 'bn';
const PREP_LANG_KEY = 'topcandidate.interviewPrepLang';

function loadPrepLang(): PrepLang {
  try {
    const v = typeof window !== 'undefined' ? window.localStorage.getItem(PREP_LANG_KEY) : null;
    return v === 'bn' ? 'bn' : 'en';
  } catch {
    return 'en';
  }
}

function savePrepLang(lang: PrepLang): void {
  try {
    if (typeof window !== 'undefined') window.localStorage.setItem(PREP_LANG_KEY, lang);
  } catch {
    // Ignore storage failures — toggle still works in-session.
  }
}

// True only when at least one question carries Bengali content. Old saved
// resumes (pre-bilingual landing) won't have any, so the toggle hides itself.
function hasBengaliPrep(questions: InterviewQuestion[]): boolean {
  return questions.some(
    q => (q.questionBn?.trim() ?? '') || (q.whyAskedBn?.trim() ?? '') || (q.answerStrategyBn?.trim() ?? ''),
  );
}

// Pick the right text for the current language with English fallback so a
// missing translation doesn't blank the UI.
function pickLang(en: string, bn: string | undefined, lang: PrepLang): string {
  if (lang === 'bn' && bn && bn.trim()) return bn;
  return en;
}

export const InterviewPrepViewer = ({
  questions,
}: {
  questions: InterviewQuestion[];
}) => {
  const t = useT();
  const [expanded, setExpanded] = useState<Set<number>>(new Set([0]));
  const [lang, setLang] = useState<PrepLang>(() => loadPrepLang());

  const bilingual = hasBengaliPrep(questions);
  // If the saved preference is Bangla but this resume's questions only have
  // English (e.g. generated before bilingual prep landed), don't strand the
  // user on a language with nothing to show.
  const effectiveLang: PrepLang = bilingual ? lang : 'en';

  const setLangPersist = (next: PrepLang) => {
    setLang(next);
    savePrepLang(next);
  };

  const toggle = (i: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const allExpanded = expanded.size === questions.length;
  const setAll = () => {
    setExpanded(
      allExpanded ? new Set() : new Set(questions.map((_, i) => i)),
    );
  };

  const fullBrief = questions
    .map((q, i) => {
      const question = pickLang(q.question, q.questionBn, effectiveLang);
      const why = pickLang(q.whyAsked, q.whyAskedBn, effectiveLang);
      const how = pickLang(q.answerStrategy, q.answerStrategyBn, effectiveLang);
      return `Q${i + 1}. ${question}\n[${q.category}]\n${t('toolkit.interviewWhy')}: ${why}\n${t('toolkit.interviewHow')}: ${how}`;
    })
    .join('\n\n──\n\n');

  return (
    <ViewerShell
      icon={MessageSquare}
      eyebrow={t('toolkit.interviewEyebrow')}
      title={t('toolkit.interviewTitle')}
      description={t('toolkit.interviewDesc')}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-3">
          <p className="text-sm text-brand-500">
            {t('toolkit.interviewQCount', { n: questions.length })}
          </p>
          {bilingual && (
            <div
              role="group"
              aria-label={t('toolkit.interviewLangToggleLabel')}
              className="inline-flex rounded-full border border-charcoal-300 bg-charcoal-50 p-0.5"
            >
              <button
                type="button"
                onClick={() => setLangPersist('en')}
                aria-pressed={effectiveLang === 'en'}
                className={`text-xs font-semibold px-3 py-1 rounded-full transition-colors ${
                  effectiveLang === 'en'
                    ? 'bg-brand-700 text-charcoal-50'
                    : 'text-brand-500 hover:text-brand-700'
                }`}
              >
                English
              </button>
              <button
                type="button"
                onClick={() => setLangPersist('bn')}
                aria-pressed={effectiveLang === 'bn'}
                className={`text-xs font-semibold px-3 py-1 rounded-full transition-colors ${
                  effectiveLang === 'bn'
                    ? 'bg-brand-700 text-charcoal-50'
                    : 'text-brand-500 hover:text-brand-700'
                }`}
              >
                বাংলা
              </button>
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={setAll}
            className="text-sm font-semibold text-brand-700 hover:text-accent-600 px-2 py-1.5"
          >
            {allExpanded ? t('toolkit.interviewCollapseAll') : t('toolkit.interviewExpandAll')}
          </button>
          <CopyButton text={fullBrief} label={t('toolkit.interviewBrief')} variant="primary" />
        </div>
      </div>

      <div className="space-y-3">
        {questions.map((q, i) => (
          <QuestionCard
            key={i}
            q={q}
            index={i}
            expanded={expanded.has(i)}
            onToggle={() => toggle(i)}
            lang={effectiveLang}
          />
        ))}
      </div>
    </ViewerShell>
  );
};
