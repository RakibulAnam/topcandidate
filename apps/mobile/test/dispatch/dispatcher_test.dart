import 'package:flutter_test/flutter_test.dart';
import 'package:bkash_watcher/dispatch/backoff.dart';
import 'package:bkash_watcher/dispatch/dispatcher.dart';
import 'package:bkash_watcher/dispatch/state.dart';
import 'package:bkash_watcher/dispatch/webhook_client.dart';

/// Fakes — no Flutter, no I/O.

class _FakeClock implements Clock {
  _FakeClock(this._now);
  DateTime _now;
  @override
  DateTime now() => _now;
  void advance(Duration d) => _now = _now.add(d);
  void set(DateTime t) => _now = t;
}

class _FakeWebhookClient implements WebhookClient {
  WebhookResponse next = const WebhookResponse(statusCode: 200);
  WebhookResponse nextReversal = const WebhookResponse(statusCode: 200);
  WebhookResponse nextOrphan = const WebhookResponse(statusCode: 200);
  WebhookResponse nextParserFailure = const WebhookResponse(statusCode: 200);

  int callCount = 0;
  int reversalCallCount = 0;
  int orphanCallCount = 0;
  int parserFailureCallCount = 0;

  Map<String, dynamic>? lastBody;
  Map<String, dynamic>? lastReversalBody;
  Map<String, dynamic>? lastOrphanBody;
  Map<String, dynamic>? lastParserFailureBody;

  @override
  Future<WebhookResponse> post({
    required String trxId,
    required String? senderMsisdn,
    required int amountTaka,
  }) async {
    callCount += 1;
    lastBody = {
      'transactionId': trxId,
      'senderMsisdn': senderMsisdn,
      'amountTaka': amountTaka,
    };
    return next;
  }

  @override
  Future<WebhookResponse> postRaw(Map<String, dynamic> body) async {
    callCount += 1;
    lastBody = body;
    return next;
  }

  @override
  Future<WebhookResponse> postOrphan({
    required String trxId,
    required String? senderMsisdn,
    required int amountTaka,
    required String rawBody,
    required DateTime smsTimestamp,
  }) async {
    orphanCallCount += 1;
    lastOrphanBody = {
      'transactionId': trxId,
      'senderMsisdn': senderMsisdn,
      'amountTaka': amountTaka,
      'rawBody': rawBody,
      'smsTimestamp': smsTimestamp.toUtc().toIso8601String(),
    };
    return nextOrphan;
  }

  @override
  Future<WebhookResponse> postReversal({
    required String trxId,
    String? reason,
  }) async {
    reversalCallCount += 1;
    lastReversalBody = {
      'transactionId': trxId,
      'reason': ?reason,
    };
    return nextReversal;
  }

  @override
  Future<WebhookResponse> postParserFailure({
    required String rawBody,
    String? senderMsisdn,
    DateTime? smsTimestamp,
    String? reason,
  }) async {
    parserFailureCallCount += 1;
    lastParserFailureBody = {
      'rawBody': rawBody,
      'senderMsisdn': ?senderMsisdn,
      'smsTimestamp': ?smsTimestamp?.toUtc().toIso8601String(),
      'reason': ?reason,
    };
    return nextParserFailure;
  }
}

class _FakeNotifier implements DispatcherNotifier {
  final notifications = <NotificationSpec>[];
  @override
  Future<void> show(NotificationSpec spec) async {
    notifications.add(spec);
  }
}

/// In-memory DAO that implements just enough of the API to exercise the
/// dispatcher. Real DAO lives in lib/storage/.
class _InMemoryDao implements DispatcherDao {
  _InMemoryDao();
  final rows = <int, ProcessedSms>{};
  int _nextId = 1;

  ProcessedSms insert({
    required String trxId,
    String? senderMsisdn,
    int amountTaka = 100,
    DateTime? createdAt,
    int attemptCount = 0,
    ProcessedSmsState state = ProcessedSmsState.queued,
  }) {
    final id = _nextId++;
    final t = createdAt ?? DateTime(2026, 5, 16, 12, 0, 0);
    final row = ProcessedSms(
      id: id,
      trxId: trxId,
      senderMsisdn: senderMsisdn,
      amountTaka: amountTaka,
      rawBody: 'fake body',
      smsTimestamp: t,
      state: state,
      nextAttemptAt: null,
      attemptCount: attemptCount,
      lastError: null,
      createdAt: t,
      updatedAt: t,
    );
    rows[id] = row;
    return row;
  }

