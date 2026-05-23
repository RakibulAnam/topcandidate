# Development workflow

## Day-to-day

1. Branch from `dev`: `git checkout -b feat/<scope>` or `chore/<scope>`.
2. `cd apps/web` or `cd apps/mobile` — work from the app's own directory so its `AGENTS.md` and `CLAUDE.md` are picked up by Claude Code.
3. Make changes. Update the closest `AGENTS.md` in the same commit if behavior or structure changed.
4. Run the per-app verification (see below).
5. Open a PR into `dev`. Once green and reviewed, merge to `dev`. When ready to release, PR `dev` → `master`.

## Per-app verification

**Web:**
```bash
cd apps/web
npm run build
# tsx import smoke for server-only files (see apps/web/CLAUDE.md)
node_modules/.bin/tsx -e "await import('./api/_lib/aiFactory.ts'); console.log('ok')"
```
Optional: `npm run dev`, exercise the changed flow in a browser.

**Mobile:**
```bash
cd apps/mobile
flutter pub get
flutter analyze
flutter test
```
Manual QA on a physical Android device before release per [`apps/mobile/spec/09-qa-checklist.md`](../../apps/mobile/spec/09-qa-checklist.md).

## When in doubt

Read the closest `AGENTS.md`. If still unclear, ask — speculation is worse than a question.
