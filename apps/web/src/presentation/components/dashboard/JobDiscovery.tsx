// JobDiscovery — "Roles you might be interested in" on Home.
//
// Up to six angles on the user's own profile, each a deep link into a job
// board's search. We never fetch results, so the copy promises the SEARCH and
// never an outcome: no counts, no "12 new jobs for you", nothing we can't stand
// behind. Links are derived on every render (see utils/jobSearch.ts) and never
// persisted; the only thing that touches storage is which tiles this browser
// has opened. Shown regardless of credit balance — finding a job is what
// creates demand for a credit, so gating discovery behind the purchase would
// invert the funnel. The gate stays on generation.
//
// ── Design: the dark board ───────────────────────────────────────────────────
// Two earlier passes failed in opposite directions. A grid of white cards was
// indistinguishable from the toolkits sitting right above it; a bare ruled
// index fixed that but read as unfinished — the plainest thing on a page that
// opens with a dark hero card and a warm master-resume banner.
//
// So this is a SURFACE, not a list: an ink panel that anchors the bottom of the
// page the way the CTA card anchors the top. Saffron-on-ink is the brand's
// strongest pairing and the product only spent it once; this is the second
// place it earns. The panel also settles the "is it a toolkit?" question by
// material alone — a toolkit is a raised white card you own, this is a dark
// board you look out from.
//
// Each tile carries a MUTED PER-ANGLE TINT, the same formula as the five
// artifact chips on the CTA card (14% fill, 32% border, full-strength glyph),
// which makes the two dark surfaces read as one family. The glyphs encode
// direction rather than decorate: the step up is an arrow UP, the sideways role
// an arrow ACROSS, the local angle a pin, bigger employers a building. Read
// state is carried the way a visited link carries it — the tile desaturates to
// grey and the whole tile dims — so no second control is needed to say it.
//
// Deliberately NOT reusing the CTA card's `glintMove` sweep. That animation is
// what makes the primary action feel alive; spending it twice on one page would
// cost the CTA its distinction. This panel's life comes from hover instead.
import React, { useRef, useState } from 'react';
import { Compass, ArrowUpRight, Target, ArrowUp, ArrowRight, MapPin, Building2, Globe, Wrench } from 'lucide-react';
import { useT, useLocale, type TKey } from '../../i18n/LocaleContext';
import { useRelativeTime } from './relativeTime';
import { track } from '../../../infrastructure/analytics/track';
import {
  deriveJobSearches,
  readVisits,
  recordVisit,
  recordSearchClick,
  MIN_JOB_SEARCH_CARDS,
  type JobSearchAngle,
  type JobSearchCard,
  type JobSearchInput,
  type JobSearchSource,
  type EmployerArchetype,
  type VisitMap,
} from '../../utils/jobSearch';

const REASON_KEY: Record<JobSearchAngle, TKey> = {
  currentTitle: 'jobSearch.reason.currentTitle',
  nextTitle: 'jobSearch.reason.nextTitle',
  adjacentTitle: 'jobSearch.reason.adjacentTitle',
  industryCity: 'jobSearch.reason.industryCity',
  largeEmployer: 'jobSearch.reason.largeEmployer',
  remoteGlobal: 'jobSearch.reason.remoteGlobal',
  topSkill: 'jobSearch.reason.topSkill',
};

// Muted dark-surface tints + a directional glyph per angle. The tints follow
// the CTA card's documented per-artifact chip formula so the two ink surfaces
// belong to each other; the glyphs mean something (up / across / near / bigger)
// rather than merely marking the row.
const ANGLE_STYLE: Record<JobSearchAngle, { color: string; bg: string; border: string; Icon: typeof Target; solid?: boolean }> = {
  // Neutral on purpose: "where you already are" is the least aspirational angle,
  // which frees the brand saffron to mark the one row that leaves the country.
  currentTitle: { color: '#BDB5A2', bg: 'rgba(255,255,255,0.06)', border: 'rgba(255,255,255,0.12)', Icon: Target },
  nextTitle: { color: '#8CC9A0', bg: 'rgba(95,168,118,0.14)', border: 'rgba(95,168,118,0.32)', Icon: ArrowUp },
  adjacentTitle: { color: '#9DB8DF', bg: 'rgba(107,140,190,0.16)', border: 'rgba(107,140,190,0.34)', Icon: ArrowRight },
  industryCity: { color: '#E89A7E', bg: 'rgba(224,120,86,0.14)', border: 'rgba(224,120,86,0.32)', Icon: MapPin },
  largeEmployer: { color: '#B7A3D8', bg: 'rgba(150,120,190,0.16)', border: 'rgba(150,120,190,0.34)', Icon: Building2 },
  topSkill: { color: '#8FC7C4', bg: 'rgba(110,180,176,0.15)', border: 'rgba(110,180,176,0.33)', Icon: Wrench },
  // The only angle that leaves Bangladesh, and the one most users don't know is
  // open to them — so it gets the brand saffron, INVERTED into a solid tile
  // rather than a seventh muted hue. One standout beats a rainbow.
  remoteGlobal: { color: '#E59321', bg: '#E59321', border: '#E59321', Icon: Globe, solid: true },
};

