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
