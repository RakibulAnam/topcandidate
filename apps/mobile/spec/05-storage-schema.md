# Spec 05 — Storage Schema

Backed by `sqflite`. Single table.

## Table `processed_sms`

```sql
CREATE TABLE processed_sms (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  trx_id          TEXT UNIQUE NOT NULL,
  sender_msisdn   TEXT,
  amount_taka     INTEGER NOT NULL,
  raw_body        TEXT NOT NULL,
  sms_timestamp   INTEGER NOT NULL,             -- ms since epoch (OS delivery time)
  state           TEXT NOT NULL,                -- enum string, see below
  next_attempt_at INTEGER,                      -- ms since epoch, null when terminal
  attempt_count   INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE INDEX idx_processed_sms_state ON processed_sms(state);
CREATE INDEX idx_processed_sms_next_attempt ON processed_sms(next_attempt_at);
```

### Allowed `state` values

| Stored string     | Enum                                |
| ----------------- | ----------------------------------- |
| `queued`          | `ProcessedSmsState.queued`          |
| `sending`         | `ProcessedSmsState.sending`         |
| `retrying`        | `ProcessedSmsState.retrying`        |
| `waiting_user`    | `ProcessedSmsState.waitingUser`     |
| `reversing`       | `ProcessedSmsState.reversing`       |
| `done`            | `ProcessedSmsState.done`            |
| `failed`          | `ProcessedSmsState.failed`          |
| `mismatch`        | `ProcessedSmsState.mismatch`        |
| `ignored_refund`  | `ProcessedSmsState.ignoredRefund`   |
| `ignored_sent`    | `ProcessedSmsState.ignoredSent`     |
| `ignored_ibanking`| `ProcessedSmsState.ignoredIbanking` |

CHECK constraint is enforced in Dart, not in DDL, so we can evolve the enum
without migrations.

## Migrations

| Version | Change                                                |
| ------- | ----------------------------------------------------- |
| 1       | Initial schema (above).                                |

When adding a column, bump the version in `BkashDatabase` and add an
`ALTER TABLE` in `onUpgrade`.

## Queries used by the app

(Method names as in `lib/storage/processed_sms_dao.dart`.)

- `insertParsed(parsed, smsTimestamp, now)` — `INSERT OR IGNORE` on `trx_id`.
  The initial `state` is chosen by `BkashSmsKind` (received → `queued`,
  refund → `reversing`, sent → `ignored_sent`, ibankingDeposit →
  `ignored_ibanking`, unknown → `failed`).
- `dueRows(now, limit)` — rows where
  `state IN ('queued','retrying','waiting_user','reversing')`
  AND `(next_attempt_at IS NULL OR next_attempt_at <= ?)` ORDER BY id LIMIT ?.
- `markSending(id, now)` — sets state = 'sending', updated_at = now.
- `applyTransition(id, transition, now)` — sets state, next_attempt_at,
  attempt_count, last_error, updated_at.
- `reclaimStuckSending(now)` — rows where state = 'sending' AND
  updated_at < now - 60s → set state = 'retrying', next_attempt_at = now.
- `latest(limit)` — most recent rows for the Status tab.
- `page(...)` — paginated/optionally state-filtered History tab.
- `byId(id)`.
- `lastSuccessfulConfirmAt()`, `lastSmsSeenAt()` — Status tab footer.
- `retryNow(id, now)`, `markIgnored(id, now)` — row detail-sheet actions.

## Indices

`(state)` for state-filtered listing; `(next_attempt_at)` for the dispatcher's
due-row lookup.
