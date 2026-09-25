import { cn } from './utils';

// The brand mark (ink "C" arc + saffron "T" crossbar) that sits in front of
// the two-word wordmark. Always rendered next to the "TOP CANDIDATE" text, so
// it's decorative: alt="" keeps screen readers from announcing the name twice.
// Size it with a height class (`h-6`); the width follows the SVG's aspect ratio.
export const LogoMark = ({ className }: { className?: string }) => (
    <img src="/logo-mark.svg" alt="" aria-hidden="true" draggable={false} className={cn('w-auto shrink-0', className)} />
);
