# Mobile prompt — align watcher with web's transaction-flow hardening (migration 007)

> **Origin**: web session on 2026-05-24 implemented `apps/web/topcandidate-audit-2026-05-08/PROMPT-transaction-flow-edge-cases.md`. The web side shipped migration 007, the v2 `confirm_purchase` RPC, and three new HMAC-signed endpoints that the watcher does not yet call. This prompt brings the Flutter watcher into alignment.
>
> **When you finish this work** (all changes merged on the mobile side, watcher rebuilt and verified on the operator's phone), **delete this file** per the rule added to `apps/mobile/AGENTS.md` §"prompts-from-web protocol".

---

## 0. What the web app changed

You don't need to read the web code to do this work, but you do need to know the contract changed. The canonical wire-contract reference is [`../../../docs/contracts/webhook-confirm-purchase.md`](../../../docs/contracts/webhook-confirm-purchase.md). Read it once before editing.

Summary of the web-side delta (as of 2026-05-24):

1. **`/api/confirm-purchase`** now compares `amountTaka` against the pending row's expected amount. When the SMS amount is *less than* expected, the server returns:
   ```
   HTTP 409
   { "error": "...", "code": "underpaid", "expected": 200, "observed": 50 }
   ```
   `amountTaka` is now load-bearing — without it, the underpayment check is skipped and money can leak. The watcher already sends it; just don't let a future refactor drop it.

2. **Three new endpoints exist on the server** that the watcher does NOT yet call. All three use the **same `BKASH_WEBHOOK_SECRET`** and the **same HMAC-SHA256-over-raw-body** convention as `/api/confirm-purchase` (header: `X-Bkash-Webhook-Signature`).

   | Path | Purpose | When to call |
   | --- | --- | --- |
   | `POST /api/orphan-inbound-sms` | Dump an unmatchable bKash SMS for operator reconciliation. | After a `waiting_user` row hits its 24h retry budget without a server-side match. |
   | `POST /api/reverse-purchase` | Tell the server a bKash reversal SMS arrived; server flips the matching `completed` row to `refunded` and decrements credits. | When `BkashSms.parse()` classifies an SMS as a refund/reversal. |
   | `POST /api/admin/parser-failures` | Dump an SMS the parser couldn't classify so the operator can review and update the parser. | When `BkashSms.parse()` returns null on a `bKash`-addressed SMS. |

3. **Confirm-purchase response codes the watcher already handles correctly** — no changes needed:
   - 200 fresh or `{ alreadyConfirmed: true }` → mark `done`.
   - 400 → terminal `failed`.
   - 401 → terminal `failed`, alert operator.
   - 404 → `waiting_user`, retry every 5 min for 24h.
   - 409 → terminal `mismatch`, alert operator. **This now also covers `code: 'underpaid'`** — the watcher's existing 409-as-terminal handling is correct; only the operator notification text could be more specific (see §3 below).
   - 503 → terminal `failed`, alert operator.
   - other 5xx → exponential backoff per `spec/04-state-machine.md`.

---

## 1. What you need to do, in order

### 1.1. Read these first

- `apps/mobile/AGENTS.md` (whole thing, but especially §0 "summary" and §9 "footguns")
- `apps/mobile/spec/01-server-contract.md` (current contract — you'll update this)
- `apps/mobile/spec/04-state-machine.md` (current state machine — you'll touch this lightly)
- `docs/contracts/webhook-confirm-purchase.md` (web's canonical contract — DO NOT edit; the web app owns it)

### 1.2. Add the three new client methods to `WebhookClient`

File: `apps/mobile/lib/dispatch/webhook_client.dart`.

The existing class signs requests using the operator's settings (URL base + secret). Add three new methods that POST to the new paths with the same HMAC convention. Suggested shapes (adapt to the codebase's existing patterns):

```dart
Future<WebhookResponse> postOrphan({
  required String transactionId,
  String? senderMsisdn,
  required int amountTaka,
  required String rawBody,
  required DateTime smsTimestamp,
});

Future<WebhookResponse> postReversal({
  required String transactionId,
  String? reason,
});

Future<WebhookResponse> postParserFailure({
  required String rawBody,
  String? senderMsisdn,
  DateTime? smsTimestamp,
  String? reason,
});
```

The base URL for orphan and reversal is the same `<host>/api/...` shape the existing `confirm-purchase` POST uses. For `parser-failures` the path is `/api/admin/parser-failures` (note the `/admin/` segment) — it's HMAC-signed even though it lives under the `/admin/*` tree on the server because it's a watcher-callable endpoint.

The server expects:

```
POST /api/orphan-inbound-sms
{ "transactionId": "ABC123XYZ0", "senderMsisdn": "017XXXXXXXX" | null,
  "amountTaka": 200, "rawBody": "<original SMS body>", "smsTimestamp": "<ISO 8601>" }

POST /api/reverse-purchase
{ "transactionId": "ABC123XYZ0", "reason": "<short, optional>" }

POST /api/admin/parser-failures
{ "rawBody": "<original SMS body>", "senderMsisdn": "017XXXXXXXX" | null,
  "smsTimestamp": "<ISO 8601, optional>", "reason": "<optional>" }
```

All three respond with 200 on success and 401/400/503 in the usual ways.

### 1.3. Wire the dispatcher to actually call them

File: `apps/mobile/lib/dispatch/dispatcher.dart`. Three integration points:

**(a) Orphan dump after 24h.** Currently when a `waiting_user` row hits its 288th attempt (5 min × 288 ≈ 24h) it transitions to `failed` and the SMS is just sitting on the phone. Before the transition to `failed`, call `webhookClient.postOrphan(...)` with the row's parsed fields. On 200, transition to `failed` with a note like "orphan dumped to server". On non-200, transition to `failed` with the original "gave up after 24h" reason. Don't block the state change on the orphan POST succeeding — best-effort.

**(b) Reversal SMS.** `BkashSms.parse()` already classifies reversal SMS (state `ignoredRefund` per `lib/dispatch/state.dart`). Today those rows are inserted with that ignored state and never dispatched. Change the flow so reversal-classified SMS get queued for dispatch via `postReversal(...)` instead of going straight to `ignoredRefund`. Use a new dispatch state for them (e.g. `reversing`) that transitions to `done` on 200 or `ignoredRefund` on 404 (server says no matching completed row — fine, the operator will pick it up via the admin panel).

**(c) Parser failure dump.** Where `BkashSms.parse()` returns null for a `bKash`-addressed SMS, fire `webhookClient.postParserFailure(...)` with the raw body. Best-effort; don't retry, don't track state. This is purely an observability dump so the operator can find the failures and update `bkash_parser.dart`. Log success/failure to `developer.log` with `name: 'parser_failure_dump'`.

### 1.4. Update the operator notification text

For the 409 case, the existing flow shows "Sender msisdn mismatch" (per spec §04). The server now returns 409 in two cases distinguished by the response body's `code` field: `msisdn_mismatch` (existing) and `underpaid` (new). Branch the notification message on `code`:

- `code: "msisdn_mismatch"` → existing text.
- `code: "underpaid"` → "Underpayment: customer sent less than required — open admin panel to recover".

### 1.5. Update the specs

- `apps/mobile/spec/01-server-contract.md` — add a section for the three new endpoints (path, body, response shape, HMAC). Add the 409 `underpaid` response to the existing confirm-purchase response table. Reference `docs/contracts/webhook-confirm-purchase.md` as the canonical cross-app source.
- `apps/mobile/spec/04-state-machine.md` — add the new `reversing` state (or whatever you name it) and its transitions if you went with the new-state design in 1.3(b). Note the orphan dump as a side-effect of the `failed`-from-`waiting_user` transition.

### 1.6. Update `apps/mobile/AGENTS.md`

- §2 repo map: list the new `prompts-from-web/` folder (it should be empty by the time you delete this file).
- Add a NEW section (suggested place: right after §6 "Things you must not do") titled **"prompts-from-web protocol"** with the text from §3 of this file.
- §10 production status: append "2026-05-24: aligned with web migration 007 — three new HMAC endpoints + 409 underpaid handling".

### 1.7. Verify

```bash
cd apps/mobile
flutter pub get
flutter analyze   # must be clean
flutter test      # must be green
```

Run a manual smoke on a real device or the emulator:
- Force a 409 underpaid response (have the web operator submit a pending row, then post to `/api/confirm-purchase` with a smaller amount — they have a script for this). Confirm watcher transitions to terminal `mismatch` and shows the new underpaid notification text.
- For the reversal path: feed the parser a known bKash reversal SMS shape from `apps/mobile/sms-images/` (or add one if needed) and confirm the dispatcher POSTs to `/api/reverse-purchase`.
- For the parser-failure dump: feed the parser an SMS the current `bkash_parser.dart` can't classify (corrupt a real SMS, change a token) and confirm a POST to `/api/admin/parser-failures` lands on the server.

### 1.8. When you're done

1. Confirm all three new endpoints are integrated and verified.
2. Run `flutter analyze` + `flutter test` one final time.
3. Bump `version:` in `apps/mobile/pubspec.yaml`.
4. `flutter build apk --release`, sideload to the operator's phone.
5. **Delete this file** (`apps/mobile/prompts-from-web/2026-05-24-tx-flow-hardening.md`) in the same commit as the version bump.

---

## 2. Things you should NOT do

- Do not change the wire contract unilaterally. If anything about the response shape, headers, or path needs to change, stop and coordinate with the web side — both `apps/web/`, `apps/mobile/`, AND `docs/contracts/webhook-confirm-purchase.md` move in the same PR per the monorepo's cross-app rule.
- Do not add a *new* HMAC secret for the new endpoints. They all reuse `BKASH_WEBHOOK_SECRET`.
- Do not iOS-port any of this work — `apps/mobile/AGENTS.md` §6 rule 1.
- Do not retry parser-failure dumps or reversal POSTs aggressively. The orphan POST is the only one that's worth retrying (best-effort, 1–2 attempts max). Reversals and parser failures are observability dumps; if they 5xx, log and move on.

---

## 3. The prompts-from-web protocol (copy into apps/mobile/AGENTS.md)

> When the web app makes a change that requires coordinated work on the mobile side, the web session drops a self-contained markdown prompt into `apps/mobile/prompts-from-web/<YYYY-MM-DD>-<slug>.md`. Each prompt is a complete brief for a future mobile agent — it states what the web changed, what the mobile needs to do, what files to touch, and how to verify.
>
> **Lifecycle**:
>
> 1. Web session creates the file.
> 2. A future mobile session reads `apps/mobile/AGENTS.md` first, then opens any file in `prompts-from-web/` and treats it as the active brief.
> 3. When the mobile work is complete, verified (`flutter analyze` + `flutter test` green, manual smoke on device passed), and the build is shipping, the agent **deletes the prompt file in the same commit** as the version bump.
>
> Reasoning: the folder is a queue of pending cross-app work, not an archive. A stale prompt file is worse than none — it makes a future agent think work is pending when it isn't. Git history is the archive; the file's job is to mark "work is owed". Once it's done, remove it.

---

## 4. Pointers (for context, optional reading)

- Web's migration: `apps/web/supabase/migrations/007_transaction_flow_hardening.sql`
- Web's new endpoints: `apps/web/api/orphan-inbound-sms.ts`, `apps/web/api/reverse-purchase.ts`, `apps/web/api/admin/parser-failures.ts`
- Web's amended confirm: `apps/web/api/confirm-purchase.ts` (the 409 underpaid branch is around line 165)
- Web's HMAC helper (mirror its byte-exactness convention): `apps/web/api/_lib/webhookAuth.ts`
- Operator runbook (what the operator sees when watcher fails): `apps/web/ADMIN.md`
