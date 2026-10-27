# ADR-0007: Repair AI output in place, never retry for content

- **Date:** 2026-10-26
- **Status:** Accepted.

## Context

The resume optimizer's honesty guards threw `ResumeFabricationError` when a skill that the skills filter had stripped as invented still appeared in a bullet or the summary. The throw sent the whole generation through `withRetry` on another model. That could run up to the 50s deadline and end in a failure and a credit refund. The toolkit did the same thing to a whole artifact: one flagged word threw away a 300-word cover letter and showed the user a retry card.

The owner rejected this on 2026-10-26. A user who waits through a long spinner and then sees an error has a bad first impression, and the problem was one word in a document that was otherwise fine. The same review also added checks the old code never had: an invented industry in the summary ("fintech" for a candidate with no payments work) and tools outside the fabrication dictionary ("CI/CD", "XCTest").

## Decision

1. **Content problems are repaired in place and never retried.** Retries remain only for structural failures: bad JSON and missing item ids.
2. **Only two kinds of edit, so nothing can be garbled.** One removes a whole item from a list that parses cleanly (`prompts/proseRepair.ts`). The other removes a whole unit: a sentence, a trailing participle clause after a bullet's last comma (", deploying it on Kubernetes"), a bullet, or a later summary sentence. An item's only bullet is never removed; it is swapped for that item's own polished fact. If the summary's opening sentence can't be repaired that way, it is replaced with a positioning line built from profile facts ("<latest role> with <N>+ years of experience."). Word-level cuts, such as removing prepositional phrases, single words or adjectives, were tried and then removed during review. Each new phrasing broke them ("Deployed it", "specializing in.").
3. **Deleting a whole bullet or sentence needs the old guard's own high-confidence signal.** That is a stripped skill that the fabrication dictionary also flags in the text. Structural strips ("Agile") and over-caught competencies ("License Management") are never deleted along with the work around them.
4. **The toolkit uses the same repair before its fabrication gate.** The gate still runs afterwards, so anything the repair cannot fix is discarded exactly as before.

## Why not the alternatives

- **Keep throwing and retrying.** This is the user-visible failure being removed. It also bills a second model call for a one-word problem.
- **A second "fix this sentence" AI call.** It adds latency and cost on the paid hot path. It is also not guaranteed to fix the problem, which brings the retry loop back.

## Consequences

- **The summary opener can become plainer.** A model-written opener that claims something unproven is replaced by a factual positioning line. That line is plainer, but it is always grammatical and true.
- `ResumeFabricationError` stays exported because telemetry classifies older log rows by it. Nothing on the optimizer path throws it any more.
- The repair rules are covered by a scratch regression suite of real cases, run across several review rounds, rather than an in-repo test harness (the web app has none, by design).
