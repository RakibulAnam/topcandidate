// Guided Mode question sets.
//
// Design principles (Bangladeshi market, ALL job fields — not just IT):
//   • A friend asking, not an interrogation. ≤ 8-word questions, everyday words.
//   • Every question carries an EXAMPLE ANSWER (a real natural sentence), shown
//     as always-visible helper text — it teaches by showing, it is NOT a format
//     the user must follow. Examples rotate across fields (garments, teaching,
//     nursing, sales, banking, NGO) so no profession feels excluded.
//   • Exactly ONE required question per section (the anchor); everything else is
//     optional and visibly skippable. Numbers questions name what to count and
//     say "a rough number is fine" so skipping never feels like failing.
//   • Fully bilingual (English + বাংলা) — strings live here, inline, so the
//     whole set is reviewable in one place.
//
// On save, answers are assembled into a labeled text block (assembleGuided)
// that becomes the item's description, which the existing AI normalizer refines
// exactly like a free brain dump. `assemblyLabel` is the English topic the AI
// reads; it is independent of the UI language.

import type { Locale } from '../../i18n/LocaleContext';
import type { GuidedAnswers } from '../../../domain/entities/Resume';

// Bump when question ids/wording change materially; stored as guided_version.
export const GUIDED_VERSION = 1;

export type GuidedSection = 'experience' | 'project' | 'extracurricular' | 'award';

interface LocalizedText {
  en: string;
  bn: string;
}

export interface GuidedQuestion {
  id: string;                 // stable key stored in `guided`
  required?: boolean;         // exactly one per section
  primary?: boolean;          // shown on the first screen; others collapse
  assemblyLabel: string;      // English topic label for the assembled block
  label: LocalizedText;       // the warm question
  example: LocalizedText;     // example answer (always-visible helper, not a format)
}

