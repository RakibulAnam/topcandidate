// Presentation Layer - Form Components
//
// Shared across ProfileSetupScreen and BuilderScreen. Each step is a pure
// controlled component: parent owns the data, the step renders the UI.
//
// Design idioms (matches AGENTS.md §10):
//   - Editorial Ink + Saffron, never blue/purple/gradients.
//   - SectionHeader with a Saffron eyebrow + Fraunces display title.
//   - TipCard — always-on "Quick guide" panel above the form (rules + real
//     examples). User can hide it; defaults open.
//   - PolishHint — small "type messy, the AI will polish" reassurance next
//     to brain-dump fields.
//   - CollapsibleItem — list cards (Experience, Projects, Education, etc.)
//     auto-collapse to a one-line summary once the key fields are filled,
//     expand again on click.

import React, { useMemo, useState } from 'react';
import { extractSkillsFromJD, buildSkillPool } from '../utils/skillMatcher';
import {
  PersonalInfo,
  WorkExperience,
  Education,
  TargetJob,
  UserType,
  Project,
  Extracurricular,
  Award,
  Certification,
  Affiliation,
  Publication,
  Language,
  LanguageProficiency,
  Reference,
} from '../../domain/entities/Resume';
import {
  Plus,
  X,
  Trash2,
  Briefcase,
  GraduationCap,
  FolderGit2,
  Award as AwardIcon,
  BookOpen,
  Users,
  Lightbulb,
  ChevronDown,
  Check,
  Sparkles,
  Info,
  Link as LinkIcon,
  Building2,
  Languages as LanguagesIcon,
  UserCheck,
} from 'lucide-react';
import { MonthPicker } from './ui/month-picker';
import { EmailInput } from './ui/EmailInput';
import { PhoneInput } from './ui/PhoneInput';
import { LanguagePicker } from './ui/LanguagePicker';
import { useT } from '../i18n/LocaleContext';

// -----------------------------------------------------------------------------
// Shared primitives
// -----------------------------------------------------------------------------

const SectionHeader = ({
  eyebrow,
  title,
  desc,
}: {
  eyebrow: string;
  title: string;
  desc: string;
}) => (
  <div className="mb-7">
    <p className="text-[11px] uppercase tracking-[0.22em] text-accent-600 font-semibold mb-2">
      {eyebrow}
    </p>
    <h2 className="font-display text-3xl sm:text-[2rem] font-semibold text-brand-700 leading-[1.1]">
      {title}
    </h2>
    <p className="text-sm sm:text-[15px] text-brand-500 mt-2.5 leading-relaxed max-w-2xl">
      {desc}
    </p>
  </div>
);

// Inputs across a row stay vertically aligned even when only some fields have
// helper or error text — both render BELOW the input, never between label and
// input, so the input baseline is determined by the (consistent) label only.
const InputGroup = ({
  label,
  error,
  helper,
  optional,
  required,
  children,
  className = '',
}: {
  label: string;
  error?: string;
  helper?: string;
  optional?: boolean;
  required?: boolean;
  children?: React.ReactNode;
  className?: string;
}) => {
  const t = useT();
  return (
  <div className={`flex flex-col gap-1.5 ${className}`}>
    <div className="flex items-baseline justify-between gap-2">
      <label className="text-sm font-semibold text-brand-700">
        {label}
        {required && <span className="text-accent-500 ml-0.5">*</span>}
      </label>
      {optional && (
        <span className="text-[10px] uppercase tracking-[0.18em] text-charcoal-400 font-semibold">
          {t('formSteps.optional')}
        </span>
      )}
    </div>
    {children}
    {error ? (
      <span className="text-xs text-red-600 font-medium">{error}</span>
    ) : helper ? (
      <p className="text-xs text-charcoal-500 leading-relaxed">{helper}</p>
    ) : null}
  </div>
  );
};

type InputProps = React.ComponentProps<'input'> & { error?: string };

const Input = ({ error, className, ...props }: InputProps) => (
  <input
    {...props}
    aria-invalid={!!error}
    className={`w-full rounded-lg border px-3.5 py-2.5 text-sm bg-white text-brand-800 placeholder:text-charcoal-400 focus:outline-none focus-visible:ring-2 transition-colors disabled:bg-charcoal-100 disabled:text-charcoal-400 ${
      error
        ? 'border-red-400 focus-visible:ring-red-400'
        : 'border-charcoal-300 hover:border-charcoal-400 focus-visible:ring-accent-400 focus-visible:border-accent-400'
    } ${className || ''}`}
  />
);

type TextAreaProps = React.ComponentProps<'textarea'> & { error?: string };

const TextArea = ({ error, className, ...props }: TextAreaProps) => (
  <textarea
    {...props}
    aria-invalid={!!error}
    className={`w-full rounded-lg border px-3.5 py-3 text-sm bg-white text-brand-800 placeholder:text-charcoal-400 focus:outline-none focus-visible:ring-2 transition-colors leading-relaxed ${
      error
        ? 'border-red-400 focus-visible:ring-red-400'
        : 'border-charcoal-300 hover:border-charcoal-400 focus-visible:ring-accent-400 focus-visible:border-accent-400'
    } ${className || ''}`}
  />
);

