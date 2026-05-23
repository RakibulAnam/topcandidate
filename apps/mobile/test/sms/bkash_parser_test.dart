import 'package:flutter_test/flutter_test.dart';
import 'package:bkash_watcher/sms/bkash_parser.dart';
import 'package:bkash_watcher/sms/sms_kind.dart';

/// Table-driven parser tests. See spec/02-sms-formats.md.
///
/// Adding a new SMS variant? Add a row to [_cases]. Do not add new top-level
/// test() functions.

class _Case {
  const _Case(
    this.label,
    this.body, {
    this.expectNull = false,
    this.trxId,
    this.amount,
    this.msisdn,
    this.kind,
  });

  final String label;
  final String body;
  final bool expectNull;
  final String? trxId;
  final int? amount;
  final String? msisdn;
  final BkashSmsKind? kind;
}

const _cases = <_Case>[
  // 1. Canonical Personal account "money received".
  _Case(
    'personal money received',
    'You have received Tk 200.00 from 01711234567. Ref ABC. Fee Tk 0.00. '
        'Balance Tk 1,234.56. TrxID 9G4K2M8N0P at 12/05/2026 14:33',
    trxId: '9G4K2M8N0P',
    amount: 200,
    msisdn: '01711234567',
    kind: BkashSmsKind.received,
  ),

  // 2. Merchant Cash In.
  _Case(
    'merchant cash in',
    'Cash In Tk 200.00 from 01711234567 successful. Fee Tk 0.00. '
        'Balance Tk 1,234.56. TrxID 9G4K2M8N0P at 12/05/2026 14:33',
    trxId: '9G4K2M8N0P',
    amount: 200,
    msisdn: '01711234567',
    kind: BkashSmsKind.received,
  ),

  // 3. Send Money received.
  _Case(
    'send money received',
    'Send Money received Tk 50.00 from 01911112222. Fee Tk 0.00. '
        'Balance Tk 9,012.00. TrxID ABCDEF1234 at 12/05/2026 14:33',
    trxId: 'ABCDEF1234',
    amount: 50,
    msisdn: '01911112222',
    kind: BkashSmsKind.received,
  ),

  // 4. Make Payment — legacy outbound wording, classified as `sent`, no MSISDN.
  _Case(
    'make payment outbound (legacy wording)',
    'Make Payment of Tk 500.00 to MERCHANT-X. Fee Tk 0.00. '
        'Balance Tk 100.00. TrxID 11112222AB at 12/05/2026 14:33',
    trxId: '11112222AB',
    amount: 500,
    msisdn: null,
    kind: BkashSmsKind.sent,
  ),

  // 4b. Real bKash outbound wording (verified from operator screenshots 2026):
  //     "Payment of Tk X to <merchant> is successful." — no "Make".
  _Case(
    'payment of tk outbound (real wording, merchant)',
    'Payment of Tk 656.50 to FOODPANDA BANGLADESH LIMITED is successful. '
        'Balance Tk 402.19. TrxID DAP2GQMM6U at 25/01/2026 18:51',
    trxId: 'DAP2GQMM6U',
    amount: 656,  // floor of 656.50
    msisdn: null,
    kind: BkashSmsKind.sent,
  ),

  // 4c. Real bKash outbound to a foundation-style merchant ID. Tests that
  //     the merchant name (with hyphens and digits) does not confuse the
  //     parser into capturing a fake MSISDN.
  _Case(
    'payment of tk outbound (real wording, foundation)',
    'Payment of Tk 100.00 to As Sunnah Foundation-1-RM46979 is successful. '
        'Balance Tk 45.19. TrxID DCA6WL2YEI at 10/03/2026 22:52',
    trxId: 'DCA6WL2YEI',
    amount: 100,
    msisdn: null,
    kind: BkashSmsKind.sent,
  ),

  // 4d. iBanking deposit — operator's own bank→wallet deposit.
  //     Body STARTS with "You have received deposit ..." which would normally
  //     trip the "received" classifier, so this test guards the ordering.
  _Case(
    'ibanking deposit (verified from operator screenshots)',
    'You have received deposit from iBanking of Tk 600.00 from City Bank. '
        'Fee Tk 0.00. Balance Tk 1,058.69. TrxID DAP6GQKGZ8 at 25/01/2026 18:50',
    trxId: 'DAP6GQKGZ8',
    amount: 600,
    msisdn: null,  // bank deposit has no customer MSISDN
    kind: BkashSmsKind.ibankingDeposit,
  ),

  // 4e. Large iBanking deposit with comma-formatted amount.
  _Case(
    'ibanking deposit large amount',
    'You have received deposit from iBanking of Tk 17,000.00 from City Bank. '
        'Fee Tk 0.00. Balance Tk 17,257.39. TrxID CGN9VADGVD at 23/07/2025 17:07',
    trxId: 'CGN9VADGVD',
    amount: 17000,
    msisdn: null,
    kind: BkashSmsKind.ibankingDeposit,
  ),

  // 4f. Real personal-received with "MSISDN.Ref Name,Note." trailing clause
  //     (note: no space between MSISDN and ".Ref"). Names are redacted.
  _Case(
    'personal received with Ref note (real wording)',
    'You have received Tk 1,200.00 from 01700000001.Ref Test Customer,'
        'Test Course. Fee Tk 0.00. Balance Tk 1,469.69. '
        'TrxID CFG8W97QAO at 16/06/2025 13:24',
    trxId: 'CFG8W97QAO',
    amount: 1200,
    msisdn: '01700000001',
    kind: BkashSmsKind.received,
  ),

  // 5. Reversal — classified as `refund`.
  _Case(
    'reversal refund',
    'Reversal: Tk 200.00 has been credited to your Account from MERCHANT-X. '
        'TrxID REV1234567 at 12/05/2026 14:33',
    trxId: 'REV1234567',
    amount: 200,
    msisdn: null,
    kind: BkashSmsKind.refund,
  ),

  // 6. Extra whitespace + tabs.
  _Case(
    'extra whitespace',
    'You  have  received   Tk  300.00   from  01711234567.\tTrxID\tZZZZ123456\t',
    trxId: 'ZZZZ123456',
    amount: 300,
    msisdn: '01711234567',
    kind: BkashSmsKind.received,
  ),

  // 7. No fee line, no balance line.
  _Case(
    'minimal received',
    'You have received Tk 75.00 from 01711234567. TrxID MINI123456',
    trxId: 'MINI123456',
    amount: 75,
    msisdn: '01711234567',
    kind: BkashSmsKind.received,
  ),

  // 8. Comma-formatted amount (thousands separator).
  _Case(
    'comma amount',
    'You have received Tk 1,500.00 from 01711234567. Fee Tk 0.00. '
        'Balance Tk 12,345.00. TrxID BIGSPENDER at 12/05/2026 14:33',
    trxId: 'BIGSPENDER',
    amount: 1500,
    msisdn: '01711234567',
    kind: BkashSmsKind.received,
  ),

  // 9. Alternative date format with dashes + 12h clock — should still parse
  //    the TrxID + amount; date itself is not extracted.
  _Case(
    'alt date format',
    'You have received Tk 200.00 from 01711234567. TrxID DATE123456 at '
        '12-05-2026 02:33 PM',
    trxId: 'DATE123456',
    amount: 200,
    msisdn: '01711234567',
    kind: BkashSmsKind.received,
  ),

  // 10. Trailing newline.
  _Case(
    'trailing newline',
    'You have received Tk 10.00 from 01711234567. TrxID NEWLINE001\n',
    trxId: 'NEWLINE001',
    amount: 10,
    msisdn: '01711234567',
    kind: BkashSmsKind.received,
  ),

  // 11. Malformed — no TrxID anywhere. parse() must return null.
  _Case(
    'malformed no trxid',
    'You have received Tk 200.00 from 01711234567. Have a nice day!',
    expectNull: true,
  ),

  // 11a. Real OTP (verification code). No TrxID, no Tk amount.
  _Case(
    'otp verification code',
    'Your bKash verification code is 809678. The code will expire in 2 '
        'minutes. Please do NOT share your OTP or PIN with others.',
    expectNull: true,
  ),

  // 11b. Real account-binding success notice. No TrxID, no Tk amount.
  _Case(
    'account binding confirmation',
    'Your Account Binding request for FOODPANDA BANGLADESH LIMITED is '
        'successful. You have authorized FOODPANDA BANGLADESH LIMITED to '
        'debit your account for future purchases. For queries, please call '
        '16247.',
    expectNull: true,
  ),

  // 11c. Real recharge discount coupon. Uses BDT not Tk → parser drops it.
  _Case(
    'recharge discount coupon (BDT, not Tk)',
    'You have received BDT 30 Mobile Recharge discount Coupon. Enjoy '
        'discount by applying coupon through bKash app\'s Mobile Recharge. '
        'TCA. Validity: 28-07-2025',
    expectNull: true,
  ),

  // 12. Malformed — TrxID is too short (only 9 chars).
  _Case(
    'malformed short trxid',
    'You have received Tk 200.00 from 01711234567. TrxID SHORT1234 at '
        '12/05/2026 14:33',
    expectNull: true,
  ),

  // 13. Malformed — no Tk amount.
  _Case(
    'malformed no amount',
    'You have received from 01711234567. TrxID NOAMT12345 at 12/05/2026 14:33',
    expectNull: true,
  ),

  // 14. Edge — amount uses integer (no decimals). Real bKash always sends
  //     2dp but parser shouldn't require them.
  _Case(
    'integer amount no decimal',
    'You have received Tk 250 from 01711234567. TrxID INTAMT1234',
    trxId: 'INTAMT1234',
    amount: 250,
    msisdn: '01711234567',
    kind: BkashSmsKind.received,
  ),

  // 14b. Edge — MSISDN rendered with an internal space ("0171 1234567").
  //      Strip whitespace then validate; capture must still be 01+9 digits.
  _Case(
    'msisdn with internal whitespace',
    'You have received Tk 200.00 from 0171 1234567. TrxID WSMSISDN01 at '
        '12/05/2026 14:33',
    trxId: 'WSMSISDN01',
    amount: 200,
    msisdn: '01711234567',
    kind: BkashSmsKind.received,
  ),

  // 14c. Edge — MSISDN with multiple internal spaces ("01 711 234 567").
  _Case(
    'msisdn with multiple internal spaces',
    'You have received Tk 50.00 from 01 711 234 567. TrxID WSMSISDN02',
    trxId: 'WSMSISDN02',
    amount: 50,
    msisdn: '01711234567',
    kind: BkashSmsKind.received,
  ),

  // 15. Edge — TrxID lowercase letters mixed (defensive uppercasing).
  _Case(
    'lowercase letters in trxid',
    'You have received Tk 200.00 from 01711234567. TrxID abcd123456 at '
        '12/05/2026 14:33',
    trxId: 'ABCD123456',
    amount: 200,
    msisdn: '01711234567',
    kind: BkashSmsKind.received,
  ),
];

