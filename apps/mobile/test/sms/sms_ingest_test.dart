// Guards the Settings test-tools mechanic: the synthetic SMS it posts must be
// something the REAL parser accepts, with the exact fields the server needs.
//
// Without this, the test panel could drift into emitting bodies the parser
// rejects, and every scenario would fail for a reason unrelated to whatever the
// operator was actually trying to verify.

import 'package:flutter_test/flutter_test.dart';
import 'package:bkash_watcher/sms/bkash_parser.dart';
import 'package:bkash_watcher/sms/sms_ingest.dart';
import 'package:bkash_watcher/sms/sms_kind.dart';

void main() {
  group('composeSyntheticBkashSms', () {
    test('produces a body the real parser accepts', () {
      final body = composeSyntheticBkashSms(
        amountTaka: 200,
        senderMsisdn: '01711234567',
        trxId: 'TSTABC1234',
        at: DateTime(2026, 8, 27, 15, 30),
      );

      final parsed = BkashSms.parse(body);
      expect(parsed, isNotNull, reason: 'test tools would post an unparseable SMS');
      expect(parsed!.kind, BkashSmsKind.received);
      expect(parsed.trxId, 'TSTABC1234');
      expect(parsed.amountTaka, 200);
      expect(parsed.senderMsisdn, '01711234567');
    });

    test('underpaid amount survives the round trip', () {
      final parsed = BkashSms.parse(composeSyntheticBkashSms(
        amountTaka: 150,
        senderMsisdn: '01711234567',
        trxId: 'TSTXYZ9876',
        at: DateTime(2026, 8, 27, 9, 5),
      ));
      expect(parsed?.amountTaka, 150);
    });

    test('TrxID marker stays inside the 10-char budget the parser enforces', () {
      // 'TST' + 7 random = 10. Any longer and the parser silently drops it.
      const generated = 'TSTABCDEFG';
      expect(generated.length, 10);
      final parsed = BkashSms.parse(composeSyntheticBkashSms(
        amountTaka: 200,
        senderMsisdn: '01711234567',
        trxId: generated,
        at: DateTime(2026, 8, 27, 1, 2),
      ));
      expect(parsed?.trxId, generated);
    });
  });
}
