// Read-only view of one generated resume (+ its job toolkit) for the admin
// User Detail screen. Loads /api/admin/resume-detail.
//
// Deliberately NOT the customer <Preview>: that component tracks analytics
// events (tab views, downloads) as whoever is signed in, and carries editing
// and export controls. This is a plain render of what was saved.

import React, { useEffect, useRef, useState } from 'react';
import type { AdminApi } from './adminApi';
import type { JobToolkit, ResumeData } from '../../domain/entities/Resume';
import { formatResumeDateRange } from '../templates/dateFormat';
import { Button, ErrorState, Skeleton, StatusPill } from './ui';

interface ResumeDetailResp {
  resume: {
    id: string;
    user_id: string;
    title: string;
    company: string | null;
    generation_type: string | null;
    data: Partial<ResumeData> | null;
    toolkit: JobToolkit | null;
    created_at: string;
    updated_at: string | null;
  };
}

/** Master (the JD-less General Resume) vs a job-tailored one. */
export const isMasterResume = (r: { title?: string | null; generation_type?: string | null; data?: { resumeMode?: string } | null }): boolean =>
  r.generation_type === 'free_general' || r.title === 'General Resume' || r.data?.resumeMode === 'master';

const H: React.FC<React.PropsWithChildren> = ({ children }) => (
  <h4 className="mt-5 mb-1.5 pb-1 border-b border-charcoal-200 text-[11px] uppercase tracking-[0.18em] font-bold text-brand-700">{children}</h4>
);

const Bullets: React.FC<{ items: (string | null | undefined)[] }> = ({ items }) => {
  const list = items.map((s) => (s ?? '').trim()).filter(Boolean);
  if (list.length === 0) return null;
  return <ul className="mt-1 list-disc pl-5 space-y-0.5">{list.map((b, i) => <li key={i}>{b}</li>)}</ul>;
};

/** The resume lines for an item: refined bullets, else polished, else raw text. */
const linesOf = (item: { refinedBullets?: string[]; normalized?: { bullets?: string[] }; rawDescription?: string; description?: string }): string[] =>
  item.refinedBullets?.length ? item.refinedBullets
    : item.normalized?.bullets?.length ? item.normalized.bullets
    : (item.rawDescription ?? item.description ?? '').split('\n');

