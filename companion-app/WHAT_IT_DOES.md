# bKash Watcher — Companion App Reference

> **Audience: the web app and any AI agent maintaining it.**
> Paste this file into the root of the web app's repository as
> `BKASH_WATCHER.md` (or similar). It describes the companion Android app
> that confirms bKash payments for the web app. The watcher repo lives
> separately; this document is all the web app needs to know.

---

## 1. The problem this solves

The web app sells credit packs in BDT. Instead of integrating bKash's
commercial Payment Gateway, customers manually:

1. Send bKash money to the operator's personal/agent number.
2. Paste the bKash **Transaction ID (TrxID)** into a form on the web app.

The web app records the purchase as `pending`. Something then needs to
confirm that the money actually arrived before credits are granted. That
"something" is the **bKash Watcher** companion app, running on the operator's
personal Android phone.

Think of the watcher as a one-person back-office automation that replaces a
commercial payment gateway. The web app never talks to bKash. The watcher
never talks to customers. They communicate over a single HTTPS webhook.

---

## 2. Roles at a glance

| Role          | Where                       | Responsibility                                          |
| ------------- | --------------------------- | ------------------------------------------------------- |
| **Customer**  | Web app                     | Pays bKash, pastes TrxID into the web app form.         |
| **Web app**   | Vercel + Supabase           | Creates `pending` purchase row, exposes confirm webhook.|
| **Operator**  | Owns one Android phone      | Receives bKash SMS automatically.                       |
| **Watcher**   | Operator's Android phone    | Reads SMS, POSTs signed confirmation to web app.        |

There is **one operator**, **one phone**, **one bKash number**. This is
single-tenant by hardware. Do not design the web app as if there could be
multiple watchers.

---

## 3. The flow, end to end

```
┌────────────┐                                                          ┌────────────┐
│  Customer  │                                                          │  Operator  │
└─────┬──────┘                                                          └─────┬──────┘
      │  (1) "Buy 100 credits for Tk 200"                                     │
      ▼                                                                       │
┌────────────────────────────────────────────┐                                │
│ Web app: create `pending_purchase` row     │                                │
│   { trxId: null, msisdn: "01711…",         │                                │
│     amount: 200, userId, status: pending } │                                │
│ Show "Pay Tk 200 to 0177xxxxxxx, then      │                                │
│ paste your TrxID below."                   │                                │
└─────────────┬──────────────────────────────┘                                │
              │  (2) Customer pays via bKash app                              │
              │                                                               │
              │  (3) Customer pastes TrxID  ─────► Web app                    │
              │      Web app updates row:                                     │
              │        { trxId: "AB12CD34EF", status: still pending }         │
              │                                                               │
              │                                                  bKash SMS    │
              │                                                      │        │
              │                                                      ▼        │
              │                                            ┌──────────────┐   │
              │                                            │ Operator's   │   │
              │                                            │ Android phone│   │
              │                                            │  (watcher)   │   │
              │                                            └──────┬───────┘   │
              │                                                   │           │
              │  (4) Watcher POSTs signed JSON to webhook         │           │
              │       /api/confirm-purchase                       │           │
              │       { transactionId, senderMsisdn, amountTaka } │           │
              │                                                   │           │
              │  (5) Web app matches by TrxID,                    │           │
              │      verifies amount + sender, grants credits,    │           │
              │      flips row to `confirmed`, returns 200.       │           │
              │                                                   │           │
              │  (6) Customer's credit balance updates            │           │
              └───────────────────────────────────────────────────┘           │
```

The web app is responsible for steps 1, 3, and 5. The watcher is responsible
for steps 4. Steps 2 and 6 are out-of-band.

---

## 4. The webhook contract (what the web app must implement)

This is the **only** point of contact between the web app and the watcher.
There are no other endpoints, no health checks, no admin APIs. Keep it
simple and stable; changing this contract requires a coordinated change
in both repos.

### Endpoint

```
POST  https://<your-web-app-domain>/api/confirm-purchase
```

The operator enters this exact URL into the watcher's Settings tab. The
URL must match the regex `^https?://.+/api/confirm-purchase$` (the watcher
validates this client-side).

### Headers

