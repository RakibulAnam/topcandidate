# Prompt — Build the bKash SMS-watcher Flutter app

> Paste the entire body below into a fresh Claude (or other) chat session.
> The receiving session has no context about the parent web app — this
> prompt is fully self-contained.

---

I want you to build a small **Flutter (Android-only) companion app** that I run on my personal phone. Its sole job is to read incoming bKash payment-received SMS, extract the transaction details, and POST them to a webhook on my web app. Think of it as a one-person back-office automation that replaces a payment gateway.

## 1. Why this exists

My web app (a SaaS product running on Vercel + Supabase) sells credit packs in BDT. Instead of integrating bKash's commercial Payment Gateway, customers send bKash to my personal Personal/Agent number, then paste the bKash Transaction ID (TrxID) into my web app. The web app records a `pending` purchase row; my Flutter app on my phone reads the SMS bKash sends me when money arrives and tells the web app "the money is here, give them their credits." The web app exposes a single webhook endpoint for this; you are building the client that calls it.

Hard constraint: this app runs ONLY on my phone. It does not need a multi-user account system, a backend of its own, or App Store distribution. Sideload via APK is fine.

## 2. Server contract (already implemented — do not change)

**Endpoint:** `POST https://<my-domain>/api/confirm-purchase`

**Headers:**
- `Content-Type: application/json`
- `X-Bkash-Webhook-Signature: <hex-encoded HMAC-SHA256 of the raw request body, using the shared secret>`

**Body** (JSON):
```json
{
  "transactionId": "AB12CD34EF",
  "senderMsisdn": "01711234567",
  "amountTaka": 200
}
```

**Response codes:**
- `200` — `{ success: true, userId, creditsGranted, newBalance }` — credits granted, you can mark this SMS done.
- `401` — signature missing or wrong. Likely a misconfigured secret; do NOT retry.
- `400` — body malformed. Do NOT retry.
- `404` — `{ code: 'no_pending_purchase' }` — the user hasn't submitted this TrxID on the web side yet (or never will). Hold this SMS in a "waiting for user submission" queue and retry every 5 min for 24 h before giving up.
- `409` — `{ code: 'msisdn_mismatch' }` — the user-claimed sender phone doesn't match the SMS-observed one. Do NOT retry; surface to the operator (me) for manual reconciliation.
- `503` — webhook misconfigured. Stop and surface to operator.
- `5xx` (other) — transient. Retry with exponential backoff: 5s, 15s, 45s, 2 min, 6 min, 18 min, then once per hour for 24 h.

**Idempotency:** the server uses the TrxID as a unique key, so it's safe to POST the same SMS twice — the second call returns 200 (or 404 if the pending row was deleted). Treat 200 OR `404 + already-confirmed-elsewhere` as terminal success on retries.

## 3. bKash SMS formats to parse

Money-received SMS on a bKash Personal account looks like this (real, redacted):

```
You have received Tk 200.00 from 01711234567. Ref ABC. Fee Tk 0.00. Balance Tk 1,234.56. TrxID 9G4K2M8N0P at 12/05/2026 14:33
```

Money-received on a bKash Merchant/Agent account:

```
Cash In Tk 200.00 from 01711234567 successful. Fee Tk 0.00. Balance Tk 1,234.56. TrxID 9G4K2M8N0P at 12/05/2026 14:33
```

Send Money / Make Payment formats (variations):

```
Make Payment of Tk 200.00 to <merchant>. Fee Tk 0.00. Balance Tk 1,234.56. TrxID 9G4K2M8N0P at 12/05/2026 14:33

Send Money received Tk 200.00 from 01711234567. Fee Tk 0.00. Balance Tk 1,234.56. TrxID 9G4K2M8N0P at 12/05/2026 14:33
```

Refund SMS (must be flagged but not POSTed to the confirm endpoint):

```
Reversal: Tk 200.00 has been credited to your Account from <merchant>. TrxID 9G4K2M8N0P at 12/05/2026 14:33
```

The fields you must extract from any of the above:
- **TrxID** — 10-character alphanumeric, after the literal `TrxID `.
- **amountTaka** — number after `Tk ` and before the space; strip the `.00`. Use the FIRST `Tk ` occurrence (some formats have multiple).
- **senderMsisdn** — the 11-digit `01XXXXXXXXX` after `from ` (only present for inbound flows; null for Make Payment).

