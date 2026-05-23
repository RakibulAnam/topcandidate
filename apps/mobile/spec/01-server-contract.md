# Spec 01 — Server Contract

> The web app implements this endpoint. The watcher is a client. **Do not
> change this contract from the watcher side** — if the operator wants a
> change, the server changes first, then this spec updates.

## Endpoint

```
POST https://<operator-domain>/api/confirm-purchase
```

The full URL is supplied by the operator at runtime via the Settings tab.

## Headers

| Header                         | Value                                                         |
| ------------------------------ | ------------------------------------------------------------- |
| `Content-Type`                 | `application/json`                                            |
| `X-Bkash-Webhook-Signature`    | hex-encoded HMAC-SHA256 of the **raw request body** using the |
|                                | operator-supplied shared secret (UTF-8 bytes of the secret).  |

The HMAC must be computed over the exact byte sequence that is sent on the
wire, with no whitespace normalization. Use `utf8.encode(jsonString)` and
serialize with `jsonEncode(map)`.

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
  prices.

## Response codes

| Status | Meaning                                                | Watcher action                                              |
| ------ | ------------------------------------------------------ | ----------------------------------------------------------- |
| 200    | Credits granted (or already granted; idempotent OK).   | Mark row `done`. Show "✓ +N credits granted" notification.  |
| 400    | Body malformed. Programmer error.                      | Mark row `failed`. Surface to operator. No retry.           |
| 401    | Signature missing or wrong.                            | Mark row `failed`. Notify "Webhook misconfigured". No retry.|
| 404    | `{ code: 'no_pending_purchase' }`. Customer hasn't     | Mark row `waiting_user`. Retry every 5 min for 24 h.        |
|        | submitted TrxID yet.                                   |                                                             |
| 409    | `{ code: 'msisdn_mismatch' }`. Sender phone differs    | Mark row `mismatch`. Notify "Manual review". No retry.      |
|        | from what the customer claimed.                        |                                                             |
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

## Example HMAC computation

```dart
import 'dart:convert';
import 'package:crypto/crypto.dart';

String sign(String body, String secret) {
  final mac = Hmac(sha256, utf8.encode(secret));
  return mac.convert(utf8.encode(body)).toString();
}
```

## Test-webhook payload

The Settings tab provides a "Test webhook" button. It POSTs `{}` with a valid
signature. Expected responses:

- 400 with `transactionId is required` → URL + secret are correct.
- 401 → secret is wrong.
- 503 → server misconfigured.
- Network error → wrong URL or no connectivity.
