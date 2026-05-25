# Web-side support needed for the mobile QA checklist

> **Progress (2026-05-26)** — Web side has confirmed: env bundle (§1)
> ready to share on demand; migration 007 + all four endpoints (§2) live
> and HMAC-reachable (verified by a live ৳30/৳200 production smoke that
> correctly returned `409 underpaid`); seed-row SQL (§3) materialised in
> the sibling `seeds.sql` file alongside this brief; cleanup queries
> (§6.2) corrected for the actual migration-007 schema (`payment_reference`
> column on `unmatched_inbound_sms`; parser failures land in the same
> table with a `PARSE_FAIL_` prefix — there is no separate `parser_failures`
> table). **Still pending** (operator-only): create the dedicated QA test
> customer account (§1) and hand the tester the env bundle. This file
> stays in place until QA finishes and the operator runs `seeds.sql`'s
> cleanup block.

> **Source**: a manual QA pass on the Flutter `bkash_watcher` app
> (v1.1.0+2) is starting. The QA tester needs a small amount of
> server-side help so they can run the checklist end-to-end without
> developer assistance after the initial environment hand-off.
>
> **Companion doc** (the actual test plan):
> [`apps/mobile/QA_CHECKLIST.md`](../../mobile/QA_CHECKLIST.md). Read its
> section numbers; this prompt only describes the *web* tasks each
> section depends on.
>
> **Delete this file** when all items below are delivered and the QA pass
> is complete.

---

## ⚠️ Single-environment constraint — READ FIRST

There is **one DB and one deployed environment** — the same one real
customers use. Two consequences:

1. **Do NOT change live server config for testing.** Specifically do
   not unset / change `BKASH_WEBHOOK_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`,
   `ADMIN_API_KEY`, or `VITE_BKASH_PAYMENT_NUMBER`. Anything that breaks
   the webhook breaks real customer purchases. The QA §16.3 "server
   reports 503" test is **skipped** for this reason.
2. **All seeded QA rows use the TrxID prefix `QA-`** so cleanup is a
   single `WHERE payment_reference LIKE 'QA-%'`. The tester will report
   exactly which `QA-…` TrxIDs they used, plus the one **real** TrxID
   from the happy-path bKash payment.

Owner of the env: read §6 "Cleanup" at the bottom of this file before
QA starts so you know what state the DB will end up in.

---

## 0. Why this exists

The watcher's behaviour is fully observable on-phone (History tab + the
foreground notification), but several QA scenarios need a known DB state
the tester cannot create on their own:

- A pending purchase row with a *specific* TrxID, *specific* amount, and
  *specific* claimed sender msisdn — so the tester can craft an SMS that
  matches it.
- A completed purchase row — so the reversal-SMS path has something to
  flip to `refunded`.
- Visibility into the Pending / Orphans / Parser-failures tabs of the
  admin panel.
- A way to temporarily break the webhook (wrong secret on the server) for
  the negative-path test.

The web team needs to do four things up-front, then stay on call for two
short on-demand actions during the test pass.

---

## 1. Hand the QA tester an environment bundle

Before testing starts, deliver one short text to the tester containing:

- [ ] **Live webhook URL**, looking like
      `https://<host>/api/confirm-purchase`.
- [ ] **`BKASH_WEBHOOK_SECRET`** — the exact value currently set on
      Vercel. The tester pastes this into the mobile app's Settings →
      HMAC secret. **They will not change it on the server.**
- [ ] **`VITE_BKASH_PAYMENT_NUMBER`** — the operator's bKash number (the
      live one — there is no separate test number).
- [ ] **`ADMIN_API_KEY`** — so the tester can open `/admin` and observe
      what happens server-side.
- [ ] **A dedicated QA test customer account** (email + password). The
      tester logs in as this user to drive the PurchaseModal. Create a
      new one specifically for QA — do not hand over a real customer's
      account.
- [ ] **The URL where the admin panel lives** (e.g.
      `https://<host>/admin`).

> **Security note**: the tester is being given a live secret. Brief them
> that the secret stays on the operator phone's Settings tab; they
> should not paste it into any other app or message.

---

## 2. Confirm migration 007 + the three new endpoints are live

The watcher (v1.1.0+2) now calls three sibling endpoints from web
migration 007. They must be deployed and reachable before QA begins.

- [ ] `POST /api/confirm-purchase` — already live; reconfirm it returns
      `409 { code: 'underpaid' }` when `amount_taka` is less than the
      pending row's expected amount (the new branch around
      `confirm-purchase.ts:164`).
- [ ] `POST /api/orphan-inbound-sms` — present and HMAC-gated. Returns
      200 on success. Used by the watcher only when a `WAITING_USER` row
      gives up after 24h.
