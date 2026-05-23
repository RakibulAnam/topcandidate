// Concrete sqflite-backed DAO. Implements DispatcherDao + extra UI queries.

import 'package:sqflite/sqflite.dart';

import '../dispatch/dispatcher.dart' show DispatcherDao;
import '../dispatch/state.dart';
import '../sms/bkash_parser.dart';
import '../sms/sms_kind.dart';
import 'database.dart';

class ProcessedSmsDao implements DispatcherDao {
  ProcessedSmsDao(this._db);
  final BkashDatabase _db;

  Database get _raw => _db.db;

  /// Insert a parsed SMS at the appropriate state for its [BkashSmsKind].
  /// Returns the inserted id, or `null` if the row already existed (dedupe
  /// on `trx_id`).
  Future<int?> insertParsed({
    required ParsedBkashSms parsed,
    required DateTime smsTimestamp,
    required DateTime now,
  }) async {
    final state = switch (parsed.kind) {
      BkashSmsKind.received => ProcessedSmsState.queued,
      BkashSmsKind.refund => ProcessedSmsState.ignoredRefund,
      BkashSmsKind.sent => ProcessedSmsState.ignoredSent,
      BkashSmsKind.ibankingDeposit => ProcessedSmsState.ignoredIbanking,
      BkashSmsKind.unknown => ProcessedSmsState.failed,
    };
    final id = await _raw.insert(
      'processed_sms',
      {
        'trx_id': parsed.trxId,
        'sender_msisdn': parsed.senderMsisdn,
        'amount_taka': parsed.amountTaka,
        'raw_body': parsed.rawBody,
        'sms_timestamp': smsTimestamp.millisecondsSinceEpoch,
        'state': state.db,
        'next_attempt_at': null,
        'attempt_count': 0,
        'last_error': parsed.kind == BkashSmsKind.unknown
            ? 'Unrecognized bKash SMS body'
            : null,
        'created_at': now.millisecondsSinceEpoch,
        'updated_at': now.millisecondsSinceEpoch,
      },
      conflictAlgorithm: ConflictAlgorithm.ignore,
    );
    return id == 0 ? null : id;
  }

  @override
  Future<List<ProcessedSms>> dueRows({
    required DateTime now,
    int limit = 50,
  }) async {
    final rows = await _raw.query(
      'processed_sms',
      where:
          "state IN ('queued','retrying','waiting_user') "
          "AND (next_attempt_at IS NULL OR next_attempt_at <= ?)",
      whereArgs: [now.millisecondsSinceEpoch],
      orderBy: 'id ASC',
      limit: limit,
    );
    return rows.map(_fromRow).toList();
  }

  @override
  Future<void> reclaimStuckSending(DateTime now) async {
    final cutoff = now.subtract(const Duration(seconds: 60)).millisecondsSinceEpoch;
    await _raw.update(
      'processed_sms',
      {
        'state': ProcessedSmsState.retrying.db,
        'next_attempt_at': now.millisecondsSinceEpoch,
        'updated_at': now.millisecondsSinceEpoch,
      },
      where: "state = 'sending' AND updated_at < ?",
      whereArgs: [cutoff],
    );
  }

  @override
  Future<void> markSending(int id, DateTime now) async {
    await _raw.update(
      'processed_sms',
      {
        'state': ProcessedSmsState.sending.db,
        'updated_at': now.millisecondsSinceEpoch,
      },
      where: 'id = ?',
      whereArgs: [id],
    );
  }

  @override
  Future<void> applyTransition({
    required int id,
    required DispatchTransition transition,
    required DateTime now,
  }) async {
    final values = <String, Object?>{
      'state': transition.nextState.db,
      'next_attempt_at': transition.nextAttemptAt?.millisecondsSinceEpoch,
      'last_error': transition.lastError,
      'updated_at': now.millisecondsSinceEpoch,
    };
    if (transition.incrementAttempts) {
      // Single UPDATE that increments attempt_count atomically.
      await _raw.rawUpdate(
        '''
        UPDATE processed_sms
        SET state = ?, next_attempt_at = ?, last_error = ?,
            updated_at = ?, attempt_count = attempt_count + 1
        WHERE id = ?
        ''',
        [
          values['state'],
          values['next_attempt_at'],
          values['last_error'],
          values['updated_at'],
          id,
        ],
      );
    } else {
      await _raw.update(
        'processed_sms',
        values,
        where: 'id = ?',
        whereArgs: [id],
      );
    }
  }

