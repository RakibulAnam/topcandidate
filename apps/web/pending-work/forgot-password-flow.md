# Forgot-password flow — implementation notes

**Status:** implemented in 2026-05-31 PR. This doc describes the shipped flow and known follow-ups.

## Shipped behavior

### Request reset
1. User on `/login` clicks "Forgot password?" — `LoginScreen` switches to `mode = 'forgot'`.
2. User enters their email and submits.
3. `AuthContext.requestPasswordReset(email)` calls `supabase.auth.resetPasswordForEmail(email, { redirectTo: <origin>/?auth=recovery })`.
4. Success surfaces an inline emerald banner: "Check your inbox — we sent a password reset link."
5. The user clicks the link in their inbox.

### Reset landing
6. The link points back to our origin with a URL hash like:
   ```
   <origin>/?auth=recovery#access_token=…&refresh_token=…&expires_in=3600&token_type=bearer&type=recovery
   ```
7. Supabase's `supabase-js` client auto-parses the hash on page load and fires `PASSWORD_RECOVERY` via `onAuthStateChange`.
8. `App.tsx` watches for this event (and for the recovery hash on first paint, as a fallback if the event fires before our effect mounts). Either path navigates to `RESET_PASSWORD`.
9. `SetNewPasswordScreen` renders:
   - Two password fields (new + confirm).
   - Min 6 chars + match validation client-side.
   - Submits via `AuthContext.updatePassword(newPassword)` → `supabase.auth.updateUser({ password })`.
   - On success: clears the URL hash, toasts "Password updated", navigates to `DASHBOARD`.
10. The session in localStorage is now a normal session — same shape as a fresh sign-in.

### Expired or already-used link
11. Supabase puts errors in the URL hash too: `#error=access_denied&error_code=otp_expired`.
12. `SetNewPasswordScreen` detects `error_code` and renders a friendly "this link expired" screen with a single CTA back to `LoginScreen` in `forgot` mode.

## File map

- `src/infrastructure/auth/AuthContext.tsx` — `requestPasswordReset`, `updatePassword`.
- `src/presentation/LoginScreen.tsx` — the `'forgot'` mode UI.
- `src/presentation/SetNewPasswordScreen.tsx` — the post-recovery landing.
- `src/presentation/App.tsx` — `hasRecoveryHash()`, `PASSWORD_RECOVERY` listener, screen routing.
- `src/presentation/hooks/useBrowserNav.ts` — added `RESET_PASSWORD` to the `NavScreen` union and `/auth/reset-password` to the path map.
- `src/presentation/i18n/locales/en.ts` / `bn.ts` — keys `setNewPassword`, `setNewPasswordSubtitle`, `newPasswordLabel`, `confirmPasswordLabel`, `passwordsDontMatch`, `savePassword`, `passwordUpdated`, `recoveryLinkExpired`, etc.

## Supabase configuration

- Auth → URL Configuration → Site URL: must include the production origin (e.g. `https://topcandidate.app`).
- Auth → URL Configuration → Redirect URLs: add `<origin>/**` (or specifically `<origin>/?auth=recovery`).
- Auth → Email Templates → "Reset Password": leave default, or customize. The default template includes the `{{ .ConfirmationURL }}` placeholder that Supabase fills with our `redirectTo` link.
- Auth → Rate Limits: defaults are fine. Supabase limits password-reset emails per IP/email automatically.

## Known follow-ups

| Item | Severity | Notes |
|---|---|---|
| **No "have you reset this before? please don't keep resetting" UX** | Low | Supabase rate-limits; if a user hits the limit they get a generic error. Could surface a friendlier message. |
| **i18n for hash error variants** | Low | Today we map every `error_code` (otp_expired, access_denied, server_error) to the same string. Could differentiate. |
| **Recovery in incognito** | Low | Supabase requires localStorage. Incognito mode usually allows it, but private-mode Safari may be restrictive. Test before launch. |
| **Mobile responsive QA on the reset screen** | Med | The screen is small enough to fit but has not been tested on a real mobile device yet. |
| **Per-user reset rate-limit at app layer** | Med | Today we rely on Supabase's defaults. We could add our own tracking via a `password_reset_log` table if abuse becomes a concern. Not needed pre-launch. |
| **Browser back from `RESET_PASSWORD` to landing** | Low | Currently the back button works via `useBrowserNav` history. Verify the cleared URL hash doesn't cause re-entry into recovery on back. |

## Security notes

- Recovery tokens are **one-use** and expire in 1 hour (Supabase default). Configurable in Auth → Email Templates if longer windows are needed; we recommend keeping the default.
- The new password never traverses our API — it goes directly to Supabase. No risk of our logs picking it up.
- The reset link is signed by Supabase; tampering invalidates it.
- The `PASSWORD_RECOVERY` event fires only after Supabase has verified the hash signature, so by the time our `App.tsx` routes to `RESET_PASSWORD`, the session is already trustworthy.

## Future: passwordless magic links

If we ever switch from email/password to email-magic-link as the email-auth method (Supabase supports both), the recovery flow becomes identical to sign-in — both are just "click this link". We'd keep `SetNewPasswordScreen` for users who want a persistent password, and add a "magic link only" path on top. Not planned for the next quarter.