- [ ] `POST /api/reverse-purchase` — present and HMAC-gated. Returns 200
      when the matching `completed` row exists, 404 when not.
- [ ] `POST /api/admin/parser-failures` — accepts watcher POSTs (HMAC,
      not the `X-Admin-Key` header). The shared admin handler is in
      `api/admin/_handlers/parser-failures.ts`.

Tester will verify all four via the QA checklist; this item is just to
make sure the env is in the right shape before they start.

---

## 3. Seed-data helpers — what the tester will ask for during QA

Several checklist sections need a specific row inserted **before** the
tester injects the SMS, because the watcher's response depends on the
matching pending row's `amount_taka` and `sender_msisdn`. The tester will
ask, in plain English, for the rows below. Each one corresponds to a
section of the QA checklist.

The fastest path is for the web team to run a SQL snippet against the
Supabase DB on demand. If you prefer to ship a small admin-side
helper instead, that's fine — just document the URL/curl in this file
so the tester can self-serve.

### 3.1 §6 / §7 / §8 — pending rows with specific TrxIDs

Tester will need the following rows in the `purchases` table, all
belonging to the dedicated QA test user (`<qa-user-uuid>`). Every TrxID
uses the `QA-` prefix so cleanup is a single
`WHERE payment_reference LIKE 'QA-%'` query.

| TrxID         | amount_taka | claimed sender_msisdn | status   | Used for QA §                 |
| ------------- | ----------- | --------------------- | -------- | ----------------------------- |
| `QA-WAIT001`  | 200         | `01711111111`         | pending  | §6 (waiting_user retry path)  |
| `QA-UNDER01`  | 200         | `01711111111`         | pending  | §7 (underpayment 409)         |
| `QA-MSDN001`  | 200         | `01700000000`         | pending  | §8 (msisdn mismatch 409)      |

- [ ] Provide either:
  - A SQL snippet the web dev runs once before the QA session, OR
  - A short curl/script the QA tester can run themselves (recommended:
    a one-shot `POST /api/admin/seed-pending` gated by `ADMIN_API_KEY`,
    accepting `{ user_id, trx_id, amount_taka, claimed_msisdn }` and
    inserting via service role; tear down + delete the endpoint after
    QA).

For reference, the raw insert shape per the `purchases` schema is:

```sql
insert into purchases (
  user_id, credits_granted, amount_taka, payment_reference,
  sender_msisdn, status
) values (
  '<qa-user-uuid>', 5, 200, 'QA-WAIT001', '01711111111', 'pending'
);
```

(Same for the other two — only `payment_reference` and `sender_msisdn`
change.)

### 3.2 §5.1 — a completed purchase to reverse

