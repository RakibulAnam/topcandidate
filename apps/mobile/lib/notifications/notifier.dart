// Wrapper around flutter_local_notifications. Implements DispatcherNotifier.

import 'package:flutter_local_notifications/flutter_local_notifications.dart';

import '../dispatch/dispatcher.dart';
import '../dispatch/state.dart';

class Notifier implements DispatcherNotifier {
  Notifier(this._plugin);
  final FlutterLocalNotificationsPlugin _plugin;
  int _seq = 1;

  /// Initializer safe to call from BOTH isolates:
  /// - UI isolate (`main.dart`)
  /// - Service isolate (`_onStart`)
  /// - Workmanager callback isolate
  ///
  /// Critically, this does NOT call `requestNotificationsPermission()` — that
  /// API throws NullPointerException in the service isolate because it needs
  /// an Activity context. The permission is requested from the UI isolate by
  /// `Permission.notification.request()` in `main.dart`, before this is
  /// called. Notification channels are pre-created in
  /// `android/.../MainApplication.kt`, so this init is purely about wiring
  /// up the Dart-side plugin so `show()` works.
  static Future<Notifier> init() async {
    final plugin = FlutterLocalNotificationsPlugin();
    const androidInit = AndroidInitializationSettings('@mipmap/ic_launcher');
    // flutter_local_notifications 20.x: initialize/show take named args only.
    await plugin.initialize(
      settings: const InitializationSettings(android: androidInit),
    );
    return Notifier(plugin);
  }

  @override
  Future<void> show(NotificationSpec spec) async {
    await _plugin.show(
      id: _seq++,
      title: spec.title,
      body: spec.body,
      notificationDetails: const NotificationDetails(
        android: AndroidNotificationDetails(
          'bkash_outcomes',
          'bKash outcomes',
          importance: Importance.high,
          priority: Priority.high,
        ),
      ),
    );
  }
}
