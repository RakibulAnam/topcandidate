# Spec 04 — Dispatcher State Machine

## States

```
queued           ← just inserted, waiting for first dispatch tick.
sending          ← in-flight HTTP POST.
done             ← terminal. 200 OK received.
failed           ← terminal. 400/401/503/other-non-retryable.
mismatch         ← terminal. 409 received (msisdn_mismatch or underpaid).
waiting_user     ← 404 received; retry every 5 min for 24 h.
retrying         ← 5xx / network; backoff per §3 below.
reversing        ← refund/reversal SMS pending dispatch to
                   /api/reverse-purchase. Exits to ignored_refund.
ignored_refund   ← refund SMS that has been ack'd by the server (or for
                   which dispatch was abandoned). Terminal, audit-only.
ignored_sent     ← outbound payment SMS, audit-only, never POSTed.
ignored_ibanking ← operator's own bank→wallet deposit, audit-only, never POSTed.
```

The Dart enum:

```dart
enum ProcessedSmsState {
  queued, sending, retrying, waitingUser, reversing,
  done, failed, mismatch,
  ignoredRefund, ignoredSent, ignoredIbanking,
}
```

Terminal states: `done`, `failed`, `mismatch`, `ignoredRefund`, `ignoredSent`,
`ignoredIbanking`. "Terminal" means the dispatcher will not pick the row up
again unless the operator clicks "Retry now". (The `ignored_*` states cannot
be retried — they were never dispatchable to begin with.)

`reversing` is non-terminal: refund SMS now POST to `/api/reverse-purchase`
(added in web migration 007). Prior to migration 007, refund SMS were
inserted directly into `ignored_refund` and never dispatched.

## Transitions

### From `queued` or `retrying` or `waiting_user`

| HTTP outcome     | New state       | next_attempt_at                                    | Notification?                       |
| ---------------- | --------------- | -------------------------------------------------- | ----------------------------------- |
| 200 OK (fresh)   | `done`          | null                                               | yes: "Credits granted"              |
| 200 OK + body `{"alreadyConfirmed":true}` | `done` | null                              | **suppressed** (replay of a row already confirmed earlier; the fresh-grant notification would be misleading) |
| 400              | `failed`        | null                                               | yes: "Webhook rejected body"        |
| 401              | `failed`        | null                                               | yes: "Webhook auth failed"          |
| 404              | `waiting_user`  | now + 5 min, **up to 288 attempts** (=24 h)        | no (first time); after 288 → notify |
| 409 `msisdn_mismatch` | `mismatch` | null                                               | yes: "Sender mismatch"              |
| 409 `underpaid`  | `mismatch`      | null                                               | yes: "Underpayment — open admin panel" (added migration 007) |
| 503              | `failed`        | null                                               | yes: "Server misconfigured"         |
| other 5xx        | `retrying`      | now + backoff(attempt_count)                       | no (silent until exhausted)         |
| network/timeout  | `retrying`      | now + backoff(attempt_count)                       | no (silent until exhausted)         |

`attempt_count` is incremented BEFORE computing the next delay.

### From any terminal state

Operator-initiated "Retry now" → state becomes `queued`, `next_attempt_at`
becomes null, `attempt_count` is **not** reset (so we don't loop forever on a
genuinely broken row). `last_error` is cleared.

### From `sending`

`sending` is a transient state used while the HTTP call is in flight. If the
process dies during `sending`, on next boot the dispatcher reclaims any row
stuck in `sending` for > 60 seconds and treats it as `retrying`.

### From `reversing`

Reversal SMS are dispatched to `POST /api/reverse-purchase` instead of
`/api/confirm-purchase`. The body is `{ transactionId, reason? }`. The
state transitions:

| HTTP outcome    | New state         | next_attempt_at                | Notification?                          |
| --------------- | ----------------- | ------------------------------ | -------------------------------------- |
| 200             | `ignored_refund`  | null                           | yes: "Refund recorded"                 |
| 404             | `ignored_refund`  | null                           | **no** (common case — stray reversal SMS) |
| 400 / 401 / 503 | `ignored_refund`  | null                           | yes: "Reversal dispatch failed"        |
| other 5xx       | `reversing`       | now + backoff(attempt_count)   | no (silent until exhausted)            |
| network/timeout | `reversing`       | now + backoff(attempt_count)   | no (silent until exhausted)            |

After 24h without success, a `reversing` row drops to `ignored_refund` with
a notification — the operator can replay the reversal manually from the
admin panel; a stuck reversal must not block other dispatches.

### Side-effect: orphan dump

When a row transitions from `waiting_user` to terminal `failed` because the
24h / 288-attempt budget is exhausted, the dispatcher fires a single
best-effort `POST /api/orphan-inbound-sms` with the original SMS fields
**before** the transition is persisted. The transition commits regardless
of the response — the orphan dump is observability so the operator can
reconcile, not a gating condition on the state machine.

## Backoff schedule (5xx / network)

Indices are zero-based `attempt_count` AFTER increment:

| attempt | delay      |
| ------- | ---------- |
| 1       | 5 s        |
| 2       | 15 s       |
| 3       | 45 s       |
| 4       | 2 min      |
| 5       | 6 min      |
| 6       | 18 min     |
| 7+      | 60 min     |

Continue retrying once per hour for up to 24 h total wall-clock from
`created_at`. After 24 h with no success, move to `failed` and notify
"Gave up after 24 h of transient errors".

The 5-min retry for `waiting_user` is on its own schedule (288 attempts
spaced 5 min apart, also a 24 h budget).

## Mapping 404 → done special case

If we observe a 200 for a TrxID and later somehow get a 404 for it (would
require operator "Retry now" after `done`), treat as `done` — do not regress.
In code this is implemented as: from terminal `done`, no transition occurs.

## Pseudocode

```dart
Future<void> dispatch(ProcessedSms row) async {
  await dao.update(row.id, state: ProcessedSmsState.sending);
  final response = await webhookClient.post(row);
  final next = applyResponse(row, response, now: clock.now());
  await dao.applyTransition(row.id, next);
  if (next.notify != null) await notifier.show(next.notify!);
}

DispatchOutcome applyResponse(ProcessedSms row, WebhookResponse r, ...) {
  final attempt = row.attemptCount + 1;
  final ageMillis = now.difference(row.createdAt).inMilliseconds;
  final past24h = ageMillis > Duration(hours: 24).inMilliseconds;
  ...
}
```

The full reference implementation is in
`lib/dispatch/dispatcher.dart::applyResponse`; tests in
`test/dispatch/dispatcher_test.dart` cover every row of the table above.
