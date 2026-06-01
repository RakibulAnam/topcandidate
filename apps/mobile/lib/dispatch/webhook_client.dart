// HTTP client that signs the body with HMAC-SHA256 and POSTs to the operator
// webhook. See spec/01-server-contract.md.
//
// WEBHOOK PROTOCOL v2 (2026-05-31)
// ================================
// The server now expects two headers and a "timestamp.body" signed string:
//
//   X-Bkash-Webhook-Timestamp: <UTC ISO-8601 with milliseconds, e.g. 2026-05-31T14:23:09.512Z>
//   X-Bkash-Webhook-Signature: hex(HMAC-SHA256(secret, "<timestamp>.<body>"))
//
// The literal ASCII period between timestamp and body is mandatory — without
// it an attacker could swap timestamp/body chunks at the boundary while
// keeping a valid HMAC.
//
// The server applies a ±5 min window to the timestamp and stores a nonce
// derived from "<timestamp>:<body>" (colon separator there, deliberately
// different) to detect replays. See:
//   - docs/architecture/webhook-replay-protection.md (the why)
//   - docs/contracts/webhook-confirm-purchase.md      (the canonical contract)
//   - apps/web/api/_lib/webhookAuth.ts                (the server impl)
//
// Backward compatibility: the server still accepts the legacy v1 path (no
// timestamp, signature over raw body only) until the operator flips
// BKASH_WEBHOOK_REQUIRE_TIMESTAMP=true in Vercel env. We ship v2 from this
// release; once every operator install is on v1.2.0+, the operator can
// flip the env var to enforce v2 server-side.

import 'dart:convert';
import 'dart:developer' as developer;
import 'dart:typed_data';

import 'package:crypto/crypto.dart';
import 'package:http/http.dart' as http;

import 'state.dart';

/// Interface so tests can inject a fake.
abstract class WebhookClient {
  Future<WebhookResponse> post({
    required String trxId,
    required String? senderMsisdn,
    required int amountTaka,
  });

  /// Posts an empty `{}` body — used by the Settings "Test webhook" button.
  Future<WebhookResponse> postRaw(Map<String, dynamic> body);

  /// Sibling endpoints added in web migration 007. All three use the same
  /// HMAC convention as [post]; the URL is derived from the operator's
  /// `/api/confirm-purchase` base by swapping the path segment.

  /// `POST /api/orphan-inbound-sms` — dump an unmatchable SMS for operator
  /// reconciliation. Called after `waiting_user` exhausts its 24h budget.
  Future<WebhookResponse> postOrphan({
    required String trxId,
    required String? senderMsisdn,
    required int amountTaka,
    required String rawBody,
    required DateTime smsTimestamp,
  });

  /// `POST /api/reverse-purchase` — notify the server of a bKash reversal
  /// SMS. Server flips the matching `completed` row to `refunded`.
  Future<WebhookResponse> postReversal({
    required String trxId,
    String? reason,
  });

  /// `POST /api/admin/parser-failures` — dump an SMS the parser could not
  /// classify so the operator can update `bkash_parser.dart`. Best-effort
  /// observability; no retry.
  Future<WebhookResponse> postParserFailure({
    required String rawBody,
    String? senderMsisdn,
    DateTime? smsTimestamp,
    String? reason,
  });
}

class HttpWebhookClient implements WebhookClient {
  HttpWebhookClient({
    required this.urlProvider,
    required this.secretProvider,
    http.Client? client,
    Duration timeout = const Duration(seconds: 30),
    DateTime Function()? timestampProvider,
  }) : _client = client ?? http.Client(),
       _timeout = timeout,
       _timestampProvider = timestampProvider ?? DateTime.now;

  /// Lazy provider so a stale URL/secret in memory after settings change
  /// can't ship a wrong payload.
  final Future<String?> Function() urlProvider;
  final Future<String?> Function() secretProvider;
  final http.Client _client;
  final Duration _timeout;

  /// Injection seam for v2 signature tests — defaults to `DateTime.now`
  /// in production. Tests pass a fixed value so signatures are
  /// reproducible.
  final DateTime Function() _timestampProvider;

  @override
  Future<WebhookResponse> post({
    required String trxId,
    required String? senderMsisdn,
    required int amountTaka,
  }) {
    final body = <String, dynamic>{
      'transactionId': trxId,
      'senderMsisdn': senderMsisdn,
      'amountTaka': amountTaka,
    };
    return postRaw(body);
  }

  @override
  Future<WebhookResponse> postRaw(Map<String, dynamic> body) {
    return _postToPath(body, path: null);
  }

  @override
  Future<WebhookResponse> postOrphan({
    required String trxId,
    required String? senderMsisdn,
    required int amountTaka,
    required String rawBody,
    required DateTime smsTimestamp,
  }) {
    return _postToPath(
      <String, dynamic>{
        'transactionId': trxId,
        'senderMsisdn': senderMsisdn,
        'amountTaka': amountTaka,
        'rawBody': rawBody,
        'smsTimestamp': smsTimestamp.toUtc().toIso8601String(),
      },
      path: '/api/orphan-inbound-sms',
    );
  }

