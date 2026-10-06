# Captions

Captions are generated from `captions/transcript.json` (source-time words, corrected by Claude),
mapped through the cuts, chunked, and rendered per chunk (`scripts/lib/captions.mjs`).

## Language

- Default ingest `--lang en` → Whisper writes **romanized Banglish as spoken** (plus English words).
  Correct spelling to natural Banglish; never translate to formal English.
- `--lang bn` → Bangla script. Chunks containing Bangla script switch to Hind Siliguri, taller
  line height and a thinner stroke automatically. Mixed chunks are fine.
- Brand: "Top Candidate" in captions. Keep English job words as English ("CV", "apply", "interview").

## Options (`edit.json` → `captions`)

| key | default | notes |
|---|---|---|
| `style` | `punch` | `punch` white + heavy ink stroke (default, internet-native) · `clean` ink on stone plate (calm, "less edited") · `minimal` small, shadow only |
| `y` | 1180 | top of the caption box in px. Move up if a lower-third/card sits there; keep < ~1450 |
| `size` | 1 | multiplier (1.2 = "bigger") |
| `maxWords` / `maxChars` | 4 / 20 | chunk size; 2–3 words = aggressive, 5–6 = calm |
| `case` | `none` | `upper` for aggressive hooks |
| `karaoke` | false | dim upcoming words in the chunk |
| `hideFillers` | true | drop um/uh/eh from captions (audio untouched) |
| `hide` | [] | extra words to hide |
| `breakOnCut` | true | new chunk at each segment boundary |
| `emphasis` | [] | see below |
| `enabled` | true | or render with `--no-captions` |

Chunks also break on pauses > 0.35 s and on punctuation (so put commas/full stops in the corrected transcript where the speaker breathes).

## Emphasis — strategic, not decorative

`"emphasis": ["same CV", { "text": "generic", "style": "strike", "occurrence": 2, "sfx": "pop" }]`

| style | look | use for |
|---|---|---|
| `box` (default) | ink text on an orange highlighter that wipes in as the word is spoken | THE key phrase of a sentence |
| `ink` | white on an ink plate | contrarian statements ("kharap na") |
| `accent` | word turns orange | brand / softer emphasis |
| `underline` | orange underline sweep | numbers, conditions |
| `strike` | orange line through it after it's said | the wrong thing ("generic", "same CV for every job") |
| `big` | own chunk, 1.32× | one-word punchlines |

Matches first occurrence by default (`occurrence: n` or `"all"`). Rule of thumb: ≤ 1 emphasis per
4–6 s, never two in one chunk, and don't emphasize what an overlay is already showing.

Output: burned-in captions + `captions/captions.srt` (timeline-correct) → copied to `output/final.srt`.
