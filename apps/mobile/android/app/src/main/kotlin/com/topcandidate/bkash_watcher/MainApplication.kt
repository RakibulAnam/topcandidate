package com.topcandidate.bkash_watcher

import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build
import android.util.Log
import io.flutter.app.FlutterApplication

/**
 * Custom Application class.
 *
 * The sole reason this exists is to **pre-create the foreground service
 * notification channel before any component (Activity, Service,
 * BroadcastReceiver) starts**.
 *
 * Why: `flutter_background_service`'s `AndroidConfiguration` references a
 * notification channel id (`bkash_watcher_service`). On Android 13+ the OS
 * throws `CannotPostForegroundServiceNotificationException: Bad notification
 * for startForeground` if `startForeground()` runs before the channel exists.
 *
 * Several entry points race the Dart `main()` and may start the service
 * before any Dart code can create the channel:
 *   - `id.flutter.flutter_background_service.BootReceiver` on
 *     ACTION_BOOT_COMPLETED and **ACTION_MY_PACKAGE_REPLACED** (fired on
 *     every `flutter run` / app update).
 *   - Our own `BootReceiver` on boot.
 *   - `flutter_background_service`'s `WatchdogReceiver`.
 *
 * Android always initializes the Application class before delivering any
 * broadcast or starting any component, so creating the channel here is the
 * one place that wins every race.
 *
 * See `spec/03-architecture.md` "Foreground notification channel must be
 * pre-created" for the spec-level discussion.
 */
class MainApplication : FlutterApplication() {

    companion object {
        // Must match `_foregroundNotificationChannel` in
        // lib/service/background_service.dart.
        private const val FOREGROUND_CHANNEL_ID = "bkash_watcher_service"
        private const val FOREGROUND_CHANNEL_NAME = "bKash watcher service"
        private const val FOREGROUND_CHANNEL_DESC =
            "Persistent notification while the watcher is running."

        // Must match `bkash_outcomes` in lib/notifications/notifier.dart.
        // Pre-created here too so that toasts work even if the dispatcher
        // fires before Notifier.init() runs (e.g. from a workmanager
        // callback on a freshly booted phone).
        private const val OUTCOMES_CHANNEL_ID = "bkash_outcomes"
        private const val OUTCOMES_CHANNEL_NAME = "bKash outcomes"
        private const val OUTCOMES_CHANNEL_DESC =
            "Per-transaction outcome notifications."
    }

    override fun onCreate() {
        super.onCreate()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = getSystemService(NotificationManager::class.java) ?: return
            try {
                nm.createNotificationChannel(
                    NotificationChannel(
                        FOREGROUND_CHANNEL_ID,
                        FOREGROUND_CHANNEL_NAME,
                        NotificationManager.IMPORTANCE_LOW
                    ).apply { description = FOREGROUND_CHANNEL_DESC }
                )
                nm.createNotificationChannel(
                    NotificationChannel(
                        OUTCOMES_CHANNEL_ID,
                        OUTCOMES_CHANNEL_NAME,
                        NotificationManager.IMPORTANCE_HIGH
                    ).apply { description = OUTCOMES_CHANNEL_DESC }
                )
            } catch (t: Throwable) {
                Log.e("bkash_watcher", "Failed to create notification channels", t)
            }
        }
    }
}