Build a parser as a pure Dart function `BkashSms.parse(String body) -> ParsedBkashSms?` that returns null on no match. Write **table-driven unit tests** with at least 12 SMS bodies (both happy paths and edge cases: extra whitespace, no fee line, alternate date formats, refund/reversal, partial parse, malformed). Put the parser in `lib/sms/bkash_parser.dart` and the tests in `test/sms/bkash_parser_test.dart`.

Additionally implement a `BkashSms.classify(body) -> BkashSmsKind` enum: `received | sent | refund | unknown`. Only `received` SMS get POSTed.

## 4. Architecture

**Tech stack** — Flutter 3.x, Dart 3.x, Android only. Suggested packages (pick or substitute equivalents):

- `flutter_sms_inbox` or `another_telephony` — SMS read access.
- `flutter_background_service` — keeps the SMS watcher alive in the background; foreground service with persistent notification.
- `flutter_secure_storage` — encrypted shared prefs for the webhook URL + HMAC secret.
- `crypto` (built-in) — HMAC-SHA256.
- `http` or `dio` — outbound POST.
- `drift` (SQLite) — local persistence: every SMS we've seen, plus its delivery state.
- `flutter_local_notifications` — show "credits added" / "retry needed" / "error" toasts.

**Threading model** — Foreground service (`flutter_background_service`) holds an SMS broadcast receiver. On every inbound SMS, the service:
1. Filters by sender — only process SMS from sender ID `bKash` (Android exposes this as the originating address; case-insensitive match).
2. Parses with `BkashSms.parse`. If null or `classify != received`, log and stop.
3. Inserts a row into the `processed_sms` table with status `queued`. Dedupes on `(trxId, smsTimestamp)`.
4. Triggers the dispatcher (next section).

**Dispatcher** — A single in-memory queue + a periodic Workmanager job (every 1 min) that:
1. Picks up rows in `queued` and `retrying` states whose `nextAttemptAt <= now()`.
2. Builds the JSON body, computes HMAC, POSTs to the webhook.
3. On 200 — sets state `done`, shows a "✓ +5 credits granted" notification.
4. On 401 / 400 / 503 — sets state `failed`, shows an actionable notification ("Webhook misconfigured — open settings"), and stops retrying that row.
5. On 404 — sets state `waiting_user`, increments `nextAttemptAt = now + 5 min`, retries up to 288 times (= 24 h).
6. On 409 — sets state `mismatch`, shows a notification ("Sender msisdn mismatch — manual review"), stops retrying.
7. On 5xx / network — sets state `retrying`, applies the exponential backoff schedule from §2.

**Storage schema** (drift):

```
table processed_sms {
  id              integer primary key autoincrement
  trx_id          text unique not null
  sender_msisdn   text
  amount_taka     integer not null
  raw_body        text not null
  sms_timestamp   datetime not null
  state           text not null check (state in (
                    'queued','sending','retrying','waiting_user',
                    'done','failed','mismatch','ignored_refund'
                  ))
  next_attempt_at datetime
  attempt_count   integer not null default 0
  last_error      text
  created_at      datetime not null default current_timestamp
  updated_at      datetime not null default current_timestamp
}
```

## 5. UI

A single-screen app with three tabs:

**Tab 1 — Status**
- Big green "Watching for bKash SMS" indicator when the foreground service is alive.
- Big red "Stopped" with "Start service" button if not.
- Latest 10 processed SMS rows with their state badges and timestamps.
- "Last successful confirm: <time>" footer.

**Tab 2 — History**
- Full list of `processed_sms`, paginated, filterable by state.
- Tap a row → details modal: raw SMS body, parsed fields, attempts, last error, "Retry now" button (only for `retrying` / `waiting_user` / `failed` rows), "Mark as ignored" button.

**Tab 3 — Settings**
- Webhook URL — text input. Validates against `^https?://.+/api/confirm-purchase$`.
- HMAC secret — password-style input. Show/hide toggle. Stored via `flutter_secure_storage`.
- "Test webhook" button — POSTs an empty signed payload, expects 400 with `transactionId is required`. If you get 401 the secret is wrong; if 503, the server is misconfigured. Surface the result clearly.
- Battery optimization — button "Open Battery Settings" with a clear explanation of why we need to be excluded.
- SMS permission — show current status + "Open settings" button if revoked.

