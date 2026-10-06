# ADR-0004: Local-only video production workspace on HyperFrames

- **Date:** 2026-10-06
- **Status:** Accepted

## Context

The owner wants to turn raw talking-head footage into short-form Reels/Shorts with Claude Code acting as the editor. That means transcribing, cutting, adding captions and motion graphics, using real product UI, doing sound design, and rendering an MP4. Footage, renders and generated media must never reach GitHub because the repo is public. The product apps must not gain dependencies.

## Decision

1. Add a third top-level workspace, **`video-production/`**, with its own `package.json`. It is not an app and not a shared package: it never imports from `apps/` and is never deployed. Like each app, it has its own `.gitignore` and `CLAUDE.md`.
2. Render with **HyperFrames** (pinned `hyperframes@0.8.137`, Apache-2.0). HyperFrames turns HTML, GSAP and media into deterministic MP4s. It provides cut/trim/splice of video clips inside the composition, a volume-automation audio mixer, lint/check/snapshot tools, Studio preview, and agent skills. Its skills are installed **project-scoped** in `video-production/.claude/skills/` (gitignored) rather than globally. Its telemetry is disabled.
3. Store editorial decisions as data. `projects/<p>/edit.json` holds the segments in source time, captions and emphasis, word-anchored overlays, camera moves, SFX, music and the outro. `scripts/build.mjs` compiles it into a HyperFrames composition. Revisions edit that plan, and the generated HTML is disposable.
4. Transcribe with local **whisper.cpp** (`large-v3-turbo`). Speech regions are concatenated with fixed gaps so word timings map back exactly. Plain whisper.cpp smears timestamps across pauses, and its `--vad` mode returns compressed times. English decoding (`-l en`) yields romanized Banglish as spoken.
5. Git rule: commit the scripts, components, templates, docs and config. Ignore everything under `projects/`, all reproducible or user media under `shared/`, and every media extension inside the workspace.

## Why not the alternatives

- **Remotion.** It is React-based and capable, but it carries a company license for organisations above a size threshold and has no agent-native skill set. HyperFrames is built for agent authoring and ships transcription and audio tooling.
- **A plain FFmpeg pipeline.** It can cut and burn subtitles, but it can't express designed motion graphics or brand components maintainably.
- **Putting it in `apps/web`.** That would add heavy deps (Chrome automation, fonts, video tooling) to a deployed app and risk media landing in the build.
- **Global HyperFrames skills.** Its default installer writes to `~/.claude/skills` and to other agents' directories. Project scope keeps it with this workspace.

## Consequences

- `cd video-production && npm run setup` is required on a new machine. It downloads the Whisper model (~1.6 GB), fonts and SFX, copies the logos from `apps/web/public`, and installs the skills.
- If the brand palette or copy changes in `apps/web`, update `shared/brand/tokens.css`, `scripts/lib/config.mjs` and `guides/BRAND.md` as well.
- Music is not bundled. The owner supplies licensed tracks. The HeyGen catalog is an optional external account.
