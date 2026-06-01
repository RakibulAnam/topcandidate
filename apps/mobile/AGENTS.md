# AGENTS.md — bKash Watcher (mobile app)

> Mandatory reading for any AI agent (Claude Code, Cursor, Copilot, etc.) that
> edits the **mobile app**. Read the root [`../../AGENTS.md`](../../AGENTS.md) first for
> monorepo-wide topology; this file is the mobile-specific guide.
>
> This file is the **stable contract** between humans and the AI agents that
> maintain the mobile codebase. Everything else (spec/, README, code comments)
> flows from this document.

---

## 0. One-paragraph summary

`bkash_watcher` is a **single-user, Android-only Flutter app** that runs on the
operator's personal phone. It listens for bKash "money received" SMS, extracts
the transaction details, and POSTs a signed webhook to the operator's web app
so customer credit-pack purchases can be auto-confirmed. There is no backend,
no login, no multi-tenant story, no iOS. The app is sideloaded.

---

## 1. How this codebase is developed

This project is **maintained primarily by AI agents** under operator
supervision. To keep agent work coherent across sessions:

1. **All requirements live in `spec/`.** When the operator changes the desired
   behavior, the spec is updated FIRST, then code is brought into compliance.
2. **AGENTS.md (this file) is the entry point.** Always read it on session
   start, then read the relevant `spec/*.md` file before editing related code.
3. **No file is "done forever".** Treat every file as a candidate for edits as
   the spec evolves. Avoid load-bearing comments that duplicate the spec —
   keep the spec single-source-of-truth and let the code refer to it by
   section number (e.g. `// see spec/04-state-machine.md §3`).
4. **Spec-driven, not chat-driven.** If the operator gives you a verbal
   instruction that contradicts the spec, update the spec in the same change
   set so the next agent doesn't redo the wrong thing.

---

## 2. Repo map

```
bkash_watcher/
├── AGENTS.md                  ← you are here
├── README.md                  ← operator-facing install + QA
├── pubspec.yaml               ← pinned dependency versions
├── analysis_options.yaml
├── prompts-from-web/          ← cross-app briefs from web sessions; delete when done (§6.5)
├── spec/                      ← single source of truth for behavior
│   ├── 00-overview.md
│   ├── 01-server-contract.md
│   ├── 02-sms-formats.md
│   ├── 03-architecture.md
│   ├── 04-state-machine.md
│   ├── 05-storage-schema.md
│   ├── 06-ui-spec.md
│   ├── 07-permissions.md
│   ├── 08-security.md
│   └── 09-qa-checklist.md
├── android/
│   └── app/src/main/AndroidManifest.xml
├── lib/
│   ├── main.dart              ← app entrypoint, service bootstrap
│   ├── app.dart               ← root MaterialApp + theme
│   ├── theme.dart             ← monochrome palette + state badge colors
│   ├── diagnostics.dart       ← installCrashLogging() per-isolate (see §9.4)
│   ├── sms/
│   │   ├── bkash_parser.dart  ← pure parser (no Flutter deps)
│   │   └── sms_kind.dart      ← BkashSmsKind enum
│   ├── storage/
│   │   ├── database.dart      ← sqflite schema + migrations
│   │   └── processed_sms_dao.dart
│   ├── dispatch/
│   │   ├── backoff.dart       ← retry schedule from spec §4
│   │   ├── dispatcher.dart    ← state machine
│   │   ├── state.dart         ← ProcessedSmsState enum + transitions
│   │   └── webhook_client.dart← HMAC + HTTP
│   ├── service/
│   │   ├── background_service.dart ← flutter_background_service entrypoint
│   │   └── sms_listener.dart  ← another_telephony bridge
│   ├── settings/
│   │   └── settings_repository.dart ← flutter_secure_storage wrapper
│   ├── notifications/
│   │   └── notifier.dart      ← flutter_local_notifications wrapper
│   └── ui/
│       ├── home_page.dart     ← 3-tab scaffold
│       ├── status_tab.dart
│       ├── history_tab.dart
│       ├── settings_tab.dart
│       └── widgets/
│           ├── state_badge.dart
│           └── sms_row_tile.dart
└── test/
    ├── sms/
    │   └── bkash_parser_test.dart
    └── dispatch/
        ├── backoff_test.dart
        └── dispatcher_test.dart
```

---

## 3. Layering rules

