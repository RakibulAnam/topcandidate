# Webhook replay-protection — security approach

**Scope:** `POST /api/confirm-purchase`, `POST /api/orphan-inbound-sms`, `POST /api/reverse-purchase`, `POST /api/admin/parser-failures` — all four Flutter watcher webhooks sign with the same `BKASH_WEBHOOK_SECRET`.

**Shipped:** 2026-05-31 (migration 011 + `api/_lib/webhookAuth.ts` v2). Backward-compatible during rollout; enforce-only via `BKASH_WEBHOOK_REQUIRE_TIMESTAMP=true` once the Flutter watcher has been updated.

---

## Threat model

| Threat | Pre-v2 posture | v2 posture |
|---|---|---|
| **Untrusted caller forges a request body** | Mitigated — HMAC requires the shared secret. | Same. |
| **Compromised observer captures a valid signed request and replays it minutes / hours / days later** | **Unmitigated**. The body-only HMAC has no freshness signal; the request stays valid forever. | Mitigated by the ±5-min timestamp window. |
| **Same request re-sent within the window (lost-ACK retry)** | Idempotent at the DB level (TrxID short-circuits in `confirm_purchase`). Outcome correct but spammy. | Atomically deduplicated by the `webhook_nonces` table. The retry returns 401 `replay`; the watcher's first-attempt outcome is already committed. |
| **Captured request body + attacker-chosen timestamp** | N/A. | Rejected — the HMAC binds timestamp to body. Changing the timestamp invalidates the signature. |
| **Captured timestamp + attacker-chosen body** | N/A. | Same — HMAC binding. |

---

## Wire-format change

### v1 (legacy)

```
Headers:
  X-Bkash-Webhook-Signature: <hex>

Signed string:
  <rawBody>
```

### v2 (recommended; enforce via `BKASH_WEBHOOK_REQUIRE_TIMESTAMP=true`)

```
Headers:
  X-Bkash-Webhook-Timestamp: 2026-05-31T14:23:09.512Z
  X-Bkash-Webhook-Signature: <hex>

Signed string (literal bytes):
  <timestamp>.<rawBody>

Nonce (server-computed, not transmitted):
  sha256("<timestamp>:<rawBody>")
```

Notes:
- The signature input uses a **period** (`.`) separator between timestamp and body.
- The nonce input uses a **colon** (`:`) separator. Different separator on purpose — if the same string did both jobs, an attacker who got the nonce could derive part of the signature input, or vice versa.
- The nonce isn't sent over the wire. The server derives it from the same two values the watcher already signed; this means a deterministic nonce that catches *exact* replays. Non-replay retries with a different timestamp (e.g. watcher backs off 5 min then retries) produce a different nonce and are accepted by the nonce layer (still gated by the DB-level idempotency).

---

## Server-side validation flow

```
incoming POST
  │
  ├── BKASH_WEBHOOK_SECRET configured?        no → 503
  ├── X-Bkash-Webhook-Signature present?      no → 401 (reason=no_signature)
  ├── X-Bkash-Webhook-Timestamp present?
  │     │
  │     ├── yes (v2 path):
  │     │     ├── parse timestamp; within ±5 min of server clock?
  │     │     │     no → 401 (reason=timestamp_skew)
  │     │     ├── HMAC(secret, "<ts>.<body>") == provided?
  │     │     │     no → 401 (reason=bad_signature)
  │     │     ├── nonce = sha256("<ts>:<body>")
  │     │     ├── INSERT INTO webhook_nonces ... ON CONFLICT DO NOTHING
  │     │     │   FOUND ? → continue : → 401 (reason=replay)
  │     │     └── ok
  │     │
  │     └── no:
  │           ├── BKASH_WEBHOOK_REQUIRE_TIMESTAMP == 'true' ?
  │           │     yes → 401 (reason=no_timestamp)
  │           ├── (legacy) HMAC(secret, "<body>") == provided?
  │           │     no → 401 (reason=bad_signature)
  │           ├── log warning
  │           └── ok
  │
  ├── handler-specific body validation
  └── handler-specific business logic
```

