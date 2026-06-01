# Spec 01 — Server Contract

> The web app implements this endpoint. The watcher is a client. **Do not
> change this contract from the watcher side** — if the operator wants a
> change, the server changes first, then this spec updates.
>
> Canonical cross-app wire contract:
> [`docs/contracts/webhook-confirm-purchase.md`](../../../docs/contracts/webhook-confirm-purchase.md).
> This file is the watcher's view of that contract; the linked one is the
> source both apps move together.

## Endpoint

```
POST https://<operator-domain>/api/confirm-purchase
```

The full URL is supplied by the operator at runtime via the Settings tab.

## Headers (protocol v2 — 2026-05-31)

| Header                         | Value                                                                              |
| ------------------------------ | ---------------------------------------------------------------------------------- |
| `Content-Type`                 | `application/json`                                                                 |
| `X-Bkash-Webhook-Timestamp`    | UTC ISO-8601 with millisecond precision and trailing `Z` (e.g. `2026-05-31T14:23:09.512Z`). |
| `X-Bkash-Webhook-Signature`    | hex-encoded HMAC-SHA256 of `<timestamp>.<rawBody>` — literal ASCII period between them. |

### Signed string

The watcher signs the byte sequence:

```
<X-Bkash-Webhook-Timestamp>  + 0x2e (ASCII '.')  + <raw request body>
```

The HMAC is computed over the EXACT bytes that ship — no whitespace
normalization, no re-encoding. Use `utf8.encode(jsonString)` for both the
timestamp and the body; concatenate the byte arrays (or feed them
sequentially into the HMAC accumulator).

### Replay protection (server-side)

The server enforces:

1. **Timestamp window**: rejects requests whose timestamp is more than
   ±5 minutes from server time. The watcher generates timestamps with
   `DateTime.now().toUtc().toIso8601String()` — Android keeps NTP-synced
   clocks reliably enough that we never approach the window.
2. **Nonce**: the server computes `sha256("<timestamp>:<rawBody>")` (note
   the COLON, not period) and atomically inserts it into a nonce table.
   Duplicate nonces are rejected as replays. A watcher retry of the same
   request body with the same timestamp will fail — retries MUST generate
   a fresh timestamp (which produces a fresh nonce).

The watcher does not need to know about the nonce. Just refresh the
timestamp on every retry.

### Backward compatibility

While the operator's web server is on the rollout window
(`BKASH_WEBHOOK_REQUIRE_TIMESTAMP=false`), the server also accepts the
legacy v1 path — a body-only HMAC without a timestamp. We ship v2 from
v1.2.0+; once the operator flips the env var to `true`, legacy requests
are rejected. The watcher does NOT need a legacy fallback — v2 works
under both server configurations.

## Request body

```json
{
  "transactionId": "AB12CD34EF",
  "senderMsisdn": "01711234567",
  "amountTaka": 200
}
```

- `transactionId` — exactly 10 alphanumeric characters, uppercased.
- `senderMsisdn` — `01` followed by 9 digits; `null` if the SMS does not carry
  one (e.g. Make Payment notifications, though those are not POSTed).
- `amountTaka` — positive integer. Decimals from the SMS (`200.00`) are
  truncated to integer Taka; bKash credit packs are always sold in whole-Taka
  prices. **Load-bearing** since web migration 007: the server compares
  observed vs expected and refuses underpayments with `409 underpaid`. A
  missing or zero `amountTaka` causes the underpayment check to be skipped.

## Response codes

| Status | Meaning                                                | Watcher action                                              |
| ------ | ------------------------------------------------------ | ----------------------------------------------------------- |
| 200    | Credits granted (or already granted; idempotent OK).   | Mark row `done`. Show "✓ +N credits granted" notification.  |
| 400    | Body malformed. Programmer error.                      | Mark row `failed`. Surface to operator. No retry.           |
| 401    | Signature missing or wrong.                            | Mark row `failed`. Notify "Webhook misconfigured". No retry.|
| 404    | `{ code: 'no_pending_purchase' }`. Customer hasn't     | Mark row `waiting_user`. Retry every 5 min for 24 h.        |
|        | submitted TrxID yet.                                   |                                                             |
| 409    | `{ code: 'msisdn_mismatch' }`. Sender phone differs    | Mark row `mismatch`. Notify "Sender mismatch". No retry.    |
|        | from what the customer claimed.                        |                                                             |
| 409    | `{ code: 'underpaid', expected, observed }`. SMS       | Mark row `mismatch`. Notify "Underpayment — open admin      |
|        | amount < pending row's expected amount (migration 007).| panel". No retry.                                           |
| 503    | Webhook misconfigured server-side.                     | Mark row `failed`. Notify "Server down/misconfig". No retry.|
| 5xx    | Other transient errors.                                | Mark row `retrying`. Apply exponential backoff (§04).       |
| n/a    | Network error / timeout.                               | Same as 5xx.                                                |

