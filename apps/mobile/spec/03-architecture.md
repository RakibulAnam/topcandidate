# Spec 03 — Architecture

## Process model

The app is one Android process with **four** Dart execution contexts (isolates).
They do NOT share a Dart heap — each isolate has its own. They share:

1. The Android plugin layer (single plugin instance per Flutter engine binding).
2. The native SQLite handle returned by `sqflite` (see §"Cross-isolate DB" below).
3. Process-wide singletons in SharedPreferences (e.g. the background-message
   callback handle registered by `another_telephony`).

The four isolates:

1. **UI isolate** — `MaterialApp`, three tabs, reads from the database,
   creates an `SmsListener` so the plugin's foreground SMS routing has
   somewhere to land (see §"SMS listener registration"). Also kicks the
   dispatcher when a foreground SMS arrives.
2. **Service isolate** — long-lived foreground service started by
   `flutter_background_service`. Holds its own `SmsListener` (so the
   background callback handle is registered in SharedPrefs) and its own
   `Dispatcher`. Survives UI being closed. Runs an initial `dispatcher.tick()`
   on start, listens for `'kick'` events, and runs a **15s `Timer.periodic`
   `dispatcher.tick()`** so rows with a future `next_attempt_at` (transient
   retries, `waiting_user` 404 backoff) fire within ~15s of becoming due while
   the service is alive — not only on the next SMS / app-reopen / 15-min
   Workmanager backstop. The timer is cancelled on `'stop'`.
3. **Workmanager isolate** — 15-min periodic `Dispatcher.tick()` safety net.
   Spawned by `workmanager`, may be a fresh isolate or reused depending on
   Android scheduling. Must call `DartPluginRegistrant.ensureInitialized()`
   at entry.
4. **SMS background isolate** — spawned by `another_telephony` when an SMS
   arrives while the Activity is detached. Entry point is the top-level
   `backgroundMessageHandler` in `lib/service/sms_listener.dart`. Inserts the
   parsed row into the DB, then **builds a `Dispatcher` and dispatches
   immediately** (`tick()`) rather than waiting for the next periodic
   Workmanager tick — this removes the up-to-15-min latency for SMS that arrive
   while backgrounded. The 15-min Workmanager tick is now only the backstop.
   Must call `DartPluginRegistrant.ensureInitialized()` at entry (and, per the
   cross-isolate DB rule, must NOT close the shared handle).

Each isolate's entrypoint calls `installCrashLogging('<isolate>')` from
`lib/diagnostics.dart` so uncaught Dart errors surface to `developer.log`
with a `crash.<isolate>` tag (otherwise background-isolate errors silently
disappear from `flutter run` console).

A persistent low-priority notification is required by Android to keep the
service alive. The notification title is "bKash watcher running" with body
"Listening for bKash SMS and confirming purchases." (channel
`bkash_watcher_service`, foreground notification id 1001).

## Boot sequence