  @override
  Future<List<ProcessedSms>> dueRows({
    required DateTime now,
    int limit = 50,
  }) async {
    return rows.values
        .where((r) =>
            (r.state == ProcessedSmsState.queued ||
                r.state == ProcessedSmsState.retrying ||
                r.state == ProcessedSmsState.waitingUser ||
                r.state == ProcessedSmsState.reversing) &&
            (r.nextAttemptAt == null || !r.nextAttemptAt!.isAfter(now)))
        .take(limit)
        .toList();
  }

  @override
  Future<void> reclaimStuckSending(DateTime now) async {
    for (final entry in rows.entries.toList()) {
      final r = entry.value;
      if (r.state == ProcessedSmsState.sending &&
          now.difference(r.updatedAt) > const Duration(seconds: 60)) {
        rows[entry.key] = _copy(r, state: ProcessedSmsState.retrying, nextAttemptAt: now);
      }
    }
  }

  @override
  Future<void> markSending(int id, DateTime now) async {
    rows[id] = _copy(rows[id]!, state: ProcessedSmsState.sending, updatedAt: now);
  }

  @override
  Future<void> applyTransition({
    required int id,
    required DispatchTransition transition,
    required DateTime now,
  }) async {
    final old = rows[id]!;
    rows[id] = _copy(
      old,
      state: transition.nextState,
      nextAttemptAt: transition.nextAttemptAt,
      attemptCount:
          transition.incrementAttempts ? old.attemptCount + 1 : old.attemptCount,
      lastError: transition.lastError,
      updatedAt: now,
    );
  }

  ProcessedSms _copy(
    ProcessedSms r, {
    ProcessedSmsState? state,
    DateTime? nextAttemptAt,
    int? attemptCount,
    String? lastError,
    DateTime? updatedAt,
  }) {
    return ProcessedSms(
      id: r.id,
      trxId: r.trxId,
      senderMsisdn: r.senderMsisdn,
      amountTaka: r.amountTaka,
      rawBody: r.rawBody,
      smsTimestamp: r.smsTimestamp,
      state: state ?? r.state,
      nextAttemptAt: nextAttemptAt,
      attemptCount: attemptCount ?? r.attemptCount,
      lastError: lastError,
      createdAt: r.createdAt,
      updatedAt: updatedAt ?? r.updatedAt,
    );
  }
}

