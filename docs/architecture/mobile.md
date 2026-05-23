# Mobile architecture

Authoritative reference:
- [`apps/mobile/AGENTS.md`](../../apps/mobile/AGENTS.md) — high-level overview, agent rules.
- [`apps/mobile/spec/03-architecture.md`](../../apps/mobile/spec/03-architecture.md) — isolate model, service lifecycle.
- [`apps/mobile/spec/04-state-machine.md`](../../apps/mobile/spec/04-state-machine.md) — dispatcher states, backoff schedule.
- [`apps/mobile/spec/05-storage-schema.md`](../../apps/mobile/spec/05-storage-schema.md) — local SQLite `processed_sms` table.

In brief: Android-only foreground service reads bKash SMS, parses with pure-Dart `lib/sms/`, dispatches via state machine in `lib/dispatch/`, persists in SQLite via `lib/storage/`. UI is a 3-tab Flutter Material app (Status / History / Settings).

_This file exists as a navigation hint — content stays in `apps/mobile/spec/` to avoid drift._
