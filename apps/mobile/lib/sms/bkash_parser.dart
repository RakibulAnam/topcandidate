// Pure Dart parser for bKash SMS bodies. No Flutter imports.
// See spec/02-sms-formats.md for the canonical rules.

import 'sms_kind.dart';

/// Value object returned by [BkashSms.parse].
class ParsedBkashSms {
  const ParsedBkashSms({
    required this.trxId,
    required this.amountTaka,
    required this.senderMsisdn,
    required this.kind,
    required this.rawBody,
  });

  /// 10-character alphanumeric (uppercased).
  final String trxId;

  /// Integer Taka. The bKash SMS uses 2-decimal `200.00`; we floor to int.
  final int amountTaka;

  /// `01` followed by 9 digits, or `null` when the body has no `from <msisdn>`
  /// (e.g. Make Payment).
  final String? senderMsisdn;

  final BkashSmsKind kind;

  /// The original SMS body, kept for audit. Stored on the DB row.
  final String rawBody;

  @override
  String toString() =>
      'ParsedBkashSms(trxId=$trxId, amountTaka=$amountTaka, '
      'senderMsisdn=$senderMsisdn, kind=$kind)';
}

/// Static facade for the parser. See spec/02-sms-formats.md.
abstract final class BkashSms {
  // First "Tk <amount>" occurrence. Handles commas and an optional decimal.
  static final RegExp _amount = RegExp(r'Tk\s+([\d,]+(?:\.\d+)?)');

  // 11-digit BD MSISDN after the literal "from ". Tolerates internal
  // whitespace inside the number (some renderers / carrier rewrites split
  // it as `0171 1234567`). The capture is whitespace-stripped and then
  // re-validated against `^01\d{9}$` before being kept.
  static final RegExp _msisdn = RegExp(r'from\s+(01[\d\s]{9,15})');
  static final RegExp _msisdnStrict = RegExp(r'^01\d{9}$');

  // 10-character alphanumeric TrxID after the literal "TrxID ".
  // Case-sensitive on "TrxID" — bKash never sends it lowercased.
  static final RegExp _trx = RegExp(r'TrxID\s+([A-Za-z0-9]{10})\b');

  /// Returns the parsed SMS, or `null` if [body] is not a recognizable
  /// bKash SMS. A non-null return guarantees [ParsedBkashSms.trxId] and
  /// [ParsedBkashSms.amountTaka] are present.
  static ParsedBkashSms? parse(String body) {
    final normalized = body.replaceAll(RegExp(r'[\t\r]+'), ' ');

    final trxMatch = _trx.firstMatch(normalized);
    if (trxMatch == null) return null;

    final amountMatch = _amount.firstMatch(normalized);
    if (amountMatch == null) return null;

    final amountStr = amountMatch.group(1)!.replaceAll(',', '');
    final amount = double.tryParse(amountStr);
    if (amount == null || amount <= 0) return null;

    final msisdnMatch = _msisdn.firstMatch(normalized);
    String? msisdn;
    if (msisdnMatch != null) {
      final stripped = msisdnMatch.group(1)!.replaceAll(RegExp(r'\s+'), '');
      if (_msisdnStrict.hasMatch(stripped)) {
        msisdn = stripped;
      }
    }

    return ParsedBkashSms(
      trxId: trxMatch.group(1)!.toUpperCase(),
      amountTaka: amount.floor(),
      senderMsisdn: msisdn,
      kind: classify(body),
      rawBody: body,
    );
  }

  /// Pure classification function. See spec/02-sms-formats.md §3.
  ///
  /// Tolerates extra whitespace (collapses runs of whitespace to a single
  /// space before matching).
  ///
  /// Order matters — earlier rules win. iBanking deposits and outbound
  /// payments must be checked BEFORE the generic "You have received" check,
  /// because iBanking SMS also start with "You have received deposit ..."
  /// and we don't want to falsely POST them as customer payments.
  static BkashSmsKind classify(String body) {
    final b = body.replaceAll(RegExp(r'\s+'), ' ');
    if (b.contains('Reversal') || b.contains('has been reversed')) {
      return BkashSmsKind.refund;
    }
    if (b.contains('received deposit from iBanking')) {
      return BkashSmsKind.ibankingDeposit;
    }
    if (b.contains('Payment of Tk') || b.contains('Make Payment')) {
      return BkashSmsKind.sent;
    }
    if (b.contains('You have received') ||
        b.contains('Cash In') ||
        b.contains('Send Money received')) {
      return BkashSmsKind.received;
    }
    return BkashSmsKind.unknown;
  }
}
