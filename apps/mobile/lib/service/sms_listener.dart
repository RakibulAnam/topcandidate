// Bridges the Android SMS broadcast (via the `another_telephony` plugin) into
// our parser → DAO → dispatcher pipeline.

import 'dart:developer' as developer;
import 'dart:ui';

import 'package:another_telephony/telephony.dart';

import '../diagnostics.dart';
import '../dispatch/dispatcher.dart';
import '../dispatch/webhook_client.dart';
import '../notifications/notifier.dart';
import '../settings/settings_repository.dart';
import '../sms/bkash_parser.dart';
import '../sms/sms_kind.dart';
import '../storage/database.dart';
import '../storage/processed_sms_dao.dart';

/// Sender address filter. Case-insensitive `contains("bkash")` rather than
/// strict equality — Bangladeshi carriers routinely rewrite the sender ID to
/// variants like `IM-BKASH`, `VM-BKASH`, `BKASH-OTP`, `BKASHWALLET`. Dropping
/// those would make the watcher appear dead-on-arrival with no signal. The
/// body parser still rejects non-bKash content (it requires a `TrxID NNNNNNNNNN`
/// plus `Tk N`), so over-including at the sender layer is safe — junk lands
/// in History as `failed/unknown` instead of being silently dropped.
const _bkashSenderToken = 'bkash';

bool _isBkashSender(String address) =>
    address.toLowerCase().contains(_bkashSenderToken);

class SmsListener {
  SmsListener({
    required this.telephony,
    required this.dao,
    required this.dispatcher,
    this.isolate = 'fg',
  });

  final Telephony telephony;
  final ProcessedSmsDao dao;
  final Dispatcher dispatcher;
  final String isolate;

  Future<void> start() async {
    final granted = await telephony.requestSmsPermissions ?? false;
    developer.log(
      'starting, sms permission granted=$granted',
      name: 'sms_listener.$isolate',
    );
    if (!granted) return;
    telephony.listenIncomingSms(
      onNewMessage: _handle,
      onBackgroundMessage: backgroundMessageHandler,
      listenInBackground: true,
    );
  }

  void _handle(SmsMessage message) {
    final address = message.address ?? '';
    developer.log(
      'fg broadcast address="$address" bodyLen=${message.body?.length ?? 0}',
      name: 'sms_listener.$isolate',
    );
    if (!_isBkashSender(address)) {
      developer.log('fg: sender not bKash, dropping', name: 'sms_listener.$isolate');
      return;
    }
    final body = message.body ?? '';
    final parsed = BkashSms.parse(body);
    if (parsed == null) {
      developer.log('fg: parse returned null', name: 'sms_listener.$isolate');
      // Best-effort observability dump — operator updates the parser later.
      // No DB row, no retry. See spec/01-server-contract.md "Other webhooks".
      _dumpParserFailure(
        client: dispatcher.webhookClient,
        rawBody: body,
        smsTimestamp: message.date != null
            ? DateTime.fromMillisecondsSinceEpoch(message.date!)
            : DateTime.now(),
      );
      return;
    }
    developer.log(
      'fg parsed kind=${parsed.kind} trxId=${parsed.trxId} '
      'amount=${parsed.amountTaka} hasMsisdn=${parsed.senderMsisdn != null}',
      name: 'sms_listener.$isolate',
    );
    final now = DateTime.now();
    final smsTs = message.date != null
        ? DateTime.fromMillisecondsSinceEpoch(message.date!)
        : now;
    dao
        .insertParsed(parsed: parsed, smsTimestamp: smsTs, now: now)
        .then((id) {
      if (id == null) {
        developer.log(
          'fg: duplicate trxId=${parsed.trxId}, not dispatching',
          name: 'sms_listener.$isolate',
        );
        return;
      }
      developer.log(
        'fg: inserted id=$id kind=${parsed.kind}',
        name: 'sms_listener.$isolate',
      );
      // Kick the dispatcher when the row was inserted in a dispatchable state.
      // Reversal SMS now go through the dispatcher (POST /api/reverse-purchase)
      // since migration 007; previously they terminated as ignoredRefund.
      if (parsed.kind == BkashSmsKind.received ||
          parsed.kind == BkashSmsKind.refund) {
        developer.log('fg: kicking dispatcher', name: 'sms_listener.$isolate');
        dispatcher.tick().then((processed) {
          developer.log(
            'fg: dispatcher.tick complete, processed=$processed',
            name: 'sms_listener.$isolate',
          );
        }).catchError((Object e, StackTrace st) {
          developer.log(
            'fg: dispatcher.tick failed: $e',
            name: 'sms_listener.$isolate',
            error: e,
            stackTrace: st,
          );
        });
      }
    }).catchError((Object e, StackTrace st) {
      developer.log(
        'fg: insert failed: $e',
        name: 'sms_listener.$isolate',
        error: e,
        stackTrace: st,
      );
    });
  }
}

