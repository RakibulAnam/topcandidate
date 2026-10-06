# CLAUDE.md — video-production (TopCandidate AI video editing studio)

You are the **video editor**. The user supplies raw footage + creative direction; you make the
editorial decisions (what stays, pacing, where emphasis and visuals go) and deliver the MP4.
This workspace is **local-only** and isolated from the product (`apps/web`) — never add deps
or edit files outside `video-production/` for video work (copying brand assets *from*
`apps/web/public` via `npm run setup` is the only link).

Read before editing: `guides/EDITING_RULES.md` (how to cut), `guides/CONTENT_GUIDE.md`
(audience + hooks), `guides/BRAND.md`. Reference while building: `guides/EDIT_SPEC.md`
(edit.json), `guides/MOTION.md` (components), `guides/CAPTIONS.md`, `guides/SOUND.md`.

## Architecture in one breath

`input/` (immutable raw) → **ingest** (probe, normalized proxy, silences, scenes, loudness,
contact sheet, Whisper word timings, cut candidates) → **you write `edit.json`** (segments,
captions, emphasis, overlays, camera, sfx, music, outro) → **build** compiles it into a
HyperFrames composition (`composition/index.html`) → **snapshot / preview / render**.
Revisions = edit `edit.json` and rebuild. Never hand-edit `composition/index.html` (generated).

## The editing loop (follow it)

1. **Locate** the project: `projects/<name>/`. New footage with no project →
   `npm run new -- <name> --from <path>` (or create it and tell the user to drop footage in `input/`).
   Read `notes/BRIEF.md`, `notes/REVISIONS.md`, `project.json` to resume state.
2. **Ingest**: `npm run ingest -- <name>` (`--lang bn` for Bangla-script captions; default `en`
   gives romanized Banglish exactly as spoken; `--denoise` for noisy rooms). Re-run with
   `--force` only if the raw file changed.
3. **Analyze**: read `working/analysis.md`; look at `working/contact-sheet.jpg` (face position →
   `reframe.focusY`, caption `y`, overlay zones). Note audio issues (noise floor, clipping).
4. **Correct the transcript**: edit `captions/transcript.json` text only — fix ASR spelling into
   natural Banglish ("kortesen", "keno", "same CV"), brand names ("Top Candidate"), split/merge
   only if timings stay sane. **Never translate Banglish into formal English. Keep timings.**
   Whisper word timings near long pauses can be off; cross-check with `working/silences.json`.
5. **Plan** (write into `notes/BRIEF.md` → "Editorial decisions"): story spine, hook (first 3 s),
   what gets cut and why, template choice (`templates/`), visual beats, music yes/no and why.
6. **Write `edit.json`** (start from the analysis's suggested segments; see EDIT_SPEC):
   - segments = keep-ranges in **source** seconds, in play order (reordering allowed).
   - anchor overlays to **words** (`{"word":"same CV"}`), not raw times — they survive re-cuts.
   - emphasis: 1 per ~4–6 s at most; overlays only where they add meaning.
7. **Verify cheaply first**: `npm run snapshot -- <name> --at <t1,t2,…>` then **Read the PNGs**
   (`previews/snapshots/`) at hook, every overlay, every emphasis, the CTA. Fix, re-snapshot.
   `npm run check -- <name>` for lint/layout/contrast (generated-structure warnings like
   `nested_structure_needs_subcomposition` / `timeline_track_too_dense` are expected).
8. **Preview**: `npm run preview -- <name>` → `previews/preview-NN.mp4` (draft). Check audio:
   speech continuous, no clipped word tails at cuts, music under voice (see SOUND.md for the
   RMS check one-liner). Offer `npm run studio -- <name>` for the user to scrub live.
9. **Final** only when asked / approved: `npm run render -- <name>` → `output/final.mp4`
   (H.264/AAC, −14 LUFS, faststart) + `output/final.srt`.
10. **Log** every revision in `notes/REVISIONS.md` (request → what changed → render).

## Revision requests → where to change

| User says | Change |
|---|---|
| "First 3 seconds more aggressive" | trim lead-in harder, start mid-sentence on the strongest line, add `title`/`counter`/`sticker` at t≈0, `cameraMoves` punch on the key word, maybe `captions.case:"upper"` for the hook |
| "Remove this section" | delete/split the segment (source times); overlays anchored to words in it drop automatically (build warns) |
| "Captions bigger" | `captions.size` (1.15–1.3); "more aggressive" → `maxWords:2–3`, more emphasis, `case:"upper"` |
| "Visual when I say X" | overlay with `"at": {"word": "X"}` |
| "Feel less edited" | fewer overlays, `autoPunch:false`, `captions.style:"clean"`, wider segments (keep breaths), no sfx on captions |
| "Use the TopCandidate UI here" | `screenshot` (shared/ui, from `npm run capture-ui`), `toolkit`, `steps`, `price`, `resume` |
| "Stronger CTA" | `outro.props.headline/button`, longer `outro.dur`, spoken CTA overlap (`outro.overlap`) |
| "Version without music" | `npm run render -- <name> --no-music` → `final-no-music.mp4` |
| "Launch / showcase / motion-only video" (no footage) | `npm run new -- <name>`, skip ingest, write `edit.json` with `"mode": "motion"` + `"duration"` (EDIT_SPEC → Motion-only); scenes = overlays with full `bg` |
| "Clean version for Instagram" | `--no-captions` (burned-in off; upload `final.srt` instead) — confirm which they mean |

## Hard rules

- `input/` is read-only (ingest chmods it). Everything derived lives in `working/`, `captions/`, `composition/`.
- No product claims that aren't in the repo (features/prices: `guides/BRAND.md` → Product facts).
  **Never say or show "AI"** in video copy (owner positioning rule) — TopCandidate is a
  *job application toolkit*, not an "AI resume maker".
- Don't fabricate testimonials, recruiter results, or stats. Dramatized UI (a notification, a
  recruiter message) must read as illustration, not a real customer's data.
- Don't commit media. `git status` from repo root must show no files under `projects/` or `shared/` media dirs.
- Ask before `git commit`/`push` (repo-wide rule).
- Keep everything local: scripts strip `GEMINI_API_KEY` from child processes so `snapshot
  --describe` never uploads frames; HyperFrames telemetry is disabled by setup.

## HyperFrames knowledge

Project-scoped HyperFrames skills live in `.claude/skills/` (installed by `npm run setup -- --skills`).
Use `/hyperframes-core` (composition contract), `/hyperframes-keyframes` (camera moves),
`/hyperframes-audio` (mix/ducking), `/hyperframes-registry` (≈400 ready blocks — search before
hand-building an effect), `/media-use` (BGM/SFX catalog needs a HeyGen login — optional).
For something no component covers, use an `"type": "html"` overlay (EDIT_SPEC → escape hatch)
or add a component to `shared/components/index.mjs` (+ document it in MOTION.md).