## 6. Permissions and edge cases

- **SMS permission** — `READ_SMS` and `RECEIVE_SMS`. On first launch, request both with a clear rationale dialog ("This app needs to read bKash SMS to credit your customers automatically. It only reads SMS from the sender 'bKash' and never sends messages.").
- **Foreground service** — `FOREGROUND_SERVICE` + `FOREGROUND_SERVICE_DATA_SYNC`. Show a persistent low-priority notification "TOP CANDIDATE bKash watcher running". This is also a UX signal that the app is alive.
- **Battery optimization** — request `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`. Without this, Android will kill the service after a few minutes idle. The Settings tab must surface the current state and offer a one-tap path to fix it.
- **Boot completion** — `RECEIVE_BOOT_COMPLETED` + a `BootReceiver` that re-starts the foreground service. Otherwise after a phone reboot the watcher is dead.
- **Doze / Standby buckets** — on Android 9+, the app may be put in a Standby Bucket that delays alarms. The 1-min Workmanager job will still fire eventually but with delay. This is acceptable — the customer sees credits in 5–10 min on the worst case.
- **Duplicate SMS** — Android can occasionally re-deliver an SMS broadcast. The unique index on `trx_id` prevents reprocessing.
- **SMS delivery while app is closed** — the broadcast receiver still wakes the service if it's registered in `AndroidManifest.xml` (not just at runtime). Ensure both runtime and manifest registrations exist.
- **Multi-SIM** — read SMS from any SIM (don't filter by SIM slot).
- **Offline mode** — if the phone has no internet, processed SMS sit in `retrying` with the backoff schedule. When connectivity returns, the periodic dispatcher catches them up.
- **Refund/reversal SMS** — classify as `refund`, store as `ignored_refund` for audit, do NOT POST. Reversals are handled out-of-band on the web side (a separate admin endpoint flips the original purchase to `refunded`).

## 7. Security

- HMAC secret never leaves the device unless the user exports it. Never log it.
- The secret is stored via `flutter_secure_storage` (Android Keystore-backed). Never write it to plain `SharedPreferences`.
- TLS-only webhook URL (reject `http://` outside debug builds).
- All HTTP errors logged WITHOUT request body (might contain customer phone numbers).
- App PIN/biometric lock — optional, gated behind a settings toggle. The customer phone numbers in the History tab are PII; if I lend my phone to someone they shouldn't browse them.

## 8. Build artifact

- Output: a debug APK (`flutter build apk --debug`) and a release APK (`flutter build apk --release` with a self-signed key). I'll sideload.
- Min SDK 24 (Android 7.0). Target SDK 34.
- Read the SMS sender ID via the platform channel — Android exposes it as `address` on the SMS payload.

## 9. Deliverables I want you to produce

1. **Project layout** as a tree (Markdown). Show every Dart file you create.
2. **`pubspec.yaml`** with pinned versions.
3. **`AndroidManifest.xml`** with all the permissions + receivers + foreground service declaration.
4. **The full Dart source** for: parser, dispatcher, storage layer, foreground service, three UI tabs.
5. **Unit tests** for the parser (≥ 12 cases) AND for the dispatcher's state machine (mock the HTTP client).
6. **A README** with: install instructions, how to set the webhook URL + secret on first launch, how to interpret each state badge, how to debug a stuck SMS.
7. **Manual QA checklist** — 8–10 scenarios I should run on a real phone before declaring it shipped.

## 10. Things you should NOT do

- Do not add user accounts, login, or cloud sync. The app is single-tenant by design.
- Do not store the HMAC secret in source. The Settings tab is the only entry point.
- Do not invent additional webhook endpoints. The server contract in §2 is fixed.
- Do not use any iOS-specific APIs. iOS does not allow programmatic SMS read; this is Android-only.
- Do not wrap the app in a Material 3 dynamic theme; keep it monochrome (single accent color, no gradients) so it reads as a tool, not a consumer app.

When you're ready, start with the project layout + `pubspec.yaml`, then the parser + tests, then the dispatcher state machine, then the foreground service wiring, then the UI. Stop and ask me before adding any third-party SDK not listed in §4.
