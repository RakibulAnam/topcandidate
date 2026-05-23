# Release workflow

## Web (automatic)

Merging into `master` triggers a Vercel production deploy from `apps/web/`. No further action.

Pre-release checks (informal — solo dev):
1. `cd apps/web && npm run build` clean.
2. Any new SQL migration has been applied in the Supabase SQL editor for the production project.
3. Any new env var has been added in Vercel for Production.
4. `apps/web/AGENTS.md` reflects what's about to ship.

## Mobile (manual sideload)

Per [`docs/deployment/mobile-android.md`](../deployment/mobile-android.md):
1. Bump `version:` in `apps/mobile/pubspec.yaml`.
2. `flutter build apk --release` from `apps/mobile/`.
3. Run [`apps/mobile/spec/09-qa-checklist.md`](../../apps/mobile/spec/09-qa-checklist.md).
4. Transfer APK to operator's phone, install, re-enter Settings if needed (secret persists in secure storage so usually unchanged).
