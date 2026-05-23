# Spec 02 — bKash SMS Formats

## Sender filter

Process SMS only if the originating `address`, lowercased, **contains** the
substring `bkash`. Bangladeshi carriers routinely rewrite the brand-name
sender ID to variants like `IM-BKASH`, `VM-BKASH`, `BKASH-OTP`, or
`BKASHWALLET`; a strict equality check would silently drop those and make
the watcher appear dead-on-arrival with no signal. Over-including at the
sender layer is safe — the body parser still requires `TrxID NNNNNNNNNN`
plus `Tk N`, and anything that passes the sender check but fails parsing
lands in History as `failed/unknown` rather than being POSTed.

## SMS bodies

The parser must accept ALL of the following bodies. Examples are real,
redacted.

### 1. Personal account — money received

```
You have received Tk 200.00 from 01711234567. Ref ABC. Fee Tk 0.00. Balance Tk 1,234.56. TrxID 9G4K2M8N0P at 12/05/2026 14:33
```

### 2. Merchant/Agent account — cash in

```
Cash In Tk 200.00 from 01711234567 successful. Fee Tk 0.00. Balance Tk 1,234.56. TrxID 9G4K2M8N0P at 12/05/2026 14:33
```

### 3. Send Money received (variant of money-received)

```
Send Money received Tk 200.00 from 01711234567. Fee Tk 0.00. Balance Tk 1,234.56. TrxID 9G4K2M8N0P at 12/05/2026 14:33
```

### 4. Outbound payment (OUTBOUND — do NOT confirm)

Real bKash wording observed on a Personal account (verified from operator
screenshots, 2026):

```
Payment of Tk 656.50 to FOODPANDA BANGLADESH LIMITED is successful. Balance Tk 402.19. TrxID DAP2GQMM6U at 25/01/2026 18:51
```

Earlier/spec-only wording (kept for backward compat):

```
Make Payment of Tk 200.00 to <merchant>. Fee Tk 0.00. Balance Tk 1,234.56. TrxID 9G4K2M8N0P at 12/05/2026 14:33
```

Classify as `sent`. Stored with `state = ignored_sent` (audit-only, never POSTed).

### 4b. iBanking deposit (OPERATOR'S OWN MONEY — do NOT confirm)

When the operator deposits money into their bKash wallet from their bank's
iBanking, bKash sends a SMS that LOOKS like a customer payment because it
starts with "You have received deposit ...":

```
You have received deposit from iBanking of Tk 600.00 from City Bank. Fee Tk 0.00. Balance Tk 1,058.69. TrxID DAP6GQKGZ8 at 25/01/2026 18:50
```

This is the operator's own money moving from bank to wallet — it must NEVER
be POSTed to the credit-confirmation webhook, otherwise the watcher would
falsely credit a customer for the operator's deposit.

Classify as `ibankingDeposit`. Stored with `state = ignored_ibanking`
(audit-only, never POSTed). Kept in History so the operator can reconcile
bank deposits against their bKash balance.

### 5. Reversal / refund (do NOT confirm)

```
Reversal: Tk 200.00 has been credited to your Account from <merchant>. TrxID 9G4K2M8N0P at 12/05/2026 14:33
```

Classify as `refund`. Stored with `state = ignored_refund`.

### 6. Edge variants the parser must tolerate

- Extra whitespace, repeated spaces, tab characters.
- No fee line (`. Fee Tk 0.00`) — some bKash SMS omit it.
- Alternative date formats: `12/05/2026 14:33`, `12-05-2026 14:33`,
  `12/05/2026 02:33 PM`.
- Comma-formatted amounts: `Tk 1,200.00`.
- Trailing newline or carriage returns.
- Missing balance or trailing `at <datetime>`.

## Field extraction rules

| Field         | Rule                                                                                |
| ------------- | ----------------------------------------------------------------------------------- |
| `trxId`       | Capture group after the literal `TrxID ` (case-sensitive). 10 alphanumerics, A-Z 0-9.|
| `amountTaka`  | First match of `Tk\s+([\d,]+(?:\.\d+)?)`. Strip commas. Parse as double. Floor to int. |
| `senderMsisdn`| First match of `from\s+(01[\d\s]{9,15})`, with internal whitespace stripped, then re-validated against `^01\d{9}$`. `null` if no match or post-strip validation fails. Tolerates renderers/carrier rewrites that split the number as `0171 1234567`. |
| `kind`        | See §3.                                                                              |

If `trxId` or `amountTaka` cannot be extracted, `parse()` returns `null`.

## Classification (§3 — used by `BkashSms.classify`)

Apply in order; first match wins. **Order matters**: iBanking deposits and
outbound payments must be checked BEFORE the generic "You have received"
check, because the iBanking body starts with "You have received deposit ...".

1. Body contains `Reversal` or `has been reversed` → `refund`.
2. Body contains `received deposit from iBanking` → `ibankingDeposit`.
3. Body contains `Payment of Tk` (case-sensitive) OR `Make Payment` → `sent`.
4. Body contains one of `You have received`, `Cash In`, `Send Money received` → `received`.
5. Otherwise → `unknown`.

Only `received` SMS are POSTed to the webhook. Everything else is stored for
audit. Classification is performed on a whitespace-normalized copy of the
body, so "double  space" and "tab\tseparated" still match.

## Parser API

```dart
enum BkashSmsKind { received, sent, refund, ibankingDeposit, unknown }

class ParsedBkashSms {
  final String trxId;          // uppercased, 10 chars
  final int amountTaka;        // integer Taka (floor of the parsed amount)
  final String? senderMsisdn;  // null for Payment, iBanking deposit, refund
  final BkashSmsKind kind;
  final String rawBody;
}

class BkashSms {
  static ParsedBkashSms? parse(String body);
  static BkashSmsKind classify(String body);
}
```

The parser must NOT import `dart:io` or any Flutter package.
