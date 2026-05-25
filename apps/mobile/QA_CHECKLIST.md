# Manual QA Checklist — bKash Watcher (mobile)

A human tester runs every item below on a real Android phone. Each test is
written as **Do this** → **Expect this**. Check the box once the expected
result is observed.

If anything you read here mentions a developer term you don't understand,
skip to **Glossary** at the bottom of this file.

> **Companion doc (read first if web-side help is needed):**
> [`apps/web/prompt-from-mobile/2026-05-25-qa-support.md`](../web/prompt-from-mobile/2026-05-25-qa-support.md)
> — tells the web team exactly what they must set up so this checklist can
> be run end-to-end.

---

## ⚠️ Single-environment safety notes — READ FIRST

There is **only one database / one environment** (no separate staging).
Tests run against the same DB real customers use. This means:

1. **Never touch live server config.** Do NOT ask the web team to
   unset / change `BKASH_WEBHOOK_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`,
   `ADMIN_API_KEY`, or the bKash payment number. Anything that breaks
   the webhook breaks **real customer purchases**. Any QA case that
   would require this is marked **SKIP — needs separate env** below.
2. **Use the dedicated QA test user** the web team gives you (see §0.1).
   Do not test under any real customer account.
3. **All synthetic TrxIDs start with the prefix `QA-`.** Examples:
   `QA-WAIT001`, `QA-UNDER01`, `QA-MSDN001`, `QA-REV0001`. This makes
   cleanup unambiguous — the web team can delete every QA row with one
   query. Never reuse a real customer's TrxID.
4. **Run the full cleanup checklist (§20) when QA is over** so the
   admin panel doesn't carry test rows into the next operator session.
5. **Avoid sending real bKash money** unless explicitly testing the
   real money flow (§3.1 only). Every other section can be exercised
   by SMS injection + a seeded pending row.

---

## 0. Before you start

### 0.1 Things you need

- [ ] An Android phone (Android 7.0 or newer) with an active SIM that can
      receive real bKash SMS, **or** an Android emulator with the ability
      to send fake SMS (Android Studio → Extended Controls → Phone → SMS).
      **Emulator is preferred** — it lets you fabricate SMS bodies for
      §4–§10 without touching real bKash.
- [ ] A second phone or laptop where you can log into the **web app** as a
      test customer.
- [ ] The release APK file (e.g. `app-release.apk`), shared by the
      developer.
- [ ] The **webhook URL** for the live environment (looks like
      `https://<live-host>/api/confirm-purchase`). There is only one
      environment — this is the same URL real customers' purchases hit.
- [ ] The **HMAC secret** the live webhook expects. You'll paste this
      into the mobile app's Settings; you will **not** be asked to change
      the value on the server.
- [ ] The **bKash payment phone number** (the live one — there is no
      separate test number).
- [ ] A **dedicated QA test customer account** (email + password)
      provided by the web team. **Do not test under a real customer
      account.**
- [ ] The **Admin Panel password** (`ADMIN_API_KEY`) so you can open
      `/admin` on the website and watch what happens server-side.

### 0.2 Things to install the app

- [ ] Open the APK file on the phone. If Android asks, allow "Install from
      this source".
- [ ] Tap **Install**.
- [ ] Tap **Open** when the install finishes. The app icon name is
      `bKash Watcher`.

### 0.3 First-launch permissions

When the app opens for the very first time, Android shows a few prompts.
Accept them all.

- [ ] **SMS permission** prompt appears.
  Expect this: Tap **Allow**. The prompt should close.
- [ ] **Notification permission** prompt appears (only on Android 13 or
      newer).
  Expect this: Tap **Allow**.
- [ ] **"Keep the watcher running"** dialog appears (about battery
      optimization).
  Expect this: Tap **Open settings**. Android's battery settings open.
      Find `bKash Watcher` and choose **Don't optimize** (wording varies).
      Press back to return to the app.