const Paragraphs: React.FC<{ text: string | null | undefined }> = ({ text }) => {
  const parts = (text ?? '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  return <>{parts.map((p, i) => <p key={i} className="mt-2 whitespace-pre-line">{p}</p>)}</>;
};

const ResumeBody: React.FC<{ d: Partial<ResumeData>; toolkit: JobToolkit | null; master: boolean }> = ({ d, toolkit, master }) => {
  const pi = d.personalInfo;
  const contact = [pi?.email, pi?.phone, pi?.location, pi?.linkedin, pi?.github, pi?.website].filter(Boolean);
  const skillCats = d.skillCategories?.filter((c) => c.items?.length) ?? [];
  const tk = toolkit ?? d.toolkit ?? null;
  return (
    <div className="text-[13px] leading-relaxed text-charcoal-800">
      {/* A master resume's targetJob is a placeholder ("General Purpose"), not a job post. */}
      {!master && d.targetJob?.title && (
        <details className="mb-4 rounded-xl border border-charcoal-200 bg-charcoal-50 px-3 py-2">
          <summary className="cursor-pointer text-[12px] text-charcoal-600">
            Applied for <span className="font-semibold text-brand-700">{d.targetJob.title}</span>
            {d.targetJob.company && <> at <span className="font-semibold text-brand-700">{d.targetJob.company}</span></>}
            <span className="text-charcoal-400"> · job post</span>
          </summary>
          <div className="mt-2 max-h-60 overflow-y-auto whitespace-pre-line text-[12px] text-charcoal-600">{d.targetJob.description || '—'}</div>
        </details>
      )}

      <div className="text-center">
        <div className="font-display text-xl font-semibold text-brand-700">{pi?.fullName || '—'}</div>
        {contact.length > 0 && <div className="mt-0.5 text-[12px] text-charcoal-500 break-words">{contact.join(' · ')}</div>}
      </div>

      {d.summary && (<><H>Summary</H><p>{d.summary}</p></>)}

      {!!d.experience?.length && (
        <>
          <H>Experience</H>
          {d.experience.map((e) => (
            <div key={e.id} className="mt-2">
              <div className="flex justify-between gap-3 flex-wrap">
                <span><span className="font-semibold">{e.role}</span>{e.company && <> · {e.company}</>}</span>
                <span className="text-[12px] text-charcoal-500">{formatResumeDateRange(e.startDate, e.endDate, e.isCurrent)}</span>
              </div>
              <Bullets items={linesOf(e)} />
            </div>
          ))}
        </>
      )}

      {!!d.projects?.length && (
        <>
          <H>Projects</H>
          {d.projects.map((p) => (
            <div key={p.id} className="mt-2">
              <span className="font-semibold">{p.name}</span>
              {p.technologies && <span className="text-[12px] text-charcoal-500"> · {p.technologies}</span>}
              <Bullets items={linesOf(p)} />
            </div>
          ))}
        </>
      )}

      {!!d.education?.length && (
        <>
          <H>Education</H>
          {d.education.map((ed) => (
            <div key={ed.id} className="mt-1.5 flex justify-between gap-3 flex-wrap">
              <span>
                <span className="font-semibold">{[ed.degree, ed.field].filter(Boolean).join(', ')}</span>
                {ed.school && <> · {ed.school}</>}
                {ed.gpa && <span className="text-charcoal-500"> · {ed.gpa}</span>}
              </span>
              <span className="text-[12px] text-charcoal-500">{formatResumeDateRange(ed.startDate, ed.endDate)}</span>
            </div>
          ))}
        </>
      )}

      {skillCats.length > 0 ? (
        <>
          <H>Skills</H>
          {skillCats.map((c) => <div key={c.category}><span className="font-semibold">{c.category}:</span> {c.items.join(', ')}</div>)}
        </>
      ) : !!d.skills?.length && (<><H>Skills</H><p>{d.skills.join(', ')}</p></>)}

      {!!d.extracurriculars?.length && (
        <>
          <H>Activities</H>
          {d.extracurriculars.map((x) => (
            <div key={x.id} className="mt-1.5">
              <span className="font-semibold">{x.title}</span>{x.organization && <> · {x.organization}</>}
              <Bullets items={linesOf(x)} />
            </div>
          ))}
        </>
      )}

      {!!d.awards?.length && (<><H>Awards</H><Bullets items={d.awards.map((a) => [a.title, a.issuer, a.date].filter(Boolean).join(' · '))} /></>)}
      {!!d.certifications?.length && (<><H>Certifications</H><Bullets items={d.certifications.map((c) => [c.name, c.issuer, c.date].filter(Boolean).join(' · '))} /></>)}
      {!!d.languages?.length && (<><H>Languages</H><p>{d.languages.map((l) => `${l.name} (${l.proficiency})`).join(', ')}</p></>)}

      {d.coverLetter && (<><H>Cover letter</H><Paragraphs text={d.coverLetter} /></>)}

      {tk?.outreachEmail && (
        <>
          <H>Outreach email</H>
          <div className="font-semibold">{tk.outreachEmail.subject}</div>
          <Paragraphs text={tk.outreachEmail.body} />
        </>
      )}

      {tk?.linkedInMessage && (<><H>LinkedIn note</H><p className="whitespace-pre-line">{tk.linkedInMessage}</p></>)}

      {!!tk?.interviewQuestions?.length && (
        <>
          <H>Interview questions</H>
          <ol className="list-decimal pl-5 space-y-1">
            {tk.interviewQuestions.map((q, i) => (
              <li key={i}>{q.question} <span className="text-[11px] text-charcoal-500">({q.category})</span></li>
            ))}
          </ol>
        </>
      )}

      {!!tk?.prepTopics?.length && (
        <>
          <H>Prep topics</H>
          <Bullets items={tk.prepTopics.map((p) => `${p.topic} — ${p.howToPrepare}`)} />
        </>
      )}
    </div>
  );
};

export const ResumeViewer: React.FC<{ api: AdminApi; resumeId: string; onClose: () => void }> = ({ api, resumeId, onClose }) => {
  const [data, setData] = useState<ResumeDetailResp['resume'] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setErr(null);
    api.call<ResumeDetailResp>('resume-detail', { query: { id: resumeId } })
      .then((r) => { if (!cancelled) setData(r.resume); })
      .catch((e: unknown) => { if (!cancelled) setErr(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, [api, resumeId, attempt]);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby="resume-viewer-title">
      <div className="absolute inset-0 bg-brand-900/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex w-full max-w-3xl flex-col bg-white sm:rounded-2xl shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-charcoal-100 px-5 py-4">
          <div className="min-w-0">
            <h3 id="resume-viewer-title" className="font-display text-base font-semibold text-brand-700 break-words">{data?.title ?? 'Resume'}</h3>
            {data && (
              <div className="mt-1 flex items-center gap-2 flex-wrap text-[12px] text-charcoal-500">
                <StatusPill status={isMasterResume(data) ? 'master' : 'tailored'} tone={isMasterResume(data) ? 'success' : 'info'} label={isMasterResume(data) ? 'Master resume' : 'Tailored'} />
                {data.company && <span>{data.company}</span>}
                <span>Created {new Date(data.created_at).toLocaleString()}</span>
                {data.updated_at && data.updated_at !== data.created_at && <span>· edited {new Date(data.updated_at).toLocaleString()}</span>}
              </div>
            )}
          </div>
          <Button ref={closeRef} variant="ghost" size="sm" onClick={onClose}>Close</Button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 sm:px-8">
          {err ? <ErrorState error={err} onRetry={() => setAttempt((n) => n + 1)} />
            : !data ? <div className="space-y-3"><Skeleton className="h-6 w-48 mx-auto" /><Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-5/6" /><Skeleton className="h-3 w-4/6" /></div>
            : <ResumeBody d={data.data ?? {}} toolkit={data.toolkit} master={isMasterResume(data)} />}
        </div>
      </div>
    </div>
  );
};
