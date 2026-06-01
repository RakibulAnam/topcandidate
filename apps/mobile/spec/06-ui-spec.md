# Spec 06 — UI

## Design principles

- **Monochrome.** One accent color (`#0E7C66` — deep teal). No gradients, no
  dynamic Material 3 color, no shadows beyond the default elevation 1.
- **Reads as a tool.** Lots of monospace for IDs and amounts. State badges are
  small, square, uppercase.
- **No animations beyond Flutter defaults.** No hero transitions, no Lottie.
- **Dark mode follows system.** Light mode is the canonical design; dark
  mode is the same with inverted neutrals.

## Scaffold

`HomePage` is a `Scaffold` with a `TabBar` of three tabs:

1. **Status** — current service health + 10 most recent SMS.
2. **History** — full paginated list, filter dropdown.
3. **Settings** — URL, secret, test webhook, permissions.

The app bar title is "bKash Watcher". A small dot in the app bar reflects
service health (green = running, red = stopped).

## Tab 1 — Status

Top half (~40% of screen):

- A large status pill: green "Watching for bKash SMS" or red "Stopped".
- If stopped, a `FilledButton` "Start service" below the pill.
- Two-line footer: "Last successful confirm: {relative time}" and
  "Last SMS seen: {relative time}".

Bottom half: a non-scrollable list (or a scrollable list with subtle
indicator) of the latest 10 `ProcessedSms` rows, rendered via `SmsRowTile`.

Pull-to-refresh re-queries the DB and re-checks `service.isRunning()`.

## Tab 2 — History

- A filter row at the top: an `Wrap` of chip-style toggles for each state,
  defaulting to "all".
- Below, a paginated `ListView.builder` of `SmsRowTile`s sorted by `id` desc.
- Page size 50. Loads next page when within 10 of the bottom.

Tapping a row opens a modal bottom sheet with:

- TrxID (monospace), copy button.
- Sender MSISDN, amount, OS timestamp, in-body timestamp (if extractable from
  raw body — display as-is, not parsed).
- Current state badge.
- Attempt count, last error.
- Raw SMS body in a monospace box.
- Action buttons:
  - "Retry now" — only enabled for `retrying`, `waiting_user`, `failed`.
  - "Mark as ignored" — sets state to `failed` with `last_error = "manually ignored"`.

## Tab 3 — Settings

A simple form (no async validators):

1. **Webhook URL**
   - `TextField` with regex validator `^https?://.+/api/confirm-purchase$`.
   - For non-debug builds, reject `http://` (TLS only).
   - On save, persisted to `flutter_secure_storage`.

2. **HMAC secret**
   - `TextField` with `obscureText: true`, show/hide eye icon.
   - On save, persisted to `flutter_secure_storage`.
   - Never read back into the UI after first save; show "•••••••• (saved)".

3. **Test webhook**
   - Button "Test webhook". POSTs `{}` with the current secret/URL.
   - Renders the result in a colored box (green/amber/red) with the response
     status, body snippet (first 200 chars), and an interpretation:
     - 400 + body mentions `transactionId` → "✓ URL and secret look correct".
     - 401 → "✗ Secret is wrong".
     - 503 → "✗ Server reports misconfig".
     - Network error → "✗ Could not reach server".

4. **Battery optimization**
   - Live status (`Granted` / `Denied`).
   - Button "Open battery settings". Explanation paragraph: "Android will
     kill background services if the app is battery-optimized. Disable
     optimization for bKash Watcher to keep it running 24/7."

5. **SMS permission**
   - Live status for `READ_SMS` and `RECEIVE_SMS`.
   - Button "Request permission" if denied; "Open app settings" if
     permanently denied.

6. **App lock (optional — NOT implemented in the UI)**
   - `SettingsRepository` defines `biometricLockEnabled()` /
     `setBiometricLock()` and the `bkash_biometric_lock` key, but there is
     **no biometric toggle in the Settings tab and no biometric prompt on
     launch**. No biometric plugin is in `pubspec.yaml`. Treat this as a
     reserved hook, not a shipped feature.

## State badge colors

| State            | Background | Foreground |
| ---------------- | ---------- | ---------- |
| `queued`         | grey-100   | grey-700   |
| `sending`        | blue-100   | blue-800   |
| `retrying`       | amber-100  | amber-900  |
| `waiting_user`   | purple-100 | purple-900 |
| `reversing`      | amber-100  | amber-900  |
| `done`           | green-100  | green-900  |
| `failed`         | red-100    | red-900    |
| `mismatch`       | red-100    | red-900    |
| `ignored_refund` | grey-200   | grey-600   |
| `ignored_sent`   | grey-200   | grey-600   |
| `ignored_ibanking`| grey-200  | grey-600   |

Material color tokens; specific hex values live in `lib/theme.dart`.
