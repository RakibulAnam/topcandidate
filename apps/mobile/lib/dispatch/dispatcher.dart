// Dispatcher state machine. Pulls due rows, POSTs them, applies transitions.
// See spec/04-state-machine.md — this file is the implementation of that spec.

import 'dart:async';
import 'dart:convert';
import 'dart:developer' as developer;

import 'backoff.dart';
import 'state.dart';
import 'webhook_client.dart';

/// Source of monotonic-ish wall-clock time. Tests inject a [FakeClock].
abstract class Clock {
  DateTime now();
}

class SystemClock implements Clock {
  const SystemClock();
  @override
  DateTime now() => DateTime.now();
}

/// DAO surface the dispatcher needs. Defined here (not in storage/) so the
/// dispatcher remains testable without sqflite.
abstract class DispatcherDao {
  Future<List<ProcessedSms>> dueRows({
    required DateTime now,
    int limit = 50,
  });

  /// Reclaim rows stuck in `sending` for > 60 s. Called on dispatcher startup
  /// to recover from a process crash.
  Future<void> reclaimStuckSending(DateTime now);

  Future<void> markSending(int id, DateTime now);

  Future<void> applyTransition({
    required int id,
    required DispatchTransition transition,
    required DateTime now,
  });
}

/// Notifier surface — implemented over flutter_local_notifications.
abstract class DispatcherNotifier {
  Future<void> show(NotificationSpec spec);
}

class Dispatcher {
  Dispatcher({
    required this.dao,
    required this.webhookClient,
    required this.notifier,
    this.clock = const SystemClock(),
  });

  final DispatcherDao dao;
  final WebhookClient webhookClient;
  final DispatcherNotifier notifier;
  final Clock clock;

  Completer<void>? _inflight;

  /// Idempotent. Returns the number of rows processed.
  Future<int> tick() async {
    // Serialize. If a tick is in flight, just await it and return 0.
    if (_inflight != null) {
      developer.log('tick: already in flight, awaiting', name: 'dispatcher');
      await _inflight!.future;
      return 0;
    }
    final completer = Completer<void>();
    _inflight = completer;
    try {
      await dao.reclaimStuckSending(clock.now());
      final rows = await dao.dueRows(now: clock.now());
      developer.log(
        'tick: ${rows.length} due row(s)',
        name: 'dispatcher',
      );
      var processed = 0;
      for (final row in rows) {
        try {
          await _dispatchOne(row);
          processed += 1;
        } catch (e, st) {
          developer.log(
            'dispatch error for trxId=${row.trxId}: $e',
            name: 'dispatcher',
            error: e,
            stackTrace: st,
          );
        }
      }
      developer.log('tick: complete, processed=$processed', name: 'dispatcher');
      return processed;
    } finally {
      completer.complete();
      _inflight = null;
    }
  }

  Future<void> _dispatchOne(ProcessedSms row) async {
    developer.log(
      'dispatch id=${row.id} trxId=${row.trxId} attempt=${row.attemptCount} '
      'amount=${row.amountTaka} hasMsisdn=${row.senderMsisdn != null}',
      name: 'dispatcher',
    );
    await dao.markSending(row.id, clock.now());
    final response = await webhookClient.post(
      trxId: row.trxId,
      senderMsisdn: row.senderMsisdn,
      amountTaka: row.amountTaka,
    );
    final transition = applyResponse(row, response, now: clock.now());
    developer.log(
      'dispatch id=${row.id} → ${transition.nextState.db} '
      '(notify=${transition.notify != null})',
      name: 'dispatcher',
    );
    await dao.applyTransition(
      id: row.id,
      transition: transition,
      now: clock.now(),
    );
    if (transition.notify != null) {
      try {
        await notifier.show(transition.notify!);
      } catch (e, st) {
        developer.log(
          'notifier failed: $e',
          name: 'dispatcher',
          error: e,
          stackTrace: st,
        );
      }
    }
  }

