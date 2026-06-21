# ADMIN.md — operator runbook for the bKash purchase flow

> Audience: the single operator who owns the bKash receiving number and the Flutter SMS-watcher phone. Everything below assumes one person, one tenant. There is intentionally no role/permission model.

## First-time setup

1. Generate two random 32-byte hex secrets:
   ```bash
   openssl rand -hex 32   # → ADMIN_API_KEY  (now the session-token SIGNING secret — not pasted anywhere)
   openssl rand -hex 32   # → CRON_SECRET
   openssl rand -hex 32   # → BKASH_WEBHOOK_SECRET
   ```
2. Set the owner login credentials: `ADMIN_USERNAME` (e.g. `owner`) and either `ADMIN_PASSWORD_HASH` (an scrypt `<saltHex>:<keyHex>` — preferred, see `.env.example` for the one-liner) or `ADMIN_PASSWORD` (plaintext fallback). `ADMIN_PASSWORD_HASH` takes precedence if both are set.
3. Add all of the above to Vercel's Environment Variables UI (Production + Preview + Development). Also confirm `SUPABASE_SERVICE_ROLE_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `OPENROUTER_API_KEY` (primary AI; or legacy `GROQ_API_KEY`/`GEMINI_API_KEY`), `VITE_BKASH_PAYMENT_NUMBER` are set.
4. **Run migrations in the Supabase SQL editor in order.** At minimum, migrations 007 → 008 → 009 → 010 must be applied before `/admin` works; apply the full set through 019 for current production (013 adds the analytics/BI surface the dashboard summary + Revenue/Product/System tabs read). Each file in `supabase/migrations/` is idempotent. (Migration 010 backfills `profiles.created_at` / `updated_at` — required for the Users tab, since older DBs may have been provisioned before those columns landed in `schema.sql`.)
5. **Enable `pg_cron` in Supabase** (required on Vercel Hobby) — Dashboard → Database → Extensions → enable `pg_cron`. Then paste `supabase/migrations/007_optional_pg_cron.sql` into the SQL editor and run it. This schedules the 24h-TTL pending-expiry every 15 minutes.
6. Open `/admin` on the deployed site. Log in with `ADMIN_USERNAME` + password. On success the server mints a short-lived signed session token that the SPA holds in **sessionStorage** (NOT localStorage) — closing the tab logs you out. Lock the panel any time via the **Lock** button or the **Settings → Reset session** button.

## Layout

The panel has a **left sidebar** with grouped sections (Overview · Operations · Records · System) and a **top bar** showing the current section + the global `⌘K` search. On mobile, the sidebar collapses behind a hamburger menu in the top-left.

Every write action posts a toast (top-right) on success or failure. Reason prompts accept `⌘↵` to submit, `Esc` to cancel.

## The eight tabs

| Tab | What it shows | When to open |
| --- | --- | --- |
| **Dashboard** | 4 stat tiles + a unified "action queue" that combines pending > 10m, mismatch, underpaid, expired-24h, open disputes, orphan SMS — sorted oldest-first. | Always your first stop. If the queue is empty, you're done. |
| **Users** | Searchable list (email substring / UUID). Click → UserDetail with profile, purchases, resumes, audit history, notes, plus grant/deduct/flag/note actions. | "Customer X is complaining." Find them, drill in, take action. |
| **Purchases** | Filterable list (status[], age, q). Click → PurchaseDetail with full lifecycle, state changes, audit, top-ups, overpayments, linked SMS, and a state-driven action panel. | Anytime you need to see / act on a specific transaction. |
| **Orphans** | bKash SMS the watcher saw but couldn't match to a pending purchase. Match to a pending row, or mark ignored for personal SMS. | If a customer's purchase isn't completing and you suspect their TrxID is mistyped. |
| **Disputes** | Customer-filed disputes (open / resolved / rejected). Resolve with a note or reject; click TrxID to jump to the purchase detail. | When a customer files a dispute via the in-app banner. |
| **Parser failures** | SMS the watcher couldn't classify. Bulk-select, mark reviewed, export as JSON for the Dart parser test corpus. | Periodically (monthly). When bKash changes its SMS format you'll see these spike. |
| **Audit log** | Every operator action ever, with before/after JSON diffs and the reason you typed. | When you need to remember what you did, or prove a chain of custody. |
| **Settings** | Env health (present/missing only — values never rendered), recent activity, manual cron trigger. | Sanity check after a Vercel env change, or when you want to force the pending-expiry now. |

