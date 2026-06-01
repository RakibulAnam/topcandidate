// Foreground service entrypoint. Owns the SMS listener and the dispatcher.
// See spec/03-architecture.md for the process model.

import 'dart:async';
import 'dart:developer' as developer;
import 'dart:ui';

import 'package:another_telephony/telephony.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_background_service/flutter_background_service.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:workmanager/workmanager.dart' as wm;

import '../diagnostics.dart';
import '../dispatch/dispatcher.dart';
import '../notifications/notifier.dart';
import '../settings/settings_repository.dart';
import '../storage/database.dart';
import '../storage/processed_sms_dao.dart';
import '../dispatch/webhook_client.dart';
import 'sms_listener.dart';

const _foregroundNotificationChannel = 'bkash_watcher_service';
const _foregroundNotificationTitle = 'bKash watcher running';
const _foregroundNotificationBody =
    'Listening for bKash SMS and confirming purchases.';

const _workmanagerTickName = 'bkash-watcher-tick';

class BackgroundServiceController {
  static Future<void> configure() async {
    // Android 13+ requires the foreground-notification channel to already
    // exist when `startForeground()` is called by the plugin; otherwise the
    // system kills the process with CannotPostForegroundServiceNotification-
    // Exception ("Bad notification for startForeground").
    //
    // The primary place we ensure that is MainApplication.kt — it creates
    // the channel in Application.onCreate(), which runs before any
    // component (Activity, Service, BroadcastReceiver). We ALSO create
    // it here as a belt-and-suspenders for hot-reload flows where Dart
    // code may have updated faster than the Kotlin side.
    final fln = FlutterLocalNotificationsPlugin();
    await fln
        .resolvePlatformSpecificImplementation<
          AndroidFlutterLocalNotificationsPlugin
        >()
        ?.createNotificationChannel(
          const AndroidNotificationChannel(
            _foregroundNotificationChannel,
            'bKash watcher service',
            description: 'Persistent notification while the watcher is running.',
            // Importance.low keeps it silent and collapsed but visible —
            // required for a long-running foreground service so it doesn't
            // ping the operator every time it appears.
            importance: Importance.low,
            showBadge: false,
          ),
        );

    final service = FlutterBackgroundService();
    // autoStart: false — we start the service explicitly after configure()
    // returns, so the channel + permission state is unambiguous. Without
    // this, plugin starts the service inside configure() and may race the
    // channel creation on some OEMs.
    await service.configure(
      androidConfiguration: AndroidConfiguration(
        onStart: _onStart,
        autoStart: false,
        autoStartOnBoot: true,
        isForegroundMode: true,
        notificationChannelId: _foregroundNotificationChannel,
        initialNotificationTitle: _foregroundNotificationTitle,
        initialNotificationContent: _foregroundNotificationBody,
        foregroundServiceNotificationId: 1001,
        foregroundServiceTypes: [AndroidForegroundType.dataSync],
      ),
      iosConfiguration: IosConfiguration(autoStart: false),
    );
    // Start now that configure() has populated the plugin's stored config.
    if (!(await service.isRunning())) {
      await service.startService();
    }

    // Workmanager: periodic safety-net tick (15-min floor on most OEMs).
    // workmanager 0.9.x: `isInDebugMode` is deprecated and has no effect;
    // periodic tasks use `ExistingPeriodicWorkPolicy` (separated from the
    // one-off `ExistingWorkPolicy` in 0.9).
    await wm.Workmanager().initialize(workmanagerCallback);
    await wm.Workmanager().registerPeriodicTask(
      _workmanagerTickName,
      _workmanagerTickName,
      frequency: const Duration(minutes: 15),
      constraints: wm.Constraints(networkType: wm.NetworkType.connected),
      existingWorkPolicy: wm.ExistingPeriodicWorkPolicy.keep,
    );
  }

  static Future<bool> isRunning() =>
      FlutterBackgroundService().isRunning();

  static Future<void> start() async {
    await FlutterBackgroundService().startService();
  }

  static void stop() {
    FlutterBackgroundService().invoke('stop');
  }
}

/// Dart entrypoint when the service starts. Runs in the **service isolate**;
/// shares no globals with the UI isolate.
@pragma('vm:entry-point')
Future<void> _onStart(ServiceInstance service) async {
  DartPluginRegistrant.ensureInitialized();
  WidgetsFlutterBinding.ensureInitialized();
  installCrashLogging('service');

  developer.log('service isolate starting', name: 'bg_service');

  if (service is AndroidServiceInstance) {
    service.on('stop').listen((_) async {
      await service.stopSelf();
    });
    service.setAsForegroundService();
  }

  final db = await BkashDatabase.open();
  final dao = ProcessedSmsDao(db);
  final settings = SettingsRepository();
  final webhook = HttpWebhookClient(
    urlProvider: settings.webhookUrl,
    secretProvider: settings.hmacSecret,
  );
  final notifier = await Notifier.init();
  final dispatcher = Dispatcher(
    dao: dao,
    webhookClient: webhook,
    notifier: notifier,
  );
  final smsListener = SmsListener(
    telephony: Telephony.instance,
    dao: dao,
    dispatcher: dispatcher,
    isolate: 'svc',
  );
  await smsListener.start();

  // Run a dispatch tick on startup to drain anything queued while we were off.
  unawaited(dispatcher.tick());

  // UI -> service kick channel.
  service.on('kick').listen((_) {
    unawaited(dispatcher.tick());
  });

  // Periodic in-isolate tick. The dispatcher schedules retries by setting
  // `next_attempt_at` (transient 5xx back off 5s→1h; waiting_user 404s back off
  // 20s→5min), but a tick must FIRE for a due row to be processed. While the
  // foreground service is alive this timer drives those retries so a row
  // resolves within ~15s of becoming due — instead of waiting for the next SMS,
  // an app reopen, or the 15-min WorkManager backstop. tick() is idempotent and
  // serialized, and is a cheap no-op when nothing is due.
  final ticker = Timer.periodic(const Duration(seconds: 15), (_) {
    unawaited(dispatcher.tick());
  });
  service.on('stop').listen((_) {
    ticker.cancel();
  });
}

/// Workmanager callback. Top-level so AOT can find it.
@pragma('vm:entry-point')
void workmanagerCallback() {
  wm.Workmanager().executeTask((task, inputData) async {
    if (task != _workmanagerTickName) return true;
    DartPluginRegistrant.ensureInitialized();
    installCrashLogging('wm');
    developer.log('wm tick fired', name: 'bg_service');
    // Do NOT close the DB in the finally block. sqflite opens with
    // `singleInstance: true` by default, which means every isolate in the
    // process shares one native SQLite handle. Closing it here yanks the
    // handle out from under the UI and service isolates, and every
    // subsequent query fails with `DatabaseException(database_closed)`.
    // The OS reclaims the handle when the process dies; nothing else
    // needs to do anything.
    final db = await BkashDatabase.open();
    try {
      final dao = ProcessedSmsDao(db);
      final settings = SettingsRepository();
      final webhook = HttpWebhookClient(
        urlProvider: settings.webhookUrl,
        secretProvider: settings.hmacSecret,
      );
      final notifier = await Notifier.init();
      final dispatcher = Dispatcher(
        dao: dao,
        webhookClient: webhook,
        notifier: notifier,
      );
      await dispatcher.tick();
    } catch (e, st) {
      developer.log(
        'wm tick failed: $e',
        name: 'bg_service',
        error: e,
        stackTrace: st,
      );
    }
    return true;
  });
}
