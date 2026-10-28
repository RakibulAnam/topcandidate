import React from 'react';

// Profile setup's progress indicator, drawn as the resume it is building: a
// small A4 sheet whose sections write themselves in as the user gives each one
// content. It continues the desk animation on the first screen
// (ResumeWritingHero), so "progress" means "your resume is filling up", not
// "step 4 of 13" — a step you skip leaves its section blank on the sheet.
//
// Two sizes: `full` in the desktop rail (shows the user's real name) and
// `mini` beside the mobile progress bar.

export interface SheetFill {
    name: string;
    hasEmail: boolean;
    hasPhone: boolean;
    experience: number;
    education: number;
    projects: number;
    skills: number;
    /** Activities, awards, certifications, affiliations, publications, languages, references. */
    extras: number;
}

export type SheetSection = 'contact' | 'experience' | 'education' | 'projects' | 'skills' | 'extras';

/**
 * How complete the profile is, 0–100, by what a resume needs rather than by
 * steps visited. Education and experience are scored as "background": the
 * first one present is worth most, so a student with no jobs is not stuck far
 * below someone with both. The name and email that sign-up already provides
 * count, so a new account opens with real (not invented) progress.
 */
export const sheetPercent = (f: SheetFill): number => {
    const bg = [f.experience > 0, f.education > 0].filter(Boolean).length;
    const score =
        (f.name.trim() ? 10 : 0) +
        (f.hasEmail ? 5 : 0) +
        (f.hasPhone ? 5 : 0) +
        (bg >= 1 ? 35 : 0) +
        (bg === 2 ? 10 : 0) +
        (f.skills > 0 ? 15 : 0) +
        (f.projects > 0 ? 10 : 0) +
        (f.extras > 0 ? 10 : 0);
    return Math.min(100, score);
};

const INK = 'var(--color-brand-700)';
const LINE = 'var(--color-charcoal-400)';
const GHOST = 'var(--color-charcoal-200)';
const ACCENT = 'var(--color-accent-500)';

interface Block {
    key: SheetSection;
    filled: boolean;
    /** Bullet line lengths (fractions of the text column). */
    lines: number[];
}

const Lines: React.FC<{
    block: Block;
    y: number;
    current: boolean;
    mini: boolean;
}> = ({ block, y, current, mini }) => {
    const x0 = 22;
    const colW = 166;
    const gap = mini ? 15 : 11;
    // Remount on fill so the draw-in replays when a section gets its content.
    const k = block.filled ? 'on' : 'off';
    const ghostClass = current ? 'ls-ghost' : undefined;
    const ghostColor = current ? 'var(--color-accent-200)' : GHOST;
    return (
        <g key={k}>
            <path
                d={`M${x0} ${y}h${mini ? 70 : 54}`}
                pathLength={1}
                stroke={block.filled ? INK : ghostColor}
                strokeWidth={mini ? 9 : 6}
                strokeLinecap="round"
                className={block.filled ? 'ls-draw' : ghostClass}
            />
            {block.lines.map((len, i) => {
                const ly = y + (mini ? 14 : 13) + i * gap;
                return (
                    <path
                        key={i}
                        d={`M${x0 + 8} ${ly}h${(colW - 8) * len}`}
                        pathLength={1}
                        stroke={block.filled ? LINE : ghostColor}
                        strokeWidth={mini ? 6 : 3.6}
                        strokeLinecap="round"
                        className={block.filled ? 'ls-draw' : ghostClass}
                        style={block.filled ? { animationDelay: `${120 + i * 90}ms` } : undefined}
                    />
                );
            })}
        </g>
    );
};

interface Props {
    fill: SheetFill;
    /** The section the user is filling in right now; it breathes on the sheet. */
    current?: SheetSection | null;
    size?: 'full' | 'mini';
    className?: string;
}

export const LiveSheet: React.FC<Props> = ({ fill, current = null, size = 'full', className = '' }) => {
    const mini = size === 'mini';
    const bullets = (n: number, full: number[]) => (n > 0 ? full.slice(0, Math.max(1, Math.min(full.length, n + 1))) : full);
    const blocks: Block[] = mini
        ? [
              { key: 'experience', filled: fill.experience > 0, lines: [0.9, 0.7] },
              { key: 'education', filled: fill.education > 0, lines: [0.8] },
              { key: 'skills', filled: fill.skills > 0, lines: [0.6] },
          ]
        : [
              { key: 'experience', filled: fill.experience > 0, lines: bullets(fill.experience, [0.95, 0.78, 0.86]) },
              { key: 'education', filled: fill.education > 0, lines: bullets(fill.education, [0.82, 0.6]) },
              { key: 'projects', filled: fill.projects > 0, lines: bullets(fill.projects, [0.9, 0.66]) },
              { key: 'skills', filled: fill.skills > 0, lines: [0.7] },
              { key: 'extras', filled: fill.extras > 0, lines: [0.74, 0.5] },
          ];

    const name = fill.name.trim();
    const blockGap = mini ? 66 : 42;
    const top = mini ? 112 : 88;

    return (
        <svg
            viewBox="0 0 210 297"
            className={className}
            aria-hidden="true"
            focusable="false"
            fill="none"
        >
            <rect x="1" y="3" width="208" height="293" rx="6" fill="var(--color-brand-700)" opacity="0.08" />
            <rect x="0.5" y="0.5" width="208" height="292" rx="6" fill="#fff" stroke="var(--color-charcoal-200)" />

            {/* Header: the user's real name once we have it. */}
            {!mini && name ? (
                <text
                    x="22"
                    y="42"
                    fill={INK}
                    className="font-display"
                    fontSize={name.length > 22 ? 15 : 19}
                    fontWeight={600}
                >
                    {name.length > 26 ? `${name.slice(0, 25)}…` : name}
                </text>
            ) : (
                <path
                    d={`M22 ${mini ? 40 : 36}h${mini ? 110 : 96}`}
                    stroke={name ? INK : GHOST}
                    strokeWidth={mini ? 14 : 10}
                    strokeLinecap="round"
                />
            )}
            <path d={`M22 ${mini ? 66 : 56}h${mini ? 80 : 62}`} stroke={name ? ACCENT : GHOST} strokeWidth={mini ? 7 : 4} strokeLinecap="round" />
            {/* Contact row: email, phone */}
            <g key={`contact-${fill.hasEmail}-${fill.hasPhone}`}>
                <path
                    d={`M22 ${mini ? 86 : 69}h${mini ? 70 : 60}`}
                    pathLength={1}
                    stroke={fill.hasEmail ? LINE : current === 'contact' ? 'var(--color-accent-200)' : GHOST}
                    strokeWidth={mini ? 6 : 3.4}
                    strokeLinecap="round"
                    className={fill.hasEmail ? 'ls-draw' : current === 'contact' ? 'ls-ghost' : undefined}
                />
                <path
                    d={`M${mini ? 104 : 92} ${mini ? 86 : 69}h${mini ? 54 : 44}`}
                    pathLength={1}
                    stroke={fill.hasPhone ? LINE : current === 'contact' ? 'var(--color-accent-200)' : GHOST}
                    strokeWidth={mini ? 6 : 3.4}
                    strokeLinecap="round"
                    className={fill.hasPhone ? 'ls-draw' : current === 'contact' ? 'ls-ghost' : undefined}
                />
            </g>
            {!mini && <path d="M22 78h166" stroke="var(--color-charcoal-200)" strokeWidth="1" />}

            {blocks.map((b, i) => (
                <Lines key={b.key} block={b} y={top + i * blockGap} current={current === b.key} mini={mini} />
            ))}
        </svg>
    );
};