// Persistent guide panel. Defaults to OPEN — the whole point of this app is
// to coach the user as they fill the form, not hide guidance behind a click.
// User can still collapse it ("Hide") if they want to focus on typing.
const TipCard = ({
  eyebrow,
  title,
  rules,
  examples,
  exampleLabel,
  defaultOpen = true,
}: {
  eyebrow?: string;
  title?: string;
  rules: string[];
  examples: string[];
  exampleLabel?: string;
  defaultOpen?: boolean;
}) => {
  const t = useT();
  const [open, setOpen] = useState(defaultOpen);
  const eyebrowText = eyebrow ?? t('formSteps.quickGuide');
  const titleText = title ?? t('formSteps.howToWriteStrong');
  const exampleLabelText = exampleLabel ?? t('formSteps.realExamples');
  return (
    <div className="rounded-2xl border border-accent-200 bg-accent-50/70 overflow-hidden">
      <div className="flex items-start gap-3 px-5 pt-4 pb-3">
        <div className="w-8 h-8 rounded-full bg-accent-400 text-brand-800 flex items-center justify-center shrink-0">
          <Lightbulb size={15} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] uppercase tracking-[0.22em] text-accent-700 font-semibold">
            {eyebrowText}
          </p>
          <p className="text-[15px] font-semibold text-brand-700 leading-snug mt-0.5">
            {titleText}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          aria-label={open ? t('formSteps.hideGuide') : t('formSteps.showGuide')}
          className="text-[11px] uppercase tracking-[0.18em] text-accent-700 font-semibold inline-flex items-center gap-1 hover:text-accent-800 transition-colors shrink-0 mt-1"
        >
          {open ? t('formSteps.hide') : t('formSteps.show')}
          <ChevronDown
            size={14}
            className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          />
        </button>
      </div>
      {open && (
        <div className="px-5 pb-5 space-y-4">
          <ul className="space-y-2">
            {rules.map(r => (
              <li
                key={r}
                className="flex gap-2.5 text-[13.5px] leading-relaxed text-brand-700"
              >
                <Check
                  size={15}
                  className="text-accent-600 shrink-0 mt-0.5"
                  strokeWidth={2.5}
                />
                <span>{r}</span>
              </li>
            ))}
          </ul>
          {examples.length > 0 && (
            <div className="rounded-xl bg-white/70 border border-accent-100 p-3.5">
              <p className="text-[10px] uppercase tracking-[0.22em] text-accent-700 font-semibold mb-2">
                {exampleLabelText}
              </p>
              <ul className="space-y-2">
                {examples.map(e => (
                  <li
                    key={e}
                    className="text-[13px] leading-relaxed text-brand-600 pl-3 border-l-2 border-accent-300 italic"
                  >
                    {e}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// Friendlier alternative to TipCard for brain-dump-heavy steps (Experience,
// Projects). Leads with a *reassurance hero* — "write it however feels
// natural, the AI cleans it up" — instead of a wall of rules. Examples are
// tucked behind a toggle so they're available without being in your face.
const WritingGuide = ({
  reassurance,
  examples,
}: {
  reassurance: string;
  examples: string[];
}) => {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-2xl border border-accent-200 bg-accent-50/70 overflow-hidden">
      <div className="flex items-start gap-3.5 px-5 py-5">
        <div className="w-10 h-10 rounded-full bg-accent-400 text-brand-800 flex items-center justify-center shrink-0">
          <Sparkles size={17} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] uppercase tracking-[0.22em] text-accent-700 font-semibold mb-1.5">
            {t('formSteps.safeBrainDump')}
          </p>
          <p className="text-[15px] leading-relaxed text-brand-700">
            {reassurance}
          </p>
        </div>
      </div>
      {examples.length > 0 && (
        <div className="border-t border-accent-200/70">
          <button
            type="button"
            onClick={() => setOpen(o => !o)}
            aria-expanded={open}
            className="w-full flex items-center justify-between gap-2 px-5 py-3 text-left hover:bg-white/40 transition-colors"
          >
            <span className="text-[11px] uppercase tracking-[0.18em] text-accent-700 font-semibold">
              {open
                ? t('formSteps.hideExamples')
                : t('formSteps.peekExamples', { n: examples.length })}
            </span>
            <ChevronDown
              size={14}
              className={`text-accent-700 transition-transform ${
                open ? 'rotate-180' : ''
              }`}
            />
          </button>
          {open && (
            <div className="px-5 pb-4">
              <ul className="space-y-2">
                {examples.map(e => (
                  <li
                    key={e}
                    className="text-[13px] leading-relaxed text-brand-600 pl-3 border-l-2 border-accent-300 italic"
                  >
                    {e}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// Single-paragraph saffron callout for steps that don't need a full TipCard
// or WritingGuide — a friendly one-liner that orients the user without a rule
// wall. Used in Awards, Certifications, Affiliations, Publications.
const MiniGuide = ({
  icon,
  children,
}: {
  icon?: React.ReactNode;
  children: React.ReactNode;
}) => (
  <div className="flex items-start gap-3 rounded-2xl border border-accent-200 bg-accent-50/70 px-5 py-4">
    <div className="w-8 h-8 rounded-full bg-accent-400 text-brand-800 flex items-center justify-center shrink-0">
      {icon ?? <Lightbulb size={14} />}
    </div>
    <p className="text-[13.5px] leading-relaxed text-brand-700 flex-1 pt-1">
      {children}
    </p>
  </div>
);

// Calm reassurance shown next to brain-dump fields so users brain-dump freely.
const PolishHint = () => {
  const t = useT();
  return (
  <p className="flex items-start gap-1.5 text-[12px] text-charcoal-500 leading-relaxed">
    <Sparkles size={12} className="text-accent-500 shrink-0 mt-0.5" />
    <span>{t('formSteps.polishHint')}</span>
  </p>
  );
};

// List-item card that auto-collapses to a one-line summary once its key fields
// are filled. Prevents long forms from becoming an endless scroll.
const CollapsibleItem = ({
  icon,
  indexLabel,
  isFilled,
  summaryPrimary,
  summarySecondary,
  onRemove,
  children,
}: {
  icon: React.ReactNode;
  indexLabel: string;
  isFilled: boolean;
  summaryPrimary?: string;
  summarySecondary?: string;
  onRemove: () => void;
  children: React.ReactNode;
}) => {
  const t = useT();
  const [open, setOpen] = useState(!isFilled);
  return (
    <div className="rounded-2xl border border-charcoal-200 bg-white overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-charcoal-100">
        <div className="w-9 h-9 rounded-full bg-charcoal-100 text-brand-700 flex items-center justify-center shrink-0">
          {icon}
        </div>
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className="flex-1 text-left min-w-0"
          aria-expanded={open}
        >
          <p className="text-[10px] uppercase tracking-[0.2em] text-charcoal-500 font-semibold">
            {indexLabel}
          </p>
          {isFilled && !open && summaryPrimary ? (
            <p className="text-sm text-brand-700 truncate mt-0.5">
              <span className="font-semibold">{summaryPrimary}</span>
              {summarySecondary && (
                <span className="text-charcoal-500 font-normal">
                  {' '}· {summarySecondary}
                </span>
              )}
            </p>
          ) : (
            <p className="text-[13px] text-charcoal-500 mt-0.5">
              {open ? t('formSteps.editing') : t('formSteps.tapToFill')}
            </p>
          )}
        </button>
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className="text-charcoal-400 hover:text-brand-700 p-1.5 rounded-md hover:bg-charcoal-100 transition-colors"
          aria-label={open ? t('formSteps.collapse') : t('formSteps.expand')}
        >
          <ChevronDown
            size={18}
            className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          />
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="text-charcoal-400 hover:text-red-600 p-1.5 rounded-md hover:bg-red-50 transition-colors"
          aria-label={t('formSteps.remove')}
        >
          <Trash2 size={16} />
        </button>
      </div>
      {open && <div className="p-5 space-y-5">{children}</div>}
    </div>
  );
};

const AddButton = ({
  onClick,
  label,
}: {
  onClick: () => void;
  label: string;
}) => (
  <button
    type="button"
    onClick={onClick}
    className="w-full py-3.5 border-2 border-dashed border-charcoal-300 rounded-2xl text-charcoal-600 hover:border-accent-400 hover:text-accent-700 hover:bg-accent-50/40 font-semibold text-sm flex items-center justify-center gap-2 transition-colors"
  >
    <Plus size={18} /> {label}
  </button>
);

const formatMonth = (ym?: string) => {
  if (!ym) return '';
  const [y, m] = ym.split('-');
  const idx = Number(m) - 1;
  const names = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  return Number.isFinite(idx) && idx >= 0 && idx < 12 ? `${names[idx]} ${y}` : ym;
};

const dateRange = (start?: string, end?: string, isCurrent?: boolean) => {
  const s = formatMonth(start);
  const e = isCurrent ? 'Present' : formatMonth(end);
  if (!s && !e) return '';
  if (!s) return e;
  if (!e) return s;
  return `${s} – ${e}`;
};

// -----------------------------------------------------------------------------
// Steps
// -----------------------------------------------------------------------------

export const UserTypeStep: React.FC<{
  userType?: UserType;
  update: (userType: UserType) => void;
}> = ({ userType, update }) => {
  const t = useT();
  const options: {
    key: UserType;
    title: string;
    icon: React.ReactNode;
    lead: string;
    fits: string[];
  }[] = [
    {
      key: 'experienced',
      title: t('formSteps.expCardTitle'),
      icon: <Briefcase size={22} />,
      lead: t('formSteps.expCardLead'),
      fits: [
        t('formSteps.expCardFit1'),
        t('formSteps.expCardFit2'),
        t('formSteps.expCardFit3'),
      ],
    },
    {
      key: 'student',
      title: t('formSteps.studentCardTitle'),
      icon: <GraduationCap size={22} />,
      lead: t('formSteps.studentCardLead'),
      fits: [
        t('formSteps.studentCardFit1'),
        t('formSteps.studentCardFit2'),
        t('formSteps.studentCardFit3'),
      ],
    },
  ];

  return (
    <div>
      <SectionHeader
        eyebrow={t('formSteps.userTypeEyebrow')}
        title={t('formSteps.userTypeTitle')}
        desc={t('formSteps.userTypeDesc')}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {options.map(opt => {
          const active = userType === opt.key;
          return (
            <button
              key={opt.key}
              type="button"
              onClick={() => update(opt.key)}
              className={`text-left p-6 rounded-2xl border-2 transition-all ${
                active
                  ? 'border-accent-400 bg-accent-50/50 shadow-sm'
                  : 'border-charcoal-200 bg-white hover:border-charcoal-400'
              }`}
            >
              <div className="flex items-center gap-3 mb-4">
                <div
                  className={`w-11 h-11 rounded-full flex items-center justify-center transition-colors ${
                    active
                      ? 'bg-brand-700 text-accent-300'
                      : 'bg-charcoal-100 text-brand-700'
                  }`}
                >
                  {opt.icon}
                </div>
                <h3 className="font-display text-xl font-semibold text-brand-700">
                  {opt.title}
                </h3>
              </div>
              <p className="text-sm text-brand-600 leading-relaxed mb-4">
                {opt.lead}
              </p>
              <ul className="space-y-1.5">
                {opt.fits.map(f => (
                  <li
                    key={f}
                    className="flex items-start gap-2 text-[13px] text-charcoal-600"
                  >
                    <Check
                      size={14}
                      className="text-accent-500 shrink-0 mt-[3px]"
                    />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </button>
          );
        })}
      </div>

      <div className="mt-6 flex items-start gap-2.5 rounded-lg bg-charcoal-100 border border-charcoal-200 px-4 py-3 text-[13px] text-brand-600">
        <Info size={15} className="text-brand-500 shrink-0 mt-0.5" />
        <p className="leading-relaxed">
          <span className="font-semibold text-brand-700">{t('formSteps.notSureLabel')}</span> {t('formSteps.notSureBody')}
        </p>
      </div>
    </div>
  );
};

export const TargetJobStep: React.FC<{
  data: TargetJob;
  errors?: Record<string, string>;
  update: (d: TargetJob) => void;
}> = ({ data, errors, update }) => {
  const t = useT();
  return (
  <div>
    <SectionHeader
      eyebrow={t('formSteps.targetJobEyebrow')}
      title={t('formSteps.targetJobTitle')}
      desc={t('formSteps.targetJobDesc')}
    />

    <div className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <InputGroup
          label={t('formSteps.targetJobJobTitleLabel')}
          required
          helper={t('formSteps.targetJobJobTitleHelper')}
          error={errors?.['targetJob.title']}
        >
          <Input
            placeholder={t('formSteps.targetJobJobTitlePlaceholder')}
            value={data.title}
            error={errors?.['targetJob.title']}
            onChange={e => update({ ...data, title: e.target.value })}
          />
        </InputGroup>
        <InputGroup
          label={t('formSteps.targetJobCompanyLabel')}
          required
          helper={t('formSteps.targetJobCompanyHelper')}
          error={errors?.['targetJob.company']}
        >
          <Input
            placeholder={t('formSteps.targetJobCompanyPlaceholder')}
            value={data.company}
            error={errors?.['targetJob.company']}
            onChange={e => update({ ...data, company: e.target.value })}
          />
        </InputGroup>
      </div>

      <InputGroup
        label={t('formSteps.targetJobDescLabel')}
        required
        helper={t('formSteps.targetJobDescHelper')}
        error={errors?.['targetJob.description']}
      >
        <TextArea
          rows={10}
          placeholder={t('formSteps.targetJobDescPlaceholder')}
          value={data.description}
          error={errors?.['targetJob.description']}
          onChange={e => update({ ...data, description: e.target.value })}
        />
      </InputGroup>

      <TipCard
        title={t('formSteps.targetJobTipTitle')}
        rules={[
          t('formSteps.targetJobTipRule1'),
          t('formSteps.targetJobTipRule2'),
          t('formSteps.targetJobTipRule3'),
        ]}
        examples={[]}
      />
    </div>
  </div>
  );
};

// Small section header used inside PersonalInfoStep cards.
const PanelHeader = ({
  eyebrow,
  title,
  hint,
  optional,
  icon,
}: {
  eyebrow: string;
  title: string;
  hint?: string;
  optional?: boolean;
  icon?: React.ReactNode;
}) => {
  const t = useT();
  return (
  <div className="mb-5">
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        {icon && <span className="text-accent-600">{icon}</span>}
        <p className="text-[11px] uppercase tracking-[0.22em] text-accent-600 font-semibold">
          {eyebrow}
        </p>
      </div>
      {optional && (
        <span className="text-[10px] uppercase tracking-[0.18em] text-charcoal-400 font-semibold">
          {t('formSteps.allOptional')}
        </span>
      )}
    </div>
    <p className="font-display text-lg font-semibold text-brand-700 mt-1.5">
      {title}
    </p>
    {hint && (
      <p className="text-[13px] text-charcoal-500 mt-1 leading-relaxed">
        {hint}
      </p>
    )}
  </div>
  );
};

export const PersonalInfoStep: React.FC<{
  data: PersonalInfo;
  errors?: Record<string, string>;
  update: (d: PersonalInfo) => void;
}> = ({ data, errors, update }) => {
  const t = useT();
  return (
  <div>
    <SectionHeader
      eyebrow={t('formSteps.personalEyebrow')}
      title={t('formSteps.personalTitle')}
      desc={t('formSteps.personalDesc')}
    />

    <div className="space-y-5">
      <section className="rounded-2xl border border-charcoal-200 bg-white p-5 sm:p-6">
        <PanelHeader
          eyebrow={t('formSteps.basicsEyebrow')}
          title={t('formSteps.basicsTitle')}
          hint={t('formSteps.basicsHint')}
        />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <InputGroup
            label={t('formSteps.fullNameLabel')}
            required
            error={errors?.['personalInfo.fullName']}
          >
            <Input
              error={errors?.['personalInfo.fullName']}
              value={data.fullName}
              onChange={e => update({ ...data, fullName: e.target.value })}
              placeholder={t('formSteps.fullNamePlaceholder')}
              autoComplete="name"
            />
          </InputGroup>
          <InputGroup
            label={t('formSteps.emailLabel')}
            required
          >
            <EmailInput
              error={errors?.['personalInfo.email']}
              value={data.email}
              onChange={v => update({ ...data, email: v })}
              placeholder={t('formSteps.emailPlaceholder')}
              invalidMessage={t('builder.errEmailInvalid')}
            />
          </InputGroup>
        </div>
      </section>

      <section className="rounded-2xl border border-charcoal-200 bg-white p-5 sm:p-6">
        <PanelHeader
          eyebrow={t('formSteps.phoneLocEyebrow')}
          title={t('formSteps.phoneLocTitle')}
          hint={t('formSteps.phoneLocHint')}
          optional
        />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <InputGroup label={t('formSteps.phoneLabel')}>
            <PhoneInput
              value={data.phone}
              onChange={v => update({ ...data, phone: v })}
              placeholder={t('formSteps.phonePlaceholder')}
              invalidMessage={t('builder.errPhoneInvalid')}
            />
          </InputGroup>
          <InputGroup
            label={t('formSteps.locationLabel')}
            helper={t('formSteps.locationHelper')}
          >
            <Input
              value={data.location}
              onChange={e => update({ ...data, location: e.target.value })}
              placeholder={t('formSteps.locationPlaceholder')}
            />
          </InputGroup>
        </div>
      </section>

      <section className="rounded-2xl border border-charcoal-200 bg-white p-5 sm:p-6">
        <PanelHeader
          eyebrow={t('formSteps.linksEyebrow')}
          title={t('formSteps.linksTitle')}
          hint={t('formSteps.linksHint')}
          optional
          icon={<LinkIcon size={14} />}
        />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <InputGroup label={t('formSteps.linkedinLabel')}>
            <Input
              type="url"
              value={data.linkedin || ''}
              onChange={e => update({ ...data, linkedin: e.target.value })}
              placeholder={t('formSteps.linkedinPlaceholder')}
            />
          </InputGroup>
          <InputGroup label={t('formSteps.githubLabel')}>
            <Input
              type="url"
              value={data.github || ''}
              onChange={e => update({ ...data, github: e.target.value })}
              placeholder={t('formSteps.githubPlaceholder')}
            />
          </InputGroup>
          <InputGroup
            label={t('formSteps.websiteLabel')}
            className="md:col-span-2"
            helper={t('formSteps.websiteHelper')}
          >
            <Input
              type="url"
              value={data.website || ''}
              onChange={e => update({ ...data, website: e.target.value })}
              placeholder={t('formSteps.websitePlaceholder')}
            />
          </InputGroup>
        </div>
      </section>
    </div>
  </div>
  );
};

export const ProjectsStep: React.FC<{
  data: Project[];
  errors?: Record<string, string>;
  update: (d: Project[]) => void;
  userType?: UserType;
}> = ({ data, errors, update, userType }) => {
  const t = useT();
  const addProject = () => {
    update([
      ...data,
      {
        id: crypto.randomUUID(),
        name: '',
        rawDescription: '',
        refinedBullets: [],
        technologies: '',
      },
    ]);
  };

  const removeProject = (id: string) => update(data.filter(p => p.id !== id));

  const updateProject = (id: string, field: keyof Project, value: string) => {
    update(data.map(p => (p.id === id ? { ...p, [field]: value } : p)));
  };

  const studentExamples = [
    t('formSteps.projectsStudentEx1'),
    t('formSteps.projectsStudentEx2'),
    t('formSteps.projectsStudentEx3'),
  ];
  const proExamples = [
    t('formSteps.projectsProEx1'),
    t('formSteps.projectsProEx2'),
    t('formSteps.projectsProEx3'),
  ];

  return (
    <div className="space-y-5">
      <SectionHeader
        eyebrow={t('formSteps.projectsEyebrow')}
        title={t('formSteps.projectsTitle')}
        desc={
          userType === 'student'
            ? t('formSteps.projectsDescStudent')
            : t('formSteps.projectsDescPro')
        }
      />

      <WritingGuide
        reassurance={t('formSteps.projectsReassurance')}
        examples={userType === 'student' ? studentExamples : proExamples}
      />

      {data.map((project, index) => {
        const filled = !!project.name.trim() && !!project.rawDescription.trim();
        return (
          <CollapsibleItem
            key={project.id}
            icon={<FolderGit2 size={16} />}
            indexLabel={t('formSteps.projectsIndex', { n: index + 1 })}
            isFilled={filled}
            summaryPrimary={project.name || t('formSteps.projectsUntitled')}
            summarySecondary={project.technologies}
            onRemove={() => removeProject(project.id)}
          >
            <InputGroup
              label={t('formSteps.projectsNameLabel')}
              required
              error={errors?.[`projects.${index}.name`]}
            >
              <Input
                error={errors?.[`projects.${index}.name`]}
                value={project.name}
                onChange={e =>
                  updateProject(project.id, 'name', e.target.value)
                }
                placeholder={t('formSteps.projectsNamePlaceholder')}
              />
            </InputGroup>

            <InputGroup
              label={t('formSteps.projectsTechLabel')}
              optional
              helper={t('formSteps.projectsTechHelper')}
            >
              <Input
                value={project.technologies || ''}
                onChange={e =>
                  updateProject(project.id, 'technologies', e.target.value)
                }
                placeholder={t('formSteps.projectsTechPlaceholder')}
              />
            </InputGroup>

            <InputGroup
              label={t('formSteps.projectsLinkLabel')}
              optional
              helper={t('formSteps.projectsLinkHelper')}
            >
              <Input
                type="url"
                value={project.link || ''}
                onChange={e =>
                  updateProject(project.id, 'link', e.target.value)
                }
                placeholder={t('formSteps.projectsLinkPlaceholder')}
              />
            </InputGroup>

            <InputGroup
              label={t('formSteps.projectsDescLabel')}
              required
              error={errors?.[`projects.${index}.rawDescription`]}
            >
              <PolishHint />
              <TextArea
                error={errors?.[`projects.${index}.rawDescription`]}
                rows={5}
                value={project.rawDescription}
                onChange={e =>
                  updateProject(project.id, 'rawDescription', e.target.value)
                }
                placeholder={t('formSteps.projectsDescPlaceholder')}
              />
            </InputGroup>
          </CollapsibleItem>
        );
      })}

      <AddButton onClick={addProject} label={t('formSteps.projectsAddCta')} />
    </div>
  );
};

export const ExperienceStep: React.FC<{
  data: WorkExperience[];
  errors?: Record<string, string>;
  update: (d: WorkExperience[]) => void;
}> = ({ data, errors, update }) => {
  const t = useT();
  const addExp = () => {
    update([
      ...data,
      {
        id: crypto.randomUUID(),
        company: '',
        role: '',
        startDate: '',
        endDate: '',
        isCurrent: false,
        rawDescription: '',
        refinedBullets: [],
      },
    ]);
  };

  const removeExp = (id: string) => update(data.filter(exp => exp.id !== id));
  const updateExp = (id: string, field: keyof WorkExperience, value: unknown) => {
    update(data.map(exp => (exp.id === id ? { ...exp, [field]: value } : exp)));
  };

  return (
    <div className="space-y-5">
      <SectionHeader
        eyebrow={t('formSteps.experienceEyebrow')}
        title={t('formSteps.experienceTitle')}
        desc={t('formSteps.experienceDesc')}
      />

      <WritingGuide
        reassurance={t('formSteps.experienceReassurance')}
        examples={[
          t('formSteps.experienceEx1'),
          t('formSteps.experienceEx2'),
          t('formSteps.experienceEx3'),
          t('formSteps.experienceEx4'),
        ]}
      />

      {data.map((exp, index) => {
        const filled =
          !!exp.company.trim() && !!exp.role.trim() && !!exp.startDate;
        return (
          <CollapsibleItem
            key={exp.id}
            icon={<Briefcase size={16} />}
            indexLabel={t('formSteps.experienceIndex', { n: index + 1 })}
            isFilled={filled}
            summaryPrimary={
              exp.role && exp.company
                ? `${exp.role} · ${exp.company}`
                : exp.role || exp.company || t('formSteps.untitledRole')
            }
            summarySecondary={dateRange(exp.startDate, exp.endDate, exp.isCurrent)}
            onRemove={() => removeExp(exp.id)}
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <InputGroup
                label={t('formSteps.experienceJobTitleLabel')}
                required
                error={errors?.[`experience.${index}.role`]}
              >
                <Input
                  error={errors?.[`experience.${index}.role`]}
                  value={exp.role}
                  onChange={e => updateExp(exp.id, 'role', e.target.value)}
                  placeholder={t('formSteps.experienceJobTitlePlaceholder')}
                />
              </InputGroup>
              <InputGroup
                label={t('formSteps.experienceCompanyLabel')}
                required
                error={errors?.[`experience.${index}.company`]}
              >
                <Input
                  error={errors?.[`experience.${index}.company`]}
                  value={exp.company}
                  onChange={e => updateExp(exp.id, 'company', e.target.value)}
                  placeholder={t('formSteps.experienceCompanyPlaceholder')}
                />
              </InputGroup>

              <InputGroup
                label={t('formSteps.experienceStartLabel')}
                required
                error={errors?.[`experience.${index}.startDate`]}
              >
                <MonthPicker
                  isError={!!errors?.[`experience.${index}.startDate`]}
                  value={exp.startDate}
                  onChange={val => updateExp(exp.id, 'startDate', val)}
                />
              </InputGroup>

              <div className="flex flex-col gap-1.5">
                <div className="flex items-baseline justify-between">
                  <label className="text-sm font-semibold text-brand-700">
                    {t('formSteps.experienceEndLabel')}
                    {!exp.isCurrent && (
                      <span className="text-accent-500 ml-0.5">*</span>
                    )}
                  </label>
                </div>
                {exp.isCurrent ? (
                  <div className="w-full rounded-lg border border-charcoal-200 bg-charcoal-100 px-3.5 py-2.5 text-sm text-brand-600 font-medium">
                    {t('formSteps.monthPresent')}
                  </div>
                ) : (
                  <>
                    <MonthPicker
                      isError={!!errors?.[`experience.${index}.endDate`]}
                      value={exp.endDate}
                      onChange={val => updateExp(exp.id, 'endDate', val)}
                    />
                    {errors?.[`experience.${index}.endDate`] && (
                      <span className="text-xs text-red-600 font-medium">
                        {errors[`experience.${index}.endDate`]}
                      </span>
                    )}
                  </>
                )}

                <label className="flex items-center gap-2 mt-1 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    className="w-4 h-4 accent-accent-500 rounded border-charcoal-300"
                    checked={exp.isCurrent}
                    onChange={e => {
                      const isCurrent = e.target.checked;
                      update(
                        data.map(item =>
                          item.id === exp.id
                            ? {
                                ...item,
                                isCurrent,
                                endDate: isCurrent ? '' : item.endDate,
                              }
                            : item,
                        ),
                      );
                    }}
                  />
                  <span
                    className={`text-sm font-medium ${
                      exp.isCurrent ? 'text-accent-700' : 'text-charcoal-600'
                    }`}
                  >
                    {t('formSteps.experienceCurrentLabel')}
                  </span>
                </label>
              </div>
            </div>

            <InputGroup
              label={t('formSteps.experienceDescLabel')}
              required
              error={errors?.[`experience.${index}.rawDescription`]}
            >
              <PolishHint />
              <TextArea
                error={errors?.[`experience.${index}.rawDescription`]}
                rows={6}
                value={exp.rawDescription}
                onChange={e =>
                  updateExp(exp.id, 'rawDescription', e.target.value)
                }
                placeholder={t('formSteps.experienceDescPlaceholder')}
              />
            </InputGroup>
          </CollapsibleItem>
        );
      })}

      <AddButton onClick={addExp} label={t('formSteps.experienceAddCta')} />
    </div>
  );
};

export const EducationStep: React.FC<{
  data: Education[];
  errors?: Record<string, string>;
  update: (d: Education[]) => void;
}> = ({ data, errors, update }) => {
  const t = useT();
  const addEdu = () =>
    update([
      ...data,
      {
        id: crypto.randomUUID(),
        school: '',
        degree: '',
        field: '',
        startDate: '',
        endDate: '',
        gpa: '',
      },
    ]);

  const removeEdu = (id: string) => update(data.filter(e => e.id !== id));
  const updateEdu = (id: string, field: keyof Education, value: string) => {
    update(data.map(e => (e.id === id ? { ...e, [field]: value } : e)));
  };

  return (
    <div className="space-y-5">
      <SectionHeader
        eyebrow={t('formSteps.educationEyebrow')}
        title={t('formSteps.educationTitle')}
        desc={t('formSteps.educationDesc')}
      />

      <TipCard
        title={t('formSteps.educationTipTitle')}
        rules={[
          t('formSteps.educationTipRule1'),
          t('formSteps.educationTipRule2'),
          t('formSteps.educationTipRule3'),
        ]}
        examples={[
          t('formSteps.educationTipEx1'),
          t('formSteps.educationTipEx2'),
          t('formSteps.educationTipEx3'),
        ]}
      />

      {data.map((edu, index) => {
        const filled =
          !!edu.school.trim() && !!edu.degree.trim() && !!edu.field.trim();
        return (
          <CollapsibleItem
            key={edu.id}
            icon={<GraduationCap size={16} />}
            indexLabel={t('formSteps.educationIndex', { n: index + 1 })}
            isFilled={filled}
            summaryPrimary={
              edu.degree && edu.field
                ? `${edu.degree}, ${edu.field}`
                : edu.degree || edu.school || t('formSteps.educationUntitled')
            }
            summarySecondary={
              edu.school
                ? `${edu.school}${
                    edu.startDate || edu.endDate
                      ? ` · ${edu.startDate}–${edu.endDate || '…'}`
                      : ''
                  }`
                : ''
            }
            onRemove={() => removeEdu(edu.id)}
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <InputGroup
                label={t('formSteps.educationSchoolLabel')}
                required
                error={errors?.[`education.${index}.school`]}
              >
                <Input
                  error={errors?.[`education.${index}.school`]}
                  value={edu.school}
                  onChange={e => updateEdu(edu.id, 'school', e.target.value)}
                  placeholder={t('formSteps.educationSchoolPlaceholder')}
                />
              </InputGroup>
              <InputGroup
                label={t('formSteps.educationDegreeLabel')}
                required
                error={errors?.[`education.${index}.degree`]}
              >
                <Input
                  error={errors?.[`education.${index}.degree`]}
                  value={edu.degree}
                  onChange={e => updateEdu(edu.id, 'degree', e.target.value)}
                  placeholder={t('formSteps.educationDegreePlaceholder')}
                />
              </InputGroup>
              <InputGroup
                label={t('formSteps.educationFieldLabel')}
                required
                error={errors?.[`education.${index}.field`]}
              >
                <Input
                  error={errors?.[`education.${index}.field`]}
                  value={edu.field}
                  onChange={e => updateEdu(edu.id, 'field', e.target.value)}
                  placeholder={t('formSteps.educationFieldPlaceholder')}
                />
              </InputGroup>
              <div className="grid grid-cols-2 gap-3">
                <InputGroup
                  label={t('formSteps.educationStartYearLabel')}
                  required
                  error={errors?.[`education.${index}.startDate`]}
                >
                  <MonthPicker
                    isError={!!errors?.[`education.${index}.startDate`]}
                    value={edu.startDate}
                    onChange={val => updateEdu(edu.id, 'startDate', val)}
                  />
                </InputGroup>
                <InputGroup
                  label={t('formSteps.educationEndYearLabel')}
                  required
                  error={errors?.[`education.${index}.endDate`]}
                >
                  <MonthPicker
                    isError={!!errors?.[`education.${index}.endDate`]}
                    value={edu.endDate}
                    onChange={val => updateEdu(edu.id, 'endDate', val)}
                  />
                </InputGroup>
              </div>
              <InputGroup
                label={t('formSteps.educationGpaLabel')}
                optional
                helper={t('formSteps.educationGpaHelper')}
                className="md:col-span-2"
              >
                <Input
                  value={edu.gpa || ''}
                  onChange={e => updateEdu(edu.id, 'gpa', e.target.value)}
                  placeholder={t('formSteps.educationGpaPlaceholder')}
                />
              </InputGroup>
            </div>
          </CollapsibleItem>
        );
      })}

      <AddButton onClick={addEdu} label={t('formSteps.educationAddCta')} />
    </div>
  );
};

export const SkillsStep: React.FC<{
  data: string[];
  update: (d: string[]) => void;
  userType?: UserType;
  /**
   * Job description text. When present, drives the "From this job description"
   * suggestion section via fuse.js fuzzy-matching against the skill pool.
   * Builder passes `targetJob.description`; profile setup passes nothing.
   */
  jdText?: string;
  /**
   * Skills the user has previously added to their profile. Surfaced first in
   * the suggestion pool — these are "yours", not generic dictionary picks.
   */
  profilePool?: string[];
}> = ({ data, update, userType, jdText, profilePool = [] }) => {
  const t = useT();
  const [currentSkill, setCurrentSkill] = useState('');

  const addSkill = (e?: React.FormEvent) => {
    e?.preventDefault();
    const value = currentSkill.trim();
    if (!value) return;
    if (!data.includes(value)) update([...data, value]);
    setCurrentSkill('');
  };

  const addSuggested = (skill: string) => {
    if (!data.includes(skill)) update([...data, skill]);
  };

  const removeSkill = (skill: string) =>
    update(data.filter(s => s !== skill));

  // Broad-by-design starter chips. The AI reorders + prunes at generation
  // time against the JD, so it's safe to seed a wide net.
  const starterChips =
    userType === 'student'
      ? [
          'Communication', 'Teamwork', 'Problem solving', 'Time management',
          'Leadership', 'Writing', 'Microsoft Excel', 'Research',
          'Public speaking', 'Customer service',
        ]
      : [
          'Stakeholder management', 'Project management', 'Data analysis',
          'Cross-functional collaboration', 'Coaching', 'Strategy',
          'Process improvement', 'Budgeting', 'Microsoft Excel', 'SQL',
        ];

  // Canonical pool — profile skills first, then the curated dictionary.
  // Used by the extractor for canonical naming ("react" → "React") and for
  // its high-precision Pass A.
  const canonicalPool = useMemo(
    () => buildSkillPool(profilePool, []),
    [profilePool],
  );

  // True extraction — finds skills *from* the JD via 4 passes (known-match,
  // intro-phrase, section-bullet, capitalized-frequency). Surfaces niche
  // skills the dictionary doesn't know (Snowflake, Datadog, custom internal
  // tools), normalised to canonical names where possible. Already-added
  // skills are filtered via `exclude`. Pure client-side, no API call.
  const jdMatched = useMemo(
    () =>
      extractSkillsFromJD(jdText ?? '', {
        knownSkills: canonicalPool,
        exclude: data,
        maxResults: 24,
      }),
    [jdText, canonicalPool, data],
  );

  // Lower-priority "common picks" — starter chips for the user type, minus
  // anything already added or already shown in the JD section.
  const moreSuggestions = useMemo(() => {
    const taken = new Set([
      ...data.map(s => s.toLowerCase()),
      ...jdMatched.map(s => s.toLowerCase()),
    ]);
    const out: string[] = [];
    const seen = new Set<string>();
    for (const s of starterChips) {
      const k = s.toLowerCase();
      if (taken.has(k) || seen.has(k)) continue;
      seen.add(k);
      out.push(s);
    }
    return out;
  }, [data, jdMatched, starterChips]);

  const count = data.length;
  const hasJdMatches = jdMatched.length > 0;

  // Encouraging count vibe — purely cosmetic, no validation behaviour.
  const countLabel =
    count === 0
      ? t('formSteps.skillsAddSome')
      : count < 6
        ? t('formSteps.skillsKeepGoing', { n: count })
        : count <= 18
          ? t('formSteps.skillsSolidList', { n: count })
          : t('formSteps.skillsLongList', { n: count });
  const countTone =
    count === 0
      ? 'text-charcoal-500'
      : count >= 6 && count <= 18
        ? 'text-accent-700'
        : 'text-charcoal-600';

  return (
    <div>
      <SectionHeader
        eyebrow={t('formSteps.skillsEyebrow')}
        title={t('formSteps.skillsTitle')}
        desc={t('formSteps.skillsDesc')}
      />

      <MiniGuide>
        <strong>{t('formSteps.skillsMiniGuidePrefix')}</strong>{t('formSteps.skillsMiniGuideBody')}
      </MiniGuide>

      <form
        onSubmit={addSkill}
        className="mt-6 flex flex-col sm:flex-row gap-2"
      >
        <Input
          value={currentSkill}
          onChange={e => setCurrentSkill(e.target.value)}
          placeholder={t('formSteps.skillsInputPlaceholder')}
          className="flex-1"
          autoComplete="off"
        />
        <button
          type="submit"
          className="inline-flex items-center justify-center gap-1.5 px-5 py-2.5 bg-brand-700 text-charcoal-50 rounded-lg font-semibold text-sm hover:bg-brand-800 transition-colors disabled:opacity-50"
          disabled={!currentSkill.trim()}
        >
          <Plus size={15} /> {t('formSteps.skillsAddBtn')}
        </button>
      </form>

      {/* JD-matched suggestions — saffron prominent. Surfaces the user's own
          profile skills + curated dictionary entries that actually appear in
          the job description. Powered by fuse.js fuzzy matching. */}
      {hasJdMatches && (
        <div className="mt-7 rounded-2xl border border-accent-300 bg-accent-50/80 p-5">
          <div className="flex items-start justify-between gap-3 mb-4">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-full bg-accent-400 text-brand-800 flex items-center justify-center shrink-0">
                <Sparkles size={16} />
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-[0.22em] text-accent-700 font-semibold">
                  {t('formSteps.skillsFromJD')}
                </p>
                <p className="text-[13.5px] text-brand-700 leading-snug mt-0.5 max-w-md">
                  {t('formSteps.skillsFromJDDesc')}
                </p>
              </div>
            </div>
            <p className="text-[11px] text-accent-700 font-semibold whitespace-nowrap">
              {t('formSteps.skillsMatchedCount', { n: jdMatched.length })}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {jdMatched.map(chip => (
              <button
                key={chip}
                type="button"
                onClick={() => addSuggested(chip)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-accent-400 border border-accent-500 text-brand-800 text-sm font-semibold hover:bg-accent-300 transition-colors"
              >
                <Plus size={12} className="text-brand-700" />
                {chip}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Common picks — neutral fallback chips. Always shown if the user-type
          starter list still has unselected items, so even users without a JD
          have something to click. */}
      {moreSuggestions.length > 0 && (
        <div className="mt-7">
          <div className="flex items-baseline justify-between mb-3">
            <p className="text-[11px] uppercase tracking-[0.22em] text-charcoal-500 font-semibold">
              {hasJdMatches ? t('formSteps.skillsOtherCommon') : t('formSteps.skillsCommonPicks')}
            </p>
            <p className="text-[11px] text-charcoal-500">
              {userType === 'student' ? t('formSteps.skillsStudentFriendly') : t('formSteps.skillsProFriendly')}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {moreSuggestions.map(chip => (
              <button
                key={chip}
                type="button"
                onClick={() => addSuggested(chip)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-charcoal-200 bg-white text-charcoal-700 text-sm font-medium hover:border-accent-300 hover:bg-accent-50 hover:text-brand-700 transition-colors"
              >
                <Plus size={12} />
                {chip}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Your skills — clean tag chips (light bg, charcoal border, ink text).
          The previous heavy-ink pills looked like a wall; these read as data
          tags so 20+ skills don't feel oppressive. */}
      <div className="mt-8 rounded-2xl border border-charcoal-200 bg-white p-5">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <span className="text-[11px] uppercase tracking-[0.22em] text-brand-700 font-semibold">
              {t('formSteps.skillsYoursLabel')}
            </span>
            {count > 0 && (
              <span className="inline-flex items-center justify-center min-w-[22px] h-[20px] px-1.5 rounded-full bg-brand-700 text-charcoal-50 text-[11px] font-semibold leading-none">
                {count}
              </span>
            )}
          </div>
          <p className={`text-xs font-semibold ${countTone}`}>{countLabel}</p>
        </div>
        {count === 0 ? (
          <div className="rounded-xl border border-dashed border-charcoal-200 bg-charcoal-50/60 px-5 py-7 text-center">
            <p className="text-sm text-charcoal-500">
              {t('formSteps.skillsNothingYet')}
            </p>
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {data.map(skill => (
              <span
                key={skill}
                className="group inline-flex items-center gap-1 pl-2.5 pr-1 py-[5px] rounded-md bg-charcoal-50 border border-charcoal-200 text-brand-700 text-[13px] font-medium hover:border-charcoal-300 hover:bg-white transition-colors"
              >
                <span className="leading-none">{skill}</span>
                <button
                  type="button"
                  onClick={() => removeSkill(skill)}
                  className="ml-0.5 w-[18px] h-[18px] inline-flex items-center justify-center rounded text-charcoal-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                  aria-label={t('formSteps.skillsRemoveAria', { skill })}
                >
                  <X size={12} strokeWidth={2.5} />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export const ExtracurricularStep: React.FC<{
  data: Extracurricular[];
  errors?: Record<string, string>;
  update: (d: Extracurricular[]) => void;
}> = ({ data, errors, update }) => {
  const t = useT();
  const addItem = () =>
    update([
      ...data,
      {
        id: crypto.randomUUID(),
        title: '',
        organization: '',
        startDate: '',
        endDate: '',
        description: '',
        refinedBullets: [],
      },
    ]);

  const removeItem = (id: string) => update(data.filter(i => i.id !== id));
  const updateItem = (
    id: string,
    field: keyof Extracurricular,
    value: unknown,
  ) => update(data.map(i => (i.id === id ? { ...i, [field]: value } : i)));

  return (
    <div className="space-y-5">
      <SectionHeader
        eyebrow={t('formSteps.extracurricularsEyebrow')}
        title={t('formSteps.extracurricularsTitle')}
        desc={t('formSteps.extracurricularsDesc')}
      />

      <TipCard
        title={t('formSteps.extracurricularsTipTitle')}
        rules={[
          t('formSteps.extracurricularsTipRule1'),
          t('formSteps.extracurricularsTipRule2'),
          t('formSteps.extracurricularsTipRule3'),
        ]}
        examples={[
          t('formSteps.extracurricularsTipEx1'),
          t('formSteps.extracurricularsTipEx2'),
          t('formSteps.extracurricularsTipEx3'),
        ]}
      />

      {data.map((item, index) => {
        const filled = !!item.title.trim() && !!item.organization.trim();
        return (
          <CollapsibleItem
            key={item.id}
            icon={<Users size={16} />}
            indexLabel={t('formSteps.extracurricularsIndex', { n: index + 1 })}
            isFilled={filled}
            summaryPrimary={
              item.title && item.organization
                ? `${item.title} · ${item.organization}`
                : item.title || item.organization
            }
            summarySecondary={dateRange(item.startDate, item.endDate)}
            onRemove={() => removeItem(item.id)}
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <InputGroup
                label={t('formSteps.extracurricularsRoleLabel')}
                required
                error={errors?.[`extracurriculars.${index}.title`]}
              >
                <Input
                  error={errors?.[`extracurriculars.${index}.title`]}
                  value={item.title}
                  onChange={e => updateItem(item.id, 'title', e.target.value)}
                  placeholder={t('formSteps.extracurricularsRolePlaceholder')}
                />
              </InputGroup>
              <InputGroup
                label={t('formSteps.extracurricularsOrgLabel')}
                required
                error={errors?.[`extracurriculars.${index}.organization`]}
              >
                <Input
                  error={errors?.[`extracurriculars.${index}.organization`]}
                  value={item.organization}
                  onChange={e =>
                    updateItem(item.id, 'organization', e.target.value)
                  }
                  placeholder={t('formSteps.extracurricularsOrgPlaceholder')}
                />
              </InputGroup>
              <InputGroup
                label={t('formSteps.extracurricularsStartLabel')}
                required
                error={errors?.[`extracurriculars.${index}.startDate`]}
              >
                <MonthPicker
                  isError={!!errors?.[`extracurriculars.${index}.startDate`]}
                  value={item.startDate}
                  onChange={val => updateItem(item.id, 'startDate', val)}
                />
              </InputGroup>
              <InputGroup
                label={t('formSteps.extracurricularsEndLabel')}
                required
                error={errors?.[`extracurriculars.${index}.endDate`]}
              >
                <MonthPicker
                  isError={!!errors?.[`extracurriculars.${index}.endDate`]}
                  value={item.endDate}
                  onChange={val => updateItem(item.id, 'endDate', val)}
                />
              </InputGroup>
            </div>
            <InputGroup label={t('formSteps.extracurricularsDescLabel')} optional>
              <PolishHint />
              <TextArea
                rows={3}
                value={item.description}
                onChange={e =>
                  updateItem(item.id, 'description', e.target.value)
                }
                placeholder={t('formSteps.extracurricularsDescPlaceholder')}
              />
            </InputGroup>
          </CollapsibleItem>
        );
      })}

      <AddButton onClick={addItem} label={t('formSteps.extracurricularsAddCta')} />
    </div>
  );
};

export const AwardsStep: React.FC<{
  data: Award[];
  errors?: Record<string, string>;
  update: (d: Award[]) => void;
}> = ({ data, errors, update }) => {
  const t = useT();
  const addItem = () =>
    update([
      ...data,
      {
        id: crypto.randomUUID(),
        title: '',
        issuer: '',
        date: '',
        description: '',
      },
    ]);
  const removeItem = (id: string) => update(data.filter(x => x.id !== id));
  const updateItem = (id: string, field: keyof Award, value: string) =>
    update(data.map(i => (i.id === id ? { ...i, [field]: value } : i)));

  return (
    <div className="space-y-5">
      <SectionHeader
        eyebrow={t('formSteps.awardsEyebrow')}
        title={t('formSteps.awardsTitle')}
        desc={t('formSteps.awardsDesc')}
      />

      <MiniGuide icon={<AwardIcon size={14} />}>
        <strong>{t('formSteps.awardsMiniPrefix')}</strong>{t('formSteps.awardsMiniBody')}
      </MiniGuide>

      {data.map((item, i) => {
        const filled = !!item.title.trim() && !!item.issuer.trim();
        return (
          <CollapsibleItem
            key={item.id}
            icon={<AwardIcon size={16} />}
            indexLabel={t('formSteps.awardsIndex', { n: i + 1 })}
            isFilled={filled}
            summaryPrimary={item.title || t('formSteps.awardsUntitled')}
            summarySecondary={
              [item.issuer, formatMonth(item.date)].filter(Boolean).join(' · ')
            }
            onRemove={() => removeItem(item.id)}
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <InputGroup
                label={t('formSteps.awardsTitleLabel')}
                required
                error={errors?.[`awards.${i}.title`]}
              >
                <Input
                  error={errors?.[`awards.${i}.title`]}
                  value={item.title}
                  onChange={e => updateItem(item.id, 'title', e.target.value)}
                  placeholder={t('formSteps.awardsTitlePlaceholder')}
                />
              </InputGroup>
              <InputGroup
                label={t('formSteps.awardsIssuerLabel')}
                required
                error={errors?.[`awards.${i}.issuer`]}
              >
                <Input
                  error={errors?.[`awards.${i}.issuer`]}
                  value={item.issuer}
                  onChange={e => updateItem(item.id, 'issuer', e.target.value)}
                  placeholder={t('formSteps.awardsIssuerPlaceholder')}
                />
              </InputGroup>
              <InputGroup
                label={t('formSteps.awardsDateLabel')}
                required
                error={errors?.[`awards.${i}.date`]}
              >
                <MonthPicker
                  isError={!!errors?.[`awards.${i}.date`]}
                  value={item.date}
                  onChange={val => updateItem(item.id, 'date', val)}
                />
              </InputGroup>
            </div>
            <InputGroup
              label={t('formSteps.awardsDescLabel')}
              optional
              helper={t('formSteps.awardsDescHelper')}
            >
              <TextArea
                rows={2}
                value={item.description}
                onChange={e =>
                  updateItem(item.id, 'description', e.target.value)
                }
              />
            </InputGroup>
          </CollapsibleItem>
        );
      })}

      <AddButton onClick={addItem} label={t('formSteps.awardsAddCta')} />
    </div>
  );
};

export const CertificationsStep: React.FC<{
  data: Certification[];
  errors?: Record<string, string>;
  update: (d: Certification[]) => void;
}> = ({ data, errors, update }) => {
  const t = useT();
  const addItem = () =>
    update([
      ...data,
      {
        id: crypto.randomUUID(),
        name: '',
        issuer: '',
        date: '',
        link: '',
      },
    ]);
  const removeItem = (id: string) => update(data.filter(x => x.id !== id));
  const updateItem = (id: string, field: keyof Certification, value: string) =>
    update(data.map(i => (i.id === id ? { ...i, [field]: value } : i)));

  return (
    <div className="space-y-5">
      <SectionHeader
        eyebrow={t('formSteps.certEyebrow')}
        title={t('formSteps.certTitle')}
        desc={t('formSteps.certDesc')}
      />

      <MiniGuide icon={<AwardIcon size={14} />}>
        <strong>{t('formSteps.certMiniPrefix')}</strong>{t('formSteps.certMiniBody')}
      </MiniGuide>

      {data.map((item, i) => {
        const filled = !!item.name.trim() && !!item.issuer.trim();
        return (
          <CollapsibleItem
            key={item.id}
            icon={<AwardIcon size={16} />}
            indexLabel={t('formSteps.certIndex', { n: i + 1 })}
            isFilled={filled}
            summaryPrimary={item.name || t('formSteps.certUntitled')}
            summarySecondary={
              [item.issuer, formatMonth(item.date)].filter(Boolean).join(' · ')
            }
            onRemove={() => removeItem(item.id)}
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <InputGroup
                label={t('formSteps.certNameLabel')}
                required
                error={errors?.[`certifications.${i}.name`]}
              >
                <Input
                  error={errors?.[`certifications.${i}.name`]}
                  value={item.name}
                  onChange={e => updateItem(item.id, 'name', e.target.value)}
                  placeholder={t('formSteps.certNamePlaceholder')}
                />
              </InputGroup>
              <InputGroup
                label={t('formSteps.certIssuerLabel')}
                required
                error={errors?.[`certifications.${i}.issuer`]}
              >
                <Input
                  error={errors?.[`certifications.${i}.issuer`]}
                  value={item.issuer}
                  onChange={e => updateItem(item.id, 'issuer', e.target.value)}
                  placeholder={t('formSteps.certIssuerPlaceholder')}
                />
              </InputGroup>
              <InputGroup
                label={t('formSteps.certIssuedLabel')}
                required
                error={errors?.[`certifications.${i}.date`]}
              >
                <MonthPicker
                  isError={!!errors?.[`certifications.${i}.date`]}
                  value={item.date}
                  onChange={val => updateItem(item.id, 'date', val)}
                />
              </InputGroup>
              <InputGroup label={t('formSteps.certLinkLabel')} optional>
                <Input
                  type="url"
                  value={item.link || ''}
                  onChange={e => updateItem(item.id, 'link', e.target.value)}
                  placeholder={t('formSteps.certLinkPlaceholder')}
                />
              </InputGroup>
            </div>
          </CollapsibleItem>
        );
      })}

      <AddButton onClick={addItem} label={t('formSteps.certAddCta')} />
    </div>
  );
};

export const AffiliationsStep: React.FC<{
  data: Affiliation[];
  errors?: Record<string, string>;
  update: (d: Affiliation[]) => void;
}> = ({ data, errors, update }) => {
  const t = useT();
  const addItem = () =>
    update([
      ...data,
      {
        id: crypto.randomUUID(),
        organization: '',
        role: '',
        startDate: '',
        endDate: '',
      },
    ]);
  const removeItem = (id: string) => update(data.filter(x => x.id !== id));
  const updateItem = (id: string, field: keyof Affiliation, value: string) =>
    update(data.map(i => (i.id === id ? { ...i, [field]: value } : i)));

  return (
    <div className="space-y-5">
      <SectionHeader
        eyebrow={t('formSteps.affilEyebrow')}
        title={t('formSteps.affilTitle')}
        desc={t('formSteps.affilDesc')}
      />

      <MiniGuide icon={<Building2 size={14} />}>
        <strong>{t('formSteps.affilMiniPrefix')}</strong>{t('formSteps.affilMiniBody')}
      </MiniGuide>

      {data.map((item, i) => {
        const filled = !!item.organization.trim() && !!item.role.trim();
        return (
          <CollapsibleItem
            key={item.id}
            icon={<Building2 size={16} />}
            indexLabel={t('formSteps.affilIndex', { n: i + 1 })}
            isFilled={filled}
            summaryPrimary={
              item.role && item.organization
                ? `${item.role} · ${item.organization}`
                : item.role || item.organization
            }
            summarySecondary={dateRange(item.startDate, item.endDate)}
            onRemove={() => removeItem(item.id)}
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <InputGroup
                label={t('formSteps.affilOrgLabel')}
                required
                error={errors?.[`affiliations.${i}.organization`]}
              >
                <Input
                  error={errors?.[`affiliations.${i}.organization`]}
                  value={item.organization}
                  onChange={e =>
                    updateItem(item.id, 'organization', e.target.value)
                  }
                  placeholder={t('formSteps.affilOrgPlaceholder')}
                />
              </InputGroup>
              <InputGroup
                label={t('formSteps.affilRoleLabel')}
                required
                error={errors?.[`affiliations.${i}.role`]}
              >
                <Input
                  error={errors?.[`affiliations.${i}.role`]}
                  value={item.role}
                  onChange={e => updateItem(item.id, 'role', e.target.value)}
                  placeholder={t('formSteps.affilRolePlaceholder')}
                />
              </InputGroup>
              <InputGroup
                label={t('formSteps.affilStartLabel')}
                required
                error={errors?.[`affiliations.${i}.startDate`]}
              >
                <MonthPicker
                  isError={!!errors?.[`affiliations.${i}.startDate`]}
                  value={item.startDate}
                  onChange={val => updateItem(item.id, 'startDate', val)}
                />
              </InputGroup>
              <InputGroup
                label={t('formSteps.affilEndLabel')}
                required
                error={errors?.[`affiliations.${i}.endDate`]}
              >
                <MonthPicker
                  isError={!!errors?.[`affiliations.${i}.endDate`]}
                  value={item.endDate}
                  onChange={val => updateItem(item.id, 'endDate', val)}
                />
              </InputGroup>
            </div>
          </CollapsibleItem>
        );
      })}

      <AddButton onClick={addItem} label={t('formSteps.affilAddCta')} />
    </div>
  );
};

export const PublicationsStep: React.FC<{
  data: Publication[];
  errors?: Record<string, string>;
  update: (d: Publication[]) => void;
}> = ({ data, errors, update }) => {
  const t = useT();
  const addItem = () =>
    update([
      ...data,
      {
        id: crypto.randomUUID(),
        title: '',
        publisher: '',
        date: '',
        link: '',
      },
    ]);
  const removeItem = (id: string) => update(data.filter(x => x.id !== id));
  const updateItem = (id: string, field: keyof Publication, value: string) =>
    update(data.map(i => (i.id === id ? { ...i, [field]: value } : i)));

  return (
    <div className="space-y-5">
      <SectionHeader
        eyebrow={t('formSteps.pubsEyebrow')}
        title={t('formSteps.pubsTitle')}
        desc={t('formSteps.pubsDesc')}
      />

      <MiniGuide icon={<BookOpen size={14} />}>
        <strong>{t('formSteps.pubsMiniPrefix')}</strong>{t('formSteps.pubsMiniBody')}
      </MiniGuide>

      {data.map((item, i) => {
        const filled = !!item.title.trim() && !!(item.publisher || '').trim();
        return (
          <CollapsibleItem
            key={item.id}
            icon={<BookOpen size={16} />}
            indexLabel={t('formSteps.pubsIndex', { n: i + 1 })}
            isFilled={filled}
            summaryPrimary={item.title || t('formSteps.pubsUntitled')}
            summarySecondary={
              [item.publisher, formatMonth(item.date)].filter(Boolean).join(' · ')
            }
            onRemove={() => removeItem(item.id)}
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <InputGroup
                label={t('formSteps.pubsTitleLabel')}
                required
                error={errors?.[`publications.${i}.title`]}
              >
                <Input
                  error={errors?.[`publications.${i}.title`]}
                  value={item.title}
                  onChange={e => updateItem(item.id, 'title', e.target.value)}
                  placeholder={t('formSteps.pubsTitlePlaceholder')}
                />
              </InputGroup>
              <InputGroup
                label={t('formSteps.pubsPublisherLabel')}
                required
                error={errors?.[`publications.${i}.publisher`]}
              >
                <Input
                  error={errors?.[`publications.${i}.publisher`]}
                  value={item.publisher || ''}
                  onChange={e =>
                    updateItem(item.id, 'publisher', e.target.value)
                  }
                  placeholder={t('formSteps.pubsPublisherPlaceholder')}
                />
              </InputGroup>
              <InputGroup
                label={t('formSteps.pubsDateLabel')}
                required
                error={errors?.[`publications.${i}.date`]}
              >
                <MonthPicker
                  isError={!!errors?.[`publications.${i}.date`]}
                  value={item.date}
                  onChange={val => updateItem(item.id, 'date', val)}
                />
              </InputGroup>
              <InputGroup label={t('formSteps.pubsLinkLabel')} optional>
                <Input
                  type="url"
                  value={item.link || ''}
                  onChange={e => updateItem(item.id, 'link', e.target.value)}
                  placeholder={t('formSteps.pubsLinkPlaceholder')}
                />
              </InputGroup>
            </div>
          </CollapsibleItem>
        );
      })}

      <AddButton onClick={addItem} label={t('formSteps.pubsAddCta')} />
    </div>
  );
};

// Languages — common in Bangladesh CVs (Bengali + English baseline) and useful
// globally for multilingual roles. Compact row layout — name + proficiency
// dropdown — since each item is just two short fields.
const LANGUAGE_PROFICIENCIES: LanguageProficiency[] = [
  'Native', 'Fluent', 'Professional', 'Conversational', 'Basic',
];

export const LanguagesStep: React.FC<{
  data: Language[];
  errors?: Record<string, string>;
  update: (d: Language[]) => void;
}> = ({ data, errors, update }) => {
  const t = useT();
  const proficiencyLabel: Record<LanguageProficiency, string> = {
    Native: t('formSteps.profNative'),
    Fluent: t('formSteps.profFluent'),
    Professional: t('formSteps.profProfessional'),
    Conversational: t('formSteps.profConversational'),
    Basic: t('formSteps.profBasic'),
  };
  const addItem = () =>
    update([
      ...data,
      { id: crypto.randomUUID(), name: '', proficiency: 'Professional' },
    ]);
  const removeItem = (id: string) => update(data.filter(x => x.id !== id));
  const updateItem = (id: string, field: keyof Language, value: string) =>
    update(data.map(i => (i.id === id ? { ...i, [field]: value } : i)));

  return (
    <div className="space-y-5">
      <SectionHeader
        eyebrow={t('formSteps.languagesEyebrow')}
        title={t('formSteps.languagesTitle')}
        desc={t('formSteps.languagesDesc')}
      />

      <MiniGuide icon={<LanguagesIcon size={14} />}>
        <strong>{t('formSteps.languagesMiniPrefix')}</strong>{t('formSteps.languagesMiniBody')}
      </MiniGuide>

      <div className="space-y-3">
        {data.map((item, i) => (
          <div
            key={item.id}
            className="grid grid-cols-1 md:grid-cols-[1fr_220px_auto] gap-3 items-end p-4 rounded-2xl border border-charcoal-200 bg-white"
          >
            <InputGroup
              label={t('formSteps.languagesLanguageLabel')}
              required
              error={errors?.[`languages.${i}.name`]}
            >
              <LanguagePicker
                isError={!!errors?.[`languages.${i}.name`]}
                value={item.name}
                onChange={val => updateItem(item.id, 'name', val)}
              />
            </InputGroup>
            <InputGroup label={t('formSteps.languagesProficiencyLabel')} required>
              <select
                value={item.proficiency}
                onChange={e => updateItem(item.id, 'proficiency', e.target.value)}
                className="w-full rounded-lg border border-charcoal-300 hover:border-charcoal-400 focus-visible:ring-2 focus-visible:ring-accent-400 focus-visible:border-accent-400 px-3.5 py-2.5 text-sm bg-white text-brand-800 focus:outline-none transition-colors"
              >
                {LANGUAGE_PROFICIENCIES.map(p => (
                  <option key={p} value={p}>{proficiencyLabel[p]}</option>
                ))}
              </select>
            </InputGroup>
            <button
              type="button"
              onClick={() => removeItem(item.id)}
              className="p-2 text-charcoal-500 hover:text-red-600 transition-colors"
              aria-label={t('formSteps.languagesRemoveAria')}
            >
              <Trash2 size={18} />
            </button>
          </div>
        ))}
      </div>

      <AddButton onClick={addItem} label={t('formSteps.languagesAddCta')} />
    </div>
  );
};

// References — standard in Bangladesh CVs (banks, conglomerates, gov't roles
// often expect 2–3 named referees with phone + email). Optional in most global
// resumes, gated behind the section selector.
export const ReferencesStep: React.FC<{
  data: Reference[];
  errors?: Record<string, string>;
  update: (d: Reference[]) => void;
}> = ({ data, errors, update }) => {
  const t = useT();
  const addItem = () =>
    update([
      ...data,
      {
        id: crypto.randomUUID(),
        name: '',
        position: '',
        organization: '',
        email: '',
        phone: '',
        relationship: '',
      },
    ]);
  const removeItem = (id: string) => update(data.filter(x => x.id !== id));
  const updateItem = (id: string, field: keyof Reference, value: string) =>
    update(data.map(i => (i.id === id ? { ...i, [field]: value } : i)));

  return (
    <div className="space-y-5">
      <SectionHeader
        eyebrow={t('formSteps.refsEyebrow')}
        title={t('formSteps.refsTitle')}
        desc={t('formSteps.refsDesc')}
      />

      <MiniGuide icon={<UserCheck size={14} />}>
        <strong>{t('formSteps.refsMiniPrefix')}</strong>{t('formSteps.refsMiniBody')}
      </MiniGuide>

      {data.map((item, i) => {
        const filled = !!item.name.trim() && !!item.email.trim();
        return (
          <CollapsibleItem
            key={item.id}
            icon={<UserCheck size={16} />}
            indexLabel={t('formSteps.refsIndex', { n: i + 1 })}
            isFilled={filled}
            summaryPrimary={item.name || t('formSteps.refsUnnamed')}
            summarySecondary={
              [item.position, item.organization].filter(Boolean).join(' · ')
            }
            onRemove={() => removeItem(item.id)}
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <InputGroup
                label={t('formSteps.refsNameLabel')}
                required
                error={errors?.[`references.${i}.name`]}
              >
                <Input
                  error={errors?.[`references.${i}.name`]}
                  value={item.name}
                  onChange={e => updateItem(item.id, 'name', e.target.value)}
                  placeholder={t('formSteps.refsNamePlaceholder')}
                />
              </InputGroup>
              <InputGroup
                label={t('formSteps.refsPositionLabel')}
                required
                error={errors?.[`references.${i}.position`]}
              >
                <Input
                  error={errors?.[`references.${i}.position`]}
                  value={item.position}
                  onChange={e => updateItem(item.id, 'position', e.target.value)}
                  placeholder={t('formSteps.refsPositionPlaceholder')}
                />
              </InputGroup>
              <InputGroup
                label={t('formSteps.refsOrgLabel')}
                required
                error={errors?.[`references.${i}.organization`]}
              >
                <Input
                  error={errors?.[`references.${i}.organization`]}
                  value={item.organization}
                  onChange={e => updateItem(item.id, 'organization', e.target.value)}
                  placeholder={t('formSteps.refsOrgPlaceholder')}
                />
              </InputGroup>
              <InputGroup
                label={t('formSteps.refsEmailLabel')}
                required
              >
                <EmailInput
                  error={errors?.[`references.${i}.email`]}
                  value={item.email}
                  onChange={v => updateItem(item.id, 'email', v)}
                  placeholder={t('formSteps.refsEmailPlaceholder')}
                  invalidMessage={t('builder.errEmailInvalid')}
                />
              </InputGroup>
              <InputGroup
                label={t('formSteps.refsPhoneLabel')}
                required
              >
                <PhoneInput
                  error={errors?.[`references.${i}.phone`]}
                  value={item.phone}
                  onChange={v => updateItem(item.id, 'phone', v)}
                  placeholder={t('formSteps.refsPhonePlaceholder')}
                  invalidMessage={t('builder.errPhoneInvalid')}
                />
              </InputGroup>
              <InputGroup
                label={t('formSteps.refsRelLabel')}
                optional
                helper={t('formSteps.refsRelHelper')}
              >
                <Input
                  value={item.relationship || ''}
                  onChange={e => updateItem(item.id, 'relationship', e.target.value)}
                  placeholder={t('formSteps.refsRelPlaceholder')}
                />
              </InputGroup>
            </div>
          </CollapsibleItem>
        );
      })}

      <AddButton onClick={addItem} label={t('formSteps.refsAddCta')} />
    </div>
  );
};

export const SectionSelectionStep: React.FC<{
  selected: string[];
  update: (sections: string[]) => void;
  userType?: UserType;
}> = ({ selected, update, userType }) => {
  const t = useT();
  const sections = [
    {
      id: 'experience',
      label: t('formSteps.secExperienceLabel'),
      icon: <Briefcase size={18} />,
      hint: userType === 'experienced'
        ? t('formSteps.secExperienceHintExp')
        : t('formSteps.secExperienceHintGen'),
    },
    {
      id: 'education',
      label: t('formSteps.secEducationLabel'),
      icon: <GraduationCap size={18} />,
      hint: t('formSteps.secEducationHint'),
    },
    {
      id: 'projects',
      label: t('formSteps.secProjectsLabel'),
      icon: <FolderGit2 size={18} />,
      hint: userType === 'student'
        ? t('formSteps.secProjectsHintStudent')
        : t('formSteps.secProjectsHintGen'),
    },
    {
      id: 'skills',
      label: t('formSteps.secSkillsLabel'),
      icon: <Sparkles size={18} />,
      hint: t('formSteps.secSkillsHint'),
    },
    {
      id: 'extracurriculars',
      label: t('formSteps.secActivitiesLabel'),
      icon: <Users size={18} />,
      hint: t('formSteps.secActivitiesHint'),
    },
    {
      id: 'awards',
      label: t('formSteps.secAwardsLabel'),
      icon: <AwardIcon size={18} />,
      hint: t('formSteps.secAwardsHint'),
    },
    {
      id: 'certifications',
      label: t('formSteps.secCertsLabel'),
      icon: <AwardIcon size={18} />,
      hint: t('formSteps.secCertsHint'),
    },
    {
      id: 'affiliations',
      label: t('formSteps.secAffilsLabel'),
      icon: <Users size={18} />,
      hint: t('formSteps.secAffilsHint'),
    },
    {
      id: 'publications',
      label: t('formSteps.secPubsLabel'),
      icon: <BookOpen size={18} />,
      hint: t('formSteps.secPubsHint'),
    },
    {
      id: 'languages',
      label: t('formSteps.secLanguagesLabel'),
      icon: <LanguagesIcon size={18} />,
      hint: t('formSteps.secLanguagesHint'),
    },
    {
      id: 'references',
      label: t('formSteps.secRefsLabel'),
      icon: <UserCheck size={18} />,
      hint: t('formSteps.secRefsHint'),
    },
  ];

  const handleToggle = (id: string) => {
    if (selected.includes(id)) {
      update(selected.filter(s => s !== id));
    } else {
      update([...selected, id]);
    }
  };

  const coreIds = new Set(['experience', 'education', 'projects', 'skills']);
  const coreSections = sections.filter(s => coreIds.has(s.id));
  const extraSections = sections.filter(s => !coreIds.has(s.id));

  const renderSectionCard = ({
    id,
    label,
    icon,
    hint,
  }: (typeof sections)[number]) => {
    const isSelected = selected.includes(id);
    return (
      <button
        key={id}
        type="button"
        onClick={() => handleToggle(id)}
        className={`flex items-start gap-3.5 p-4 rounded-2xl border-2 transition-all text-left ${
          isSelected
            ? 'border-accent-400 bg-accent-50/60 shadow-sm'
            : 'border-charcoal-200 bg-white hover:border-charcoal-400'
        }`}
        aria-pressed={isSelected}
      >
        <div
          className={`p-2 rounded-lg shrink-0 transition-colors ${
            isSelected
              ? 'bg-brand-700 text-accent-300'
              : 'bg-charcoal-100 text-brand-600'
          }`}
        >
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-1">
            <h3 className="font-semibold text-brand-700">{label}</h3>
            <div
              className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors shrink-0 ${
                isSelected
                  ? 'border-accent-500 bg-accent-500 text-white'
                  : 'border-charcoal-300 bg-white'
              }`}
            >
              {isSelected && <Check size={12} strokeWidth={3} />}
            </div>
          </div>
          <p className="text-xs text-charcoal-500 leading-relaxed">{hint}</p>
        </div>
      </button>
    );
  };

  return (
    <div>
      <SectionHeader
        eyebrow={t('formSteps.sectionsEyebrow')}
        title={t('formSteps.sectionsTitle')}
        desc={t('formSteps.sectionsDesc')}
      />

      <div className="rounded-2xl bg-brand-700 text-charcoal-50 px-5 sm:px-6 py-5 mb-7 flex items-center justify-between gap-4">
        <div>
          <p className="text-[10px] uppercase tracking-[0.22em] text-accent-300 font-semibold">
            {t('formSteps.sectionsCounterEyebrow')}
          </p>
          <p className="font-display text-xl sm:text-2xl font-semibold leading-tight mt-0.5">
            <span className="text-accent-400">{selected.length}</span>{' '}
            <span className="text-charcoal-300">{t('formSteps.sectionsCounterTextSuffix', { total: sections.length })}</span>
          </p>
        </div>
        <p className="hidden sm:block text-xs text-charcoal-300 max-w-[180px] text-right leading-relaxed">
          {t('formSteps.sectionsCounterHelp')}
        </p>
      </div>

      <div className="mb-7">
        <div className="flex items-baseline justify-between mb-3 gap-3">
          <p className="text-[11px] uppercase tracking-[0.22em] text-accent-600 font-semibold">
            {t('formSteps.sectionsCoreEyebrow')}
          </p>
          <p className="text-[11px] text-charcoal-500">
            {t('formSteps.sectionsCoreHelp')}
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {coreSections.map(renderSectionCard)}
        </div>
      </div>

      <div>
        <div className="flex items-baseline justify-between mb-3 gap-3">
          <p className="text-[11px] uppercase tracking-[0.22em] text-charcoal-500 font-semibold">
            {t('formSteps.sectionsExtrasEyebrow')}
          </p>
          <p className="text-[11px] text-charcoal-500">
            {t('formSteps.sectionsExtrasHelp')}
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {extraSections.map(renderSectionCard)}
        </div>
      </div>
    </div>
  );
};