- [ ] (Samsung phones only) Settings → Battery → Background usage limits →
      "Apps that won't be put to sleep" — add `bKash Watcher` here too.

---

## 1. Settings tab — first configuration

Open the **Settings** tab (rightmost tab at the top).

### 1.1 Webhook URL field

- [ ] Do this: Leave the field empty and tap **Save URL**.
  Expect this: A red error message appears under the field telling you
      the URL must look like `https://…/api/confirm-purchase`. Nothing
      is saved.
- [ ] Do this: Type `not a url` and tap **Save URL**.
  Expect this: Same red error message. Nothing is saved.
- [ ] Do this: Type `http://example.com/api/confirm-purchase` (notice the
      missing `s` in `https`) and tap **Save URL**.
  Expect this: Red error message saying only `https://` is allowed.
- [ ] Do this: Paste the full real webhook URL from §0.1 and tap
      **Save URL**.
  Expect this: Green confirmation message **"Webhook URL saved"** appears
      briefly at the bottom of the screen.

### 1.2 HMAC secret field

- [ ] Do this: Look at the secret field. By default the text is hidden
      (dots).
  Expect this: The label says **"HMAC secret"** and the eye icon on the
      right is closed.
- [ ] Do this: Tap the eye icon.
  Expect this: The icon changes and any text you type will become
      visible. Tap again to hide.
- [ ] Do this: Leave the field empty and tap **Save secret**.
  Expect this: Nothing happens. No confirmation message.
- [ ] Do this: Type the real HMAC secret from §0.1 and tap **Save secret**.
  Expect this: Green confirmation **"HMAC secret saved"**. The field
      empties. The label now says **"HMAC secret (•••••••• saved — enter
      to replace)"**.

### 1.3 Test webhook button

- [ ] Do this: Tap **Test webhook**.
  Expect this: The button briefly says **"Testing…"**. Within 5 seconds a
      **green box** appears below saying **"URL and secret look correct"**
      with a check mark.

### 1.4 Test webhook — error cases

- [ ] Do this: Go back to the secret field, type any wrong value (e.g.
      `wrongsecret`), tap **Save secret**, then tap **Test webhook** again.
  Expect this: A **red box** appears saying **"HMAC secret is wrong"**.
- [ ] Do this: Save the correct secret again, then turn on airplane mode
      and tap **Test webhook**.
  Expect this: A red box appears saying **"Could not reach server
      (network)"** or similar. Turn airplane mode back off.

### 1.5 Permissions section

- [ ] Do this: Look at the **SMS read** row.
  Expect this: A green check + the word **"Granted"** on the right.
- [ ] Do this: Look at the **Notifications** row.
  Expect this: Green check + **"Granted"** (if Android 13+).
- [ ] Do this: Look at the **Battery optimization disabled** row.
  Expect this: Green check + **"Exempt"** if you completed §0.3. Otherwise
      amber/yellow icon + **"Open settings"** button.

---

## 2. Status tab — service health

Open the **Status** tab (leftmost tab).

### 2.1 Service running pill

- [ ] Do this: Look at the top of the screen.
  Expect this: A **large green pill** says **"Watching for bKash SMS"**.
      In the app bar (very top), the small dot next to the title
      "bKash Watcher" is **green**.

### 2.2 Footer

- [ ] Do this: Read the two grey lines under the pill.
  Expect this: They say **"Last successful confirm: —"** and **"Last SMS
      seen: —"** (a dash means "nothing yet") until you complete real
      tests below.

### 2.3 Recent activity list

- [ ] Do this: Scroll down on the Status tab.
  Expect this: The list under **"Recent activity"** says **"No SMS
      processed yet."** on a fresh install.

### 2.4 Pull to refresh

- [ ] Do this: Pull the page down from the top and release.
  Expect this: A small spinning circle appears for ~1 second, then the
      page refreshes. No errors.

### 2.5 Foreground notification

- [ ] Do this: Swipe down from the top of the phone to see the
      notification tray (do NOT swipe the app away — leave it running).
  Expect this: A persistent (cannot be swiped away) notification reads
      **"bKash watcher running — Listening for bKash SMS and confirming
      purchases."**

