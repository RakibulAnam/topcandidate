# Commit and branch conventions

See [`docs/workflows/branching.md`](../workflows/branching.md) for the branch model.

## Commit message shape

```
<type>(<scope>): <short summary>

<body — what changed and WHY, not how>

Co-Authored-By: <agent or human>
```

- `<type>` — one of `feat`, `fix`, `chore`, `docs`, `refactor`, `perf`, `test`.
- `<scope>` — one of `web`, `mobile`, `monorepo`, `docs`, or a finer-grained area (`web/api`, `mobile/dispatch`).
- AI-assisted commits include a `Co-Authored-By:` trailer for the agent.

## PR conventions

- Title: same shape as the commit message subject.
- Body: what changed + why + verification steps + any cross-app impact.
- Cross-app changes: list each touched file by app.
