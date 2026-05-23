// Sqflite-backed database for the single `processed_sms` table.
// Schema lives in spec/05-storage-schema.md.

import 'dart:async';

import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:sqflite/sqflite.dart';

class BkashDatabase {
  BkashDatabase._(this.db);
  final Database db;

  static const _filename = 'bkash_watcher.db';
  static const _schemaVersion = 1;

  static Future<BkashDatabase> open() async {
    final dir = await getApplicationDocumentsDirectory();
    final path = p.join(dir.path, _filename);
    final db = await openDatabase(
      path,
      version: _schemaVersion,
      onCreate: (db, version) async {
        await _create(db);
      },
      onUpgrade: (db, oldV, newV) async {
        // Future migrations:
        // if (oldV < 2) await db.execute('ALTER TABLE ...');
      },
    );
    return BkashDatabase._(db);
  }

  /// Open without depending on the Flutter binding — used by tests that bring
  /// up sqflite_common_ffi.
  static Future<BkashDatabase> openAtPath(String path) async {
    final db = await openDatabase(
      path,
      version: _schemaVersion,
      onCreate: (db, version) async {
        await _create(db);
      },
    );
    return BkashDatabase._(db);
  }

  static Future<void> _create(Database db) async {
    await db.execute('''
      CREATE TABLE processed_sms (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        trx_id          TEXT UNIQUE NOT NULL,
        sender_msisdn   TEXT,
        amount_taka     INTEGER NOT NULL,
        raw_body        TEXT NOT NULL,
        sms_timestamp   INTEGER NOT NULL,
        state           TEXT NOT NULL,
        next_attempt_at INTEGER,
        attempt_count   INTEGER NOT NULL DEFAULT 0,
        last_error      TEXT,
        created_at      INTEGER NOT NULL,
        updated_at      INTEGER NOT NULL
      )
    ''');
    await db.execute(
        'CREATE INDEX idx_processed_sms_state ON processed_sms(state)');
    await db.execute(
        'CREATE INDEX idx_processed_sms_next_attempt ON processed_sms(next_attempt_at)');
  }

  Future<void> close() => db.close();
}
