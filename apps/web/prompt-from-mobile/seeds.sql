-- QA support SQL for the bKash watcher manual QA pass.
-- Paired with `2026-05-25-qa-support.md` — see §3 (seed rows) and §6.2
-- (cleanup). Replace `<qa-user-uuid>` with the dedicated QA test user's
-- auth.users.id before pasting into the Supabase SQL editor.
--
-- The QA prefix `QA-` is load-bearing: cleanup keys off it, so do not
-- rename. The PARSE_FAIL_ prefix is the synthetic primary key shape used
-- by `api/admin/_handlers/parser-failures.ts` for parser-failure dumps
-- landing in `unmatched_inbound_sms`.

-- ─────────────────────────────────────────────────────────────────────
-- QA SEED ROWS — run BEFORE the QA tester starts the checklist.
-- (§3.1 + §3.2 of the brief.)
-- ─────────────────────────────────────────────────────────────────────

-- §3.1 — pending rows used by QA checklist §6 / §7 / §8.

-- QA-WAIT001 — §6 (customer hasn't pasted TrxID yet, waiting_user retry).
insert into purchases (
  user_id, credits_granted, amount_taka, payment_reference,
  sender_msisdn, status
) values (
  '<qa-user-uuid>', 5, 200, 'QA-WAIT001', '01711111111', 'pending'
);

-- QA-UNDER01 — §7 (underpayment: tester injects an SMS for Tk 50, not 200).
insert into purchases (
  user_id, credits_granted, amount_taka, payment_reference,
  sender_msisdn, status
) values (
  '<qa-user-uuid>', 5, 200, 'QA-UNDER01', '01711111111', 'pending'
);

-- QA-MSDN001 — §8 (msisdn mismatch: claimed sender 01700000000, SMS
-- arrives from a different number, e.g. 01799999999).
insert into purchases (
  user_id, credits_granted, amount_taka, payment_reference,
  sender_msisdn, status
) values (
  '<qa-user-uuid>', 5, 200, 'QA-MSDN001', '01700000000', 'pending'
);

-- §3.2 — completed row used by QA checklist §5.1 (reversal SMS flips
-- this to `refunded` and decrements credits).
insert into purchases (
  user_id, credits_granted, amount_taka, payment_reference,
  sender_msisdn, status
) values (
  '<qa-user-uuid>', 5, 200, 'QA-REV0001', '01711111111', 'completed'
);


-- ─────────────────────────────────────────────────────────────────────
-- QA CLEANUP — run AFTER the QA tester reports "done".
-- (§6.2 of the brief, corrected for migration 007's actual schema.)
-- ─────────────────────────────────────────────────────────────────────

-- 1. Synthetic QA purchases + their state-change audit rows.
delete from purchase_state_changes
  where purchase_id in (
    select id from purchases where payment_reference like 'QA-%'
  );
delete from purchases where payment_reference like 'QA-%';

-- 2. Orphan-dump landing rows (QA checklist §10).
--    The column on `unmatched_inbound_sms` is `payment_reference` —
--    migration 007 §5, around line 80. There is NO `transaction_id`
--    column on that table.
delete from unmatched_inbound_sms where payment_reference like 'QA-%';

-- 3. Parser-failure rows (QA checklist §9).
--    Parser failures live in `unmatched_inbound_sms` with a synthetic
--    payment_reference of `PARSE_FAIL_<sha8>` — see
--    `api/admin/_handlers/parser-failures.ts`. There is no separate
--    `parser_failures` table.
delete from unmatched_inbound_sms
  where payment_reference like 'PARSE_FAIL_%';