  // ---------------------------------------------------------------------------
  // UI queries
  // ---------------------------------------------------------------------------

  Future<List<ProcessedSms>> latest({int limit = 10}) async {
    final rows = await _raw.query(
      'processed_sms',
      orderBy: 'id DESC',
      limit: limit,
    );
    return rows.map(_fromRow).toList();
  }

  Future<List<ProcessedSms>> page({
    ProcessedSmsState? state,
    int limit = 50,
    int offset = 0,
  }) async {
    final rows = await _raw.query(
      'processed_sms',
      where: state == null ? null : 'state = ?',
      whereArgs: state == null ? null : [state.db],
      orderBy: 'id DESC',
      limit: limit,
      offset: offset,
    );
    return rows.map(_fromRow).toList();
  }

  Future<ProcessedSms?> byId(int id) async {
    final rows = await _raw.query(
      'processed_sms',
      where: 'id = ?',
      whereArgs: [id],
      limit: 1,
    );
    if (rows.isEmpty) return null;
    return _fromRow(rows.first);
  }

  Future<DateTime?> lastSuccessfulConfirmAt() async {
    final rows = await _raw.query(
      'processed_sms',
      columns: ['updated_at'],
      where: "state = 'done'",
      orderBy: 'updated_at DESC',
      limit: 1,
    );
    if (rows.isEmpty) return null;
    return DateTime.fromMillisecondsSinceEpoch(rows.first['updated_at'] as int);
  }

  Future<DateTime?> lastSmsSeenAt() async {
    final rows = await _raw.query(
      'processed_sms',
      columns: ['sms_timestamp'],
      orderBy: 'sms_timestamp DESC',
      limit: 1,
    );
    if (rows.isEmpty) return null;
    return DateTime.fromMillisecondsSinceEpoch(
        rows.first['sms_timestamp'] as int);
  }

  /// Operator-initiated retry — see spec/04-state-machine.md.
  Future<void> retryNow(int id, DateTime now) async {
    await _raw.update(
      'processed_sms',
      {
        'state': ProcessedSmsState.queued.db,
        'next_attempt_at': null,
        'last_error': null,
        'updated_at': now.millisecondsSinceEpoch,
      },
      where: 'id = ?',
      whereArgs: [id],
    );
  }

  /// Force a row into [ProcessedSmsState.failed] with a "manually ignored"
  /// marker.
  Future<void> markIgnored(int id, DateTime now) async {
    await _raw.update(
      'processed_sms',
      {
        'state': ProcessedSmsState.failed.db,
        'next_attempt_at': null,
        'last_error': 'manually ignored',
        'updated_at': now.millisecondsSinceEpoch,
      },
      where: 'id = ?',
      whereArgs: [id],
    );
  }

  ProcessedSms _fromRow(Map<String, Object?> r) {
    return ProcessedSms(
      id: r['id'] as int,
      trxId: r['trx_id'] as String,
      senderMsisdn: r['sender_msisdn'] as String?,
      amountTaka: r['amount_taka'] as int,
      rawBody: r['raw_body'] as String,
      smsTimestamp:
          DateTime.fromMillisecondsSinceEpoch(r['sms_timestamp'] as int),
      state: ProcessedSmsState.fromDb(r['state'] as String),
      nextAttemptAt: r['next_attempt_at'] == null
          ? null
          : DateTime.fromMillisecondsSinceEpoch(r['next_attempt_at'] as int),
      attemptCount: r['attempt_count'] as int,
      lastError: r['last_error'] as String?,
      createdAt: DateTime.fromMillisecondsSinceEpoch(r['created_at'] as int),
      updatedAt: DateTime.fromMillisecondsSinceEpoch(r['updated_at'] as int),
    );
  }
}
