# bKash Watcher

A single-purpose Android app that reads bKash "money received" SMS on the
operator's phone and POSTs them to a confirm-purchase webhook on a SaaS web
app. Replaces a commercial payment gateway for low-volume BDT credit-pack
sales.

**Status: shipped to production 2026-05-17.** First real bKash payment
confirmed end-to-end on the operator's phone. The pipeline (SMS broadcast →
parse → HMAC-signed POST → server response → state transition →
notification) works against a real bKash SMS and a real `/api/confirm-purchase`
endpoint. See `WHAT_IT_DOES.md` for the wire contract.

> This codebase is maintained by AI agents. **If you are an AI agent,
> read [AGENTS.md](AGENTS.md) before doing anything.** Then read the
> relevant file under [`spec/`](spec/). Everything in this README is for
> a human operator.

## What it does

1. Foreground service listens for SMS where sender = `bKash`.
2. Parses the body → extracts `TrxID`, `amountTaka`, `senderMsisdn`.
3. POSTs `{transactionId, senderMsisdn, amountTaka}` to your webhook with
   `X-Bkash-Webhook-Timestamp` and `X-Bkash-Webhook-Signature` headers
   (HMAC-SHA256 over `"<timestamp>.<body>"`, protocol v2).
4. Retries on transient failures with exponential backoff, holds 404s for
   24 h (in case the customer hasn't pasted their TrxID yet), fails on
   400/401/503, and marks 409 (`msisdn_mismatch` / `underpaid`) as
   `MISMATCH` for manual review.

Full architecture in [`spec/03-architecture.md`](spec/03-architecture.md);
full state machine in [`spec/04-state-machine.md`](spec/04-state-machine.md).

## Install

### Prerequisites

- Android phone running Android 7.0 (API 24) or later with an active SIM
  that receives bKash SMS.
- `flutter` 3.x in your PATH.
- Java 17 + Android SDK installed (for `flutter build apk`).

### Build

```bash
flutter pub get
flutter build apk --release
```

The APK lands at `build/app/outputs/flutter-apk/app-release.apk`. Sideload
it onto your phone (transfer + tap, or `adb install`).

For development / QA, use the debug build:

```bash
flutter run -d <your-android-device-id>
```

### First-launch configuration

1. Open the app. Accept the SMS-read and notification permission prompts.
2. Go to **Settings** tab:
   - Enter your **Webhook URL** in the form
     `https://your-domain.example/api/confirm-purchase`.
   - Tap **Save URL**.
   - Enter your **HMAC secret** (the same secret your web app uses to verify
     the `X-Bkash-Webhook-Signature` HMAC). Tap **Save secret**.
   - Tap **Test webhook**. Green box → you're good. Red → see the message.
3. Tap **Open settings** next to "Battery optimization disabled" and grant
   the exemption. Without this, Android may kill the service after a few
   minutes idle.
4. **Samsung phones only — extra step:** Settings → Battery → Background
   usage limits → Apps that won't be put to sleep → add `bKash Watcher`.
   Samsung's "Freecess" mechanism can freeze the app even with battery
   optimization disabled. Skipping this on Samsung One UI 6+ will cause
   silent SMS misses when the phone has been idle for a while.
5. Switch to the **Status** tab. The pill should be green ("Watching for
   bKash SMS").

You're done. Forget about it. The next bKash SMS that arrives will be
processed automatically.

**Smoke-test before relying on it:** unplug the phone from USB, lock the
screen, wait 5 minutes, then have someone send you a small bKash payment.
Open the History tab — the row should be present and have moved through
`QUEUED → SENDING → DONE` (or `WAITING` if the matching `pending_purchase`
row didn't exist on the web app side). If the row is missing entirely,
Samsung froze the app; revisit step 4.

## State badges — what they mean

| Badge      | Meaning                                                                 |
| ---------- | ----------------------------------------------------------------------- |
| `QUEUED`   | Just arrived, waiting for the next dispatch tick (usually < 1 s).       |
| `SENDING`  | HTTP POST is in flight right now.                                       |
| `DONE`     | Webhook returned 200. Credits granted. Terminal.                        |
| `RETRYING` | Transient error (network or 5xx). Will retry with exponential backoff.  |
| `WAITING`  | The web app says "I haven't seen this TrxID yet". Retry every 5 min.    |
| `REVERSING`| Reversal SMS being POSTed to `/api/reverse-purchase`. Settles to `REFUND`.|
| `FAILED`   | Hard failure (bad signature, server misconfig, gave up after 24 h).     |
| `MISMATCH` | Customer claimed a different sender phone than the SMS. Manual review. |
| `REFUND`   | Reversal SMS, settled (POSTed to `/api/reverse-purchase` then terminal). |
| `SENT`     | Outbound payment ("Payment of Tk … to …"). Not POSTed. Audit-only.      |
| `IBANKING` | Your own bank→wallet deposit. Not POSTed. Audit-only.                   |

## Debugging a stuck SMS

1. Open **History** tab. Find the row by TrxID.
2. Tap the row → the modal shows attempts, last error, raw SMS body, and
   the next scheduled attempt.
3. If state is `RETRYING` / `WAITING` / `FAILED`, you can **Retry now**.
   That re-queues the row immediately.
4. If state is `WAITING` and the customer says they did submit on the web
   side, your web app probably never recorded the pending row — check
   server logs.
5. If state is `FAILED` with "HTTP 401", your HMAC secret is wrong. Open
   Settings, save the correct secret, **Retry now**.
6. If state is `MISMATCH`, the customer claimed a phone number that
   doesn't match what bKash actually showed. Open the row, decide
   manually, then either grant credits on the server side or
   **Mark as ignored**.

## Logs

`flutter logs` while connected via USB shows the live stream. Notable
loggers: `webhook`, `dispatcher`, `sms_listener`, `bg_service`.

## Spec / architecture

See [`spec/`](spec/) — ten Markdown files, ~30 minutes to read. Start
with `spec/00-overview.md`.

| File                                                 | Topic                            |
| ---------------------------------------------------- | -------------------------------- |
| `spec/00-overview.md`                                | What this app is and isn't.      |
| `spec/01-server-contract.md`                         | Webhook endpoint / HTTP codes.   |
| `spec/02-sms-formats.md`                             | The 5 SMS bodies + edge cases.   |
| `spec/03-architecture.md`                            | Process / threading model.       |
| `spec/04-state-machine.md`                           | Dispatcher transitions / backoff.|
| `spec/05-storage-schema.md`                          | The `processed_sms` SQLite table.|
| `spec/06-ui-spec.md`                                 | The three tabs.                  |
| `spec/07-permissions.md`                             | AndroidManifest / runtime perms. |
| `spec/08-security.md`                                | Threat model / controls.         |
| `spec/09-qa-checklist.md`                            | Manual QA before each release.   |

## Running tests

```bash
flutter test
```

Tests cover:

- Parser: 15+ table-driven cases over the 5 SMS formats and their edge
  cases. See `test/sms/bkash_parser_test.dart`.
- Backoff: every entry in the schedule. See `test/dispatch/backoff_test.dart`.
- Dispatcher state machine: every HTTP status → transition + the full
  pipeline with a fake DAO. See `test/dispatch/dispatcher_test.dart`.

## License

Internal tool. No license granted. Copy as you wish for your own ops.