---

## 3. Happy path — a real customer purchase

This is the single most important test. You need the web team to do part
of it (see §0.1 and the companion doc).

> **Note for single-env testing:** this test moves **real money** to the
> live operator bKash number. The TrxID is whatever bKash assigns — it
> will **not** start with the `QA-` prefix. Track that TrxID separately
> so the web team can clean up the granted 5 credits + the `completed`
> purchase row after QA (see §20).

### 3.1 Customer creates a pending purchase on the web

- [ ] Do this: On the second device/laptop, log in to the website as
      the dedicated QA test customer (the account the web team gave you
      in §0.1 — **not** any real customer account).
- [ ] Do this: Click the **Buy credits / Buy generations** button (top
      right). The purchase modal opens showing the bKash payment number
      and **৳200**.
- [ ] Do this: Send **exactly ৳200** in bKash from any real bKash account
      to the displayed number. (If you don't have real bKash, ask the web
      team to insert a row directly — see the companion doc for the
      "Seed pending row" workflow.)
- [ ] Do this: After you've sent the bKash, in the modal type the real
      bKash **TrxID** (e.g. `9G4K2M8N0P`) and the **sender phone** you
      sent from. Click **Submit**.
  Expect this: The modal closes and a small pill in the navbar says
      **"Verifying purchase…"**.

### 3.2 Watcher receives the SMS

- [ ] Do this: Bring the **operator phone** (the one running the watcher)
      to the front. Wait for the bKash SMS to arrive.
  Expect this on the operator phone:
      - The Status pill stays green.
      - Within ~2 seconds of the SMS landing, the "Recent activity" list
        shows a new row with the TrxID and the badge **QUEUED** or
        **SENDING**.
      - Within ~10 seconds the badge changes to **DONE** (green).
      - A pop-up notification appears: **"Credits granted — A bKash
        payment was confirmed and credits delivered."**
- [ ] Do this: Look at the customer's browser (other device).
  Expect this: The "Verifying purchase…" pill disappears and the credits
      counter goes up by 5.
- [ ] Do this: Pull-to-refresh the Status tab.
  Expect this: **"Last successful confirm"** now shows **"a few seconds
      ago"**. **"Last SMS seen"** also updated.

### 3.3 Open the row in History

- [ ] Do this: Open the **History** tab.
  Expect this: The row from §3.2 is at the top with green **DONE** badge.
- [ ] Do this: Tap the row.
  Expect this: A bottom sheet opens with:
      - The TrxID in big monospace text + a small copy icon.
      - **Sender** (the phone number), **Amount** (`Tk 200`), **Received**
        time, **Attempts** (1), and no last error.
      - The raw SMS body shown in a grey monospace box.
      - **"Retry now"** button is NOT visible (because the row is DONE).
      - **"Mark as ignored"** button IS visible.
- [ ] Do this: Tap the copy icon next to the TrxID.
  Expect this: The TrxID is copied to clipboard. (Paste it somewhere to
      confirm.)

---

## 4. SMS that should be IGNORED (not POSTed)

The watcher must classify some SMS types as "audit only" and **not** send
them to the server. Ask the web team or the developer to send a real (or
emulator-injected) SMS body for each case below to the operator phone.

### 4.1 Outbound payment SMS (`SENT`)

- [ ] Do this: Send a bKash SMS to the operator phone with body like
      `Payment of Tk 656.50 to FOODPANDA BANGLADESH LIMITED is
      successful. Balance Tk 402.19. TrxID DAP2GQMM6U at 25/01/2026 18:51`
- [ ] Open the History tab.
  Expect this:
      - The new row's badge is **SENT** (grey).
      - No notification fired.
      - On the web Admin Panel, the Pending tab has NOT changed.

### 4.2 iBanking deposit SMS (`IBANKING`)