  @override
  Future<WebhookResponse> postReversal({
    required String trxId,
    String? reason,
  }) {
    return _postToPath(
      <String, dynamic>{
        'transactionId': trxId,
        'reason': ?reason,
      },
      path: '/api/reverse-purchase',
    );
  }

  @override
  Future<WebhookResponse> postParserFailure({
    required String rawBody,
    String? senderMsisdn,
    DateTime? smsTimestamp,
    String? reason,
  }) {
    return _postToPath(
      <String, dynamic>{
        'rawBody': rawBody,
        'senderMsisdn': ?senderMsisdn,
        'smsTimestamp': ?smsTimestamp?.toUtc().toIso8601String(),
        'reason': ?reason,
      },
      path: '/api/admin/parser-failures',
    );
  }

  /// Shared POST core. When [path] is null the operator's configured URL is
  /// used as-is (confirm-purchase). When non-null, the configured URL's path
  /// is replaced with [path] so sibling endpoints share a single base.
  Future<WebhookResponse> _postToPath(
    Map<String, dynamic> body, {
    required String? path,
  }) async {
    final configured = await urlProvider();
    final secret = await secretProvider();
    if (configured == null ||
        configured.isEmpty ||
        secret == null ||
        secret.isEmpty) {
      return const WebhookResponse(
        statusCode: null,
        errorTag: 'unconfigured',
      );
    }

    final target = path == null ? configured : _rewritePath(configured, path);
    if (target == null) {
      return const WebhookResponse(
        statusCode: null,
        errorTag: 'bad_url',
      );
    }

    final encoded = jsonEncode(body);
    // Generate timestamp AFTER the body — keeps the signed window as
    // small as possible (server enforces ±5 min). UTC + millisecond
    // precision + 'Z' suffix is exactly what the server parses.
    final timestamp = _timestampProvider().toUtc().toIso8601String();
    final signature = _signV2(timestamp, encoded, secret);

    // Diagnostic only. Never log the body, signature, or secret — they
    // can contain customer MSISDN / TrxID and the HMAC reveals secret usage
    // patterns. Lengths and the URL host are enough to debug shape problems.
    developer.log(
      'POST host=${Uri.tryParse(target)?.host ?? "?"} '
      'path=${Uri.tryParse(target)?.path ?? "?"} '
      'bodyLen=${encoded.length} sigLen=${signature.length} '
      'tsLen=${timestamp.length}',
      name: 'webhook',
    );

    try {
      final response = await _client
          .post(
            Uri.parse(target),
            headers: {
              'Content-Type': 'application/json',
              'X-Bkash-Webhook-Timestamp': timestamp,
              'X-Bkash-Webhook-Signature': signature,
            },
            body: encoded,
          )
          .timeout(_timeout);

      // Truncate response body. Never log it in full (see spec/08-security).
      final truncatedBody = response.body.length > 512
          ? response.body.substring(0, 512)
          : response.body;

      developer.log(
        'POST -> ${response.statusCode} respLen=${response.body.length}',
        name: 'webhook',
      );

      return WebhookResponse(
        statusCode: response.statusCode,
        body: truncatedBody,
      );
    } catch (e, st) {
      final tag = _classifyError(e);
      developer.log(
        'POST error: $tag ($e)',
        name: 'webhook',
        error: e,
        stackTrace: st,
      );
      return WebhookResponse(statusCode: null, errorTag: tag);
    }
  }

  /// Swap the path of [base] (operator-configured URL ending in
  /// `/api/confirm-purchase`) for [newPath]. Returns null if [base] cannot
  /// be parsed.
  static String? _rewritePath(String base, String newPath) {
    final uri = Uri.tryParse(base);
    if (uri == null || !uri.hasScheme || uri.host.isEmpty) return null;
    return uri.replace(path: newPath).toString();
  }

  /// v2 signature: `hex(HMAC-SHA256(secret, "{timestamp}.{body}"))`.
  /// The dot separator is part of the protocol — do not change.
  ///
  /// We feed three byte chunks (timestamp, period, body) sequentially into
  /// the HMAC accumulator rather than concatenating into one String first.
  /// For typical webhook bodies (<2 KB) the difference is negligible but
  /// the pattern stays the same as concatenating `"$timestamp.$body"`.
  String _signV2(String timestamp, String body, String secret) {
    final mac = Hmac(sha256, utf8.encode(secret));
    final tsBytes = utf8.encode(timestamp);
    final bodyBytes = utf8.encode(body);
    final buffer = Uint8List(tsBytes.length + 1 + bodyBytes.length);
    buffer.setRange(0, tsBytes.length, tsBytes);
    buffer[tsBytes.length] = 0x2e; // ASCII '.'
    buffer.setRange(tsBytes.length + 1, buffer.length, bodyBytes);
    return mac.convert(buffer).toString();
  }

  String _classifyError(Object e) {
    final s = e.toString().toLowerCase();
    if (s.contains('timeout')) return 'timeout';
    if (s.contains('socket') || s.contains('connection')) return 'network';
    if (s.contains('handshake') || s.contains('certificate')) return 'tls';
    return 'unknown';
  }
}