Strict bottom-up dependency direction. Higher layers may import lower layers,
never the reverse. **Violating this is a refactor, not a feature.**

```
ui/         ← may import everything below
service/    ← may import dispatch/, storage/, settings/, notifications/, sms/
dispatch/   ← may import storage/, settings/, sms/
storage/    ← may import sms/ (parsed-sms value type only)
settings/   ← stand-alone (only crypto + secure_storage)
sms/        ← pure Dart only, NO Flutter, NO platform imports
```

Why: the parser and dispatcher state machine MUST be unit-testable on the Dart
VM without Flutter. Anything that pulls a Flutter import into `sms/` or
`dispatch/state.dart` will break CI.

---

## 4. Coding conventions

- **Dart 3.x**, null-safety, prefer `sealed class` for finite unions.
- Public API uses `final` fields and `const` constructors wherever possible.
- No global mutable state. Pass dependencies explicitly so tests can inject
  fakes. The only exceptions are `WidgetsBinding`-managed singletons exposed
  by Flutter itself.
- HTTP, clock, and storage are abstracted behind small interfaces
  (`WebhookClient`, `Clock`, `ProcessedSmsDao`) so the dispatcher can be
  tested without real I/O.
- No `print()`. Use `developer.log` with the `name:` parameter set to the
  module name (e.g. `name: 'dispatcher'`).
- Lint config in `analysis_options.yaml` is strict — fix warnings, don't
  suppress them, unless you add a one-line `// ignore: ...` with rationale.

---

## 5. Testing rules

- Every change to `lib/sms/bkash_parser.dart` must update
  `test/sms/bkash_parser_test.dart`. The parser is table-driven; add a row,
  don't add a new test function.
- Every change to `lib/dispatch/dispatcher.dart` must update
  `test/dispatch/dispatcher_test.dart`. Use the fake `WebhookClient` already
  in the test file — do not introduce real HTTP in tests.
- Tests live next to the code structurally: `lib/foo/bar.dart` →
  `test/foo/bar_test.dart`.
- Tests must pass on `flutter test` with no devices attached.

---

## 6. Things you must not do

1. **Do not add iOS code paths.** Apple does not allow programmatic SMS read.
   If you see `if (Platform.isIOS)` anywhere, delete it.
2. **Do not introduce a user-account system, cloud sync, or analytics.** This
   app is single-tenant by hardware.
3. **Do not store the HMAC secret in source, env files, or asset bundles.**
   The Settings tab is the only entry point.
4. **Do not invent webhook endpoints.** The watcher POSTs to exactly four:
   `POST /api/confirm-purchase` (the configured URL) plus three siblings
   derived by path-rewrite — `/api/orphan-inbound-sms`,
   `/api/reverse-purchase`, `/api/admin/parser-failures`. The full contract
   is in `spec/01-server-contract.md`. Don't add more.
5. **Do not change the retry schedule without updating
   `spec/04-state-machine.md` first.** The backoff sequence is a contract
   with the operator's expectations.
6. **Do not add Material 3 dynamic color, gradients, or marketing flourishes.**
   See `spec/06-ui-spec.md` — this is a tool, not a consumer app.
7. **Do not add third-party SDKs not listed in `pubspec.yaml`** without
   updating AGENTS.md and pausing for operator approval.
8. **Do not bump pinned dependency versions casually.** The pubspec is
   pinned. Only bump when (a) the current pin no longer builds against the
   installed Flutter/Android SDK, or (b) the operator asks. When you bump,
   record the reason in `spec/03-architecture.md` and verify the Dart-side
   API surface used by `lib/` still matches.

---

## 6.5. prompts-from-web protocol

When the web app makes a change that requires coordinated work on the mobile
side, the web session drops a self-contained markdown brief into
`prompts-from-web/<YYYY-MM-DD>-<slug>.md`. Each brief is a complete
specification — it states what the web changed, what the mobile must do,
which files to touch, and how to verify.

**Lifecycle**:

1. The web session creates the file.
2. A future mobile session reads this file (`AGENTS.md`) first, then opens
   any file in `prompts-from-web/` and treats it as the active brief.
3. When the mobile work is complete and verified — `flutter analyze` and
   `flutter test` green, manual smoke on a real device passed, build
   sideloaded to the operator's phone — the agent **deletes the prompt
   file in the same commit as the `pubspec.yaml` version bump**.