- [ ] Do this: Send an SMS like `You have received deposit from iBanking
      of Tk 600.00 from City Bank. Fee Tk 0.00. Balance Tk 1,058.69.
      TrxID DAP6GQKGZ8 at 25/01/2026 18:50`
- [ ] Open the History tab.
  Expect this: The new row's badge is **IBANKING** (grey). No server
      request was made.

### 4.3 Random non-bKash SMS

- [ ] Do this: Send a normal SMS from any non-bKash sender (e.g. a friend
      texts "hi") to the operator phone.
- [ ] Open the History tab.
  Expect this: **No new row** appears. The SMS is dropped before parsing
      because the sender is not bKash.

---

## 5. Refund / Reversal SMS

The watcher should now treat a reversal SMS as a real event (it POSTs to
the server's `reverse-purchase` endpoint). This is **new behaviour in
v1.1.0+2** — older builds just stored these as `REFUND` without
contacting the server.

### 5.1 Reversal of a row the server knows about

Pre-step: ask the web team to make sure there is already a **completed**
purchase in the DB with TrxID `QA-REV0001` (the web team can seed this
directly — see companion doc §3.2).

- [ ] Do this: Inject a bKash SMS with body
      `Reversal: Tk 200.00 has been credited to your Account from
      <merchant>. TrxID QA-REV0001 at 25/01/2026 18:51`
- [ ] Open the History tab.
  Expect this:
      - The row's badge is **REVERSING** (amber/orange) briefly, then
        changes to **REFUND** (grey) within 10 seconds.
      - A pop-up notification appears: **"Refund recorded — A bKash
        reversal was applied — credits were rolled back."**
      - On the Admin Panel, the matching purchase now shows status
        **refunded** and the customer's credit balance has dropped by 5.

### 5.2 Reversal of a TrxID the server doesn't know

- [ ] Do this: Inject a Reversal SMS with a TrxID the server has never
      seen, e.g. TrxID `QA-NOMATCH`.
- [ ] Open the History tab.
  Expect this:
      - The row's badge is **REFUND** (grey) within ~10 seconds.
      - **No** "Refund recorded" notification appears (this is the
        silent case — common for stray reversals).
      - On the Admin Panel nothing changed.

### 5.3 Reversal while phone is offline

- [ ] Do this: Turn on airplane mode. Inject a Reversal SMS for any TrxID.
- [ ] Open the History tab.
  Expect this: The row appears with badge **REVERSING**.
- [ ] Do this: Wait ~1 minute, then turn airplane mode off.
- [ ] Do this: Wait up to 1 minute (the watcher retries automatically).
  Expect this: The badge changes to **REFUND** without you tapping
      anything.

---

## 6. "Customer hasn't pasted TrxID yet" — WAITING state

- [ ] Do this: Send an SMS with a TrxID **that the customer has NOT yet
      submitted on the website**. For example TrxID `QA-WAIT001`.
- [ ] Open the History tab.
  Expect this:
      - The row's badge is **WAITING** (purple).
      - The bottom sheet (tap the row) shows **Attempts: 1** and
        **Next attempt** about 5 minutes in the future.
      - **No notification** fires yet.
- [ ] Do this: Wait 5–6 minutes (or pull-to-refresh).
  Expect this: Attempts increases to **2** and a new "Next attempt" time
      appears.

### 6.1 Customer then submits the TrxID

- [ ] Do this: Now on the customer browser, submit the same TrxID
      `QA-WAIT001` via the purchase modal.
- [ ] Do this: On the operator phone, open the row's detail sheet and
      tap **Retry now** (or just wait up to 5 minutes).
  Expect this: Within ~10 seconds the badge changes to **DONE** (green)
      and the "Credits granted" notification fires.

### 6.2 Customer never submits — give up after 24 hours

This test takes 24 hours of real wall clock time. **Skip unless
explicitly asked to verify.** The developer can simulate by adjusting
the row's `created_at` timestamp in the database, but on the single
shared environment **only the `QA-WAIT001` row** should be edited — do
not change any other row's `created_at`.

- [ ] Do this: Leave a WAITING row alone for 24 hours.
  Expect this: After ~24 hours the badge changes to **FAILED** with a
      notification **"Unclaimed payment — A payment was never matched to
      a customer. Manual review needed."**
- [ ] Do this: Open the Admin Panel → **Orphans** tab.
  Expect this: The TrxID now appears in the Orphans list (the watcher
      dumped it to `/api/orphan-inbound-sms` before giving up).

---

## 7. Underpayment (NEW in v1.1.0+2) — 409 `underpaid`

The customer claims to send ৳200 but actually sends less.

Pre-step (web side): create a pending purchase for the test user with
TrxID `QA-UNDER01` expecting ৳200.

- [ ] Do this: Inject an SMS that says `Tk 50.00` (or any amount less
      than 200) with TrxID `QA-UNDER01`.
- [ ] Open the History tab.
  Expect this:
      - The row's badge changes to **MISMATCH** (red) within ~10 seconds.
      - A pop-up notification: **"Underpayment — Customer sent less than
        required — open admin panel to recover."**
      - The bottom sheet (tap the row) shows **Last error: HTTP 409:
        underpaid**.
- [ ] Do this: Open the Admin Panel → **Pending** tab on the website.
  Expect this: The customer's row now shows status **underpaid** with
      `observed_amount_taka = 50`.

---

## 8. Sender phone mismatch — 409 `msisdn_mismatch`

The customer claims they sent from one number, but bKash says it came
from another.

Pre-step (web side): create a pending purchase with TrxID `QA-MSDN001`
where the customer claimed sender `01700000000`.

- [ ] Do this: Inject an SMS with TrxID `QA-MSDN001` that shows it came
      from a **different** number, e.g. `01799999999`.
- [ ] Open the History tab.
  Expect this:
      - Row badge: **MISMATCH** (red).
      - Notification: **"Sender mismatch — Customer claimed a different
        phone number. Manual review needed."**
- [ ] Do this: Open the Admin Panel → Pending tab.
  Expect this: The row now sits in `msisdn_mismatch_review` status.

---

## 9. Parser failure dump (NEW)

When the watcher receives an SMS that looks like it came from bKash but
the parser can't make sense of it, the watcher should send a copy of the
raw body to `/api/admin/parser-failures` so the operator can update the
parser later.

- [ ] Do this: Send an SMS where the sender is `bKash` (or anything
      containing "bkash") but the body is garbage, e.g.
      `Hello this is not a real bKash message`.
- [ ] Open the History tab.
  Expect this: **No row appears** in the History tab (this SMS could not
      be parsed, so the watcher does not store it).
- [ ] Do this: Open the Admin Panel → **Parser failures** tab.
  Expect this: A new entry appears with the verbatim body
      `Hello this is not a real bKash message`, plus the timestamp.

---

## 10. Orphan dump (give-up branch)

This is the matching server side of §6.2. It only fires after 24h on a
WAITING row, or when the developer accelerates the clock for testing.

- [ ] Do this: After §6.2 completes (or simulated), open Admin Panel →
      **Orphans** tab.
  Expect this: The TrxID from §6.2 is listed with the raw SMS body and
      timestamp. The operator can match it to a pending row from there.

---

## 11. Retry-now and Mark-as-ignored buttons

- [ ] Do this: In History, find any row whose badge is **WAITING**,
      **RETRYING**, or **FAILED**. Tap the row.
  Expect this: The bottom sheet shows two buttons at the bottom:
      **"Retry now"** (filled) and **"Mark as ignored"** (outlined).
- [ ] Do this: Find a row whose badge is **DONE** or **REFUND**. Tap it.
  Expect this: Only **"Mark as ignored"** is visible. **"Retry now"** is
      hidden.
- [ ] Do this: On a WAITING row, tap **Retry now**.
  Expect this: The sheet closes. The badge briefly becomes **SENDING**.
- [ ] Do this: On a FAILED row, tap **Mark as ignored**.
  Expect this: The sheet closes. The row's last error becomes
      **"manually ignored"**. (You can verify by tapping the row again.)

---

## 12. History tab filters and paging

- [ ] Do this: Look at the row of chips at the top of the History tab.
  Expect this: Chips for **all**, **queued**, **sending**, **retrying**,
      **waiting**, **reversing**, **done**, **failed**, **mismatch**,
      **refund**, **sent**, **ibanking**.
- [ ] Do this: Tap **done**.
  Expect this: The list now only contains rows with green **DONE**
      badges. Others disappear.
- [ ] Do this: Tap **all** to return to the unfiltered list.
- [ ] Do this: Scroll to the very bottom of the list.
  Expect this: A small spinner appears briefly, then more rows load
      (only if there are more than 50 rows). If you have under 50 rows,
      no spinner appears.
- [ ] Do this: Pull down from the top of the list.
  Expect this: The list reloads from page 1.

---

## 13. Duplicate SMS (same TrxID arrives twice)

- [ ] Do this: Inject the exact same SMS body twice (same TrxID).
  Expect this: Only **one** row appears in History. The second insert is
      silently ignored.

---

## 14. App lifecycle

### 14.1 App closed but service running

- [ ] Do this: Press the recent-apps button (square) and swipe
      `bKash Watcher` away.
- [ ] Do this: Swipe down to see the notification tray.
  Expect this: The **"bKash watcher running"** notification is **still
      there**. The service kept running.
- [ ] Do this: Inject a money-received SMS.
  Expect this: The watcher still processes it. (Re-open the app and
      check History.)

### 14.2 Phone reboot

- [ ] Do this: Restart the phone (full reboot, not just lock screen).
- [ ] Do this: Wait 30 seconds after the phone boots back up.
  Expect this: The persistent **"bKash watcher running"** notification
      should reappear automatically. No need to open the app.
- [ ] Do this: Open the app.
  Expect this: Status tab pill is green within ~5 seconds.

### 14.3 Battery optimization re-enabled (negative case)

- [ ] Do this: Open Android Settings → Apps → bKash Watcher → Battery →
      switch back to **Optimized**. Reopen the watcher app → Settings tab.
  Expect this: The "Battery optimization disabled" row now shows an
      amber icon and the button reads **"Open settings"**.
- [ ] Do this: Tap **Open settings** and revert it to **Don't optimize**.
      Return to the app.
  Expect this: The row goes back to green **"Exempt"**.

### 14.4 SMS permission revoked mid-session

- [ ] Do this: Open Android Settings → Apps → bKash Watcher → Permissions
      → SMS → **Deny**. Reopen the watcher app → Settings tab.
  Expect this: The **SMS read** row now shows amber + **"Request"**
      button.
- [ ] Do this: Tap **Request**.
  Expect this: Android prompts again. Tap **Allow**. The row turns
      green.

---

## 15. Offline / online recovery

- [ ] Do this: Turn airplane mode **on**. Inject a normal money-received
      SMS.
- [ ] Open the History tab.
  Expect this:
      - The row appears with badge **RETRYING** (amber) within ~10
        seconds.
      - Tapping the row shows **Last error** containing the word
        "network" or "timeout", and **Next attempt** ~5–15 seconds in
        the future.
- [ ] Do this: Wait 30 seconds.
  Expect this: The badge stays **RETRYING** and the attempts counter
      grows.
- [ ] Do this: Turn airplane mode **off**.
- [ ] Do this: Wait up to 1 minute.
  Expect this: The row flips to **DONE** automatically without you
      doing anything.

---

## 16. Wrong webhook configuration

### 16.1 Wrong secret

- [ ] Do this: In Settings, save a wrong HMAC secret. Inject any
      money-received SMS.
  Expect this:
      - Row badge: **FAILED** (red).
      - Notification: **"Webhook auth failed — HMAC secret is wrong. Open
        Settings to fix it."**
      - Bottom sheet shows last_error mentioning HTTP 401.
- [ ] Do this: Save the correct secret. Open the failed row → **Retry
      now**.
  Expect this: The row eventually becomes **DONE** (if there's still a
      pending purchase) or **WAITING** (if it expired).

### 16.2 Wrong URL host

- [ ] Do this: In Settings, save URL
      `https://this-host-does-not-exist.example.com/api/confirm-purchase`.
- [ ] Do this: Tap **Test webhook**.
  Expect this: A red box: **"Could not reach server (network)"** or
      similar.
- [ ] Do this: Restore the real URL.

### 16.3 Server reports 503 — **SKIP (needs separate env)**

This would require temporarily un-setting `BKASH_WEBHOOK_SECRET` on the
**live** server, which would break real customer purchases. Skip this
test in the single-env setup. The 503 → `FAILED` transition is covered
by the dispatcher unit tests (`test/dispatch/dispatcher_test.dart`).

---

## 17. Visual / theme

- [ ] Do this: Switch the phone to **dark mode** in Android Settings.
      Open the app.
  Expect this: The app uses dark backgrounds and light text. Badges are
      still readable. No bright white flashes.
- [ ] Do this: Switch back to light mode.
  Expect this: The app switches accordingly. No restart needed.
- [ ] Do this: Look at the app bar.
  Expect this: The title is **"bKash Watcher"** with a small green/red
      dot next to it. The three tab labels read **Status**, **History**,
      **Settings**.

---

## 18. Notifications — content + tap behaviour

- [ ] Do this: Trigger any operator notification (e.g. complete a happy
      path so "Credits granted" fires).
- [ ] Do this: Swipe down → tap the notification.
  Expect this: The app opens to the home page (Status tab or last-used
      tab).

---

## 19. Security checks (visual)

- [ ] Do this: In Settings, save a real HMAC secret. Lock and unlock the
      phone. Re-open the app → Settings.
  Expect this: The secret field is empty and the label reads
      **"HMAC secret (•••••••• saved — enter to replace)"**. The real
      secret value is NEVER shown.
- [ ] Do this: Try to find the secret anywhere in the app UI (History
      bottom sheet, Status tab, etc.).
  Expect this: The secret is not displayed anywhere outside the input
      field placeholder.

---

## Known Issues / Needs Clarification

Things the tester might run into where the expected behaviour is not
fully specified. Report what you observe; don't mark the test as failed
without confirming with the developer.

- **Tapping a notification** does not currently jump straight to the
  History row that triggered it — it opens the app to the last-used
  tab. Behaviour for "tap to deep-link to a row" is **not yet
  implemented**. Flag this if it ever does deep-link unexpectedly.
- **Biometric app lock** is mentioned in the design spec (§6.6) but is
  out of scope for v1. There is no biometric prompt today; do not test
  this scenario.
- **"Mark as ignored"** sets a row to `FAILED` with the literal text
  `"manually ignored"`. There is no separate `IGNORED` state. This is
  intentional but can look confusing.
- **Workmanager periodic tick** is supposed to fire every 15 minutes as
  a safety net. On some Android skins (MIUI, OxygenOS, One UI) it can
  fire less often. The watcher should still process SMS via the live
  receiver — the 15-minute tick is a fallback. Do not flag missed ticks
  unless live SMS reception also broke.
- **Underpayment notification body text** says "open admin panel to
  recover" but the app does not link to the admin panel itself. The
  operator opens it manually in a browser.
- **Reversal that arrives before the original purchase is `completed`**
  (rare race): the server should respond 404 and the watcher marks the
  row `REFUND` silently. If this case fires a "Refund recorded" toast
  by mistake, file a bug.

---

## 20. Cleanup after QA (single-environment hygiene)

Because all tests ran on the live DB, the admin panel now carries
synthetic QA rows. Walk through this list **before declaring QA done**
so the operator's next admin session isn't cluttered.

### 20.1 Tell the web team you're finished

- [ ] Send the web team a short note: "QA finished, please run cleanup."
      Include:
      - The list of QA TrxIDs you used (anything starting with `QA-`).
      - The **real** TrxID from §3.1's happy-path bKash payment (since
        it doesn't start with `QA-`) so they can decide whether to keep
        the granted 5 credits or refund them.
      - The test user account they gave you, so they can decide whether
        to reset its credit balance.

### 20.2 Mobile-side cleanup

- [ ] On the operator phone, open the watcher app → Settings tab.
- [ ] Re-enter the **correct** HMAC secret if you saved a deliberately
      wrong one for §16.1 and forgot to revert. Tap **Test webhook** —
      expect the **green** "URL and secret look correct" box.
- [ ] Re-enter the **correct** webhook URL if you saved a wrong one for
      §16.2.
- [ ] Confirm the Status tab pill is green and the foreground
      notification is back.

### 20.3 Sanity-check the live flow still works

- [ ] Ask the web team to confirm one **real** (non-`QA-`) pending row
      from before QA — if any exists — still moves to `completed` on
      its next watcher tick. (If no such row exists, skip this check.)
- [ ] Watch the Admin Panel's Pending tile for ~5 minutes after cleanup.
      Nothing unusual should appear.

### 20.4 Web team's cleanup responsibilities

(Listed here so you can verify; the web team executes these.)

- [ ] Delete every `purchases` row where `payment_reference LIKE 'QA-%'`.
- [ ] Delete every `unmatched_inbound_sms` row where
      `payment_reference LIKE 'QA-%'` (this is where §10's orphan dump
      lands; the column is `payment_reference`, not `transaction_id`).
- [ ] Delete the parser-failure rows added by §9. Parser failures live
      in `unmatched_inbound_sms` with a synthetic primary key of the form
      `PARSE_FAIL_<sha8>` — clean them with
      `DELETE FROM unmatched_inbound_sms WHERE payment_reference LIKE 'PARSE_FAIL_%'`
      (there is no separate `parser_failures` table).
- [ ] Decide what to do with the QA test user's credit balance —
      probably reset to 0.
- [ ] Decide what to do with the **real** TrxID from §3.1 — keep it as
      a real purchase, or refund + delete.

---

## Reporting issues

For every failing item, please collect:

1. **The test number and title** (e.g. `7. Underpayment — step 2`).
2. **What you actually saw** vs the expected line.
3. **A screenshot of the History row's detail sheet**, which contains
   attempts, last error, and the raw SMS body — that's almost everything
   a developer needs to investigate.
4. **The exact time** (Bangladesh time is fine).
5. If the server side is involved, the matching state from the Admin
   Panel (Pending / Orphans / Parser failures).

Send the report to the developer along with any other context.

---

## Glossary (for non-technical testers)

- **bKash** — the Bangladeshi mobile-money service this app monitors.
- **SMS** — a normal text message. bKash sends one every time money moves.
- **TrxID** — Transaction ID. A 10-character mix of letters and digits
  that bKash assigns to every payment. The customer types this into the
  website; the watcher reads it from the SMS.
- **Webhook** — a URL the watcher sends data to. In our case
  `…/api/confirm-purchase`.
- **HMAC** — a short cryptographic signature the watcher attaches to
  every webhook call so the server knows the call is real. It is built
  from the **secret** + the body of the message.
- **HMAC secret** — a long random string. Same value on both phone and
  server. Treat it like a password.
- **Pending purchase** — a row on the server saying "this customer says
  they paid; waiting for SMS confirmation."
- **Admin Panel** — the `/admin` page on the website where you
  can see what the server knows. Requires the **Admin API key**.
- **Operator phone** — the Android phone where this app runs.
- **Inject SMS** — send a test SMS to the operator phone, usually via the
  Android Studio emulator's "Phone → SMS" feature or by asking a real
  person to send one.

---

Last reviewed: 2026-05-25. App version under test: **1.1.0+2**.