void main() {
  for (final c in _cases) {
    test('BkashSms.parse — ${c.label}', () {
      final parsed = BkashSms.parse(c.body);
      if (c.expectNull) {
        expect(parsed, isNull, reason: 'expected null for ${c.label}');
        return;
      }
      expect(parsed, isNotNull, reason: 'expected non-null for ${c.label}');
      expect(parsed!.trxId, c.trxId, reason: 'trxId for ${c.label}');
      expect(parsed.amountTaka, c.amount, reason: 'amount for ${c.label}');
      expect(parsed.senderMsisdn, c.msisdn, reason: 'msisdn for ${c.label}');
      expect(parsed.kind, c.kind, reason: 'kind for ${c.label}');
      expect(parsed.rawBody, c.body, reason: 'rawBody preserved');
    });
  }

  group('BkashSms.classify standalone', () {
    test('refund wins over received-like text', () {
      const body =
          'Reversal: Tk 50.00 has been credited to your Account from MX. '
          'TrxID REV0000001';
      expect(BkashSms.classify(body), BkashSmsKind.refund);
    });

    test('sent wins over generic Tk', () {
      const body = 'Make Payment of Tk 50.00 to merchant. TrxID SENT0000AB';
      expect(BkashSms.classify(body), BkashSmsKind.sent);
    });

    test('unknown for unrecognized', () {
      const body = 'Welcome to bKash. Your account is now active.';
      expect(BkashSms.classify(body), BkashSmsKind.unknown);
    });

    test('iBanking deposit beats generic "You have received" rule', () {
      // Critical: iBanking SMS starts with "You have received deposit ..."
      // and would otherwise match the `received` classifier first. The
      // ordering in BkashSms.classify is what guards this.
      const body =
          'You have received deposit from iBanking of Tk 600.00 from '
          'City Bank. Fee Tk 0.00. Balance Tk 1,058.69. TrxID DAP6GQKGZ8 '
          'at 25/01/2026 18:50';
      expect(BkashSms.classify(body), BkashSmsKind.ibankingDeposit);
    });

    test('real "Payment of Tk" wording classifies as sent', () {
      const body =
          'Payment of Tk 100.00 to As Sunnah Foundation-1-RM46979 is '
          'successful. Balance Tk 45.19. TrxID DCA6WL2YEI at 10/03/2026 22:52';
      expect(BkashSms.classify(body), BkashSmsKind.sent);
    });
  });
}