The reason codes (`no_signature`, `timestamp_skew`, `bad_signature`, `replay`, `no_timestamp`, `replay`) are **logged server-side only**. The HTTP response body is always the generic `"Invalid or missing signature."` — we do not echo the discrimination to an unauthenticated caller.

---

## Why fail-closed on the DB hiccup

When `acquire_webhook_nonce()` fails for an unexpected reason (network blip between Vercel and Supabase, transient DB error), `verifyWebhook` returns `{ ok: false, reason: 'replay' }`. This is a deliberate trade-off:

- **Fail-closed:** the watcher's retry schedule (5s → 15s → 45s → 2m → 6m → 18m → 1h) will re-attempt; the next attempt has a fresh timestamp + nonce, so the legitimate retry succeeds.
- **Fail-open** would be: "if we can't reach the nonce store, accept the request anyway". That would create a window during which captured requests can be replayed any time the nonce store flickers.

The watcher's retry policy is engineered for this exact case. Fail-closed wins.

---

## Operational rollout

1. **This PR (server-only):** ships v2 verification with v1 backward-compat. Production unchanged for existing watchers.
2. **Migration 011** is applied (the `webhook_nonces` table + RPCs). No downtime — the table is new.
3. **Flutter watcher update** (separate PR in `apps/mobile/`): generate UTC timestamp, prefix the signed string. Ship via the operator's existing build pipeline.
4. **Operator confirms** all phones have the new build (a single operator today, so trivial).
5. **Set `BKASH_WEBHOOK_REQUIRE_TIMESTAMP=true`** in Vercel env and redeploy. Legacy requests now rejected.

At step 5 the rollout is complete. No DB migration to undo; the table simply stops accumulating legacy-path entries (because there is no nonce for legacy).

---

## What this does NOT defend against

- **Compromise of the shared secret itself.** If the watcher's secret leaks, an attacker can forge fresh signed requests with current timestamps. Mitigation: rotate the secret (see [`../contracts/webhook-confirm-purchase.md`](../contracts/webhook-confirm-purchase.md) — same procedure as before, the v2 secret format is unchanged).
- **A malicious watcher.** If the watcher device itself is compromised, the attacker has the secret and full control of timestamps. The only protection is the operator noticing anomalous purchase grants in the admin audit log.
- **DoS by flooding the nonce table.** An attacker who has the secret can fill the table with up-to-the-second timestamps. The 10-min TTL + `prune_webhook_nonces()` (run via pg_cron) bounds the table size. At 1 req/sec maxed for 5 min, we'd have 300 rows — trivially small.

---

## Mobile (Flutter) implementation notes

Pseudocode for the watcher (Dart):

```dart
final body = jsonEncode(payload);
final timestamp = DateTime.now().toUtc().toIso8601String(); // includes ms + 'Z'

final mac = Hmac(sha256, utf8.encode(BKASH_WEBHOOK_SECRET));
final signature = mac.convert(utf8.encode('$timestamp.$body')).toString(); // hex

final response = await httpClient.post(
  Uri.parse(url),
  headers: {
    'Content-Type': 'application/json',
    'X-Bkash-Webhook-Timestamp': timestamp,
    'X-Bkash-Webhook-Signature': signature,
  },
  body: body, // EXACT same bytes that were signed
);
```

Two gotchas worth highlighting in the mobile PR:

1. The `body` variable must be the **exact same bytes** sent over the wire and signed. Don't `jsonEncode` once for signing and again for the request — they may differ if the map iteration order changes.
2. Dart's default `Iso8601String` is millisecond-precision UTC ending in `Z`. The server parses with `Date.parse`, which accepts that format. Don't strip the `Z`.

---

## References

- Contract: [`docs/contracts/webhook-confirm-purchase.md`](../contracts/webhook-confirm-purchase.md)
- Implementation: [`apps/web/api/_lib/webhookAuth.ts`](../../apps/web/api/_lib/webhookAuth.ts)
- Migration: [`apps/web/supabase/migrations/011_webhook_nonces.sql`](../../apps/web/supabase/migrations/011_webhook_nonces.sql)
