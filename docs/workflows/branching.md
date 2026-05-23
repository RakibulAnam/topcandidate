# Branching strategy

## Branches

| Branch | Role | Auto-deploys? |
| --- | --- | --- |
| `master` | Production. Vercel deploys `apps/web/` from this branch. | Yes (production) |
| `dev` | Integration / staging. Merged into `master` when ready to release. | Yes (Vercel preview) |
| `feat/<name>` | New feature work. Branched from `dev`. PR → `dev`. | Yes (Vercel preview per branch) |
| `fix/<name>` | Bug fixes. Same flow as `feat/*`. | Yes (preview) |
| `chore/<name>` | Tooling, infra, monorepo restructure. Same flow. | Yes (preview) |

`master` is the default branch (not `main`). Vercel's "Production Branch" setting is configured for `master`.

## Lifecycle

```
feat/<name> ──► PR ──► dev ──► PR ──► master ──► (Vercel auto-deploys to prod)
```

Mobile (`apps/mobile/`) follows the same branches but does **not** auto-deploy — releases are manual `flutter build apk` + sideload to the operator's phone.

## Cross-app changes

If a PR touches both `apps/web/` and `apps/mobile/`, it MUST also update [`docs/contracts/webhook-confirm-purchase.md`](../contracts/webhook-confirm-purchase.md) if the contract changed. The PR is incomplete otherwise.

## Tags

- `pre-monorepo-2026-05-23` — snapshot before the monorepo restructure landed. Recovery point.
- Future: tag production releases as `web-v<n>.<n>.<n>` and `mobile-v<n>.<n>.<n>` if/when versioning becomes useful. Solo dev — skip versioning until you need it.

## Commit messages

Conventional-ish, scoped by app or area:
- `feat(web): …`, `fix(web): …`, `chore(web): …`
- `feat(mobile): …`, `fix(mobile): …`
- `docs: …`, `chore(monorepo): …` for cross-cutting work
- AI-assisted commits include a `Co-Authored-By:` trailer.
