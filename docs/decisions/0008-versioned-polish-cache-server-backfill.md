# ADR-0008: Version the polish rules and backfill outdated facts server-side

- **Date:** 2026-10-26
- **Status:** Accepted.

## Context

Every resume and toolkit is built from each profile item's polished facts (`normalized`). These are produced once, when the item is saved, and cached by a hash of its text. On 2026-10-26 the polisher was rewritten so that it rewrites the user's wording instead of keeping it. Bangla, Banglish and copy-pasted résumé-speak all come out as fresh English. It now leads with `gemini-3.6-flash`, because flash-lite kept 40–60% of the user's words even with explicit rules.

The text hash alone could not tell that old output predates the new rules. Existing users would have kept their old, copied facts until they happened to edit each item.

## Decision

1. **The polished output carries the rules version.** The normalizer stamps `normalized.rulesVersion = POLISH_RULES_VERSION` server-side; a missing value means v1. The source hash format (`contentHash(text)`) is unchanged.
2. **Save-time polish is unchanged.** Items are re-polished only when their text changed or they were never polished, and browser tabs still running an older bundle agree with the new code about every item.
3. **`outdated` items are refreshed by a one-off server-side backfill,** `apps/web/scripts/repolish-outdated.ts`. It selects items with an older `rulesVersion` whose hash still matches their text. It is dry-run by default, runs two normalize calls at a time, and writes with `UPDATE … WHERE normalized_source_hash = <the hash it read>`, so a user who edits mid-run keeps their newer polish. Run it once after each `POLISH_RULES_VERSION` bump.

## Why not the alternatives

- **Encoding the version in the hash (`v2:<fnv>`).** This was also built first. Browser tabs still on the previous bundle compare the hash directly, so they would have treated every newly polished item as edited and re-polished it on every save.
- **A client-side background queue.** This was built first and then removed after review. It needed daily budgets, cross-tab pauses, give-up bookkeeping and a wait before paid generation to keep the two-concurrent-call rule. It also re-ran on every device. That was about 300 lines of timing heuristics for a one-time migration.
- **Re-polishing at generation time.** That adds AI calls and latency to the paid path, and it breaks the two-call rule.
- **Leaving old facts until the user edits.** Most users never re-edit, so the improvement would never reach them.

## Consequences

- Each bump costs about $0.01 per outdated item, once. On 2026-10-26 that was 78 items across 17 users.
- The backfill writes production data and is run by the operator, not by the app. Its AI spend is printed by the script itself. It is deliberately not logged to `ai_call_log`, because rows there count against each user's daily AI caps.
- Until it runs, an outdated item keeps its old facts. Nothing breaks; the wording is just the older style.