### Global ⌘K palette

`⌘K` (Mac) / `Ctrl+K` (Linux/Windows) opens a quick jump:
- Type a TrxID → opens that purchase
- Paste a full UUID → opens that user
- Type a tab name → switches tab
- `↑` / `↓` to navigate · `↵` to open · `Esc` to close

In any list view, press `/` to focus the search input.

## Daily workflow (suggested glance order)

1. Open `/admin`. Read the 4 tiles left to right (Pending, Completed today, Open disputes, Orphan SMS).
2. Scan the action queue underneath. Click "View" / "Resolve" / "Match" on the oldest items first.
3. After everything in the queue is gone, the panel is calm. Lock or leave it open.

| Tile | Action if non-zero |
| --- | --- |
| **Pending** | If "oldest" > 30 min: check the watcher (phone). If > 12h: assume the watcher is down, recover via Purchases → Confirm. |
| **Completed today** | Informational. |
| **Open disputes** | Open the Disputes tab, resolve or reject each. |
| **Orphan SMS** | Open the Orphans tab, match each to a pending row OR mark ignored if personal. |

## Recovery playbook

### "Customer says they paid, balance still 0"

1. ⌘K, paste TrxID, hit Enter — opens PurchaseDetail.
2. If status is `pending` / `underpaid` / `msisdn_mismatch_review`: click **Confirm now** (or **Approve with override** / **Confirm (override amount)**), type a reason. Done.
3. If status is `expired` or `failed`: click **Reopen** with a reason, then Confirm.
4. If the purchase row doesn't exist: open the Orphans tab, find the SMS by TrxID or sender phone. If present, use the "Match to pending" dropdown. The customer's `pending` row must exist first — if it doesn't, the customer never submitted; ask them to submit via the modal.

### "Customer underpaid (e.g. ৳150 for a ৳200 pack)"

Row sits in `underpaid` with `observed_amount_taka` filled. Three resolutions from PurchaseDetail:

- **Top-up arrives** — Orphans tab → "Match to pending" pointing the new SMS at the underpaid row. `apply_purchase_topup` aggregates and flips to `completed` when the total reaches the package amount.
- **Grant anyway** — PurchaseDetail → "Grant pack anyway" with reason like "small underpayment, granted as goodwill".
- **Refund** — bKash refund out-of-band, then PurchaseDetail → "Force expire" (or "Reject (expire)" for the mismatch case).

### "Sender phone doesn't match"

Row sits in `msisdn_mismatch_review`. PurchaseDetail → "Approve with override" (the override flags are pre-applied based on status). Add a reason explaining you verified the sender out-of-band.

### "bKash reversal arrived"

