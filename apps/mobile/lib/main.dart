// UI-isolate entrypoint. The service isolate is bootstrapped separately by
// flutter_background_service (see lib/service/background_service.dart).
// See spec/03-architecture.md.

import 'package:another_telephony/telephony.dart';
import 'package:flutter/material.dart';
import 'package:permission_handler/permission_handler.dart';

import 'app.dart';
import 'diagnostics.dart';
import 'dispatch/dispatcher.dart';
import 'dispatch/webhook_client.dart';
import 'notifications/notifier.dart';
import 'service/background_service.dart';
import 'service/sms_listener.dart';
import 'settings/settings_repository.dart';
import 'storage/database.dart';
import 'storage/processed_sms_dao.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  installCrashLogging('ui');

  // Request the permissions we need before any state-of-the-world checks.
  await [
    Permission.sms,
    Permission.notification,
  ].request();

  final db = await BkashDatabase.open();
  final dao = ProcessedSmsDao(db);
  final settings = SettingsRepository();
  final webhookClient = HttpWebhookClient(
    urlProvider: settings.webhookUrl,
    secretProvider: settings.hmacSecret,
  );
  final notifier = await Notifier.init();
  final dispatcher = Dispatcher(
    dao: dao,
    webhookClient: webhookClient,
    notifier: notifier,
  );

  // Register an SMS listener in the UI isolate as well as the service
  // isolate. The `another_telephony` plugin routes foreground SMS broadcasts
  // (when the Activity is visible) to whichever Flutter engine has
  // `onAttachedToActivity` — the UI engine. That routing only fires Dart's
  // onNewMessage if `listenIncomingSms()` has been called in *this isolate*.
  // Without this, foreground SMS silently throws LateInitializationError
  // inside a MethodChannel handler (swallowed by the framework, never
  // surfaces as a Dart crash).
  // The service isolate's listener still registers the background callback
  // handle in SharedPrefs, which routes the OS broadcast to our
  // `backgroundMessageHandler` when the Activity is detached.
  final uiSmsListener = SmsListener(
    telephony: Telephony.instance,
    dao: dao,
    dispatcher: dispatcher,
    isolate: 'ui',
  );
  await uiSmsListener.start();

  // Boot the foreground service. If permissions were denied it will still
  // start, but won't receive SMS broadcasts.
  await BackgroundServiceController.configure();

  runApp(BkashWatcherApp(
    dao: dao,
    dispatcher: dispatcher,
    settings: settings,
    webhookClient: webhookClient,
  ));
}
