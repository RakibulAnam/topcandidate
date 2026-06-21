// Guided Mode field — drops into a profile section's add/edit form in place of
// the single description textarea. It owns the Guided/Free toggle and renders
// either the short questionnaire (guided) or the original brain-dump box
// (free). Controlled: the parent holds mode + answers + freeText and decides
// what to persist on save (assembleGuided(answers) in guided mode, freeText in
// free mode).
//
// Philosophy (BD market, all fields): a friend asking, not an interrogation.
// Each question shows an example ANSWER as always-visible helper text — teach
// by showing, never a format to follow. One required question; the rest are
// optional and collapsed behind a gentle "a few more" disclosure.

import React, { useId, useState } from 'react';
import { useLocale } from '../../i18n/LocaleContext';
import { InputMode, GuidedAnswers } from '../../../domain/entities/Resume';
import {
  GuidedSection,
  GUIDED_QUESTIONS,
  questionLabel,
  questionExample,
  assembleGuided,
  guidedHasAnyContent,
  uiText,
} from './guidedQuestions';

interface Props {
  section: GuidedSection;
  mode: InputMode;
  answers: GuidedAnswers;
  freeText: string;
  freePlaceholder: string;
  onModeChange: (mode: InputMode) => void;
  onAnswersChange: (answers: GuidedAnswers) => void;
  onFreeTextChange: (text: string) => void;
}

export const GuidedModeField: React.FC<Props> = ({
  section,
  mode,
  answers,
  freeText,
  freePlaceholder,
  onModeChange,
  onAnswersChange,
  onFreeTextChange,
}) => {
  const { locale } = useLocale();
  const [showMore, setShowMore] = useState(false);

  const questions = GUIDED_QUESTIONS[section];
  const primary = questions.filter(q => q.primary);
  const secondary = questions.filter(q => !q.primary);

  const switchMode = (next: InputMode) => {
    if (next === mode) return;
    // Preserve content across the switch.
    // Guided → Free: seed the box with the assembled answers (only if empty).
    if (next === 'free' && !freeText.trim()) {
      const assembled = assembleGuided(section, answers);
      if (assembled) onFreeTextChange(assembled);
    }
    // Free → Guided: if they'd typed a free paragraph and have no answers yet,
    // carry that text into the first (required) question so it isn't dropped
    // when we save the assembled answers instead of the free box.
    if (next === 'guided' && !guidedHasAnyContent(answers) && freeText.trim()) {
      const requiredId = GUIDED_QUESTIONS[section].find(q => q.required)?.id;
      if (requiredId) onAnswersChange({ ...answers, [requiredId]: freeText.trim() });
    }
    onModeChange(next);
  };

  const setAnswer = (id: string, value: string) =>
    onAnswersChange({ ...answers, [id]: value });

  const tabBtn = (m: InputMode, label: string) => (
    <button
      type="button"
      onClick={() => switchMode(m)}
      aria-pressed={mode === m}
      className={`text-xs font-semibold px-3 py-2 rounded-full transition-colors ${
        mode === m ? 'bg-brand-700 text-charcoal-50' : 'text-brand-600 hover:text-brand-800'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div>
      {/* Toggle + hint */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <span className="text-xs font-semibold text-charcoal-500 uppercase tracking-wide">
          {mode === 'guided' ? uiText('modeHint', locale) : ''}
        </span>
        <div
          role="group"
          aria-label={uiText('inputModeAria', locale)}
          className="inline-flex rounded-full border border-charcoal-300 bg-charcoal-50 p-0.5 shrink-0"
        >
          {tabBtn('guided', uiText('guidedTab', locale))}
          {tabBtn('free', uiText('freeTab', locale))}
        </div>
      </div>

      {mode === 'guided' ? (
        <div className="space-y-4">
          {primary.map(q => (
            <GuidedQuestionRow
              key={q.id}
              label={questionLabel(q, locale)}
              example={questionExample(q, locale)}
              required={!!q.required}
              requiredText={uiText('required', locale)}
              optionalText={uiText('optional', locale)}
              value={answers[q.id] ?? ''}
              onChange={v => setAnswer(q.id, v)}
            />
          ))}

          {secondary.length > 0 && !showMore && (
            <button
              type="button"
              onClick={() => setShowMore(true)}
              className="text-sm font-semibold text-brand-600 hover:text-brand-800"
            >
              + {uiText('moreOptional', locale)}
            </button>
          )}

          {showMore && (
            <>
              {secondary.map(q => (
                <GuidedQuestionRow
                  key={q.id}
                  label={questionLabel(q, locale)}
                  example={questionExample(q, locale)}
                  required={!!q.required}
                  requiredText={uiText('required', locale)}
                  optionalText={uiText('optional', locale)}
                  value={answers[q.id] ?? ''}
                  onChange={v => setAnswer(q.id, v)}
                />
              ))}
              <button
                type="button"
                onClick={() => setShowMore(false)}
                className="text-sm font-medium text-charcoal-500 hover:text-charcoal-700"
              >
                {uiText('showFewer', locale)}
              </button>
            </>
          )}
        </div>
      ) : (
        <textarea
          className="w-full p-2 border border-charcoal-300 rounded-lg h-40 text-sm"
          value={freeText}
          onChange={e => onFreeTextChange(e.target.value)}
          placeholder={freePlaceholder}
        />
      )}
    </div>
  );
};

const GuidedQuestionRow: React.FC<{
  label: string;
  example: string;
  required: boolean;
  requiredText: string;
  optionalText: string;
  value: string;
  onChange: (v: string) => void;
}> = ({ label, example, required, requiredText, optionalText, value, onChange }) => {
  const fieldId = useId();
  // Only flag a required field red AFTER the user has interacted (touched) —
  // a red box on a pristine form reads as scolding, not "a friend asking".
  const [touched, setTouched] = useState(false);
  const showError = required && touched && !value.trim();
  return (
    <div>
      <div className="flex items-baseline gap-2 mb-0.5">
        <label htmlFor={fieldId} className="text-sm font-semibold text-charcoal-800">{label}</label>
        <span className={`text-[10px] uppercase tracking-wide ${required ? 'text-accent-600 font-semibold' : 'text-charcoal-400'}`}>
          {required ? requiredText : optionalText}
        </span>
      </div>
      {/* Example ANSWER, always visible — teaches by showing, not a format. */}
      <p className="text-xs text-charcoal-400 mb-1.5 leading-relaxed">{example}</p>
      <textarea
        id={fieldId}
        className={`w-full p-2 border rounded-lg text-sm ${showError ? 'border-red-400' : 'border-charcoal-300'}`}
        rows={2}
        value={value}
        onChange={e => onChange(e.target.value)}
        onBlur={() => setTouched(true)}
      />
    </div>
  );
};
