// A miniature of the user's OWN master resume, drawn from their profile — the
// centrepiece of every "unlock your master resume" ask (offer sheet, dashboard
// banner). No AI call: it is a sketch of what the real build will contain.
//
// Why a preview and not a paragraph: people value what they can already see
// with their name on it (endowment / IKEA effect — they typed all of this in),
// and a half-finished thing they own pulls harder than an abstract promise.
// The top shows real data in full; the lower part is blurred behind a lock, so
// the page reads as "yours, almost ready" rather than "a product for sale".
//
// Blur, not a fade: a fade-out would need a gradient, which the brand forbids.
import React, { useEffect, useState } from 'react';
import { Lock } from 'lucide-react';
import { profileRepository } from '../../../infrastructure/config/dependencies';
import { useT } from '../../i18n/LocaleContext';

export interface MasterPreviewData {
  name: string;
  contact: string;
  roles: { role: string; company: string }[];
  education: { degree: string; school: string } | null;
  skills: string[];
  /** Neither experience nor education → the master resume can't be built. */
  empty: boolean;
}

// One read per user per page load, shared by every surface that shows the
// preview (the banner and the sheet both mount on the dashboard).
const cache = new Map<string, Promise<MasterPreviewData>>();

function load(userId: string): Promise<MasterPreviewData> {
  let p = cache.get(userId);
  if (!p) {
    p = Promise.all([
      profileRepository.getProfile(userId).catch(() => null),
      // null = the read failed. Unknown is NOT empty: a flaky connection must
      // never tell someone with a full profile to "add your experience first".
      profileRepository.getExperiences(userId).catch(() => null),
      profileRepository.getEducations(userId).catch(() => null),
      profileRepository.getSkills(userId).catch(() => [] as string[]),
    ]).then(([personal, exps, edus, skills]) => ({
      name: personal?.fullName?.trim() || '',
      contact: [personal?.location, personal?.email].filter(Boolean).join(' · '),
      roles: (exps ?? []).filter((e) => e.role || e.company).slice(0, 2).map((e) => ({ role: e.role, company: e.company })),
      education: edus?.[0] ? { degree: [edus[0].degree, edus[0].field].filter(Boolean).join(', '), school: edus[0].school } : null,
      skills: skills.slice(0, 5),
      empty: exps !== null && edus !== null && exps.length === 0 && edus.length === 0,
    }));
    // A failed read must not stick for the whole session.
    p.then((d) => { if (!d.roles.length && !d.education && !d.empty) cache.delete(userId); })
      .catch(() => cache.delete(userId));
    cache.set(userId, p);
  }
  return p;
}

/** Drop the cached read — call after the profile changes. */
export function invalidateMasterPreview(userId?: string) {
  if (userId) cache.delete(userId); else cache.clear();
}

export function useMasterPreview(userId: string | null | undefined, enabled = true): MasterPreviewData | null {
  const [data, setData] = useState<MasterPreviewData | null>(null);
  useEffect(() => {
    if (!userId || !enabled) return;
    let cancelled = false;
    load(userId).then((d) => { if (!cancelled) setData(d); }).catch(() => {});
    return () => { cancelled = true; };
  }, [userId, enabled]);
  return data;
}

const Bar = ({ w, dark = false }: { w: string; dark?: boolean }) => (
  <span className={`block h-[5px] rounded-full ${dark ? 'bg-brand-700/70' : 'bg-charcoal-200'}`} style={{ width: w }} />
);

interface Props {
  data: MasterPreviewData | null;
  /** Fallback when the profile has no name yet. */
  fallbackName: string;
  className?: string;
}

export const MasterResumeMini: React.FC<Props> = ({ data, fallbackName, className = '' }) => {
  const t = useT();
  const name = data?.name || fallbackName;
  const role = data?.roles[0];

  return (
    <div
      aria-hidden="true"
      className={`relative select-none overflow-hidden rounded-[10px] border border-charcoal-200 bg-white px-4 pb-4 pt-4 text-left shadow-[0_18px_40px_-18px_rgba(15,27,45,0.45)] ${className}`}
    >
      {/* Header — real, legible */}
      <p className="truncate font-display text-[17px] font-semibold leading-tight text-brand-700">{name}</p>
      {role?.role && <p className="mt-0.5 truncate text-[10.5px] font-semibold text-accent-600">{role.role}</p>}
      {data?.contact
        ? <p className="mt-0.5 truncate text-[9px] text-charcoal-500">{data.contact}</p>
        : <span className="mt-1.5 block"><Bar w="60%" /></span>}
      <span className="mt-2.5 block h-px bg-brand-700/80" />

      {/* Experience — first role legible, the rest fades under the lock */}
      <p className="mt-2.5 text-[8.5px] font-bold uppercase tracking-[0.14em] text-brand-700">{t('masterOffer.previewExperience')}</p>
      {data?.roles.length ? (
        <div className="mt-1">
          <p className="truncate text-[10.5px] font-semibold text-brand-700">
            {data.roles[0].role}{data.roles[0].company ? <span className="font-normal text-charcoal-500"> — {data.roles[0].company}</span> : null}
          </p>
          <span className="mt-1.5 flex flex-col gap-1"><Bar w="92%" /><Bar w="78%" /></span>
        </div>
      ) : (
        <span className="mt-1.5 flex flex-col gap-1"><Bar w="55%" dark /><Bar w="92%" /><Bar w="78%" /></span>
      )}

      {/* Locked part — the reader can tell it's theirs, but not read it */}
      <div className="mt-2 blur-[2.5px]">
        <span className="flex flex-col gap-1"><Bar w="86%" /><Bar w="64%" /></span>
        {data?.roles[1] && (
          <p className="mt-2 truncate text-[10.5px] font-semibold text-brand-700">{data.roles[1].role} — {data.roles[1].company}</p>
        )}
        <span className="mt-1.5 flex flex-col gap-1"><Bar w="90%" /><Bar w="70%" /></span>
        <p className="mt-2.5 text-[8.5px] font-bold uppercase tracking-[0.14em] text-brand-700">{t('masterOffer.previewEducation')}</p>
        <p className="mt-1 truncate text-[10px] text-brand-700">{data?.education ? `${data.education.degree} · ${data.education.school}` : '—'}</p>
        <div className="mt-2.5 flex flex-wrap gap-1">
          {(data?.skills.length ? data.skills : ['', '', '']).map((s, i) => (
            <span key={i} className="rounded-full bg-charcoal-100 px-1.5 py-0.5 text-[8.5px] text-charcoal-600">{s || '      '}</span>
          ))}
        </div>
      </div>

      {/* The lock */}
      <span className="absolute bottom-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-full bg-brand-700 px-3 py-1.5 text-[11px] font-bold text-charcoal-50 shadow-lg">
        <Lock size={11} strokeWidth={2.75} className="text-accent-300" />
        {t('masterOffer.previewLock')}
      </span>
    </div>
  );
};
