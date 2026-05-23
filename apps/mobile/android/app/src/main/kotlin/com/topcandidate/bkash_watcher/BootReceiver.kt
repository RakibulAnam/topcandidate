package com.topcandidate.bkash_watcher

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * Restarts the foreground service after the phone reboots.
 *
 * The flutter_background_service plugin exposes a JVM-side entrypoint
 * `id.flutter.flutter_background_service.BackgroundService` which we start
 * here. Once the service is up, its Dart entrypoint takes over and
 * re-registers the SMS listener.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action ?: return
        if (action == Intent.ACTION_BOOT_COMPLETED ||
            action == "android.intent.action.QUICKBOOT_POWERON" ||
            action == "com.htc.intent.action.QUICKBOOT_POWERON"
        ) {
            Log.i("bkash_watcher", "BootReceiver: rearming foreground service")
            val serviceIntent = Intent().setClassName(
                context.packageName,
                "id.flutter.flutter_background_service.BackgroundService"
            )
            try {
                context.startForegroundService(serviceIntent)
            } catch (t: Throwable) {
                Log.e("bkash_watcher", "Failed to start service on boot", t)
            }
        }
    }
}