/// Top-level entrypoint required by `another_telephony` for background SMS
/// delivery when our long-lived isolate is gone. We enqueue to the DB; the
/// Workmanager periodic tick or next app launch will dispatch.
///
/// Keep this function light — heavy work risks ANR on the broadcast receiver.
///
/// CRITICAL: this runs on a fresh background isolate, so plugin channels
/// (path_provider, sqflite, secure_storage) are not yet wired up. We must
/// call `DartPluginRegistrant.ensureInitialized()` BEFORE touching any
/// plugin-backed code, or the very first call (`BkashDatabase.open()` →
/// `getApplicationDocumentsDirectory()`) throws MissingPluginException and
/// the isolate dies silently.
@pragma('vm:entry-point')
Future<void> backgroundMessageHandler(SmsMessage message) async {
  // Log BEFORE anything else, before any plugin call can fail, so we can
  // confirm the OS is even invoking us.
  final address = message.address ?? '';
  developer.log(
    'bg broadcast invoked address="$address" bodyLen=${message.body?.length ?? 0}',
    name: 'sms_listener.bg',
  );

  try {
    DartPluginRegistrant.ensureInitialized();
    installCrashLogging('sms_bg');
  } catch (e, st) {
    developer.log(
      'bg: plugin registrant init failed: $e',
      name: 'sms_listener.bg',
      error: e,
      stackTrace: st,
    );
    return;
  }

  if (!_isBkashSender(address)) {
    developer.log('bg: sender not bKash, dropping', name: 'sms_listener.bg');
    return;
  }
  final body = message.body ?? '';
  final parsed = BkashSms.parse(body);
  if (parsed == null) {
    developer.log('bg: parse returned null', name: 'sms_listener.bg');
    // Best-effort observability dump. Build a fresh WebhookClient — this
    // isolate has no long-lived dispatcher.
    final settings = SettingsRepository();
    final webhook = HttpWebhookClient(
      urlProvider: settings.webhookUrl,
      secretProvider: settings.hmacSecret,
    );
    _dumpParserFailure(
      client: webhook,
      rawBody: body,
      smsTimestamp: message.date != null
          ? DateTime.fromMillisecondsSinceEpoch(message.date!)
          : DateTime.now(),
    );
    return;
  }
  developer.log(
    'bg parsed kind=${parsed.kind} trxId=${parsed.trxId} '
    'amount=${parsed.amountTaka} hasMsisdn=${parsed.senderMsisdn != null}',
    name: 'sms_listener.bg',
  );

  // Do NOT close the DB after the insert. sqflite's `singleInstance: true`
  // shares one native handle across all isolates in the process; closing it
  // here would kill the UI and service isolates' DAOs the next time they
  // run a query. The OS reclaims the handle when the process dies.
  try {
    final db = await BkashDatabase.open();
    final dao = ProcessedSmsDao(db);
    final now = DateTime.now();
    final smsTs = message.date != null
        ? DateTime.fromMillisecondsSinceEpoch(message.date!)
        : now;
    final id = await dao.insertParsed(
      parsed: parsed,
      smsTimestamp: smsTs,
      now: now,
    );
    developer.log(
      'bg: insert result id=$id (null=duplicate)',
      name: 'sms_listener.bg',
    );

    // Dispatch immediately instead of waiting for the WorkManager safety-net
    // tick (up to ~15 min). This background isolate is a headless task — like
    // the WorkManager callback — so awaiting one HTTP POST here is safe, and is
    // what makes a confirmation near-real-time when the app is backgrounded.
    // If anything throws, the WM tick / next launch still drains the row.
    if (id != null &&
        (parsed.kind == BkashSmsKind.received ||
            parsed.kind == BkashSmsKind.refund)) {
      try {
        final settings = SettingsRepository();
        final webhook = HttpWebhookClient(
          urlProvider: settings.webhookUrl,
          secretProvider: settings.hmacSecret,
        );
        final notifier = await Notifier.init();
        final dispatcher = Dispatcher(
          dao: dao,
          webhookClient: webhook,
          notifier: notifier,
        );
        final processed = await dispatcher.tick();
        developer.log(
          'bg: dispatched immediately, processed=$processed',
          name: 'sms_listener.bg',
        );
      } catch (e, st) {
        developer.log(
          'bg: immediate dispatch failed (WM tick will retry): $e',
          name: 'sms_listener.bg',
          error: e,
          stackTrace: st,
        );
      }
    }
  } catch (e, st) {
    developer.log(
      'bg: insert failed: $e',
      name: 'sms_listener.bg',
      error: e,
      stackTrace: st,
    );
  }
}

/// Fire-and-forget POST to `/api/admin/parser-failures`. Best-effort: a
/// failure here is just an observability gap, not a payment issue.
void _dumpParserFailure({
  required WebhookClient client,
  required String rawBody,
  required DateTime smsTimestamp,
}) {
  client
      .postParserFailure(rawBody: rawBody, smsTimestamp: smsTimestamp)
      .then((r) {
    developer.log(
      'dump status=${r.statusCode} err=${r.errorTag ?? "none"} '
      'bodyLen=${rawBody.length}',
      name: 'parser_failure_dump',
    );
  }).catchError((Object e, StackTrace st) {
    developer.log(
      'dump failed: $e',
      name: 'parser_failure_dump',
      error: e,
      stackTrace: st,
    );
  });
}
