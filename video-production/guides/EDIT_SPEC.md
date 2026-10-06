# edit.json — the edit plan

`projects/<p>/edit.json` holds every editorial decision. `npm run build` compiles it into
`composition/index.html` (HyperFrames). Revisions change this file, never the generated HTML.
Worked example: `projects/test/edit.json` (local) and `templates/*.json`.

```jsonc
{
  "version": 1,
  "title": "Same CV, 20 jobs",
  "template": "job-seeker-pain",                 // informational (templates/)
  "format": { "width": 1080, "height": 1920, "fps": 30 },   // fps 60 → render at 60
  "source": "working/source.mp4",                // the ingest proxy (default)
  "reframe": { "focusX": 0.5, "focusY": 0.38, "zoom": 1 },  // object-position + base zoom (landscape → 9:16 crop)
  "camera": { "autoPunch": true, "punchScale": 1.08 },     // alternate punch-in on jump cuts

  "segments": [ /* keep-ranges, SOURCE seconds, play order */
    { "id": "hook", "in": 4.86, "out": 11.21, "note": "why", "zoom": 1.1, "focus": [0.5, 0.35], "transition": "cut|flash|whip", "sfx": "whoosh-short", "volume": 1 }
  ],

  "captions": { /* guides/CAPTIONS.md */ "style": "punch", "y": 1180, "emphasis": ["same CV", { "text": "generic", "style": "strike" }] },

  "overlays": [
    { "type": "sticker", "at": { "word": "call" }, "dur": 1.6, "props": { … }, "sfx": true, "z": 30, "disabled": false }
  ],
  "cameraMoves": [ { "type": "punch|push|blur|shake", "at": { "word": "keno" }, "dur": 1.2, "scale": 1.14 } ],
  "sfx": [ { "name": "whoosh-short", "at": { "t": 0.1 }, "volume": 0.4 } ],
  "music": { "file": "music/track.mp3", "volume": 0.11, "duck": 0.04, "fadeIn": 0.5, "fadeOut": 1.5, "offset": 12, "start": 0, "end": { "outro": 0 } },
  "outro": { "type": "cta", "dur": 2.8, "overlap": 0, "props": { "headline": "…", "button": "Start free", "lang": "en" }, "sfx": "impact-bass-1" }
}
```

## Time references (`at`, `until`, `music.start/end`)

| Form | Meaning |
|---|---|
| `3.2` or `{ "t": 3.2 }` | timeline seconds (after cuts) |
| `{ "src": 12.4 }` | source seconds → mapped through the cuts (dropped + warned if cut) |
| `{ "word": "same CV", "occurrence": 1, "edge": "start" \| "end" }` | when that phrase is spoken (in kept footage). **Preferred** — survives re-cuts |
| `{ "segment": "product" }` | start of a segment |
| `{ "outro": 0 }` | relative to outro start |
| any + `"offset": -0.15` | shift |

Overlay duration: `"dur": 2.5` or `"until": <time ref>`. Punctuation is ignored when matching words.

## Overlays

`type` is a component from `shared/components/index.mjs` (props: `guides/MOTION.md`), or:

- **`broll`** with a video `src` → muted cut-away (`zone: full|upper|pip`, `mediaStart`, `volume`, `kenburns`); with an image `src` → Ken Burns still.
- **`html`** escape hatch: `{ "type": "html", "at": …, "dur": 2, "props": { "html": "<div id='x' …>…</div>", "js": "tl.fromTo('#x', {opacity:0}, {opacity:1, duration:.3}, T0);" } }`
  (`props.file` may point to a fragment under the project). `T0`/`DUR` are injected. Follow
  HyperFrames determinism rules (no `Math.random`, no clocks; initial states in `fromTo`).

`src` lookup order: project dir → `assets/` → `input/` → `shared/` → `shared/ui|broll|music|logos|stickers`.
`sfx: true` uses the component's suggested sound; a string or `{ name, volume, offset }` picks one.

## Build outputs worth reading

- `working/timeline.json` — segment map (source↔timeline), caption chunks with times, warnings.
  Use it to answer "what's on screen at 0:12?".
- `captions/captions.srt` — timeline-correct subtitles (copied next to the final MP4).