/** An opened tile loses its colour, the way a visited link loses its blue. */
const VISITED_TINT = { color: '#8B8574', bg: 'rgba(255,255,255,0.05)', border: 'rgba(255,255,255,0.10)' };

const SOURCE_KEY: Record<JobSearchSource, TKey> = {
  linkedin: 'jobSearch.source.linkedin',
  bdjobs: 'jobSearch.source.bdjobs',
  weworkremotely: 'jobSearch.source.weworkremotely',
};

const EMPLOYER_KEY: Record<EmployerArchetype, TKey> = {
  bank: 'jobSearch.employer.bank',
  mnc: 'jobSearch.employer.mnc',
  group: 'jobSearch.employer.group',
  ngo: 'jobSearch.employer.ngo',
  hospital: 'jobSearch.employer.hospital',
  school: 'jobSearch.employer.school',
  buyingHouse: 'jobSearch.employer.buyingHouse',
  agency: 'jobSearch.employer.agency',
};

interface Props {
  /** The saved profile, already loaded by DashboardScreen. */
  input: JobSearchInput;
}

export const JobDiscovery: React.FC<Props> = ({ input }) => {
  const t = useT();
  const { locale } = useLocale();
  const rel = useRelativeTime();
  const [visits, setVisits] = useState<VisitMap>(() => readVisits());
  // Ordering reads a snapshot frozen at mount, NOT live `visits` — otherwise a
  // tile would jump the moment you clicked it.
  const orderSnapshot = useRef<VisitMap | null>(null);
  if (orderSnapshot.current === null) orderSnapshot.current = visits;

  // Derived on render, every time — never cached, never persisted. Rebuilding
  // is string concatenation, so a profile edited on Tuesday shows up here on
  // Wednesday with nothing to sync.
  // There is no error boundary anywhere in this app, so an unforeseen throw in
  // here would white-screen Home over a secondary surface. Same posture as
  // `track()`: this section may fail, but it may never break the page.
  let cards: JobSearchCard[] = [];
  try {
    cards = deriveJobSearches(input, locale);
  } catch (err) {
    console.warn('job discovery derivation failed', err);
    return null;
  }
  if (cards.length < MIN_JOB_SEARCH_CARDS) return null;

  // Unopened first. The results behind these links are always current, but a
  // user returning on Thursday sees the same tiles and it FEELS stale — floating
  // the angles they haven't tried is the only freshness we can honestly offer,
  // and it costs nothing. Sort is stable, so derivation order holds within each
  // group.
  const tiles = [...cards].sort(
    (a, b) => (orderSnapshot.current?.[a.id] ? 1 : 0) - (orderSnapshot.current?.[b.id] ? 1 : 0),
  );

  const labelOf = (card: JobSearchCard): string =>
    card.label.employer
      ? t('jobSearch.labelEmployer', {
          terms: card.label.text,
          employer: t(EMPLOYER_KEY[card.label.employer]),
        })
      : card.label.text;

  /** Why this angle, plus the city IF the query actually filtered on one. */
  const reasonOf = (card: JobSearchCard): string =>
    [
      t(card.angle === 'currentTitle' && card.entryLevel
        ? 'jobSearch.reason.currentTitleEntry'
        : REASON_KEY[card.angle]),
      card.city,
    ]
      .filter(Boolean)
      .join(' · ');

  /** Where the link goes, and the recency window IF we sent one. Never the results. */
  const destinationOf = (card: JobSearchCard): string =>
    [t(SOURCE_KEY[card.source]), card.source === 'linkedin' ? t('jobSearch.pastWeek') : null]
      .filter(Boolean)
      .join(' · ');

  const handleOpen = (card: JobSearchCard) => {
    setVisits(recordVisit(card.id));
    recordSearchClick(card);
    // `family` is the diagnostic that says where the role taxonomy is failing:
    // a null here means we fell through to the generic path for that career.
    track('job_search_link_clicked', {
      angle: card.angle,
      source: card.source,
      query: card.query,
      family: card.family,
    });
  };

  // Bangla has no letter case, so uppercase does nothing and the tracking only
  // loosens the conjuncts. The eyebrow keeps its role through colour and size.
  const eyebrowType = locale === 'bn' ? '' : 'uppercase tracking-[0.09em]';

  return (
    <section>
      <div className="rounded-[20px] bg-brand-700 p-[clamp(18px,3vw,28px)] shadow-[0_24px_48px_-20px_rgba(25,23,18,0.35)]">
        <div className="mb-1.5 flex items-center gap-2.5">
          <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[7px] bg-accent-400">
            <Compass size={13} className="text-brand-800" />
          </span>
          <h2 className="font-display text-[19px] font-semibold leading-tight text-charcoal-50 sm:text-[22px]">
            {t('jobSearch.title')}
          </h2>
          <span className="ml-auto hidden shrink-0 whitespace-nowrap rounded-full border border-cta-border px-2.5 py-1 text-[11.5px] font-semibold text-[#A89F8C] sm:block">
            {t('jobSearch.eyebrow')}
          </span>
        </div>
        <p className="mb-4 text-[13px] leading-relaxed text-[#8B8574]">{t('jobSearch.subtitle')}</p>

        <div className="grid gap-2.5 sm:grid-cols-2">
          {tiles.map((card) => {
            const openedAt = visits[card.id];
            const opened = openedAt ? rel(openedAt) : null;
            const { Icon } = ANGLE_STYLE[card.angle];
            const tint = opened ? VISITED_TINT : ANGLE_STYLE[card.angle];
            return (
              <a
                key={card.id}
                href={card.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => handleOpen(card)}
                // Hovering a tile lights up its OWN colour rather than a shared
                // grey — the tint is an identity, so interaction should use it.
                style={{ ['--tint' as string]: tint.color, ['--tint-edge' as string]: tint.border } as React.CSSProperties}
                className={`group flex flex-col gap-2 rounded-xl border border-cta-border bg-cta-surface p-3.5 transition-colors hover:border-[color:var(--tint-edge)] hover:bg-[#2B2721] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 focus-visible:ring-offset-2 focus-visible:ring-offset-brand-700 ${
                  opened ? 'opacity-70 hover:opacity-100' : ''
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <span
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] border"
                    style={{ background: tint.bg, borderColor: tint.border }}
                  >
                    <Icon
                      size={14}
                      style={{ color: !opened && ANGLE_STYLE[card.angle].solid ? '#0E0D09' : tint.color }}
                      aria-hidden="true"
                    />
                  </span>
                  <span
                    className={`min-w-0 flex-1 truncate text-[11px] font-semibold ${eyebrowType}`}
                    style={{ color: tint.color }}
                  >
                    {reasonOf(card)}
                  </span>
                  {opened && (
                    <span className="shrink-0 text-[11px] text-[#928B7A]">
                      {t('jobSearch.opened', { when: opened })}
                    </span>
                  )}
                </span>

                <span className="block font-display text-[17px] font-semibold leading-snug text-charcoal-50">
                  {labelOf(card)}
                  <span className="sr-only"> ({t('jobSearch.newTab')})</span>
                </span>

                <span className="flex items-end justify-between gap-2">
                  <span className="min-w-0 truncate text-[12px] text-[#9C9585]">{destinationOf(card)}</span>
                  <ArrowUpRight
                    size={15}
                    aria-hidden="true"
                    className="shrink-0 text-[#857E6D] transition-all group-hover:text-[color:var(--tint)] motion-safe:group-hover:-translate-y-px motion-safe:group-hover:translate-x-px"
                  />
                </span>
              </a>
            );
          })}
        </div>
      </div>
    </section>
  );
};
