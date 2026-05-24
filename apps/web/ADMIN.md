# ADMIN.md — operator runbook for the bKash purchase flow

> Audience: the single operator who owns the bKash receiving number and the Flutter SMS-watcher phone. Everything below assumes one person, one tenant. There is intentionally no role/permission model.

## First-time setup

1. Generate two random 32-byte hex secrets:
   ```bash
   openssl rand -hex 32   # → ADMIN_API_KEY
   openssl rand -hex 32   # → CRON_SECRET
   ```
2. Add both to Vercel's Environment Variables UI (Production + Preview + Development).
3. (Optional, recommended) Enable `pg_cron` in Supabase Dashboard → Database → Extensions, then run `supabase/migrations/007_optional_pg_cron.sql` in the SQL editor. This schedules the 24h-TTL pending-expiry every 15 min. If you stay on Vercel Hobby (which only allows once-daily Vercel Cron), this is the only way to get the 15-min cadence.
4. Open `/admin` on the deployed site. Paste `ADMIN_API_KEY` into the gate. The key is stored in your browser's localStorage; lock the panel any time via the "Lock" button.

## Daily workflow (suggested glance order)

The admin home shows four tiles at the top. Read them left to right:

| Tile | Action if non-zero |
| --- | --- |
| Pending | If "oldest" > 30 min: check the watcher (phone). If > 12h: assume the watcher is down, recover via the Pending tab. |
| Completed today | Informational. |
| Open disputes | Open the Disputes tab, resolve or reject each. |
| Orphan SMS | Open the Orphans tab, match each to a pending row. |

## Recovery playbook

### "Customer says they paid, balance still 0"

1. Open the Pending tab. Search for their TrxID.
2. If you see it in `pending`/`underpaid`/`msisdn_mismatch_review`, click **Confirm**.
3. Type a reason ("manual confirm after watcher missed the SMS" is fine). Done.
4. If you see no row at all, open the Orphans tab. Find the SMS by TrxID or sender phone. If present, use the "Match to pending" dropdown to link it. The customer's `pending` row needs to exist first — if it doesn't, the customer never submitted; ask them to submit via the modal first.

### "Customer underpaid (e.g. ৳150 for a ৳200 pack)"

By default the system rejects with 409 `underpaid` and the watcher marks the SMS terminal. The customer's pending row is now in `underpaid` status with `observed_amount_taka` filled in.

Three resolution paths:
- **Top-up arrives** — when a second bKash SMS lands for the same purchase (different TrxID per bKash rules), the operator (via the admin SPA's Orphans tab) uses "Match to pending" pointing the orphan SMS at the original pending row. `apply_purchase_topup` aggregates and flips to `completed` when the total reaches the package amount.
- **Operator decides to grant anyway** — Pending tab → Confirm with reason like "small underpayment, granted as goodwill". Internally uses `operator_confirm_purchase` with the amount-override flag set.
- **Customer wants refund** — handle the bKash refund outside the system, then mark the row `failed` (currently no in-app "mark failed" affordance for this — flag for follow-up; for now flip via SQL: `update purchases set status='failed' where payment_reference='<TrxID>';` and add a `purchase_state_changes` row).

### "Sender phone doesn't match"

The row sits in `msisdn_mismatch_review`. Open Pending tab, click Confirm. The override-msisdn flag is pre-checked because of the status. Add a reason explaining you verified the sender out-of-band.

### "bKash reversal arrived"

The Flutter watcher classifies the reversal SMS and POSTs to `/api/reverse-purchase`. The row flips to `refunded` automatically; credits decrement (may go negative — that's expected, the paid endpoints already gate on balance > 0).

If the reversal SMS arrives at an offline phone, you can do this manually via the Pending tab's refund action once the row is back in scope.

### "Watcher is stuck / phone offline / parser broken"

Open `/admin` and watch the Pending tab. Anything older than ~30 min that wasn't there an hour ago is a smell. Recovery is always "Confirm with reason" from the Pending tab — no need to touch SQL.

For parser drift specifically, open the Parser failures tab. Each row is a verbatim SMS the watcher couldn't classify. Update `apps/mobile/lib/sms/bkash_parser.dart` against that corpus.

## Endpoint reference

All admin endpoints require `X-Admin-Key: <ADMIN_API_KEY>` (timing-safe compare). All write endpoints require a non-empty `reason` field — it lands in `purchase_state_changes` for the audit trail.

| Method | Path | Purpose |
| --- | --- | --- |
| GET  | `/api/admin/dashboard` | Stat tiles for the home view |
| GET  | `/api/admin/pending?olderThanMin=N` | Stuck rows in non-terminal states |
| GET  | `/api/admin/orphans` | Unmatched inbound SMS + pending candidates |
| GET  | `/api/admin/disputes?status=open\|resolved\|rejected` | Customer-filed disputes |
| GET  | `/api/admin/parser-failures` | SMS the watcher couldn't classify |
| POST | `/api/admin/confirm-purchase` | Manual confirm (P0-B recovery path) |
| POST | `/api/admin/refund-purchase` | Manual refund |
| POST | `/api/admin/match-orphan` | Link an orphan SMS to a pending row |
| POST | `/api/admin/resolve-dispute` | Resolve / reject a dispute |

## Watcher contract

The Flutter watcher app is documented in `apps/mobile/AGENTS.md` and `apps/mobile/spec/01-server-contract.md`. The cross-app contract is canonical at [`../../docs/contracts/webhook-confirm-purchase.md`](../../docs/contracts/webhook-confirm-purchase.md). Coordinate any wire-contract changes through that file.

## Pre-prod cleanup checklist

Before exposing the purchase flow to real customers:

- [ ] Set `BKASH_MOCK_AUTOCONFIRM` and `VITE_BKASH_MOCK_AUTOCONFIRM` to `false` (or unset) in Vercel **Production**.
- [ ] Delete `api/dev-mock-confirm.ts` and the `mockConfirm` block in `PurchaseModal.tsx` (see web `AGENTS.md` §13).
- [ ] `ADMIN_API_KEY`, `CRON_SECRET`, `BKASH_WEBHOOK_SECRET`, `SUPABASE_SERVICE_ROLE_KEY` all set in Vercel Production.
- [ ] Apply migration 007 in the Supabase SQL editor.
- [ ] (Optional but recommended) Apply `007_optional_pg_cron.sql` if pg_cron is enabled.
- [ ] Send yourself a small bKash payment end-to-end and watch the customer-side VerifyingPurchasePill complete.

## Known gaps

- **Operator email digest** for stuck pending rows is not wired (no email service in the repo). The dashboard tile + the cron-driven `expired` flip cover the same operational need, but the proactive ping isn't there yet. Add when you wire an email provider.
- **Audit-log tab** + **users tab** from the larger admin-panel spec are not in this initial cut. The Pending/Orphans/Disputes/Parser-failures tabs cover the recovery paths; the broader admin surface in `topcandidate-audit-2026-05-08/PROMPT-admin-panel.md` is a separate follow-up.
