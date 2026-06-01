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
    final isReversal = row.state == ProcessedSmsState.reversing;
    developer.log(
      'dispatch id=${row.id} trxId=${row.trxId} attempt=${row.attemptCount} '
      'amount=${row.amountTaka} hasMsisdn=${row.senderMsisdn != null} '
      'reversal=$isReversal',
      name: 'dispatcher',
    );
    await dao.markSending(row.id, clock.now());

    final WebhookResponse response;
    if (isReversal) {
      response = await webhookClient.postReversal(trxId: row.trxId);
    } else {
      response = await webhookClient.post(
        trxId: row.trxId,
        senderMsisdn: row.senderMsisdn,
        amountTaka: row.amountTaka,
      );
    }

    final transition = isReversal
        ? applyReversalResponse(row, response, now: clock.now())
        : applyResponse(row, response, now: clock.now());

    // Side-effect: when a confirm-purchase row gives up after 24h of 404s,
    // dump the SMS to the server's orphan-inbound-sms endpoint so the operator
    // can reconcile it. Best-effort, single attempt — the state transition
    // commits regardless.
    if (!isReversal && _isOrphanGiveUp(row, response)) {
      await _dumpOrphan(row);
    }

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

  /// True iff `applyResponse` will turn this row into terminal `failed` because
  /// 404 retries are exhausted. Mirrors the give-up logic inside
  /// `applyResponse` — kept as a separate predicate so `_dispatchOne` can fire
  /// the orphan POST before the transition is persisted.
  bool _isOrphanGiveUp(ProcessedSms row, WebhookResponse response) {
    if (response.statusCode != 404) return false;
    final newAttempt = row.attemptCount + 1;
    final past24h = clock.now().difference(row.createdAt) > kTransientGiveUp;
    return newAttempt >= kWaitingUserMaxAttempts || past24h;
  }

  Future<void> _dumpOrphan(ProcessedSms row) async {
    try {
      final r = await webhookClient.postOrphan(
        trxId: row.trxId,
        senderMsisdn: row.senderMsisdn,
        amountTaka: row.amountTaka,
        rawBody: row.rawBody,
        smsTimestamp: row.smsTimestamp,
      );
      developer.log(
        'orphan dump id=${row.id} → status=${r.statusCode} '
        'err=${r.errorTag ?? "none"}',
        name: 'dispatcher',
      );
    } catch (e, st) {
      developer.log(
        'orphan dump failed for id=${row.id}: $e',
        name: 'dispatcher',
        error: e,
        stackTrace: st,
      );
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
        nextAttemptAt: now.add(waitingUserBackoff(newAttempt)),
        incrementAttempts: true,
        lastError: 'HTTP 404: no pending purchase yet',
      );
    }

    if (code == 409) {
      // Migration 007: the server now distinguishes two 409 cases by `code` in
      // the JSON body. `msisdn_mismatch` is the pre-existing case;
      // `underpaid` was added when the server started rejecting SMS amounts
      // less than the pending row's expected amount.
      final responseCode = _bodyCode(response.body);
      if (responseCode == 'underpaid') {
        return DispatchTransition(
          nextState: ProcessedSmsState.mismatch,
          nextAttemptAt: null,
          incrementAttempts: true,
          lastError: 'HTTP 409: underpaid',
          notify: const NotificationSpec(
            title: 'Underpayment',
            body:
                'Customer sent less than required — open admin panel to recover.',
          ),
        );
      }
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

  /// Pure transition function for `/api/reverse-purchase`. A reversing row
  /// terminates as `ignoredRefund` (server had no matching completed row, or
  /// successfully recorded the reversal). Transient failures retry with the
  /// same backoff as confirm-purchase. Persistent failures (400/401/503) drop
  /// to `ignoredRefund` after notifying — the operator can replay manually
  /// from the admin panel; a stuck reversal must not block other dispatches.
  static DispatchTransition applyReversalResponse(
    ProcessedSms row,
    WebhookResponse response, {
    required DateTime now,
  }) {
    final newAttempt = row.attemptCount + 1;
    final age = now.difference(row.createdAt);
    final past24h = age > kTransientGiveUp;

    if (response.isNetworkError) {
      if (past24h) {
        return const DispatchTransition(
          nextState: ProcessedSmsState.ignoredRefund,
          nextAttemptAt: null,
          incrementAttempts: true,
          lastError: 'Reversal: gave up after 24h of network errors',
          notify: NotificationSpec(
            title: 'Reversal dispatch failed',
            body:
                'A bKash reversal could not reach the server in 24h. Open the admin panel.',
          ),
        );
      }
      return DispatchTransition(
        nextState: ProcessedSmsState.reversing,
        nextAttemptAt: now.add(transientBackoff(newAttempt)),
        incrementAttempts: true,
        lastError: 'reversal network: ${response.errorTag ?? "unknown"}',
      );
    }

    final code = response.statusCode!;

    if (code == 200) {
      return const DispatchTransition(
        nextState: ProcessedSmsState.ignoredRefund,
        nextAttemptAt: null,
        incrementAttempts: true,
        lastError: null,
        notify: NotificationSpec(
          title: 'Refund recorded',
          body: 'A bKash reversal was applied — credits were rolled back.',
        ),
      );
    }

    if (code == 404) {
      // Server says no matching completed row. Fine — the operator will pick
      // it up via the admin panel. Terminal, no notification (this is the
      // common case for stray reversal SMS that never matched a purchase).
      return const DispatchTransition(
        nextState: ProcessedSmsState.ignoredRefund,
        nextAttemptAt: null,
        incrementAttempts: true,
        lastError: 'Reversal: no matching completed purchase',
      );
    }

    if (code == 400 || code == 401 || code == 503) {
      return DispatchTransition(
        nextState: ProcessedSmsState.ignoredRefund,
        nextAttemptAt: null,
        incrementAttempts: true,
        lastError: 'Reversal HTTP $code: ${_snippet(response.body)}',
        notify: NotificationSpec(
          title: 'Reversal dispatch failed',
          body: code == 401
              ? 'HMAC secret rejected on reversal. Open Settings.'
              : 'Reversal POST returned $code. Open the admin panel.',
        ),
      );
    }

    if (code >= 500 || code == 408 || code == 429) {
      if (past24h) {
        return DispatchTransition(
          nextState: ProcessedSmsState.ignoredRefund,
          nextAttemptAt: null,
          incrementAttempts: true,
          lastError: 'Reversal: gave up after 24h. Last status: $code',
          notify: const NotificationSpec(
            title: 'Reversal dispatch failed',
            body:
                'A bKash reversal did not succeed in 24h. Open the admin panel.',
          ),
        );
      }
      return DispatchTransition(
        nextState: ProcessedSmsState.reversing,
        nextAttemptAt: now.add(transientBackoff(newAttempt)),
        incrementAttempts: true,
        lastError: 'Reversal HTTP $code: ${_snippet(response.body)}',
      );
    }

    return DispatchTransition(
      nextState: ProcessedSmsState.ignoredRefund,
      nextAttemptAt: null,
      incrementAttempts: true,
      lastError: 'Reversal unexpected HTTP $code: ${_snippet(response.body)}',
      notify: const NotificationSpec(
        title: 'Reversal dispatch failed',
        body: 'Unexpected response while reporting a reversal.',
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

  /// Returns the `code` field from a JSON response body, or null if the body
  /// is empty / unparseable / lacks `code`.
  static String? _bodyCode(String? body) {
    if (body == null || body.isEmpty) return null;
    try {
      final decoded = jsonDecode(body);
      if (decoded is Map && decoded['code'] is String) {
        return decoded['code'] as String;
      }
    } catch (_) {}
    return null;
  }

  static String _snippet(String? body) {
    if (body == null) return '';
    final trimmed = body.trim();
    if (trimmed.length <= 120) return trimmed;
    return '${trimmed.substring(0, 120)}…';
  }
}