For the reversal happy-path the watcher needs to send a Reversal SMS
with a TrxID the server has already recorded as `completed`. Pre-seed
this row directly (don't ask the tester to drive a real bKash payment
twice — they're already doing one in §3).

| TrxID         | amount_taka | sender_msisdn  | status     |
| ------------- | ----------- | -------------- | ---------- |
| `QA-REV0001`  | 200         | `01711111111`  | completed  |

Direct insert shape (the row needs the credits_granted set so the
reverse-purchase RPC has something to subtract):

```sql
insert into purchases (
  user_id, credits_granted, amount_taka, payment_reference,
  sender_msisdn, status
) values (
  '<qa-user-uuid>', 5, 200, 'QA-REV0001', '01711111111', 'completed'
);
```

After §5.1, the QA tester will report whether the row flipped to
`refunded`. Cleanup of this row is covered in §6 below.

### 3.3 §16.3 — **DROPPED for single-env QA**

The original brief asked for a temporary `BKASH_WEBHOOK_SECRET` un-set
so the watcher would see a 503. On the single live environment this
would break real customer purchases for the duration of the test.
**Do not do this.** The 503 → `FAILED` transition is exercised by the
mobile dispatcher unit tests; the QA checklist marks §16.3 as SKIP.

---

## 4. Things the tester can already do without you

These work out of the box once §1 is delivered. Listing them so you
don't get nuisance pings:

- Drive `/api/purchase` themselves by logging in as the test user and
  using the PurchaseModal (§3.1 happy path).
- Read every state of every purchase row via the **Pending** / **Orphans**
  / **Parser failures** / **Disputes** tabs in `/admin`.
- Use **Confirm with reason** and **Refund** from the admin panel for
  recovery flows (§7, §8 cleanup).
- Verify the watcher's parser-failure POST landed (§9) by opening the
  Parser failures tab — the verbatim body will be there.
- Verify the watcher's orphan POST landed (§10) by opening the Orphans
  tab.

---

## 5. On-call expectations during the QA pass

Expect ≤ 4 short pings spread over the test session:

- One up front: "I'm starting, here's the env, am I good to go?"
- One up-front seed request: "Insert the four rows from §3.1 + §3.2."
  (Or done already if you pre-seeded.)
- One around §6.2 **only** if the tester wants to accelerate the 24h
  timer by editing `created_at` on the `QA-WAIT001` row (it's safe — the
  row is QA-prefixed, no real customer impact). They can also just skip
  the wall-clock 24h test.
- One at the end: "Here are my findings, please run the cleanup in
  §6 below."

(There is no longer a ping for §16.3 — it's dropped, see §3.3.)

---

## 6. Cleanup after QA (run when the tester says "done")

Because the test ran on the live DB, the admin panel now carries
synthetic QA rows. Run this checklist before declaring QA done so the
operator's next admin session isn't cluttered.

### 6.1 QA tester's deliverable

Expect the tester to send you a short note containing:

- The list of `QA-…` TrxIDs they actually exercised (will be a subset
  of `QA-WAIT001`, `QA-UNDER01`, `QA-MSDN001`, `QA-REV0001`, `QA-NOMATCH`,
  plus any ad-hoc ones for §4 or §13).
- The **real** TrxID (not `QA-` prefixed) from the §3 happy-path bKash
  payment they actually sent. This row is `completed` with 5 credits
  granted on the QA user. Decide whether to keep it (it's a real
  payment that landed in the operator's bKash wallet) or refund + reset.

### 6.2 Database cleanup queries

Canonical, ready-to-paste copies of these queries live in the sibling
[`seeds.sql`](./seeds.sql) file (the "QA cleanup" block at the bottom).
Use that file rather than copying from here — it is kept in sync with
migration 007's actual schema.

```sql
-- 1. Synthetic QA purchases.
delete from purchase_state_changes
  where purchase_id in (
    select id from purchases where payment_reference like 'QA-%'
  );
delete from purchases where payment_reference like 'QA-%';

-- 2. Orphan-dump landing (§10 of the QA checklist).
--    Column is `payment_reference` on `unmatched_inbound_sms` per
--    migration 007 §5 — there is no `transaction_id` column.
delete from unmatched_inbound_sms where payment_reference like 'QA-%';

-- 3. Parser-failure dump (§9 of the QA checklist).
--    Parser failures live in `unmatched_inbound_sms` with a synthetic
--    primary key prefixed `PARSE_FAIL_<sha8>` (see
--    `api/admin/_handlers/parser-failures.ts`). There is no separate
--    `parser_failures` table.
delete from unmatched_inbound_sms
  where payment_reference like 'PARSE_FAIL_%';
```

### 6.3 Credit balance + happy-path row

- [ ] Reset the QA test user's credit balance to 0 (or whatever baseline
      you started them at).
- [ ] Decide what to do with the §3 happy-path row: keep as a real
      purchase, or refund via `/api/admin/refund-purchase` and clean up.

### 6.4 Sanity check

- [ ] Open `/admin` → all tiles look normal (no spurious entries in
      Pending / Orphans / Parser failures).
- [ ] Pick one historical real customer purchase and confirm it still
      shows `completed`.

---

## 7. Out of scope for this prompt

- Anything that changes the wire contract on `/api/confirm-purchase`,
  `/api/orphan-inbound-sms`, `/api/reverse-purchase`, or
  `/api/admin/parser-failures`. The watcher and the contract doc
  ([`docs/contracts/webhook-confirm-purchase.md`](../../../docs/contracts/webhook-confirm-purchase.md))
  are aligned as of `apps/mobile/v1.1.0+2`. Coordinate any change
  through that file, not through this QA prompt.
- Mobile-side fixes. QA findings about the mobile UI should be filed
  against the Flutter codebase, not against the web team.
- Production cleanup checklist — `apps/web/ADMIN.md` "Pre-prod cleanup"
  is unrelated to this QA pass and shouldn't be re-litigated here.

---

## 8. Lifecycle of this file

Per the mirror of `apps/mobile/AGENTS.md §6.5` for the
`prompt-from-mobile/` direction:

1. The mobile session created this file.
2. The web team uses it as the active brief while supporting QA.
3. **Delete this file** once QA has finished, all items above are
   delivered, and the §6 cleanup queries have been run. Don't leave
   stale prompts in `prompt-from-mobile/` — they make a future agent
   think work is pending when it isn't. Git history is the archive.

If you finish only part of the items, leave the file in place and add a
short "Progress" line at the top describing what's done vs pending.
