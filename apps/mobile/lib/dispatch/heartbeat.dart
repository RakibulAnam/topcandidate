// Liveness heartbeat for the operator's watcher phone (web migration 028).
//
// WHY THIS EXISTS
// ===============
// The web app's purchase modal has to tell a customer why their purchase is
// still pending. Server-side, "we haven't matched your bKash SMS" is ambiguous
// between two very different situations:
//
//   (a) the customer mistyped their TrxID  → telling them to re-check is right
//   (b) this phone is offline / not syncing → telling them that would be a lie,
//       and blaming a paying customer for OUR outage is the worse failure
//
// Nothing else distinguishes them: with no traffic, silence looks identical.
// A periodic ping makes it observable — the server records `last_seen_at` in
// `watcher_heartbeats`, and `diagnose_pending_purchase` reads it to choose
// between the 'nothing_found' and 'watcher_stale' verdicts.
//
// Deliberately dumb: throttled in memory, fire-and-forget, never retried,
// never notifies the operator, and it never touches the dispatch queue. A
// dropped ping only costs the web app some wording precision, so it must never
// compete with real dispatch work. If the server is unreachable the web app
// simply stays on its softer copy.

import 'dart:developer' as developer;

import 'webhook_client.dart';

class Heartbeat {
  Heartbeat({
    required this.webhookClient,
    required this.deviceIdProvider,
    this.appVersion,
    this.queueDepthProvider,
    Duration interval = const Duration(minutes: 1),
    DateTime Function()? clock,
  })  : _interval = interval,
        _clock = clock ?? DateTime.now;

  final WebhookClient webhookClient;
  final Future<String> Function() deviceIdProvider;

  /// Left null in production: there is no single source of truth for the app
  /// version in this codebase (no package_info_plus, no generated constant),
  /// and a hand-maintained copy of the pubspec version would drift and then
  /// lie in telemetry. The server accepts the field, so it can be filled in
  /// later without a contract change.
  final String? appVersion;

  final Future<int> Function()? queueDepthProvider;
  final Duration _interval;
  final DateTime Function() _clock;

  DateTime? _lastSentAt;
  bool _inFlight = false;

  /// Sends at most one ping per [interval]. Safe to call from every dispatch
  /// tick — the throttle is what keeps the cadence sane.
  ///
  /// The server treats a watcher as stale after 5 minutes, so the default
  /// 1-minute cadence tolerates four consecutive misses before the web app
  /// switches to its "verification is running behind" copy.
  Future<void> maybeSend({bool force = false}) async {
    if (_inFlight) return;
    final now = _clock();
    final last = _lastSentAt;
    if (!force && last != null && now.difference(last) < _interval) return;

    _inFlight = true;
    try {
      final deviceId = await deviceIdProvider();
      final depth = await queueDepthProvider?.call();
      final res = await webhookClient.postHeartbeat(
        deviceId: deviceId,
        appVersion: appVersion,
        queueDepth: depth,
      );
      // 'unconfigured' means the operator hasn't pasted a URL/secret yet.
      // Don't start the throttle clock on that — the moment they do configure
      // it, the next tick should ping instead of waiting out the interval.
      if (res.errorTag != 'unconfigured') _lastSentAt = now;
      developer.log(
        'heartbeat -> ${res.statusCode ?? res.errorTag} depth=${depth ?? "?"}',
        name: 'heartbeat',
      );
    } catch (e) {
      // Never let telemetry break a dispatch tick.
      developer.log('heartbeat failed: $e', name: 'heartbeat');
    } finally {
      _inFlight = false;
    }
  }
}
