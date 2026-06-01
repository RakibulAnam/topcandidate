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

| Header | Value | Status |
| --- | --- | --- |
| `Content-Type` | `application/json` | required |
| `X-Bkash-Webhook-Signature` | hex-encoded **HMAC-SHA256** of the **signed string**, using the operator-supplied shared secret. | required |
| `X-Bkash-Webhook-Timestamp` | UTC ISO-8601 timestamp of when the watcher sent the request (e.g. `2026-05-31T14:23:09.512Z`). | **v2 (recommended)** — see Replay protection below |

### Signed string

- **v2 (recommended):** the literal byte sequence `<timestamp>.<rawBody>` — timestamp from the header, then an ASCII period, then the raw body bytes.
- **v1 (legacy):** the raw body bytes only. Accepted only when the timestamp header is absent AND the server's `BKASH_WEBHOOK_REQUIRE_TIMESTAMP` env flag is unset.

The HMAC is computed over the exact byte sequence. **Do not** re-serialize parsed JSON before hashing — that produces a different byte sequence and fails verification.

### Replay protection (added migration 011, 2026-05-31)

When the watcher sends `X-Bkash-Webhook-Timestamp`:

1. The server rejects requests whose timestamp differs from server time by more than **±5 minutes** (response: `401`, reason logged as `timestamp_skew`).
2. The server computes a nonce as `sha256("<timestamp>:<rawBody>")` (note: colon separator here, not period — separate from the signature input). It atomically inserts the nonce into the `webhook_nonces` table; on conflict the request is rejected as a replay (`401`, reason logged as `replay`).
3. Nonces expire from the store after 10 minutes (2× the window); the timestamp-skew rejection covers anything older.

When the watcher omits the timestamp header, the server falls back to the v1 verification (legacy body-only HMAC) **and logs a console warning**. Operators rolling out v2 should:

1. Deploy the web server with `webhookAuth.ts` v2 support (no env var needed for backward-compat).
2. Ship a Flutter watcher build that sends the v2 headers.
3. Once every active operator install is on the new watcher, flip `BKASH_WEBHOOK_REQUIRE_TIMESTAMP=true` in Vercel env — the server then rejects v1 requests with `401`.

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
- `amountTaka` — positive integer Taka. Watcher floors any decimal (`Tk 200.50` → `200`). **Load-bearing** since migration 007: the server compares observed vs expected and refuses underpayments with 409 `underpaid`. A missing or zero `amountTaka` causes the underpayment check to be skipped — the watcher MUST send the real amount.

## Response codes (do NOT invent new ones)

| Status | Body | Meaning | Watcher's reaction |
| --- | --- | --- | --- |
| 200 | `{ success: true, userId, creditsGranted, newBalance }` | Fresh confirmation. | Marks row `done`. Notifies operator. |
| 200 | `{ success: true, alreadyConfirmed: true, userId, creditsGranted }` | Idempotent replay. | Marks row `done`. **Notification suppressed.** |
| 400 | `{ error: '<reason>' }` | Body malformed. | Marks row `failed`. No retry. |
| 401 | `{ error: 'bad signature' }` | HMAC missing or wrong. | Marks row `failed`. Operator alerted. |
| 404 | `{ code: 'no_pending_purchase' }` | No matching pending row **yet**. Server records the verified SMS into `inbound_payments` for match-on-submit. | Marks row `waiting_user`. Retries (20s→40s→1m→2m→5m backoff) for 24 h as a backstop. |
| 409 | `{ code: 'msisdn_mismatch' }` | Claimed sender ≠ SMS sender. | Marks row `mismatch`. Manual review. |
| 409 | `{ code: 'underpaid', expected, observed }` | SMS amount < required. | Marks row `mismatch` (terminal). Operator recovers via admin panel / top-up SMS. |
| 503 | `{ error: 'webhook misconfigured' }` | Server-side misconfig. | Marks row `failed`. Operator alerted. |
| 5xx (other) | any | Transient. | Exponential backoff: 5s → 15s → 45s → 2m → 6m → 18m → 1h, for 24 h. |

### Idempotency (mandatory)

A second POST with the same `transactionId` after credits were granted **must** return the 200-idempotent response, not a fresh credit grant. This is the **outcome-level** replay protection — once a payment is confirmed, replaying the same TrxID is harmless because the DB-level `confirm_purchase` RPC detects the existing `completed` row and short-circuits.

Per-**request** replay protection is enforced by the v2 timestamp+nonce machinery (see Headers → Replay protection). Both layers exist on purpose:

- The timestamp+nonce protection rejects identical signed requests **before** they reach the DB — useful against an attacker replaying a captured request to spam our pipeline.
- The TrxID-level idempotency handles the legitimate case of the watcher retrying because it didn't see our 200 — those retries land with a *fresh* timestamp + nonce (different signed string), so the v2 protection lets them through, and the DB-level idempotency makes the outcome correct.

### 404 is load-bearing (+ match-on-submit, migration 012)

The customer's TrxID-paste and the operator's bKash SMS arrive in either order. If the SMS reaches the watcher before the customer submits the TrxID, the watcher POSTs and the web app has no matching `purchases` row → return **404**, not 400.

Since migration 012 the 404 path is no longer a dead end: the server **records the HMAC-verified SMS into `inbound_payments`**. When the customer then submits, `initiate_purchase` (the `/api/purchase` path) matches that stored SMS and **grants credits synchronously inside the submit request** (match-on-submit) — so the common pay-first ordering completes in ~1–2 s instead of waiting for the watcher's next retry.

The watcher still retries the 404'd row as a **backstop** (now a 20s→5min backoff, not a fixed 5 min); a later retry simply lands on the already-`completed` row and gets the **200 idempotent** response. The web app must keep `purchases` rows for **at least 24 h** after creation; `inbound_payments` rows are pruned 48 h after receipt (or immediately once consumed).

## Server handler logic (canonical)

```
on POST /api/confirm-purchase:
  1. Read raw body (do NOT use req.json() first).
  2. Verify HMAC. Invalid → 401.
  3. Parse JSON. Missing transactionId → 400.
  4. Lookup the `purchases` row by payment_reference = transactionId.
     - found AND status = 'completed' → 200 idempotent
     - not found AND no completed row → record the verified SMS into
       `inbound_payments` (match-on-submit memory, migration 012), then
       404 no_pending_purchase
     - found AND claimed_msisdn != senderMsisdn (both non-null) → 409 msisdn_mismatch
     - found AND amountTaka < pending.amount_taka → 409 underpaid; row flipped to 'underpaid'
     - found AND amountTaka > pending.amount_taka → 200 + log surplus to purchase_overpayments
  5. Grant credits, flip status to 'completed', record observed amount + state-change audit row.
  6. Return 200 with { success: true, userId, creditsGranted, newBalance }.
```

### Other webhooks (added migration 007)

The watcher also POSTs to three sibling endpoints, all signed with the same `X-Bkash-Webhook-Signature`:

- `POST /api/orphan-inbound-sms` — body `{ transactionId, senderMsisdn?, amountTaka, rawBody, smsTimestamp }`. Used after the watcher gives up retrying a 404'd row (24h). Server dumps the row into `unmatched_inbound_sms` for operator reconciliation.
- `POST /api/reverse-purchase` — body `{ transactionId, reason? }`. For bKash reversal SMS. Server flips the matching `completed` row to `refunded` and decrements credits.
- `POST /api/admin/parser-failures` (POST mode) — body `{ rawBody, senderMsisdn?, smsTimestamp?, reason? }`. For SMS the watcher could not classify. Server stores the verbatim body so the operator can update the parser.

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
