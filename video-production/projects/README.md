# projects/

One folder per video. **Everything in here except this README is gitignored** — footage,
renders, transcripts and edit plans stay on this machine.

Create one with `npm run new -- <name> [--from path/to/raw.mp4]`, drop footage into
`<name>/input/`, then ask Claude to edit it. See `../README.md` and `../CLAUDE.md`.

`test/` is the pipeline smoke test (synthetic footage from `npm run test-footage`).
