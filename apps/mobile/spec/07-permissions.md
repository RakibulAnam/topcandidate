# Spec 07 — Permissions and Android Manifest

## Permissions requested

| Permission                                | Why                                          | When asked          |
| ----------------------------------------- | -------------------------------------------- | ------------------- |
| `RECEIVE_SMS`                             | Wake on incoming SMS broadcast.              | First launch.       |
| `READ_SMS`                                | Read SMS body (`address`, `body`, date).     | First launch.       |
| `INTERNET`                                | POST to webhook.                             | Auto-granted.       |
| `ACCESS_NETWORK_STATE`                    | Decide retry-now vs queue-for-later.         | Auto-granted.       |
| `FOREGROUND_SERVICE`                      | Run the watcher as foreground service.       | Auto-granted.       |
| `FOREGROUND_SERVICE_DATA_SYNC`            | Required on Android 14+ for sync-type fg svc.| Auto-granted.       |
| `POST_NOTIFICATIONS`                      | Show service + outcome notifications.        | First launch (A13+).|
| `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`    | Open the system dialog from Settings tab.    | On user tap.        |
| `RECEIVE_BOOT_COMPLETED`                  | Restart service after phone reboot.          | Auto-granted.       |
| `WAKE_LOCK`                               | Allow Workmanager periodic tick to run.      | Auto-granted.       |

## AndroidManifest declarations

The manifest must declare:

1. All permissions above with `<uses-permission>`.
2. The Flutter `MainActivity`.
3. The foreground service component from `flutter_background_service`.
4. The boot receiver class (`com.topcandidate.bkash_watcher.BootReceiver`)
   with the `RECEIVE_BOOT_COMPLETED` intent filter.
5. The SMS receiver from `another_telephony` (or registered at runtime).

See `android/app/src/main/AndroidManifest.xml` for the live version.

The `flutter_background_service` `<service>` declaration uses
`tools:replace="android:exported"` to override the plugin's bundled
`android:exported="true"` — see `spec/03-architecture.md` "Manifest merge"
for why.

## Minimum SDK

`minSdk = 23` (Android 6.0 Marshmallow). This is forced by the
`another_telephony` plugin, which declares `minSdk 23` and fails manifest
merge otherwise. Devices below API 23 are not supported.

## Runtime permission flow

On first launch, `main.dart` calls `PermissionsBootstrap.run()`:

1. Show a non-dismissible dialog explaining what the app will read.
2. Request `RECEIVE_SMS`, `READ_SMS`, `POST_NOTIFICATIONS` together.
3. If any are denied, show a "We can't work without these" screen with a
   link to system settings. Do not start the service.
4. If all granted, prompt user to disable battery optimization next.

The "request battery optimization disable" is non-blocking — the app starts
the service either way, but the Status tab flags this as a risk if the
exemption is missing.

## Why we need `FOREGROUND_SERVICE_DATA_SYNC`

Android 14 (API 34) requires foreground services to declare a specific
type. `dataSync` is the best fit for "I am syncing data between local and
remote on a recurring basis". Use this in `<service android:foregroundServiceType="dataSync" />`.

## Doze and Standby buckets

On Android 9+, the dispatcher's Workmanager periodic job runs in a Standby
Bucket that may delay execution to once-every-15-minutes (Active) up to
once-per-day (Rare). This is acceptable: SMS arrival itself wakes the
service via broadcast, so the periodic job is only a safety net for retries.