export const GUIDED_QUESTIONS: Record<GuidedSection, GuidedQuestion[]> = {
  experience: [
    {
      id: 'did',
      required: true,
      primary: true,
      assemblyLabel: 'Main work',
      label: { en: 'What did you mostly do here?', bn: 'এখানে আপনি মূলত কী করতেন?' },
      example: {
        en: 'e.g. "I taught maths to Class 6 and 7," or "I took customer payments and kept the cash register."',
        bn: 'যেমন: "আমি ষষ্ঠ ও সপ্তম শ্রেণিতে গণিত পড়াতাম," বা "আমি গ্রাহকদের পেমেন্ট নিতাম ও ক্যাশ সামলাতাম।"',
      },
    },
    {
      id: 'proud',
      primary: true,
      assemblyLabel: 'Proud of',
      label: { en: 'What are you most proud of?', bn: 'কোন কাজটি নিয়ে আপনি সবচেয়ে গর্বিত?' },
      example: {
        en: 'e.g. "I brought in 10 new customers in my first month." No big achievement? Anything you did well counts.',
        bn: 'যেমন: "প্রথম মাসেই আমি ১০ জন নতুন গ্রাহক এনেছিলাম।" বড় কিছু না থাকলেও, ভালো করা যেকোনো কাজই চলবে।',
      },
    },
    {
      id: 'numbers',
      primary: true,
      assemblyLabel: 'Numbers / scale',
      label: { en: 'About how many — people, customers, sales, or taka?', bn: 'মোটামুটি কতজন — মানুষ, গ্রাহক, বিক্রি, নাকি কত টাকা?' },
      example: {
        en: 'e.g. "Around 40 customers a day," or "a team of 5," or "about ৳2 lakh in sales each month." A rough number is perfectly fine.',
        bn: 'যেমন: "দিনে প্রায় ৪০ জন গ্রাহক," বা "৫ জনের একটি দল," বা "মাসে প্রায় ২ লাখ টাকা বিক্রি।" আনুমানিক সংখ্যা দিলেও চলবে।',
      },
    },
    {
      id: 'tools',
      assemblyLabel: 'Tools & methods',
      label: { en: 'What did you use to do your work?', bn: 'কাজটি করতে আপনি কী কী ব্যবহার করতেন?' },
      example: {
        en: 'e.g. "Sewing machines and a quality checklist," or "MS Excel and Tally," or "lesson plans and a projector."',
        bn: 'যেমন: "সেলাই মেশিন ও কোয়ালিটি চেকলিস্ট," বা "MS Excel ও Tally," বা "লেসন প্ল্যান ও প্রজেক্টর।"',
      },
    },
    {
      id: 'led',
      assemblyLabel: 'Leadership',
      label: { en: 'Did you lead or train anyone?', bn: 'আপনি কি কাউকে পরিচালনা বা প্রশিক্ষণ দিয়েছেন?' },
      example: {
        en: 'e.g. "I trained 3 new salespeople," or "I supervised 8 workers." If not, just skip this.',
        bn: 'যেমন: "আমি ৩ জন নতুন বিক্রয়কর্মীকে প্রশিক্ষণ দিয়েছি," বা "৮ জন কর্মী তদারকি করতাম।" না হলে বাদ দিন।',
      },
    },
    {
      id: 'improved',
      assemblyLabel: 'Improvements',
      label: { en: 'Did you make anything better or faster?', bn: 'আপনি কি কোনো কিছু আরও ভালো বা দ্রুত করতে পেরেছেন?' },
      example: {
        en: 'e.g. "I made the monthly report 2 days faster," or "fewer customer complaints." Skip if nothing comes to mind.',
        bn: 'যেমন: "মাসিক রিপোর্ট ২ দিন দ্রুত করেছি," বা "গ্রাহকের অভিযোগ কমেছে।" কিছু মনে না এলে বাদ দিন।',
      },
    },
  ],

  project: [
    {
      id: 'did',
      required: true,
      primary: true,
      assemblyLabel: 'What it was',
      label: { en: 'What did you make or do?', bn: 'আপনি কী তৈরি করেছেন বা কী করেছেন?' },
      example: {
        en: 'e.g. "Ran a vaccination camp," or "built a small website for a shop."',
        bn: 'যেমন: "একটি টিকাদান ক্যাম্প পরিচালনা করেছি," বা "একটি দোকানের জন্য ছোট ওয়েবসাইট বানিয়েছি।"',
      },
    },
    {
      id: 'outcome',
      primary: true,
      assemblyLabel: 'Outcome / numbers',
      label: { en: 'What happened in the end? Any numbers?', bn: 'শেষ পর্যন্ত কী হলো? কোনো সংখ্যা আছে?' },
      example: {
        en: 'e.g. "About 800 people came," or "we raised ৳50,000." A rough number is fine.',
        bn: 'যেমন: "প্রায় ৮০০ জন এসেছিল," বা "আমরা ৫০,০০০ টাকা তুলেছি।" আনুমানিক হলেও চলবে।',
      },
    },
    {
      id: 'goal',
      assemblyLabel: 'Goal',
      label: { en: 'Why did you do it? (the goal)', bn: 'কেন করেছিলেন? (লক্ষ্য কী ছিল)' },
      example: {
        en: 'e.g. "To reach more customers in villages."',
        bn: 'যেমন: "গ্রামের আরও বেশি গ্রাহকের কাছে পৌঁছাতে।"',
      },
    },
    {
      id: 'tools',
      assemblyLabel: 'Tools & methods',
      label: { en: 'What did you use? (tools or methods)', bn: 'কী কী ব্যবহার করেছেন? (টুল বা পদ্ধতি)' },
      example: {
        en: 'e.g. "Figma and surveys," or "hand tools," or "Excel."',
        bn: 'যেমন: "Figma ও জরিপ," বা "হাতের যন্ত্রপাতি," বা "Excel।"',
      },
    },
    {
      id: 'team',
      assemblyLabel: 'Role',
      label: { en: 'Did you do it alone or with a team?', bn: 'একা করেছেন নাকি দল নিয়ে?' },
      example: {
        en: 'e.g. "With a team of 4," or "on my own."',
        bn: 'যেমন: "৪ জনের দল নিয়ে," বা "একা।"',
      },
    },
  ],

  extracurricular: [
    {
      id: 'did',
      required: true,
      primary: true,
      assemblyLabel: 'What they did',
      label: { en: 'What did you do here?', bn: 'এখানে আপনি কী করতেন?' },
      example: {
        en: 'e.g. "I was captain of the debate club," or "organised blood donation drives."',
        bn: 'যেমন: "আমি বিতর্ক ক্লাবের ক্যাপ্টেন ছিলাম," বা "রক্তদান কর্মসূচি আয়োজন করতাম।"',
      },
    },
    {
      id: 'numbers',
      primary: true,
      assemblyLabel: 'Numbers / scale',
      label: { en: 'Any numbers? (members, events, or taka raised)', bn: 'কোনো সংখ্যা আছে? (সদস্য, অনুষ্ঠান, বা সংগৃহীত টাকা)' },
      example: {
        en: 'e.g. "Led 20 members," or "organised 5 events," or "raised ৳30,000."',
        bn: 'যেমন: "২০ জন সদস্য পরিচালনা," বা "৫টি অনুষ্ঠান আয়োজন," বা "৩০,০০০ টাকা সংগ্রহ।"',
      },
    },
    {
      id: 'learned',
      assemblyLabel: 'Skills built',
      label: { en: 'What did you get better at?', bn: 'কোন বিষয়ে আপনি দক্ষ হয়েছেন?' },
      example: {
        en: 'e.g. "Leadership, public speaking, and teamwork."',
        bn: 'যেমন: "নেতৃত্ব, জনসমক্ষে কথা বলা, ও দলগত কাজ।"',
      },
    },
  ],

  award: [
    {
      id: 'what',
      required: true,
      primary: true,
      assemblyLabel: 'Award for',
      label: { en: 'What was this award for?', bn: 'এই পুরস্কারটি কীসের জন্য?' },
      example: {
        en: 'e.g. "Best employee of the year," or "first prize in a science fair."',
        bn: 'যেমন: "বর্ষসেরা কর্মী," বা "বিজ্ঞান মেলায় প্রথম পুরস্কার।"',
      },
    },
    {
      id: 'selectivity',
      primary: true,
      assemblyLabel: 'Selectivity / level',
      label: { en: 'How hard was it to get?', bn: 'এটি পাওয়া কতটা কঠিন ছিল?' },
      example: {
        en: 'e.g. "Out of 200 staff," or "national level," or "top 3 in the district."',
        bn: 'যেমন: "২০০ জন কর্মীর মধ্যে," বা "জাতীয় পর্যায়ে," বা "জেলার সেরা ৩।"',
      },
    },
  ],
};

