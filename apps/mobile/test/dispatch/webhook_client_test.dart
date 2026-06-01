// Focused tests for HttpWebhookClient — protocol v2 (timestamp + nonce).
//
// We're testing the wire format on the SAME logic the server runs, so a
// future regression (renaming the header, dropping the period separator,
// dropping the timestamp header) trips the build. End-to-end behavior is
// covered by dispatcher_test.dart via the FakeWebhookClient; here we
// pin the protocol detail.

import 'dart:convert';

import 'package:bkash_watcher/dispatch/webhook_client.dart';
import 'package:crypto/crypto.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  group('HttpWebhookClient v2 protocol', () {
    const secret = 'test-secret-32-bytes-or-whatever';
    final fixedTimestamp = DateTime.utc(2026, 5, 31, 14, 23, 9, 512);
    final expectedIso = fixedTimestamp.toUtc().toIso8601String();

    String expectedV2Signature(String body) {
      final mac = Hmac(sha256, utf8.encode(secret));
      // Server computes HMAC over "<timestamp>.<body>" — exact same shape.
      return mac.convert(utf8.encode('$expectedIso.$body')).toString();
    }

    test('sends both X-Bkash-Webhook-Timestamp and X-Bkash-Webhook-Signature headers, '
         'signature verifies against (timestamp + "." + body)', () async {
      late http.Request captured;
      final mock = MockClient((req) async {
        captured = req;
        return http.Response('{}', 200);
      });

      final client = HttpWebhookClient(
        urlProvider: () async => 'https://example.com/api/confirm-purchase',
        secretProvider: () async => secret,
        client: mock,
        timestampProvider: () => fixedTimestamp,
      );

      final res = await client.post(
        trxId: 'AB12CD34EF',
        senderMsisdn: '01711234567',
        amountTaka: 200,
      );

      expect(res.statusCode, 200);

      // Headers present.
      expect(captured.headers['Content-Type'], 'application/json');
      expect(captured.headers['X-Bkash-Webhook-Timestamp'], expectedIso);
      expect(captured.headers['X-Bkash-Webhook-Signature'], isNotEmpty);

      // Signature matches the server's computation.
      final body = captured.body;
      expect(captured.headers['X-Bkash-Webhook-Signature'], expectedV2Signature(body));

      // Sanity: body has the expected fields (no protocol drift).
      final decoded = jsonDecode(body) as Map<String, dynamic>;
      expect(decoded['transactionId'], 'AB12CD34EF');
      expect(decoded['senderMsisdn'], '01711234567');
      expect(decoded['amountTaka'], 200);
    });

    test('timestamp is UTC with millisecond precision and Z suffix', () async {
      late http.Request captured;
      final mock = MockClient((req) async {
        captured = req;
        return http.Response('{}', 200);
      });

      final client = HttpWebhookClient(
        urlProvider: () async => 'https://example.com/api/confirm-purchase',
        secretProvider: () async => secret,
        client: mock,
        timestampProvider: () => fixedTimestamp,
      );
      await client.post(trxId: 'X', senderMsisdn: null, amountTaka: 1);

      final ts = captured.headers['X-Bkash-Webhook-Timestamp']!;
      expect(ts, endsWith('Z'), reason: 'must be UTC');
      // ISO-8601 with ms is `YYYY-MM-DDThh:mm:ss.SSSZ` — 24 chars.
      expect(ts.length, 24);
      expect(DateTime.parse(ts).toUtc(), fixedTimestamp);
    });

    test('reuses the v2 protocol for orphan / reversal / parser-failure endpoints', () async {
      final captures = <http.Request>[];
      final mock = MockClient((req) async {
        captures.add(req);
        return http.Response('{}', 200);
      });

      final client = HttpWebhookClient(
        urlProvider: () async => 'https://example.com/api/confirm-purchase',
        secretProvider: () async => secret,
        client: mock,
        timestampProvider: () => fixedTimestamp,
      );

      await client.postOrphan(
        trxId: 'AB12CD34EF',
        senderMsisdn: '01711234567',
        amountTaka: 200,
        rawBody: 'Tk 200.00 received from 01711234567 ...',
        smsTimestamp: DateTime.utc(2026, 5, 31, 14, 0, 0),
      );
      await client.postReversal(trxId: 'AB12CD34EF', reason: 'bkash reversal');
      await client.postParserFailure(rawBody: 'unparseable SMS body');

      expect(captures, hasLength(3));
      for (final req in captures) {
        expect(req.headers['X-Bkash-Webhook-Timestamp'], expectedIso);
        expect(
          req.headers['X-Bkash-Webhook-Signature'],
          expectedV2Signature(req.body),
          reason: '${req.url.path} must also use the v2 signed-string format',
        );
      }
    });

    test('returns unconfigured when URL or secret is missing', () async {
      final mock = MockClient((req) async => http.Response('{}', 200));
      final client = HttpWebhookClient(
        urlProvider: () async => null,
        secretProvider: () async => secret,
        client: mock,
      );
      final res = await client.post(
        trxId: 'X',
        senderMsisdn: null,
        amountTaka: 1,
      );
      expect(res.statusCode, isNull);
      expect(res.errorTag, 'unconfigured');
    });
  });
}
