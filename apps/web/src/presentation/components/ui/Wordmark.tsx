import { LogoMark } from './LogoMark';

// The public-page wordmark: logo mark + "TOP" (ink) + "CANDIDATE" (logo
// orange). It is a logo, so it is exposed as ONE image named "TOP CANDIDATE"
// and the two words are drawn as SVG text, the way a logo file would be. Logos
// are exempt from text-contrast rules (WCAG 1.4.3), and the brand orange on
// cream is 2.87:1 — as HTML text, accessibility audits flag it on every page.
// Keep the orange; never "fix" it by darkening the brand colour.
//
// Geometry is measured from the HTML wordmark it replaced (Source Serif 4,
// 600, 18px, tracking -0.01em): TOP 34.1px, CANDIDATE 99.7px, 6px gap, 28px
// line. The SVG is sized in em, so `size` just changes the font size.
// textLength pins each word's width even if the font falls back.
export const Wordmark = ({ size = 'md' }: { size?: 'sm' | 'md' }) => (
    <div role="img" aria-label="TOP CANDIDATE" className={`flex items-center gap-1.5 select-none ${size === 'sm' ? 'text-base' : 'text-lg'}`}>
        <LogoMark className={size === 'sm' ? 'h-5 mr-0.5' : 'h-6 mr-1'} />
        <svg aria-hidden="true" viewBox="0 0 139.8 28" className="h-[1.5556em] w-auto overflow-visible">
            <text x="0" y="20.5" fontSize="18" fontWeight="600" letterSpacing="-0.18" textLength="34.1" lengthAdjust="spacingAndGlyphs" className="font-display fill-brand-700">
                TOP
            </text>
            <text x="40.1" y="20.5" fontSize="18" fontWeight="600" letterSpacing="-0.18" textLength="99.7" lengthAdjust="spacingAndGlyphs" className="font-display fill-accent-500">
                CANDIDATE
            </text>
        </svg>
    </div>
);
