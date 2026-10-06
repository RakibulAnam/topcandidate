# Motion components

Defined in `shared/components/index.mjs` (markup + GSAP) and `shared/components/components.css`.
Use in `edit.json` → `overlays[]` as `{ "type": "<name>", "at": …, "dur"|"until": …, "props": {…}, "sfx": true }`.
Text props accept `*accent*` (orange) and `**highlight**` (orange box). Positions are px on 1080×1920.
`bg` (where supported): `none` (over video) · `dim` · `stone` (full light plate = cut-away) · `ink`.

| type | props (defaults) | use |
|---|---|---|
| `title` | `lines[]`, `eyebrow`, `style: boxed\|plain\|serif`, `align`, `y:300`, `bg`, `inkLines:[i]`, `stagger`, `size` (px) | kinetic headline / hook text; lines rise from a mask |
| `sticker` | `text`, `tone: ink\|orange\|stone`, `icon: x\|check\|arrow\|!`, `x:540` (center), `y:520`, `rotate:-4` | pop label ("0 interview call", "✓ Tailored") |
| `arrow` | `from:[x,y]`, `to:[x,y]`, `bend:.25`, `color`, `width` | hand-drawn pointer (draws on) |
| `circle` | `x,y` (center), `w,h`, `color` | scribble around something |
| `highlight` | `x,y,w,h`, `style: box\|underline` | marker rectangle / underline |
| `notification` | `app`, `letter`, `title`, `body`, `time`, `y:240` | phone push card (illustrative only) |
| `job-post` | `title`, `company`, `location`, `tags[]`, `posted`, `applicants`, `logo`, `y` | job ad card |
| `resume` | `state: tailored\|generic`, `name`, `role`, `bullets[]`, `lines`, `badge`, `chip`, `stamp`, `stampAt`, `y` | CV mock (from the landing hero); generic + stamp = the problem, tailored = the fix |
| `message` | `who`, `channel`, `letter`, `messages:[{from:them\|me,text}]`, `gap`, `y` | recruiter/LinkedIn chat (illustrative) |
| `compare` | `left:{label,items[]}`, `right:{label,items[]}`, `rightAt:.9`, `y` | before/after columns (✕ vs ✓) |
| `progress` | `label`, `from`, `to`, `suffix:"%"`, `fill`, `dark`, `y` | animated bar + number |
| `counter` | `from`, `to`, `prefix`, `suffix`, `unit`, `label`, `digits: en\|bn`, `count`, `bg`, `y` | big number count-up ("20 ta job") |
| `toolkit` | `lang: en\|bn`, `eyebrow`, `title`, `only[]`, `highlight`, `stagger`, `bg`, `y` | **the real 5 deliverables** with dashboard chip tints |
| `screenshot` | `src` (e.g. `ui/landing-en.png`), `frame: phone\|browser\|none`, `scroll` px, `url`, `height`, `bg`, `y` | real product UI reveal + scroll |
| `price` | `rows[[k,v]]`, `win[k,v]`, `eyebrow`, `bg`, `y` | real price comparison (defaults from en.ts) |
| `steps` | `lang`, `steps[]`, `eyebrow`, `stagger`, `y` | "Three steps. About a minute." |
| `lower-third` | `name`, `handle`, `y:1280` | speaker ID |
| `logo` | `bg: stone\|ink\|none`, `y` | logo draw-on + wordmark sting |
| `cta` | `lang`, `headline`, `button`, `sub`, `url` | full end card (use as `outro`) |
| `broll` | `src` (image or video), `zone: full\|upper\|pip`, `kenburns`, `mediaStart`, `volume` | cut-away |
| `html` | `html`, `js` (T0/DUR), or `file` | escape hatch for one-offs |

Camera (not overlays): `cameraMoves[]` — `punch` (snap zoom + ease back), `push` (slow zoom),
`blur` (defocus the speaker behind a card; note: blur forces a slower render path), `shake`.
Segment transitions: `"transition": "flash" | "whip"` on a segment.

## Motion rules

- Ease out on entrances (power3/back), ease in on exits; entrances 0.3–0.5 s, exits ≤ 0.25 s.
- One thing moves at a time in the frame's focal area. Stagger lists 0.1–0.6 s (match speech when listing).
- No constant motion on readable text; no looping wiggles. Sticker/emphasis pops are the only "bounce".
- Sync visual hits to the word (anchor with `{word: …}`), not "roughly then".
- Before hand-building a new effect, search the HyperFrames registry (`/hyperframes-registry`).

## Adding a component

Add a function to `components` in `index.mjs` returning `{ html, js, sfx?, z? }`, styles to
`components.css` (no CSS transforms on animated elements — set initial state in `fromTo`),
document it here, then `npm run check` a project that uses it.