1. App launches OR phone boots (via `BootReceiver` → restarts the foreground
   service through `flutter_background_service`'s JVM-side entrypoint).
2. `main.dart` (UI isolate) initializes in order:
   - `WidgetsFlutterBinding.ensureInitialized()`
   - `installCrashLogging('ui')` from `lib/diagnostics.dart`
   - Permission requests (SMS, notifications)
   - `BkashDatabase.open()` (sqflite, schema in spec/05) — process-wide handle
   - `Notifier.init()`
   - `SettingsRepository()` (reads webhook URL + HMAC from secure storage lazily)
   - `SmsListener(isolate: 'ui').start()` — registers the UI isolate's
     `_onNewMessage` so the plugin's foreground SMS path has somewhere to land
   - `BackgroundServiceController.configure()` — starts the service isolate
     and registers the Workmanager periodic task
   - `runApp(...)` — UI now visible
3. Service isolate's `_onStart` runs in parallel: `DartPluginRegistrant`,
   crash logging, opens its own `BkashDatabase` view of the shared handle,
   starts `SmsListener(isolate: 'svc').start()` (registers the background
   callback handle in SharedPrefs via `another_telephony`'s
   `startBackgroundService` action), and kicks an initial `dispatcher.tick()`.
4. UI's `HomePage.initState` schedules a `postFrameCallback` that — once per
   install — checks battery-optimization status and prompts the user to
   exempt the app if not already exempt. Persisted via
   `SettingsRepository.batteryPrompted()` so the dialog only fires once.
5. UI shows current service status by querying `service.isRunning()`.

## SMS ingest path

```
[Android SMS broadcast]
        ↓
[another_telephony receiver, registered in AndroidManifest]
        ↓
[SmsListener.onSms(SmsMessage)]
        ↓ filter: address.toLowerCase() contains 'bkash' (see spec/02)
        ↓
[BkashSms.parse(body)]
        ↓ null? → dump to /api/admin/parser-failures (no DB row) + drop
        ↓
[ProcessedSmsDao.insertParsed(parsed, deliveryTimestamp)]
        ↓ initial state by kind (see processed_sms_dao.dart):
        ↓   received        → queued      (will dispatch to /api/confirm-purchase)
        ↓   refund          → reversing   (will dispatch to /api/reverse-purchase)
        ↓   sent            → ignored_sent     (audit-only, not dispatched)
        ↓   ibankingDeposit → ignored_ibanking (audit-only, not dispatched)
        ↓   unknown         → failed (last_error set; should be rare — parse() usually returns null first)
        ↓ ON CONFLICT (trx_id) DO NOTHING  (dedupe)
        ↓
[Dispatcher.kick()]   ← signal: there's work to do
```

## Dispatch path

```
[Dispatcher.kick()  OR  Workmanager periodic tick (15 min)]
        ↓
[Dispatcher.tick()] ← idempotent, can be called concurrently with own lock
        ↓
[ProcessedSmsDao.dueRows(now)]  → rows where state in {queued, retrying, waiting_user, reversing}
                                  AND (next_attempt_at IS NULL OR next_attempt_at <= now)
        ↓
[for each row]
        ↓ mark state = sending
        ↓
[WebhookClient.post(body, hmac)]
        ↓
[Dispatcher.applyResponse(row, response)]  → new state + next_attempt_at per spec §04
        ↓
[Notifier.notify(...)] if terminal or operator-actionable.
```

The dispatcher takes an internal lock so two concurrent ticks don't race the
same row. The lock is in-process; SQLite's row-level state guards correctness
across process restarts.

## Dependency injection

`main.dart` constructs a `BkashServices` bag and hands it to the
background service entrypoint via a `ServiceInstance` payload. The bag is:

```dart
class BkashServices {
  final ProcessedSmsDao dao;
  final WebhookClient webhookClient;
  final SettingsRepository settings;
  final Notifier notifier;
  final Clock clock;
}
```

Tests substitute fakes for `webhookClient`, `clock`, and `dao` (in-memory
implementations).

## Concurrency / threading

- All DB access goes through `ProcessedSmsDao`. Multiple isolates can hold
  their own `ProcessedSmsDao` instance, but `sqflite` opens with
  `singleInstance: true` by default — every isolate that calls
  `openDatabase(samePath)` gets a wrapper around **one** native SQLite
  handle. **Critical: never call `db.close()` from a worker isolate.**
  Closing from any one isolate closes the handle for all of them; the next
  query anywhere errors with `DatabaseException(database_closed)`. The OS
  reclaims the handle when the process dies — that's the only correct
  lifecycle. See §"Cross-isolate DB" below for the full pattern.
- sqflite serializes all writes/reads through the single native handle, so
  multi-isolate access is safe at the row level.
- Each isolate's `Dispatcher` holds its own `Completer`-based lock so
  `tick()` is serialized within an isolate. Two isolates running `tick()`
  concurrently can race on the same row, but the server's idempotency
  (200 with `alreadyConfirmed:true` on replay) makes the worst case a
  wasted POST, not a double-credit grant.
- HTTP timeouts: 30 s total per request.

## Cross-isolate DB pattern

```dart
// CORRECT — open and use, never close in a worker isolate:
final db = await BkashDatabase.open();
final dao = ProcessedSmsDao(db);
await dao.insertParsed(...);
// no db.close() — let the process tear it down

// WRONG — closes the shared handle for all isolates:
final db = await BkashDatabase.open();
try {
  // ...
} finally {
  await db.close();   // ← THIS BREAKS EVERY OTHER ISOLATE
}
```

The UI isolate opens once in `main()` and holds the reference for the
lifetime of the app. The service isolate opens once in `_onStart` and
holds. The Workmanager callback opens per-tick but does NOT close. The
SMS background handler opens per-broadcast but does NOT close.

## SMS listener registration

`another_telephony` routes incoming SMS broadcasts in one of two ways:

- **Foreground** (Activity visible): receiver calls
  `IncomingSmsReceiver.foregroundSmsChannel.invokeMethod(ON_MESSAGE, ...)`.
  That channel is the **UI engine's** `_foregroundChannel`. Its Dart-side
  handler (`Telephony.handler`) routes `ON_MESSAGE` to the late-initialized
  `_onNewMessage` field, which is set by calling `listenIncomingSms()` in
  *that isolate*. If the UI isolate never calls `listenIncomingSms()`,
  `_onNewMessage` is unset and the call throws `LateInitializationError`
  inside a `MethodChannel` handler — silently swallowed by the framework,
  never surfaces as a Dart crash.
- **Background** (Activity detached): receiver spawns a fresh isolate using
  the callback handle stored in SharedPrefs (`SHARED_PREFS_BACKGROUND_SETUP_HANDLE`
  and `SHARED_PREFS_BACKGROUND_MESSAGE_HANDLE`). The handle is written by
  the native side when any isolate calls `listenIncomingSms()` with
  `onBackgroundMessage` + `listenInBackground: true`.

We therefore call `listenIncomingSms()` in **both** isolates:

1. `main.dart` constructs `SmsListener(isolate: 'ui')` and calls `.start()`.
   This sets the UI isolate's `_onNewMessage` to `SmsListener._handle`.
   Foreground delivery now works.
2. `background_service.dart:_onStart` constructs `SmsListener(isolate: 'svc')`
   and calls `.start()`. This registers (or refreshes) the background
   callback handles in SharedPrefs. Background delivery now works.

The service isolate's `_onNewMessage` is never actually invoked at runtime
(only the UI isolate's `foregroundSmsChannel` receives invokeMethod calls),
but the service-side `listenIncomingSms()` is what stores the background
handles. Leave both calls in place.

## SMS broadcast receiver class name

The receiver registered in `android/app/src/main/AndroidManifest.xml` MUST
be `com.shounakmulay.telephony.sms.IncomingSmsReceiver`. The pubspec name
(`another_telephony`) is misleading — the plugin is a fork of
`shounakmulay/telephony` and kept the original Kotlin package path. A wrong
class name here causes a fatal `ClassNotFoundException` the first time a
real SMS broadcast is delivered (not at install time, not at app launch).

Verify class name in `~/.pub-cache/hosted/pub.dev/another_telephony-0.4.1/android/src/main/kotlin/com/shounakmulay/telephony/sms/IncomingSmsHandler.kt`
if the plugin version is bumped.

## Workmanager schedule

- One periodic task: name `bkash-watcher-tick`, interval 15 min (the floor on
  most OEMs), with a `NetworkType.connected` constraint and
  `ExistingPeriodicWorkPolicy.keep`. We additionally dispatch immediately
  whenever an SMS arrives — `dispatcher.kick()` in the foreground/service path,
  and a direct `Dispatcher.tick()` inside `backgroundMessageHandler` when the
  Activity is detached — and the service isolate also runs a 15s periodic
  `tick()` that drives scheduled retries (`next_attempt_at`) while it is alive.
  So the 15-min Workmanager task is only a safety net for when the service has
  been killed, never the primary path for dispatch or retries.
- The periodic task simply calls `Dispatcher.tick()`. It does NOT do any
  parsing.
- We track the `workmanager` package at `^0.9.x`. Versions ≤ 0.5.2 reference
  Flutter v1 embedding APIs (`ShimPluginRegistry`, `PluginRegistrantCallback`,
  `Registrar`) that have been removed from current Flutter SDKs and will not
  compile. The Dart-side API is *mostly* unchanged but has two breaking
  changes that bit us during the bump:
  1. `registerPeriodicTask` now takes `ExistingPeriodicWorkPolicy?`, not the
     same `ExistingWorkPolicy?` used by `registerOneOffTask`. They were split
     in 0.9 to mirror Android WorkManager's underlying enum split.
  2. `Workmanager().initialize(callback, isInDebugMode: ...)` —
     `isInDebugMode` is deprecated and has no effect; use `WorkmanagerDebug`
     handlers instead. We pass no debug flag and just call
     `initialize(callback)`.

## Android build constraints

The following Android-side settings are non-negotiable; they are dictated by
the plugins we depend on, not by preference. They live in
`android/app/build.gradle.kts`:

| Setting                           | Value                  | Forced by                                                                 |
| --------------------------------- | ---------------------- | ------------------------------------------------------------------------- |
| `compileSdk`                      | `36`                   | `flutter_secure_storage` 10.x requires API 36 at compile time.            |
| `minSdk`                          | `23`                   | `another_telephony` declares `minSdk 23`; manifest merger fails otherwise.|
| `ndkVersion`                      | `"27.0.12077973"`      | `flutter_local_notifications`, `another_telephony`, `flutter_secure_storage`, `path_provider_android`, `permission_handler_android`, `sqflite_android`, `workmanager`, `flutter_background_service_android`, `disable_battery_optimization` all require NDK 27. |
| `compileOptions.isCoreLibraryDesugaringEnabled` | `true`   | `flutter_local_notifications` requires Java 8+ time/concurrent APIs on pre-26 devices. |
| `coreLibraryDesugaring` dep       | `com.android.tools:desugar_jdk_libs:2.1.4` | Same as above.                            |

If a future plugin bump relaxes any of these (e.g. raises Flutter's own
`flutter.ndkVersion` past 27, or `another_telephony` drops the minSdk floor),
prefer `flutter.ndkVersion` / `flutter.minSdkVersion` again so we track the
SDK defaults rather than pinning ourselves.

### Foreground notification channel must be pre-created

`flutter_background_service_android` reads `notificationChannelId` from its
config and calls `startForeground()` with a notification built against that
channel. On Android 13+ the OS validates the notification *before* allowing
the call to succeed — if the channel does not exist, the process is killed
with `CannotPostForegroundServiceNotificationException: Bad notification
for startForeground`.

The plugin only auto-creates its own default channel when no
`notificationChannelId` is supplied. We supply one (`bkash_watcher_service`),
so we must create it ourselves.

**Why creating it from Dart `main()` is not enough.** Several entry points
fire BEFORE Dart can run — they all bind to the plugin's stored config and
attempt `startForeground()`:

- `id.flutter.flutter_background_service.BootReceiver` on
  `ACTION_BOOT_COMPLETED` (after reboot) and **`ACTION_MY_PACKAGE_REPLACED`**
  (which Android sends on every reinstall/update, including every
  `flutter run`).
- The plugin's `WatchdogReceiver`.
- Our own `com.topcandidate.bkash_watcher.BootReceiver`.

The single place that always runs before any component of our process is
`Application.onCreate()`. We therefore create the channel in
`android/app/src/main/kotlin/com/topcandidate/bkash_watcher/MainApplication.kt`,
which is registered in the manifest via
`<application android:name=".MainApplication">`. The Dart side
(`BackgroundServiceController.configure()`) ALSO creates the channel as a
belt-and-suspenders, but the Kotlin Application is the authoritative
source.

When working on this code, do not change `android:name` back to
`${applicationName}` — that resolves to `io.flutter.app.FlutterApplication`
which does NOT create our channel.

### Service start timing

`AndroidConfiguration` is configured with `autoStart: false`. We then
explicitly call `FlutterBackgroundService().startService()` from
`BackgroundServiceController.configure()` after `service.configure(...)`
returns. This removes the race between channel creation and the plugin's
internal `start()` call that fires when `autoStart: true`. `autoStartOnBoot:
true` is kept so the service comes back after a phone reboot via the
plugin's `BootReceiver`.

### Manifest merge: `BackgroundService.exported`

`flutter_background_service_android`'s bundled manifest sets the service
`android:exported="true"`. Our manifest pins it to `false` (the service is
process-internal; no other app should bind to it) and uses
`tools:replace="android:exported"` to win the merge. Do not remove the
`tools:replace` attribute without first verifying the upstream manifest.

## Why not Drift?

The spec originally suggested drift. We use **sqflite** instead because:

1. No build_runner step → faster to iterate, simpler for AI agents to edit.
2. Schema is small (one table) — codegen has no payoff.
3. We don't need compile-time-checked SQL; the queries are trivial.

If the schema grows or we need reactive queries across isolates, revisit.
