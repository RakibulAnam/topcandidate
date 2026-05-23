// Isolate-wide crash logging. Call installCrashLogging('<isolate>') once at
// the top of each entrypoint (UI main, service onStart, workmanager callback,
// SMS background handler). Surfaces uncaught Dart errors to `developer.log`
// so they show up in `flutter run` console and `adb logcat -s flutter`.

import 'dart:developer' as developer;

import 'package:flutter/foundation.dart';

void installCrashLogging(String isolate) {
  FlutterError.onError = (details) {
    developer.log(
      'FlutterError: ${details.exceptionAsString()}',
      name: 'crash.$isolate',
      error: details.exception,
      stackTrace: details.stack,
    );
    // Preserve Flutter's default behavior (print to console) so we don't
    // accidentally silence framework errors.
    FlutterError.presentError(details);
  };
  PlatformDispatcher.instance.onError = (error, stack) {
    developer.log(
      'Uncaught zone error: $error',
      name: 'crash.$isolate',
      error: error,
      stackTrace: stack,
    );
    // Return false so Dart's default error handler still runs (and the
    // process crashes as it would have).
    return false;
  };
}