The Flutter watcher classifies the reversal SMS and POSTs to `/api/reverse-purchase`. The row flips to `refunded` automatically; credits decrement (may go negative — that's expected, the paid endpoints already gate on balance > 0).

If the reversal SMS arrives at an offline phone, you can refund manually from PurchaseDetail → **Refund**.

### "Watcher is stuck / phone offline / parser broken"

Open Dashboard. Action queue tells you what's overdue. Recovery is always **Confirm with reason** from PurchaseDetail.

For parser drift specifically, open Parser failures. Each row is a verbatim SMS the watcher couldn't classify. Check the boxes you've reviewed, click "Mark reviewed", then "Export reviewed JSON" — pass the file to whoever updates `apps/mobile/lib/sms/bkash_parser.dart`.

### "Customer says they were wrongly charged / wants a refund"

1. PurchaseDetail → **Refund** with reason. Credits decrement (allowed below zero).
2. Process the bKash refund manually outside the app.
3. If they opened a dispute, Disputes tab → **Resolve** with the operator note explaining you refunded.

### "Customer profile looks like fraud"

1. UserDetail → **Flag user** with reason. Sets `profiles.flagged_at = now()`.
2. The flag is informational today — nothing auto-restricts. Use it to mark the profile for follow-up; the Users tab surfaces a red FLAGGED chip.
3. Add a **Note** describing what you saw (visible only in the admin panel).

### "I need to know what I did yesterday"

Audit log tab. Filter by action ("confirm_purchase") or target kind ("purchase"). Every row has a before/after JSON diff and the reason you typed.

## Maintenance

### Run pending-expiry now

Settings → "Run pending-expiry now". Fires `expire_stale_pending_purchases()` immediately, which flips any `pending` rows older than 24h to `expired`. Normally pg_cron handles this every 15 min; the manual button is for when you've changed the migration or want to verify the path.

### Rotate the admin signing secret / change the password

`ADMIN_API_KEY` is the session-token signing secret (no longer pasted by hand). Rotating it invalidates every live session.

1. Generate a new secret: `openssl rand -hex 32`.
2. Update `ADMIN_API_KEY` in Vercel (Production + Preview + Development).
3. Trigger a redeploy in Vercel (or push any commit).
4. Open `/admin` — your stored session token is now invalid; log in again.

To change the password, regenerate `ADMIN_PASSWORD_HASH` (or update `ADMIN_PASSWORD`) and redeploy.

### Rotate the bKash webhook secret

See `docs/contracts/webhook-confirm-purchase.md` for the cross-app rotation procedure — the Flutter watcher needs the new secret in the same operator action.

## Verification checklist (manual smoke test)

Run this after any admin-related change:

1. Log in with username + password, land on Dashboard. Tiles render. Action queue is consistent.
2. Find a pending purchase via search. Click **Confirm now** with a reason. Status flips, credits land on the customer.
3. Switch to Audit log. Single new entry with the right `confirm_purchase` action, your reason, the before/after diff.
4. **Refund** the same purchase from PurchaseDetail. Status flips to `refunded`, credits decrement.
5. Audit log shows both entries in time-desc order.
6. Open UserDetail, **Deduct 100** credits with a reason. Balance goes negative.
7. **Grant 100** credits back. Balance recovers.
8. Audit log shows all four entries with correct ordering and diffs.
9. Open Parser failures (if any rows exist). Select a few, **Mark reviewed**, then **Export reviewed JSON**. Confirm the file downloads.
10. Open Settings. Run pending-expiry now with reason. Verify the alert says how many rows were expired (0 is fine).
11. Click **Lock** in the header. Confirm you land on the login screen. Log in again. You're back.

## Endpoint reference

Every admin endpoint except `login` requires `Authorization: Bearer <session-token>` — the token minted by `POST /api/admin/login` (verified via signature + expiry by `requireAdmin`; the signing secret is `ADMIN_API_KEY`). All write endpoints require a non-empty `reason` field — it lands in both `purchase_state_changes` (for purchase-row actions) and `admin_audit_log`.

All endpoints route through the single Vercel function `api/admin/[action].ts` (Hobby's 12-function cap), so URLs are flat verbs:

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/admin/login` | `{ username, password }` → `{ token, expiresInSec }` (the only unauthenticated action) |
| GET  | `/api/admin/dashboard` | Stat tiles |
| GET  | `/api/admin/summary?range=day\|week\|month\|all` | Business-overview metrics (users, earnings, failures, disputes) |
| GET  | `/api/admin/action-queue` | Unified "needs attention" feed |
| GET  | `/api/admin/pending?olderThanMin=` | Non-terminal rows (pending/underpaid/mismatch) older than N min |
| GET  | `/api/admin/users?q=&page=` | Search users |
| GET  | `/api/admin/user-detail?id=` | One user's full picture |
| POST | `/api/admin/grant-credits` | `{ userId, amount, reason }` |
| POST | `/api/admin/deduct-credits` | `{ userId, amount, reason }` |
| POST | `/api/admin/user-note` | `{ userId, note }` |
| POST | `/api/admin/flag-user` | `{ userId, flagged, reason }` |
| GET  | `/api/admin/purchases?status=&q=&age=&page=` | Filtered purchase list |
| GET  | `/api/admin/purchase-detail?id=` OR `?trxId=` | Full lifecycle |
| POST | `/api/admin/confirm-purchase` | `{ transactionId, reason, overrideMsisdnCheck?, overrideAmountCheck? }` |
| POST | `/api/admin/refund-purchase` | `{ transactionId, reason }` |
| POST | `/api/admin/expire-purchase` | `{ purchaseId, reason }` |
| POST | `/api/admin/reopen-purchase` | `{ purchaseId, reason }` |
| POST | `/api/admin/grant-override` | `{ purchaseId, reason }` |
| POST | `/api/admin/purchase-note` | `{ purchaseId, note }` |
| GET  | `/api/admin/orphans` | Unmatched SMS + pending candidates |
| POST | `/api/admin/match-orphan` | `{ smsId, purchaseId, reason }` |
| POST | `/api/admin/orphan-mark-ignored` | `{ smsId, reason }` |
| GET  | `/api/admin/disputes?status=` | List disputes |
| POST | `/api/admin/resolve-dispute` | `{ disputeId, resolution, operatorNote }` |
| GET  | `/api/admin/parser-failures` | Unreviewed parser failures |
| POST | `/api/admin/parser-mark-reviewed` | `{ ids: string[] }` |
| GET  | `/api/admin/parser-export` | Downloads reviewed corpus JSON |
| GET  | `/api/admin/audit-log?action=&targetKind=&from=&to=&page=` | Audit log feed |
| GET  | `/api/admin/settings` | Env health + recent activity |
| POST | `/api/admin/settings` | `{ op: 'run-expiry' }` |
| GET  | `/api/admin/revenue-analytics` | Revenue/BI metrics (migration 013) |
| GET  | `/api/admin/revenue-export` | Revenue data export |
| GET  | `/api/admin/customer-intelligence` | Customer-intelligence metrics |
| GET  | `/api/admin/product-analytics` | Product-usage metrics |
| GET  | `/api/admin/marketing` | Marketing metrics |
| POST | `/api/admin/marketing-spend` | Record/adjust marketing spend |
| GET  | `/api/admin/system-health` | System-health metrics |

## Watcher contract

The Flutter watcher app is documented in `apps/mobile/AGENTS.md` and `apps/mobile/spec/01-server-contract.md`. The cross-app contract is canonical at [`../../docs/contracts/webhook-confirm-purchase.md`](../../docs/contracts/webhook-confirm-purchase.md). Coordinate any wire-contract changes through that file.

## Pre-prod cleanup checklist

Before exposing the purchase flow to real customers:

- [ ] `ADMIN_API_KEY` (token-signing secret), `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH` (or `ADMIN_PASSWORD`), `CRON_SECRET`, `BKASH_WEBHOOK_SECRET`, `SUPABASE_SERVICE_ROLE_KEY` all set in Vercel Production.
- [ ] Apply migrations 001 through 019 in the Supabase SQL editor (010 backfills `profiles.created_at`/`updated_at` for the Users tab; 011 adds webhook replay protection; 013 adds the analytics/BI surface).
- [ ] Apply `007_optional_pg_cron.sql` in Supabase (required for the pending-expiry cron — Vercel Hobby can't run it).
- [ ] Send yourself a small bKash payment end-to-end and watch the customer-side VerifyingPurchasePill complete.
- [ ] Walk through the verification checklist above. Confirm the audit log captures every action.

## Known gaps

- **Operator email digest** for stuck pending rows is not wired (no email service in the repo). The dashboard tile + action queue + the cron-driven `expired` flip cover the same operational need, but the proactive ping isn't there yet. Add when you wire an email provider.
- **Tests**. No test harness (Vitest / Playwright). The verification checklist above is the manual surrogate.
- **Audit transactional guarantee.** The audit write happens after the underlying RPC, not in the same transaction. Migration 009's header explains the trade-off; cross-check with `purchase_state_changes` if you suspect a missing audit row.
