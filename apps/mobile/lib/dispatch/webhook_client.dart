// HTTP client that signs the body with HMAC-SHA256 and POSTs to the operator
// webhook. See spec/01-server-contract.md.

import 'dart:convert';
import 'dart:developer' as developer;

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
}

class HttpWebhookClient implements WebhookClient {
  HttpWebhookClient({
    required this.urlProvider,
    required this.secretProvider,
    http.Client? client,
    Duration timeout = const Duration(seconds: 30),
  }) : _client = client ?? http.Client(),
       _timeout = timeout;

  /// Lazy provider so a stale URL/secret in memory after settings change
  /// can't ship a wrong payload.
  final Future<String?> Function() urlProvider;
  final Future<String?> Function() secretProvider;
  final http.Client _client;
  final Duration _timeout;

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
  Future<WebhookResponse> postRaw(Map<String, dynamic> body) async {
    final url = await urlProvider();
    final secret = await secretProvider();
    if (url == null || url.isEmpty || secret == null || secret.isEmpty) {
      return const WebhookResponse(
        statusCode: null,
        errorTag: 'unconfigured',
      );
    }

    final encoded = jsonEncode(body);
    final signature = _sign(encoded, secret);

    // Diagnostic only. Never log the body, signature, or secret — they
    // can contain customer MSISDN / TrxID and the HMAC reveals secret usage
    // patterns. Lengths and the URL host are enough to debug shape problems.
    developer.log(
      'POST host=${Uri.tryParse(url)?.host ?? "?"} bodyLen=${encoded.length} '
      'sigLen=${signature.length}',
      name: 'webhook',
    );

    try {
      final response = await _client
          .post(
            Uri.parse(url),
            headers: {
              'Content-Type': 'application/json',
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

  String _sign(String body, String secret) {
    final mac = Hmac(sha256, utf8.encode(secret));
    return mac.convert(utf8.encode(body)).toString();
  }

  String _classifyError(Object e) {
    final s = e.toString().toLowerCase();
    if (s.contains('timeout')) return 'timeout';
    if (s.contains('socket') || s.contains('connection')) return 'network';
    if (s.contains('handshake') || s.contains('certificate')) return 'tls';
    return 'unknown';
  }
}