The folder is a queue of pending cross-app work, not an archive. A stale
prompt file is worse than none — it makes a future agent believe work is
owed when it isn't. Git history is the archive; the file's job is to mark
"work is owed". Once shipped, remove it.

If you cannot finish the prompt's work in one session, leave it in place
and add a note at the top describing what's done vs pending. Do NOT
partially-delete sections of the prompt as a progress marker — keep the
file whole, annotate the top.

## 7. When the operator asks for a change

Recommended agent workflow:

1. Read this file.
2. Skim `spec/00-overview.md`.
3. Open the spec file most relevant to the change. If the requested change
   contradicts the spec, **update the spec first**, in the same change set.
4. Find the matching code under `lib/` using the repo map in §2.
5. Make the change, update tests, run `flutter analyze` and `flutter test`.
6. If you added or removed a file, update the repo map in §2.
7. If you changed a public surface (parser API, dispatcher API, schema),
   update the spec section referenced by that code.

---

## 8. Open questions / known limitations

These are intentionally not addressed; do not "fix" them without explicit
operator request:

- No automated way to recover if Android kills the foreground service and
  battery-optimization exemption is also disabled. Operator must check the
  Status tab.
- Workmanager periodic jobs have a 15-minute floor on some OEM Android skins
  (MIUI, ColorOS, Samsung One UI). We schedule at 15 min and rely on the
  per-SMS `dispatcher.kick()` for low-latency dispatch. Worst-case retry
  latency for `waiting_user` rows is 5 min (the documented retry interval).
- We do not parse the SMS timestamp from the body — we use the OS delivery
  timestamp. The in-body timestamp is stored as part of `raw_body` for audit
  but is not authoritative.
- On Samsung One UI, "Freecess" may freeze the app despite the foreground
  service. The battery-optimization exemption is necessary but sometimes
  not sufficient. README has the operator workaround (add to "Apps that
  won't be put to sleep" manually).

## 9. Flutter integration footguns — DO NOT REMOVE THE WORKAROUNDS

These four workarounds are non-obvious and were each discovered by debugging
a real production crash. Future agents must NOT "clean up" or "simplify"
them. Each has a documenting comment in code; the canonical reference is
`spec/03-architecture.md` §"Cross-isolate DB", §"SMS listener registration",
and §"SMS broadcast receiver class name".

1. **Never call `db.close()` in a worker isolate.** sqflite's default
   `singleInstance: true` shares one native SQLite handle across all
   isolates. Any close kills it for everyone. Affects:
   `service/sms_listener.dart:backgroundMessageHandler` and
   `service/background_service.dart:workmanagerCallback`. Do not add a
   `finally { await db.close(); }` block to either.

2. **SMS receiver class name is `com.shounakmulay.telephony.sms.IncomingSmsReceiver`.**
   Hard-coded in `android/app/src/main/AndroidManifest.xml`. Comes from the
   plugin's Kotlin source, not from the Dart pubspec name. A wrong name
   causes `ClassNotFoundException` only when a real SMS arrives — not at
   build or install time.

3. **`listenIncomingSms()` must be called in the UI isolate AND the service
   isolate.** UI call wires the foreground delivery path; service call
   registers the background callback handle in SharedPrefs. Removing
   either breaks one of the two delivery paths silently. See `main.dart`
   and `service/background_service.dart:_onStart`.

4. **Every background isolate entrypoint must call
   `DartPluginRegistrant.ensureInitialized()` before any plugin call.**
   Applies to `_onStart`, `workmanagerCallback`, and
   `backgroundMessageHandler`. Each one also calls
   `installCrashLogging('<isolate>')` from `lib/diagnostics.dart` so
   uncaught Dart errors surface to `developer.log`.

## 10. Production status

Shipped to production 2026-05-17. First real bKash payment confirmed
end-to-end (TrxID `DEH7BO44AJ`, Tk 30). The codebase is live; coordinate
any wire-contract changes with the web app on the other end via
`WHAT_IT_DOES.md`.

2026-05-24: aligned with web migration 007 — three new HMAC endpoints
(`/api/orphan-inbound-sms`, `/api/reverse-purchase`,
`/api/admin/parser-failures`) and 409 `underpaid` handling on
`/api/confirm-purchase`. Refund SMS now route through the dispatcher as
`reversing` rather than landing in terminal `ignored_refund`.