| Header                         | Value                                                                 |
| ------------------------------ | --------------------------------------------------------------------- |
| `Content-Type`                 | `application/json`                                                    |
| `X-Bkash-Webhook-Signature`    | hex-encoded HMAC-SHA256 of the **raw request body** using the shared  |
|                                | secret. The secret is operator-supplied on both sides.                |

The HMAC is computed over the **exact byte sequence** of the request body.
Verify with the same byte sequence — do not re-serialize the parsed JSON
before hashing.

#### Node.js / Next.js verification example

```ts
import crypto from 'node:crypto';

function verifySignature(rawBody: string, headerSig: string, secret: string) {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody, 'utf8')
    .digest('hex');
  // Constant-time compare to avoid timing oracles.
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(headerSig, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
```

In a Next.js Route Handler:

```ts
export async function POST(req: Request) {
  const rawBody = await req.text();        // do NOT use req.json() first
  const sig = req.headers.get('x-bkash-webhook-signature') ?? '';
  const secret = process.env.BKASH_WEBHOOK_SECRET!;
  if (!verifySignature(rawBody, sig, secret)) {
    return Response.json({ error: 'bad signature' }, { status: 401 });
  }
  const body = JSON.parse(rawBody);
  // ...handle business logic, return one of the codes below.
}
```

### Request body

```json
{
  "transactionId": "AB12CD34EF",
  "senderMsisdn": "01711234567",
  "amountTaka": 200
}
```

