# Spec 09 — Manual QA Checklist

Run these scenarios on a real Android phone before shipping any build. Each
item should be reproducible from a fresh install.

## Setup

- [ ] Sideload the release APK on a phone with an active bKash personal SIM
      OR ensure you can inject test SMS via `adb shell am broadcast` (see
      bottom of file).
- [ ] In Settings tab, set webhook URL and HMAC secret.
- [ ] Tap "Test webhook" → expect green "URL and secret look correct".

## Scenarios

### 1. Happy path — real money-received SMS

- [ ] Have a friend bKash you Tk 10.
- [ ] Status tab pill turns green within 2 s of SMS arrival.
- [ ] The row appears with state badge `SENDING`, then `DONE` within 10 s.
- [ ] System notification "✓ +N credits granted" appears.
- [ ] Web app shows the customer's credits updated.

### 2. Wrong secret

- [ ] In Settings tab, change HMAC secret to a wrong value.
- [ ] Send yourself a test bKash (or inject SMS).
- [ ] Row state is `FAILED`.
- [ ] Notification "Webhook auth failed" appears.
- [ ] Row's detail view shows last_error mentioning 401.

### 3. Customer hasn't submitted TrxID

- [ ] Inject an SMS with a TrxID that the web app has never seen.
- [ ] Row state: `WAITING_USER`.
- [ ] Open History → tap row → see `attempt_count` ≥ 1.
- [ ] Wait 5–6 min, refresh: `attempt_count` increments. State still
      `WAITING_USER`.

### 4. Customer submits TrxID after SMS

- [ ] Same setup as scenario 3, then on the web app submit the TrxID.
- [ ] On the next dispatcher tick (≤ 5 min), row transitions to `DONE` and
      a "+N credits" notification fires.

### 5. Refund SMS

- [ ] Inject a reversal SMS (see body samples in `spec/02-sms-formats.md`).
- [ ] Row state: `IGNORED_REFUND`. No HTTP request made.
- [ ] Row is visible in History but not in the "due rows" path.

### 6. Phone reboot

- [ ] With the watcher running, reboot the phone.
- [ ] After reboot, open the app — Status pill is green within 10 s without
      the operator opening settings or tapping start.
- [ ] Foreground notification "bKash watcher running" is present in the tray.

### 7. Offline → online recovery

- [ ] Enable airplane mode.
- [ ] Inject a money-received SMS.
- [ ] Row state cycles through `RETRYING` with increasing backoff.
- [ ] Disable airplane mode.
- [ ] Within one minute, row transitions to `DONE`.

### 8. Duplicate SMS

- [ ] Inject the same SMS body twice (same TrxID).
- [ ] Only one row appears in the DB. The second insert is a no-op.

### 9. Battery optimization not exempted

- [ ] Re-enable battery optimization for bKash Watcher.
- [ ] Settings tab → "Battery optimization" shows `Denied` and explains risk.
- [ ] Status tab shows a yellow banner "Service may be killed by Android".

### 10. SMS permission revoked mid-session

- [ ] In Android system settings, revoke SMS permission.
- [ ] Open Settings tab → SMS permission shows `Denied`.
- [ ] Status pill turns amber "Service running but SMS read denied".

## Driving the web app's purchase states (Settings > Test tools)

Preferred over adb injection: it needs no emulator, no real money, and it runs
the same pipeline a real SMS does. Enable **Settings > Test tools** first
(default off). Every TrxID it makes starts with `TST`.

Ordering is the whole trick — the web modal reacts differently depending on
whether the payment reaches the server before or after the customer submits.

| Web state to see | Steps |
|---|---|
| Instant credit (green check) | Tap **Pay ৳200**, then paste the TrxID into the web modal and submit. The server already holds the payment, so it settles inside the submit request. |
| Verifying panel → green check | Submit the TrxID on web FIRST, then tap **Pay ৳200** within 20s. The panel flips to the check live over Realtime. |
| `likely_typo` | Tap **Pay ৳200**, then submit the **Copy typo** value on web. After 20s the modal reports the mismatch and offers a retry. Add your bKash number in the web form to get the stronger "we can see a payment from 01712•••78" wording. |
| `awaiting_sms` | Submit any unused TrxID on web and send nothing from the phone. Soft copy for the first 90s. |
| `nothing_found` | Same, but tap **Send heartbeat now** first and wait past 90s — a live watcher plus no payment is what makes the firmer copy honest. |
| `watcher_stale` | Turn on **Pause heartbeat**, wait ~5 min for the server's staleness threshold, then submit on web. Turn it back off afterwards. |
| `underpaid` | Submit the TrxID on web, then tap **Pay ৳150 (underpaid)**. |
| `msisdn_mismatch_review` | On web, expand "Add your bKash phone" and enter `01711234567`; then tap **Pay from another number**. |

**Cleanup.** These create real rows and can grant real credits to whichever
account submitted the TrxID. Sweep them afterwards:

```sql
-- inspect first
select payment_reference, status, credits_granted, created_at
from purchases where payment_reference like 'TST%' order by created_at desc;

delete from inbound_payments      where payment_reference like 'TST%';
delete from unmatched_inbound_sms where payment_reference like 'TST%';
-- purchases: prefer the admin panel so the credit ledger stays consistent;
-- pending rows also expire on their own after 24h.
```

Credits granted by a test purchase are real — deduct them from the test
account via the admin panel rather than editing `profiles` directly, so
`credit_ledger` stays truthful.

## adb test-SMS injection

To inject without a real bKash, run:

```bash
adb shell service call isms 5 i32 0 \
  s16 "com.android.phone" s16 null \
  s16 "bKash" s16 null \
  s16 "You have received Tk 200.00 from 01711234567. Ref ABC. Fee Tk 0.00. Balance Tk 1,234.56. TrxID 9G4K2M8N0P at 12/05/2026 14:33" \
  i32 0 i32 0
```

Adjust the slot indices for the Android version you're testing on; the
command above is approximate. Easier: use Android Studio's emulator → Extended
Controls → Phone → SMS.