// Bilingual UI chrome for the guided field (kept here so every guided string
// is reviewable in one file).
export const GUIDED_UI: Record<string, LocalizedText> = {
  guidedTab: { en: 'Guided', bn: 'গাইডেড' },
  freeTab: { en: 'Free write', bn: 'নিজে লিখুন' },
  modeHint: { en: 'Answer a few quick questions — we’ll turn them into a polished resume.', bn: 'কয়েকটি সহজ প্রশ্নের উত্তর দিন — আমরা সুন্দর রিজিউমে বানিয়ে দেব।' },
  required: { en: 'required', bn: 'আবশ্যক' },
  optional: { en: 'optional', bn: 'ঐচ্ছিক' },
  moreOptional: { en: 'A few more (optional)', bn: 'আরও কয়েকটি (ঐচ্ছিক)' },
  showFewer: { en: 'Show fewer', bn: 'কম দেখান' },
};

export function uiText(key: keyof typeof GUIDED_UI | string, locale: Locale): string {
  const t = GUIDED_UI[key as string];
  return t ? (t[locale] ?? t.en) : (key as string);
}

// ── Helpers (pure; shared by the form, the sections, and assembly) ───────────

export function questionLabel(q: GuidedQuestion, locale: Locale): string {
  return q.label[locale] ?? q.label.en;
}
export function questionExample(q: GuidedQuestion, locale: Locale): string {
  return q.example[locale] ?? q.example.en;
}

// Assemble guided answers into the labeled text block the AI consumes. Only
// answered questions appear, in display order. This becomes the item's
// description column — so the normalizer / optimizer / fabrication guards read
// it exactly like a free brain dump.
export function assembleGuided(section: GuidedSection, answers: GuidedAnswers | undefined): string {
  if (!answers) return '';
  const lines: string[] = [];
  for (const q of GUIDED_QUESTIONS[section]) {
    const v = (answers[q.id] ?? '').trim();
    if (v) lines.push(`${q.assemblyLabel}: ${v}`);
  }
  return lines.join('\n');
}

// True when at least the required question(s) for the section are answered.
export function guidedRequiredFilled(section: GuidedSection, answers: GuidedAnswers | undefined): boolean {
  return GUIDED_QUESTIONS[section]
    .filter(q => q.required)
    .every(q => (answers?.[q.id] ?? '').trim().length > 0);
}

// True when the user has typed anything at all.
export function guidedHasAnyContent(answers: GuidedAnswers | undefined): boolean {
  return !!answers && Object.values(answers).some(v => (v ?? '').trim().length > 0);
}