- `transactionId` — exactly 10 alphanumeric characters, uppercased.
- `senderMsisdn` — `01` followed by 9 digits, OR `null` for transactions
  with no customer phone (the watcher already filters most of those out,
  but be defensive: don't assume non-null).
- `amountTaka` — positive integer Taka. The watcher floors any decimal
  amount (`Tk 200.50` → `200`). bKash credit packs in this system are
  always whole-Taka, so this is acceptable.

### Response codes the web app must return

The watcher's retry logic depends on these. **Do not invent new codes.**
If you need a new condition, talk to the watcher maintainer first.

| Status | Body                                  | What it means                                                              | Watcher's reaction                                                       |
| ------ | ------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 200    | `{ success: true, userId, creditsGranted, newBalance }` | Credits granted (or already granted — idempotent). | Marks row `done`. Fires "✓ +N credits granted" notification.             |
| 400    | `{ error: 'transactionId is required' }` or similar     | Body malformed.                                    | Marks row `failed`. **Will not retry.**                                  |
| 401    | `{ error: 'bad signature' }`                            | HMAC missing or wrong.                             | Marks row `failed`. Operator alerted "Webhook auth failed".              |
| 404    | `{ code: 'no_pending_purchase' }`                       | No matching pending row for this TrxID **yet**.   | Marks row `waiting_user`. Retries every 5 min for 24 h.                  |
| 409    | `{ code: 'msisdn_mismatch' }`                           | Customer claimed sender phone X, SMS says Y.       | Marks row `mismatch`. Surfaces to operator for manual review.            |
| 503    | `{ error: 'webhook misconfigured' }`                    | Server-side misconfig.                             | Marks row `failed`. Operator alerted "Server misconfigured".             |
| 5xx    | (any)                                                   | Transient.                                         | Retries with exponential backoff: 5s → 15s → 45s → 2m → 6m → 18m → 1h, for 24 h. |

#### About 404 specifically

404 is the **load-bearing soft failure**. The flow is async: the customer
might paste the TrxID into the web app **before** the bKash SMS reaches
the operator's phone, OR **after**. If the SMS arrives first, the watcher
POSTs, the web app has no `pending_purchase` row matching that TrxID, and
should return 404. The watcher then holds the SMS in a "waiting for user
submission" queue and retries every 5 min for up to 24 h. So:

- The web app **does not** need to wait for the SMS — it can show
  "pending" to the customer immediately on TrxID submission.
- The web app **must** keep `pending_purchase` rows around for at least
  24 h after creation so a late-arriving SMS can still match.
- Stale `pending_purchase` rows older than 24 h can be cleaned up by a
  cron — the watcher will give up after 24 h regardless.

### Idempotency

The web app **must** treat `transactionId` as a unique key. A second POST
with the same `transactionId` after credits were granted must return 200
(not 409, not 200-with-fresh-credit-grant). The watcher only retries on
explicit failure responses, but a process crash mid-retry can cause a
duplicate POST. Idempotency is the safety net.

Recommended schema sketch (Supabase / Postgres):

```sql
CREATE TABLE pending_purchase (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id),
  trx_id          text UNIQUE,                       -- nullable until customer submits
  claimed_msisdn  text,                              -- what customer typed
  amount_taka     integer NOT NULL,
  credits         integer NOT NULL,
  status          text NOT NULL DEFAULT 'pending',   -- pending | confirmed | expired | refunded
  confirmed_at    timestamptz,
  confirmed_msisdn text,                             -- what bKash SMS actually said
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX pending_purchase_trx_id_unique
  ON pending_purchase (trx_id) WHERE trx_id IS NOT NULL;
```

### Webhook handler logic in plain English

```
on POST /api/confirm-purchase:
  1. Read raw body.
  2. Verify HMAC. If invalid, return 401.
  3. Parse JSON. If missing transactionId or amountTaka, return 400.
  4. Look up pending_purchase by trx_id = transactionId.
     - If found and status == 'confirmed', return 200 with stored credits.
       (idempotent)
     - If not found, return 404 with code 'no_pending_purchase'.
     - If found and claimed_msisdn differs from senderMsisdn (both
       non-null, normalize formatting), return 409 with code
       'msisdn_mismatch'. Optionally also flag the row for manual review.
     - If found and amounts mismatch by more than your tolerance, decide
       policy: usually return 409 too, OR grant only the lower amount
       and flag. Document whichever you choose.
  5. Grant credits, flip row to 'confirmed', record confirmed_at and
     confirmed_msisdn.
  6. Return 200 with { success: true, userId, creditsGranted, newBalance }.
```

---

## 5. Configuration the web app exposes to the operator

The web app should provide the operator with two pieces of information
they will paste into the watcher's Settings tab:

1. **Webhook URL**: `https://<your-web-app-domain>/api/confirm-purchase`
2. **HMAC secret**: any sufficiently random string (≥ 32 bytes
   recommended). Generate once, store in the web app's environment
   variables, share with the operator out-of-band.

The web app reads the secret from `process.env.BKASH_WEBHOOK_SECRET` (or
your project's equivalent). Rotation procedure:

1. Add the new secret as `BKASH_WEBHOOK_SECRET_NEXT`.
2. Update the verification function to accept either secret for a grace
   period.
3. Operator updates the watcher's Settings tab with the new secret.
4. Verify next inbound POST signs with the new secret.
5. Remove the old secret.

---

## 6. What the customer should see on the web app

The watcher introduces an unavoidable asynchronous gap (usually
< 30 seconds, can stretch to several minutes). The web app's UX should
account for this.

### Recommended states for the `pending_purchase` UI

| Backend state                            | What customer sees                                                                 |
| ---------------------------------------- | ---------------------------------------------------------------------------------- |
| Row created, no TrxID yet                | "Pay Tk N to 0177xxxxxxx via bKash. Once paid, paste your TrxID below."            |
| Row has TrxID, status `pending`, < 2 min | "Confirming your payment…" (spinner)                                               |
| Row has TrxID, status `pending`, 2–10 min| "Still confirming. This usually takes under a minute. Refresh in a moment."        |
| Row has TrxID, status `pending`, > 10 min| "Your payment is taking longer than usual. Contact support if it's not resolved in an hour." |
| Status `confirmed`                       | "✓ Credits added. Thank you!"                                                      |
| Status `expired` (>24 h)                 | "We never received your payment. If you paid, contact support with your TrxID."    |

### MSISDN mismatch handling

When the watcher returns a 409 for an MSISDN mismatch, the web app cannot
auto-resolve — the customer claimed they'd pay from phone X but the SMS
shows phone Y. Surface this to operations:

- Send an email / Slack notification to the operator.
- Show the customer: "We received a payment but couldn't match it to
  your account. Our team will review and contact you within 24 h."

---

## 7. Edge cases the web app should be aware of

### The operator's phone is the single point of failure

If the operator's phone is **offline** (airplane mode, dead battery,
broken), bKash SMS still arrive when service is restored — but credits
are delayed by however long the phone is offline. The web app cannot
detect this. Consider:

- A status banner on the web app like "Payments may take up to a few
  hours during off-hours" — set by hand or by a cron that checks if any
  pending purchase has been waiting too long.
- An admin dashboard showing "oldest pending purchase age". If this
  exceeds, say, 30 min, page the operator.

### The watcher only POSTs `received` SMS

The watcher will silently audit (without POSTing) these SMS types:
- Outbound payments the operator makes from their own bKash account.
- Refunds / reversals.
- iBanking deposits (the operator topping up their bKash wallet from
  their bank).
- OTPs, account-binding confirmations, promotional SMS.

If a customer claims they paid but no POST ever arrives, possible causes:
- They sent to the wrong number.
- bKash flagged the transaction.
- The SMS was malformed (very rare).
- The watcher app is dead on the operator's phone.

The web app **cannot** distinguish these from "the operator is offline".
This is a manual-resolution path.

### What the watcher does NOT do

The watcher will never:
- Initiate refunds. If a refund SMS arrives, it's audit-only on the phone.
  The web app handles refunds out-of-band (e.g. a separate admin route).
- Charge customers. It only confirms payments the customer already made.
- Send SMS or call bKash APIs. It is read-only on the SMS side.
- Talk to any endpoint other than `/api/confirm-purchase`.

### Volume

The watcher processes SMS sequentially. At ~300 ms per webhook round-trip,
a burst of 1000 SMS takes ~5 minutes to drain. For the web app this means:
during a flash sale, customers may experience a longer-than-usual
confirmation delay. The web app should not retry or show errors during
this window — the watcher's own retry logic will deliver eventually.

---

## 8. Local dev / staging

The watcher's Settings tab accepts `http://` URLs **only in debug builds**.
For local development:

- Run the web app on `http://localhost:3000` (or wherever).
- Use a tunnel like `ngrok` / `cloudflared` to give it a public HTTPS URL.
- Enter that tunnel URL into the watcher's Settings tab on a real test
  Android device.

Alternatively, the watcher's debug build will accept `http://10.0.2.2:3000`
(Android emulator's host-loopback) — but you have to be testing on the
emulator AND on a debug APK. Easier to use a tunnel.

For automated end-to-end tests on the web app side, **do not** try to
drive the watcher. Instead, have your test suite POST directly to
`/api/confirm-purchase` with a hand-computed HMAC, mimicking what the
watcher would send. The contract in §4 is the entire interface.

---

## 9. Security

- The HMAC secret never leaves the operator's phone or the web app's
  environment variables. Do not log it.
- Do not log request bodies in full — they contain customer phone
  numbers. Log `transactionId` + response status only.
- TLS only in production. The watcher refuses `http://` in release builds.
- The watcher's auth model is "shared secret only". There's no per-request
  nonce or replay protection. Idempotency on `transactionId` is the only
  thing preventing replay attacks — that's why §4's idempotency rule is
  mandatory, not optional.

---

## 10. Companion app repo

The watcher's source lives in a separate Flutter repo. If you need to
make a coordinated change (e.g. extend the request body, change a
response code), the watcher repo's `spec/01-server-contract.md` is the
authoritative document on the watcher's expectations. Update both repos
in the same change window.

The watcher is maintained primarily by AI agents under operator
supervision. It has its own `AGENTS.md` and `spec/` directory. If your AI
agent needs to look at it, point it at those files.

---

## 11. Quick reference — what to implement on day 1

For a fresh web app starting from scratch, the minimum to integrate:

1. **DB table** `pending_purchase` per §4 schema sketch.
2. **Route** `POST /api/confirm-purchase` per §4 handler logic.
3. **Env var** `BKASH_WEBHOOK_SECRET` with a random ≥ 32-byte string.
4. **Form** on the customer side: shows operator's bKash number, accepts
   TrxID, creates `pending_purchase` row.
5. **Status polling** on the customer side: customer's page polls every
   ~5 s for status changes, or use server-sent events / Supabase realtime.
6. **Operator dashboard** (optional but recommended): list of pending
   purchases, ages, statuses. So the operator can see what's stuck.

Everything else (admin tools, refund flows, analytics) is web-app
business and outside the watcher's concern.