void main() {
  group('Dispatcher.applyResponse — pure transitions', () {
    final base = ProcessedSms(
      id: 1,
      trxId: 'TRX0000001',
      senderMsisdn: '01711234567',
      amountTaka: 200,
      rawBody: '...',
      smsTimestamp: DateTime(2026, 5, 16, 12, 0, 0),
      state: ProcessedSmsState.queued,
      nextAttemptAt: null,
      attemptCount: 0,
      lastError: null,
      createdAt: DateTime(2026, 5, 16, 12, 0, 0),
      updatedAt: DateTime(2026, 5, 16, 12, 0, 0),
    );
    final now = DateTime(2026, 5, 16, 12, 1, 0);

    test('200 → done + notify', () {
      final t = Dispatcher.applyResponse(
        base,
        const WebhookResponse(statusCode: 200),
        now: now,
      );
      expect(t.nextState, ProcessedSmsState.done);
      expect(t.nextAttemptAt, isNull);
      expect(t.notify, isNotNull);
    });

    test('200 with alreadyConfirmed=true → done, notification suppressed', () {
      final t = Dispatcher.applyResponse(
        base,
        const WebhookResponse(
          statusCode: 200,
          body:
              '{"success":true,"alreadyConfirmed":true,"userId":"u1","creditsGranted":5}',
        ),
        now: now,
      );
      expect(t.nextState, ProcessedSmsState.done);
      expect(t.notify, isNull);
    });

    test('200 with malformed body → done, notification still fires', () {
      final t = Dispatcher.applyResponse(
        base,
        const WebhookResponse(statusCode: 200, body: 'not-json'),
        now: now,
      );
      expect(t.nextState, ProcessedSmsState.done);
      expect(t.notify, isNotNull);
    });

    test('400 → failed', () {
      final t = Dispatcher.applyResponse(
        base,
        const WebhookResponse(statusCode: 400, body: 'bad body'),
        now: now,
      );
      expect(t.nextState, ProcessedSmsState.failed);
      expect(t.lastError, contains('400'));
    });

    test('401 → failed + auth notification', () {
      final t = Dispatcher.applyResponse(
        base,
        const WebhookResponse(statusCode: 401),
        now: now,
      );
      expect(t.nextState, ProcessedSmsState.failed);
      expect(t.notify?.title, contains('auth failed'));
    });

    test('404 first time → waiting_user, +5 min', () {
      final t = Dispatcher.applyResponse(
        base,
        const WebhookResponse(statusCode: 404),
        now: now,
      );
      expect(t.nextState, ProcessedSmsState.waitingUser);
      expect(t.nextAttemptAt, now.add(kWaitingUserDelay));
    });

    test('404 after 288 attempts → failed (give up)', () {
      final exhausted = ProcessedSms(
        id: base.id,
        trxId: base.trxId,
        senderMsisdn: base.senderMsisdn,
        amountTaka: base.amountTaka,
        rawBody: base.rawBody,
        smsTimestamp: base.smsTimestamp,
        state: ProcessedSmsState.waitingUser,
        nextAttemptAt: null,
        attemptCount: kWaitingUserMaxAttempts - 1, // newAttempt will hit max
        lastError: null,
        createdAt: base.createdAt,
        updatedAt: base.updatedAt,
      );
      final t = Dispatcher.applyResponse(
        exhausted,
        const WebhookResponse(statusCode: 404),
        now: now,
      );
      expect(t.nextState, ProcessedSmsState.failed);
      expect(t.notify, isNotNull);
    });

    test('409 → mismatch', () {
      final t = Dispatcher.applyResponse(
        base,
        const WebhookResponse(statusCode: 409),
        now: now,
      );
      expect(t.nextState, ProcessedSmsState.mismatch);
      expect(t.notify, isNotNull);
    });

    test('409 with code=msisdn_mismatch → existing sender-mismatch notification',
        () {
      final t = Dispatcher.applyResponse(
        base,
        const WebhookResponse(
          statusCode: 409,
          body: '{"code":"msisdn_mismatch"}',
        ),
        now: now,
      );
      expect(t.nextState, ProcessedSmsState.mismatch);
      expect(t.notify?.title, 'Sender mismatch');
      expect(t.lastError, contains('msisdn'));
    });

    test('409 with code=underpaid → underpaid notification', () {
      final t = Dispatcher.applyResponse(
        base,
        const WebhookResponse(
          statusCode: 409,
          body: '{"code":"underpaid","expected":200,"observed":50}',
        ),
        now: now,
      );
      expect(t.nextState, ProcessedSmsState.mismatch);
      expect(t.notify?.title, 'Underpayment');
      expect(t.notify?.body, contains('admin panel'));
      expect(t.lastError, contains('underpaid'));
    });

    test('503 → failed', () {
      final t = Dispatcher.applyResponse(
        base,
        const WebhookResponse(statusCode: 503),
        now: now,
      );
      expect(t.nextState, ProcessedSmsState.failed);
    });

    test('500 → retrying with 5s backoff (first retry)', () {
      final t = Dispatcher.applyResponse(
        base,
        const WebhookResponse(statusCode: 500),
        now: now,
      );
      expect(t.nextState, ProcessedSmsState.retrying);
      expect(t.nextAttemptAt, now.add(const Duration(seconds: 5)));
      expect(t.incrementAttempts, isTrue);
    });

    test('network error → retrying', () {
      final t = Dispatcher.applyResponse(
        base,
        const WebhookResponse(statusCode: null, errorTag: 'timeout'),
        now: now,
      );
      expect(t.nextState, ProcessedSmsState.retrying);
      expect(t.lastError, contains('timeout'));
    });

    test('5xx past 24h → failed (give up)', () {
      final old = ProcessedSms(
        id: 2,
        trxId: 'TRX0000002',
        senderMsisdn: null,
        amountTaka: 200,
        rawBody: '...',
        smsTimestamp: DateTime(2026, 5, 15, 11, 0, 0),
        state: ProcessedSmsState.retrying,
        nextAttemptAt: null,
        attemptCount: 30,
        lastError: null,
        createdAt: DateTime(2026, 5, 15, 11, 0, 0),
        updatedAt: DateTime(2026, 5, 16, 11, 0, 0),
      );
      final t = Dispatcher.applyResponse(
        old,
        const WebhookResponse(statusCode: 500),
        now: DateTime(2026, 5, 16, 12, 0, 0),
      );
      expect(t.nextState, ProcessedSmsState.failed);
    });
  });

  group('Dispatcher.tick — full pipeline with fake DAO', () {
    test('200 path: row becomes done', () async {
      final dao = _InMemoryDao();
      final client = _FakeWebhookClient();
      final notifier = _FakeNotifier();
      final clock = _FakeClock(DateTime(2026, 5, 16, 12, 0, 1));
      dao.insert(trxId: 'HAPPY00001', senderMsisdn: '01711111111');
      final dispatcher = Dispatcher(
        dao: dao,
        webhookClient: client,
        notifier: notifier,
        clock: clock,
      );
      final processed = await dispatcher.tick();
      expect(processed, 1);
      expect(client.callCount, 1);
      expect(dao.rows[1]!.state, ProcessedSmsState.done);
      expect(notifier.notifications, hasLength(1));
    });

    test('404 path: row becomes waiting_user with future nextAttemptAt',
        () async {
      final dao = _InMemoryDao();
      final client = _FakeWebhookClient()
        ..next = const WebhookResponse(statusCode: 404);
      final notifier = _FakeNotifier();
      final clock = _FakeClock(DateTime(2026, 5, 16, 12, 0, 1));
      dao.insert(trxId: 'WAIT000001');
      final dispatcher = Dispatcher(
        dao: dao,
        webhookClient: client,
        notifier: notifier,
        clock: clock,
      );
      await dispatcher.tick();
      expect(dao.rows[1]!.state, ProcessedSmsState.waitingUser);
      expect(dao.rows[1]!.nextAttemptAt,
          clock.now().add(kWaitingUserDelay));
    });

    test('5xx then 200: row eventually becomes done', () async {
      final dao = _InMemoryDao();
      final client = _FakeWebhookClient()
        ..next = const WebhookResponse(statusCode: 500);
      final notifier = _FakeNotifier();
      final clock = _FakeClock(DateTime(2026, 5, 16, 12, 0, 1));
      dao.insert(trxId: 'RETRY00001');
      final dispatcher = Dispatcher(
        dao: dao,
        webhookClient: client,
        notifier: notifier,
        clock: clock,
      );

      await dispatcher.tick();
      expect(dao.rows[1]!.state, ProcessedSmsState.retrying);
      expect(dao.rows[1]!.attemptCount, 1);

      // Advance past nextAttemptAt and flip to 200.
      clock.advance(const Duration(seconds: 10));
      client.next = const WebhookResponse(statusCode: 200);
      await dispatcher.tick();
      expect(dao.rows[1]!.state, ProcessedSmsState.done);
    });

    test('tick is idempotent under concurrent calls', () async {
      final dao = _InMemoryDao();
      final client = _FakeWebhookClient();
      final notifier = _FakeNotifier();
      final clock = _FakeClock(DateTime(2026, 5, 16, 12, 0, 1));
      dao.insert(trxId: 'CONCUR0001');
      final dispatcher = Dispatcher(
        dao: dao,
        webhookClient: client,
        notifier: notifier,
        clock: clock,
      );

      final results = await Future.wait([dispatcher.tick(), dispatcher.tick()]);
      // One tick does the work; the second sees no due rows because the first
      // either claimed it or already finished.
      expect(results.reduce((a, b) => a + b), 1);
      expect(dao.rows[1]!.state, ProcessedSmsState.done);
    });

    test('orphan dump fires when waiting_user gives up at attempt 288',
        () async {
      final dao = _InMemoryDao();
      final client = _FakeWebhookClient()
        ..next = const WebhookResponse(statusCode: 404);
      final notifier = _FakeNotifier();
      final clock = _FakeClock(DateTime(2026, 5, 17, 12, 0, 1));
      dao.insert(
        trxId: 'ORPHAN0001',
        senderMsisdn: '01711111111',
        amountTaka: 200,
        createdAt: DateTime(2026, 5, 16, 12, 0, 0),
        attemptCount: kWaitingUserMaxAttempts - 1,
        state: ProcessedSmsState.waitingUser,
      );
      final dispatcher = Dispatcher(
        dao: dao,
        webhookClient: client,
        notifier: notifier,
        clock: clock,
      );
      await dispatcher.tick();
      expect(dao.rows[1]!.state, ProcessedSmsState.failed);
      expect(client.orphanCallCount, 1);
      expect(client.lastOrphanBody!['transactionId'], 'ORPHAN0001');
      expect(client.lastOrphanBody!['amountTaka'], 200);
    });

    test('orphan dump does NOT fire on transient 404 (not at give-up yet)',
        () async {
      final dao = _InMemoryDao();
      final client = _FakeWebhookClient()
        ..next = const WebhookResponse(statusCode: 404);
      final notifier = _FakeNotifier();
      final clock = _FakeClock(DateTime(2026, 5, 16, 12, 0, 1));
      dao.insert(trxId: 'TRANSIENT1');
      final dispatcher = Dispatcher(
        dao: dao,
        webhookClient: client,
        notifier: notifier,
        clock: clock,
      );
      await dispatcher.tick();
      expect(dao.rows[1]!.state, ProcessedSmsState.waitingUser);
      expect(client.orphanCallCount, 0);
    });

    test('reversal row → 200 → ignoredRefund + notify', () async {
      final dao = _InMemoryDao();
      final client = _FakeWebhookClient()
        ..nextReversal = const WebhookResponse(statusCode: 200);
      final notifier = _FakeNotifier();
      final clock = _FakeClock(DateTime(2026, 5, 16, 12, 0, 1));
      dao.insert(
        trxId: 'REVERSAL01',
        state: ProcessedSmsState.reversing,
      );
      final dispatcher = Dispatcher(
        dao: dao,
        webhookClient: client,
        notifier: notifier,
        clock: clock,
      );
      await dispatcher.tick();
      expect(client.reversalCallCount, 1);
      expect(client.callCount, 0, reason: 'must not hit confirm-purchase');
      expect(dao.rows[1]!.state, ProcessedSmsState.ignoredRefund);
      expect(notifier.notifications, hasLength(1));
      expect(notifier.notifications.first.title, 'Refund recorded');
    });

    test('reversal row → 404 → ignoredRefund silently', () async {
      final dao = _InMemoryDao();
      final client = _FakeWebhookClient()
        ..nextReversal = const WebhookResponse(statusCode: 404);
      final notifier = _FakeNotifier();
      final clock = _FakeClock(DateTime(2026, 5, 16, 12, 0, 1));
      dao.insert(
        trxId: 'REVERSAL02',
        state: ProcessedSmsState.reversing,
      );
      final dispatcher = Dispatcher(
        dao: dao,
        webhookClient: client,
        notifier: notifier,
        clock: clock,
      );
      await dispatcher.tick();
      expect(dao.rows[1]!.state, ProcessedSmsState.ignoredRefund);
      // 404 on a reversal is the common case (stray reversal SMS that never
      // matched a purchase) — no operator notification.
      expect(notifier.notifications, isEmpty);
    });

    test('reversal row → 500 → stays in reversing with backoff', () async {
      final dao = _InMemoryDao();
      final client = _FakeWebhookClient()
        ..nextReversal = const WebhookResponse(statusCode: 500);
      final notifier = _FakeNotifier();
      final clock = _FakeClock(DateTime(2026, 5, 16, 12, 0, 1));
      dao.insert(
        trxId: 'REVERSAL03',
        state: ProcessedSmsState.reversing,
      );
      final dispatcher = Dispatcher(
        dao: dao,
        webhookClient: client,
        notifier: notifier,
        clock: clock,
      );
      await dispatcher.tick();
      expect(dao.rows[1]!.state, ProcessedSmsState.reversing);
      expect(dao.rows[1]!.attemptCount, 1);
      expect(dao.rows[1]!.nextAttemptAt, isNotNull);
    });
  });
}