## Idempotency

The server treats `transactionId` as a unique key. Re-POSTing the same body
returns 200 (credits already granted) or 404 if the pending row no longer
exists. Both are terminal-success on retry — the dispatcher must treat 200
**and** "404 after at least one prior 200/202 for the same TrxID" as `done`.

Implementation note: the watcher cannot tell from a bare 404 whether this is
"never submitted" vs "already confirmed and pending row deleted". The
distinction comes from `attempt_count`:

- 404 on first attempt → `waiting_user`.
- 404 after a prior 200 was observed for this TrxID → `done`.

We do not currently observe a prior 200 then later 404 (because we stop
retrying after 200), so in practice 404 always means `waiting_user`. The
distinction is documented in case future logic needs it.

## Example HMAC computation (v2)

```dart
import 'dart:convert';
import 'package:crypto/crypto.dart';

/// Signs the v2 string "<timestamp>.<body>". The timestamp is the value sent
/// in X-Bkash-Webhook-Timestamp; the period separator is part of the protocol.
String sign(String timestamp, String body, String secret) {
  final mac = Hmac(sha256, utf8.encode(secret));
  return mac.convert(utf8.encode('$timestamp.$body')).toString();
}
```

The watcher's implementation (`lib/dispatch/webhook_client.dart::_signV2`)
feeds the timestamp bytes, an ASCII period (`0x2e`), then the body bytes into
the HMAC accumulator rather than building one String — equivalent result.

## Test-webhook payload

The Settings tab provides a "Test webhook" button. It POSTs `{}` with a valid
signature. Expected responses:

- 400 with `transactionId is required` → URL + secret are correct.
- 401 → secret is wrong.
- 503 → server misconfigured.
- Network error → wrong URL or no connectivity.

## Sibling endpoints (web migration 007)

The watcher also POSTs to three sibling endpoints. All three share the same
HMAC convention (`X-Bkash-Webhook-Signature` over the raw body, signed with
the operator-configured secret) as `/api/confirm-purchase`. The URL is
derived from the operator-supplied confirm-purchase URL by swapping the
path; the host and scheme are reused. See
[`docs/contracts/webhook-confirm-purchase.md`](../../../docs/contracts/webhook-confirm-purchase.md)
for the canonical cross-app source.

### `POST /api/orphan-inbound-sms`

Called once, best-effort, **immediately before** a `waiting_user` row
transitions to terminal `failed` (24h budget exhausted). The server stores
the unmatchable SMS for operator reconciliation.

Body:

```json
{
  "transactionId": "ABC123XYZ0",
  "senderMsisdn": "01711234567",
  "amountTaka": 200,
  "rawBody": "<original SMS body>",
  "smsTimestamp": "<ISO 8601 UTC>"
}
```

Response: 200 on success; 4xx/5xx logged. The `failed` transition commits
regardless of the response — the orphan dump is observability.

### `POST /api/reverse-purchase`

Called for each bKash reversal SMS. Rows enter the dispatcher in
`reversing` state (see `spec/04-state-machine.md`) and exit as
`ignored_refund` once the server acks.

Body:

```json
{ "transactionId": "ABC123XYZ0", "reason": "<optional short string>" }
```

Response codes and watcher reaction:

| Status      | Watcher reaction                                                    |
| ----------- | ------------------------------------------------------------------- |
| 200         | Row → `ignored_refund`. Notify "Refund recorded".                   |
| 404         | Row → `ignored_refund`. **Silent** — common when the reversal SMS doesn't match a completed purchase. |
| 400/401/503 | Row → `ignored_refund`. Notify "Reversal dispatch failed".          |
| 5xx / net   | Stay `reversing`, exponential backoff per §04. 24h budget then drop to `ignored_refund` with notification. |

### `POST /api/admin/parser-failures`

Fire-and-forget. Called when the SMS sender is bKash but
`BkashSms.parse()` returns null. No DB row, no retry — purely an
observability dump so the operator can update `lib/sms/bkash_parser.dart`.
Despite the `/admin/` segment, this endpoint accepts the same HMAC as the
others (it's watcher-callable, not browser-callable).

Body:

```json
{
  "rawBody": "<original SMS body>",
  "senderMsisdn": "01711234567",
  "smsTimestamp": "<ISO 8601 UTC, optional>",
  "reason": "<optional short string>"
}
```

Response: 200 on success; anything else is logged to `developer.log` under
`name: 'parser_failure_dump'` and discarded.
