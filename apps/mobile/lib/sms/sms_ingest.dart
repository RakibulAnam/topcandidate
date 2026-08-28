// Single entry point for "a bKash SMS arrived": parse → dedupe/insert →
// kick the dispatcher.
//
// Extracted so the real SMS broadcast (SmsListener) and the Settings test
// panel run the SAME pipeline. If the test panel had its own copy, a green
// test could stop meaning anything about production. Everything downstream of
// this — the parser, the state machine, the HMAC signing, the webhook — is
// identical either way; only the delivery of the raw body differs.

import 'dart:developer' as developer;

import '../dispatch/dispatcher.dart';
import '../sms/bkash_parser.dart';
import '../sms/sms_kind.dart';
import '../storage/processed_sms_dao.dart';

enum SmsIngestOutcome {
  /// Parser rejected the body — not a bKash SMS we understand.
  unparsed,

  /// Parsed, but this TrxID is already in the database.
  duplicate,

  /// Row inserted. [SmsIngestResult.dispatched] says whether the dispatcher
  /// was kicked (only `received` / `refund` kinds are dispatchable).
  inserted,
}

class SmsIngestResult {
  const SmsIngestResult(this.outcome, {this.kind, this.trxId, this.rowId, this.dispatched = false});

  final SmsIngestOutcome outcome;
  final BkashSmsKind? kind;
  final String? trxId;
  final int? rowId;
  final bool dispatched;
}

/// Parse [body], record it, and dispatch if it is a dispatchable kind.
///
/// Returns without throwing; callers decide how to surface the outcome.
/// `unparsed` deliberately does NOT dump a parser-failure report — the real
/// listener does that (it has a genuine unknown SMS on its hands), whereas the
/// test panel just wants to tell the operator their draft body was malformed.
Future<SmsIngestResult> ingestBkashSms({
  required String body,
  required DateTime smsTimestamp,
  required ProcessedSmsDao dao,
  required Dispatcher dispatcher,
  required String isolate,
}) async {
  final parsed = BkashSms.parse(body);
  if (parsed == null) {
    developer.log('$isolate: parse returned null', name: 'sms_ingest');
    return const SmsIngestResult(SmsIngestOutcome.unparsed);
  }

  developer.log(
    '$isolate parsed kind=${parsed.kind} trxId=${parsed.trxId} '
    'amount=${parsed.amountTaka} hasMsisdn=${parsed.senderMsisdn != null}',
    name: 'sms_ingest',
  );

  final id = await dao.insertParsed(
    parsed: parsed,
    smsTimestamp: smsTimestamp,
    now: DateTime.now(),
  );
  if (id == null) {
    developer.log('$isolate: duplicate trxId=${parsed.trxId}', name: 'sms_ingest');
    return SmsIngestResult(
      SmsIngestOutcome.duplicate,
      kind: parsed.kind,
      trxId: parsed.trxId,
    );
  }

  // Reversal SMS go through the dispatcher too (POST /api/reverse-purchase)
  // since migration 007; previously they terminated as ignoredRefund.
  final dispatchable =
      parsed.kind == BkashSmsKind.received || parsed.kind == BkashSmsKind.refund;
  if (dispatchable) {
    try {
      final processed = await dispatcher.tick();
      developer.log('$isolate: tick complete, processed=$processed', name: 'sms_ingest');
    } catch (e, st) {
      developer.log('$isolate: tick failed: $e', name: 'sms_ingest', error: e, stackTrace: st);
    }
  }

  return SmsIngestResult(
    SmsIngestOutcome.inserted,
    kind: parsed.kind,
    trxId: parsed.trxId,
    rowId: id,
    dispatched: dispatchable,
  );
}

/// Builds a synthetic "money received" bKash SMS for the Settings test tools.
///
/// The shape mirrors the real fixtures in test/sms/bkash_parser_test.dart. It
/// lives here, next to the ingest path, and is covered by a test that asserts
/// [BkashSms.parse] accepts it — otherwise the test panel could quietly start
/// emitting bodies the parser rejects and every scenario would fail for a
/// reason that has nothing to do with what is being tested.
String composeSyntheticBkashSms({
  required int amountTaka,
  required String senderMsisdn,
  required String trxId,
  DateTime? at,
}) {
  final now = at ?? DateTime.now();
  String two(int v) => v.toString().padLeft(2, '0');
  return 'You have received Tk $amountTaka.00 from $senderMsisdn. '
      'Fee Tk 0.00. Balance Tk 5,000.00. '
      'TrxID $trxId at ${two(now.day)}/${two(now.month)}/${now.year} '
      '${two(now.hour)}:${two(now.minute)}';
}