  /// Pure transition function. The whole table from spec/04-state-machine.md
  /// is implemented here. Unit-testable without any I/O.
  static DispatchTransition applyResponse(
    ProcessedSms row,
    WebhookResponse response, {
    required DateTime now,
  }) {
    final newAttempt = row.attemptCount + 1;
    final age = now.difference(row.createdAt);
    final past24h = age > kTransientGiveUp;

    // Network error / timeout → retry path.
    if (response.isNetworkError) {
      if (past24h) {
        return DispatchTransition(
          nextState: ProcessedSmsState.failed,
          nextAttemptAt: null,
          incrementAttempts: true,
          lastError:
              'Gave up after 24h of transient errors (${response.errorTag ?? "network"})',
          notify: const NotificationSpec(
            title: 'bKash watcher: gave up',
            body: 'A transaction failed after 24h of network errors. Check the History tab.',
          ),
        );
      }
      return DispatchTransition(
        nextState: ProcessedSmsState.retrying,
        nextAttemptAt: now.add(transientBackoff(newAttempt)),
        incrementAttempts: true,
        lastError: 'network: ${response.errorTag ?? "unknown"}',
      );
    }

    final code = response.statusCode!;

    if (code == 200) {
      // The server returns 200 in two situations:
      //   1. Fresh confirmation — fire the "Credits granted" notification.
      //   2. Replay of an already-confirmed row — body has
      //      `"alreadyConfirmed": true`. Suppress the notification so the
      //      operator isn't told a fresh grant happened when it didn't.
      // Either way the row is terminal `done`.
      final alreadyConfirmed = _isAlreadyConfirmed(response.body);
      return DispatchTransition(
        nextState: ProcessedSmsState.done,
        nextAttemptAt: null,
        incrementAttempts: true,
        lastError: null,
        notify: alreadyConfirmed
            ? null
            : const NotificationSpec(
                title: 'Credits granted',
                body:
                    'A bKash payment was confirmed and credits delivered.',
              ),
      );
    }

    if (code == 400) {
      return DispatchTransition(
        nextState: ProcessedSmsState.failed,
        nextAttemptAt: null,
        incrementAttempts: true,
        lastError: 'HTTP 400: ${_snippet(response.body)}',
        notify: const NotificationSpec(
          title: 'Webhook rejected body',
          body: 'The server returned 400. Open the History tab for details.',
        ),
      );
    }

    if (code == 401) {
      return DispatchTransition(
        nextState: ProcessedSmsState.failed,
        nextAttemptAt: null,
        incrementAttempts: true,
        lastError: 'HTTP 401: signature mismatch',
        notify: const NotificationSpec(
          title: 'Webhook auth failed',
          body: 'HMAC secret is wrong. Open Settings to fix it.',
        ),
      );
    }

    if (code == 404) {
      if (newAttempt >= kWaitingUserMaxAttempts || past24h) {
        return DispatchTransition(
          nextState: ProcessedSmsState.failed,
          nextAttemptAt: null,
          incrementAttempts: true,
          lastError: 'Customer never submitted TrxID within 24h',
          notify: const NotificationSpec(
            title: 'Unclaimed payment',
            body: 'A payment was never matched to a customer. Manual review needed.',
          ),
        );
      }
      return DispatchTransition(
        nextState: ProcessedSmsState.waitingUser,
        nextAttemptAt: now.add(kWaitingUserDelay),
        incrementAttempts: true,
        lastError: 'HTTP 404: no pending purchase yet',
      );
    }

    if (code == 409) {
      return DispatchTransition(
        nextState: ProcessedSmsState.mismatch,
        nextAttemptAt: null,
        incrementAttempts: true,
        lastError: 'HTTP 409: sender msisdn mismatch',
        notify: const NotificationSpec(
          title: 'Sender mismatch',
          body: 'Customer claimed a different phone number. Manual review needed.',
        ),
      );
    }

    if (code == 503) {
      return DispatchTransition(
        nextState: ProcessedSmsState.failed,
        nextAttemptAt: null,
        incrementAttempts: true,
        lastError: 'HTTP 503: server misconfigured',
        notify: const NotificationSpec(
          title: 'Server misconfigured',
          body: 'Webhook returned 503. Check the server side.',
        ),
      );
    }

    // Any other 5xx (or unexpected 3xx/4xx) → transient retry path.
    if (code >= 500 || code == 408 || code == 429) {
      if (past24h) {
        return DispatchTransition(
          nextState: ProcessedSmsState.failed,
          nextAttemptAt: null,
          incrementAttempts: true,
          lastError: 'Gave up after 24h. Last status: $code',
          notify: const NotificationSpec(
            title: 'bKash watcher: gave up',
            body: 'Transient errors did not resolve in 24h. Check the History tab.',
          ),
        );
      }
      return DispatchTransition(
        nextState: ProcessedSmsState.retrying,
        nextAttemptAt: now.add(transientBackoff(newAttempt)),
        incrementAttempts: true,
        lastError: 'HTTP $code: ${_snippet(response.body)}',
      );
    }

    // Unexpected 2xx/3xx/4xx — treat as terminal failure.
    return DispatchTransition(
      nextState: ProcessedSmsState.failed,
      nextAttemptAt: null,
      incrementAttempts: true,
      lastError: 'Unexpected HTTP $code: ${_snippet(response.body)}',
      notify: const NotificationSpec(
        title: 'Unexpected webhook response',
        body: 'Open the History tab for details.',
      ),
    );
  }

  static bool _isAlreadyConfirmed(String? body) {
    if (body == null || body.isEmpty) return false;
    try {
      final decoded = jsonDecode(body);
      return decoded is Map && decoded['alreadyConfirmed'] == true;
    } catch (_) {
      return false;
    }
  }

  static String _snippet(String? body) {
    if (body == null) return '';
    final trimmed = body.trim();
    if (trimmed.length <= 120) return trimmed;
    return '${trimmed.substring(0, 120)}…';
  }
}
