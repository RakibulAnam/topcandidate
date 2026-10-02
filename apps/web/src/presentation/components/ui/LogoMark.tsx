import { cn } from './utils';

// The brand mark (ink "C" arc + orange "T" crossbar) that sits in front of
// the two-word wordmark. Always rendered next to the "TOP CANDIDATE" text, so
// it's decorative: alt="" keeps screen readers from announcing the name twice.
// Size it with a height class (`h-6`); the width follows the SVG's aspect ratio.
export const LogoMark = ({ className }: { className?: string }) => (
    // width/height = the SVG's viewBox (156×152): reserves the mark's space
    // before the file loads, so the wordmark beside it doesn't shift.
    <img src="/logo-mark.svg" alt="" aria-hidden="true" width={156} height={152} draggable={false} className={cn('w-auto shrink-0', className)} />
);
