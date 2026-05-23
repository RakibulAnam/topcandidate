# Contract: `POST /api/confirm-purchase`

> **Canonical**. Both `apps/web/` and `apps/mobile/` MUST conform to this. Changes require updates to the web handler, the mobile dispatcher, and this file — in the same PR.
>
> Long-form narrative version (problem statement, edge cases, operator UX): [`apps/mobile/WHAT_IT_DOES.md`](../../apps/mobile/WHAT_IT_DOES.md). This file is the short, normative spec.

## Endpoint

```
POST https://<web-app-domain>/api/confirm-purchase
```

URL must match `^https?://.+/api/confirm-purchase$`. The operator pastes the full URL into the mobile app's Settings tab.

## Headers

| Header | Value |
| --- | --- |
| `Content-Type` | `application/json` |
| `X-Bkash-Webhook-Signature` | hex-encoded **HMAC-SHA256** of the **raw request body**, using the operator-supplied shared secret. |

The HMAC is computed over the exact byte sequence of the body. **Do not** re-serialize parsed JSON before hashing — that produces a different byte sequence and fails verification.

## Request body

```json
{
  "transactionId": "AB12CD34EF",
  "senderMsisdn": "01711234567",
  "amountTaka": 200
}
```

- `transactionId` — exactly 10 alphanumeric characters, uppercased. Unique key on the web side.
- `senderMsisdn` — `01` followed by 9 digits, OR `null` for SMS variants without a sender phone. Treat as nullable.
- `amountTaka` — positive integer Taka. Watcher floors any decimal (`Tk 200.50` → `200`).

## Response codes (do NOT invent new ones)

| Status | Body | Meaning | Watcher's reaction |
| --- | --- | --- | --- |
| 200 | `{ success: true, userId, creditsGranted, newBalance }` | Fresh confirmation. | Marks row `done`. Notifies operator. |
| 200 | `{ success: true, alreadyConfirmed: true, userId, creditsGranted }` | Idempotent replay. | Marks row `done`. **Notification suppressed.** |
| 400 | `{ error: '<reason>' }` | Body malformed. | Marks row `failed`. No retry. |
| 401 | `{ error: 'bad signature' }` | HMAC missing or wrong. | Marks row `failed`. Operator alerted. |
| 404 | `{ code: 'no_pending_purchase' }` | No matching pending row **yet**. | Marks row `waiting_user`. Retries every 5 min for 24 h. |
| 409 | `{ code: 'msisdn_mismatch' }` | Claimed sender ≠ SMS sender. | Marks row `mismatch`. Manual review. |
| 503 | `{ error: 'webhook misconfigured' }` | Server-side misconfig. | Marks row `failed`. Operator alerted. |
| 5xx (other) | any | Transient. | Exponential backoff: 5s → 15s → 45s → 2m → 6m → 18m → 1h, for 24 h. |

### Idempotency (mandatory)

A second POST with the same `transactionId` after credits were granted **must** return the 200-idempotent response, not a fresh credit grant. This is the only replay protection in the protocol — there is no per-request nonce.

### 404 is load-bearing

The customer's TrxID-paste and the operator's bKash SMS arrive in either order. If the SMS reaches the watcher before the customer submits the TrxID, the watcher POSTs and the web app has no matching row → return **404**, not 400. The watcher will retry every 5 min for 24 h. Web app must keep `pending_purchase` rows around for **at least 24 h** after creation.

## Server handler logic (canonical)

```
on POST /api/confirm-purchase:
  1. Read raw body (do NOT use req.json() first).
  2. Verify HMAC. Invalid → 401.
  3. Parse JSON. Missing transactionId/amountTaka → 400.
  4. Lookup pending_purchase by trx_id = transactionId.
     - found AND status = 'confirmed' → 200 idempotent
     - not found → 404 no_pending_purchase
     - found AND claimed_msisdn != senderMsisdn (both non-null) → 409 msisdn_mismatch
     - found AND amount mismatch beyond tolerance → 409 (or grant lower + flag — document the choice)
  5. Grant credits, flip status to 'confirmed', record confirmed_at + confirmed_msisdn.
  6. Return 200 with { success: true, userId, creditsGranted, newBalance }.
```

## HMAC verification example (Node)

```ts
import crypto from 'node:crypto';

function verifySignature(rawBody: string, headerSig: string, secret: string) {
  const expected = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(headerSig, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
```

## Implementation pointers

- Web handler: [`apps/web/api/confirm-purchase.ts`](../../apps/web/api/confirm-purchase.ts)
- Mobile sender: [`apps/mobile/lib/dispatch/webhook_client.dart`](../../apps/mobile/lib/dispatch/webhook_client.dart)
- Mobile state machine: [`apps/mobile/lib/dispatch/dispatcher.dart`](../../apps/mobile/lib/dispatch/dispatcher.dart) + [`apps/mobile/spec/04-state-machine.md`](../../apps/mobile/spec/04-state-machine.md)
- DB schema sketch: see [`apps/mobile/WHAT_IT_DOES.md`](../../apps/mobile/WHAT_IT_DOES.md) §4 and [`apps/web/supabase/schema.sql`](../../apps/web/supabase/schema.sql).
