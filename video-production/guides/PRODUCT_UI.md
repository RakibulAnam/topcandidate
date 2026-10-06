# Product UI in videos

Use the **real** product. Three sources, in order of preference:

1. **Rebuilt components** (crisp at any size, animatable): `toolkit`, `steps`, `price`, `resume`
   (mirrors the landing hero mock), `cta`, `logo`. Copy comes from `apps/web/.../locales/{en,bn}.ts`.
2. **Live-site screenshots**: `npm run capture-ui` → `shared/ui/{landing-en,landing-bn,resume-maker,cover-letter,interview-preparation,job-application-email}.png`
   (390-wide phone viewport @3×, full page). One page: `npm run capture-ui -- --url <url> --name <name> [--no-full]`.
   Use with `screenshot` (`frame: phone`, `scroll` to pan down the page).
3. **Logged-in app screens** (dashboard, builder, preview, bKash modal): run `npm run dev` in
   `apps/web`, sign in with the shared test account (password in `apps/web/TEST_ACCOUNT.local.md`,
   never commit it), then `npm run capture-ui -- --url http://localhost:3000/<route> --name dashboard`
   — capture-ui doesn't log in, so for authenticated pages take the screenshot from Chrome
   (DevTools → device toolbar 390×844 → "Capture full size screenshot") and save it to `shared/ui/`.
   Check every screenshot for personal data before using it.

Don't use `apps/web/public/hero_dashboard_mockup.png`, `landing_hero_illustration.png` or the
`avatar_consultant_*.png` files — off-brand/unreferenced, one avatar resembles a public figure.
Screenshots in `apps/web/topcandidate-audit-2026-05-*` predate the palette change.
