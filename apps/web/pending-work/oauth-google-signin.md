# Spec — Google OAuth sign-in

**Owner:** TBD
**Status:** IMPLEMENTED (branch `feat/google-oauth`) — client code shipped (AuthContext.signInWithGoogle, ContinueWithGoogleButton, LoginScreen flag on, App.tsx callback-error handling, PKCE client config). Remaining: configure the Supabase Google provider + redirect URLs + account-linking (§11.1), then manual QA (§11.5). No schema migration was needed.
**Estimated effort:** 1 day implementation + 1 day testing
**Prerequisite PRs:** none. This is the first OAuth provider.

---

## 0. Why this exists

Google sign-in becomes the **primary** authentication method. Email/password stays as a fallback for users who can't use Google (e.g. work emails on Microsoft).

The shell prepared by the 2026-05-31 PR already lays out the screen for this:

- `LoginScreen.tsx` has an `OAUTH_GOOGLE_ENABLED` constant (currently `false`)
- The render tree has a commented slot above the email form where the Google button + OR divider will live
- `AuthContext` is the single facade — sign-in/sign-up/reset flow through it
- i18n keys `login.continueWithEmail` and `login.orContinueWithEmail` exist in `en.ts` + `bn.ts`

When OAUTH_GOOGLE_ENABLED flips to `true`, the OR divider auto-renders. No layout rewrite needed.

---

## 1. Architecture approach

Supabase OAuth, not a hand-rolled Google client. Rationale:

1. **One session model.** OAuth via Supabase creates the same `auth.users` row + JWT as email/password. No "two kinds of users" branching elsewhere in the app.
2. **No token storage in our code.** Supabase handles the refresh-token rotation, the PKCE flow, the `code_challenge`, all of it. We never touch a Google access token.
3. **Provider linking is built in.** If a user signs in with Google using the same email they already used for password signup, Supabase can link the identities (we just need to enable "manual linking" in Auth → Providers).

The flow is:

```
LoginScreen → AuthContext.signInWithGoogle()
            → supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo, scopes } })
            → browser redirects to accounts.google.com → consent → back to <origin>/?code=…
            → Supabase exchanges the code, sets the session cookie/local-storage entry
            → onAuthStateChange fires SIGNED_IN
            → AuthProvider redirects via the existing AppContent flow
```

No new pages needed. The redirect-back lands at `/` (LandingScreen), where the existing AuthProvider sees the new user and routes them through `PROFILE_SETUP` or `DASHBOARD`.

---

## 2. OAuth flow

### 2.1 First-time signup with Google

1. User on `/login` clicks "Continue with Google".
2. `AuthContext.signInWithGoogle()` calls `supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } })`.
3. Browser redirects to Google's consent screen. Scopes: `openid email profile` (no Drive, no Calendar, no Gmail).
4. User consents.
5. Browser redirects back to `<origin>/?code=…&state=…`.
6. Supabase JS client (mounted in `client.ts`) handles the callback automatically: posts the code to Supabase Auth, exchanges for tokens, writes the session to localStorage.
7. `onAuthStateChange` fires `SIGNED_IN` with the new user.
8. The `handle_new_user()` Postgres trigger (already in `schema.sql:411`) creates a `profiles` row from `new.email` and `new.raw_user_meta_data->>'full_name'`. **Verify** that Google's identity claims map to these — Supabase puts the user's display name and email into the standard fields, so the existing trigger should work without changes.
9. `AppContent` sees the user, runs `isProfileComplete()`, and routes to `PROFILE_SETUP` (because the profile sub-tables are empty for a new user).

### 2.2 Returning Google user

Same as 2.1, but `isProfileComplete()` returns true → route to `DASHBOARD`.

### 2.3 Returning email/password user clicks "Continue with Google" with the same email

This is the **account-linking** case. Supabase has three settings here (Auth → Providers → Email → "Allow manual linking"):

- **Off (default):** Supabase errors with `identity_already_exists`. Bad UX — user can't sign in.
- **On (manual):** Supabase creates a new identity row for the same `auth.users` row, and the user is signed in. The next time they use either method, they land in the same account.
- **Auto-confirm:** Skips email verification on the new identity (we want this since our policy is no email confirmation anyway).

**Recommendation:** turn manual linking ON, auto-confirm ON. Document this in the post-deploy hardening checklist in `DEPLOYING.md`.

### 2.4 Returning email/password user clicks "Continue with Google" with a *different* email

Treated as a separate account. Supabase creates a new `auth.users` row + `profiles` row. The user effectively has two accounts. We do not attempt to merge them — that's a UX nightmare.

---

## 3. Database considerations

**No schema changes required.** Supabase OAuth uses the existing `auth.users` table and our existing `handle_new_user` trigger.

Things to verify post-implementation:

1. `profiles.email` matches what Google returned (case-sensitivity — Google normalizes to lowercase; check we don't have any `auth.uid()`-keyed lookups that depend on a specific email case).
2. `profiles.full_name` is populated from Google's `name` claim. If absent, profile-setup will catch it (the user will fill it in there).
3. RLS policies don't reference any field other than `auth.uid()`. ✓ (verified in the 2026-05-30 audit — all 67 policies use `auth.uid() = user_id`).

**Optional future hardening:** add an `identities` view or column tracking which providers a user has linked, so the operator can see in the admin panel that user X "signed up via Google, then linked email/password on Y date". Migration 011 candidate.

---

## 4. Account-linking strategy

Two paths:

### 4.1 Email match — auto-link
If the Google email exactly matches an existing `auth.users.email` row, Supabase links the identity automatically when "Allow manual linking" is on (§2.3).

### 4.2 Email mismatch — separate accounts
If a user is signed in with email/password and then clicks "Continue with Google" with a different email, we have two options:

- **A.** Treat as separate sign-ups (current default).
- **B.** Block and show a "you're already signed in" toast, forcing the user to sign out first.

**Recommendation: B.** Surface clearly: "You're already signed in as `user@example.com`. Sign out first to use a different account." Implement in `AuthContext.signInWithGoogle` — refuse if `user` is already set.

### 4.3 Future: in-Profile "Connect Google" button
A second-PR feature: from the Profile page, an authenticated user can connect a Google identity. Supabase exposes `supabase.auth.linkIdentity({ provider: 'google' })` for this. Not part of the OAuth-first PR; tracked separately.

---

## 5. Security considerations

| Item | Mitigation |
|---|---|
| **OAuth state-CSRF** | Supabase generates + verifies the `state` parameter using PKCE. We never touch it. |
| **Open redirect on callback** | Supabase enforces the `redirectTo` against the configured "Site URL" and "Redirect URLs" list in Auth Settings. **You MUST add the production domain (and any preview-deploy wildcards) to that list before this PR ships.** |
| **Phishing via fake "Continue with Google" buttons** | We render Google's official logo + brand colors per Google's brand guidelines. The actual sign-in happens on `accounts.google.com` — users see Google's URL bar. |
| **Stolen Google account** | Out of our control. If Google flags the account, the OAuth token issuance fails and our sign-in fails. We do not attempt to detect lost devices ourselves. |
| **Email spoofing via OAuth claim** | Google's `email_verified` claim is implicitly true (Google verifies all addresses they issue). For Google Workspace accounts, the workspace admin guarantees the address. We treat Google's `email` as authoritative for account linkage. |
| **PII leakage in URL** | The OAuth callback URL includes `code`. We let Supabase consume it, then clean the URL via `window.history.replaceState(null, '', '/')`. |
| **Sign-out reuse** | Sign-out clears the Supabase session. Google's session at `accounts.google.com` remains — that's intentional (Google's domain, Google's session). User can revoke our app's access from their Google account settings if they want a complete sign-out. |

---

## 6. Session handling

Same model as today's email/password:

- Supabase JS writes session to localStorage under `sb-<projectRef>-auth-token`.
- `AuthContext` mounts `onAuthStateChange` and updates `user` / `session` reactively.
- Token refresh is automatic (Supabase handles it).
- `signOut()` clears the Supabase session + the app-managed localStorage keys (resume_draft, pendingPurchase) — already implemented in 2026-05-30 audit M7.

**One change:** add `provider` to the session metadata surfaced by `useAuth()` so screens that need to differentiate (e.g. "Change password" is only shown for email/password users) can read it. Source: `user.app_metadata.provider`.

---

## 7. UX expectations

### 7.1 LoginScreen layout post-OAuth

```
┌──────────────────────────────────┐
│  TOP CANDIDATE       EN | বাং    │
├──────────────────────────────────┤
│  Welcome back                    │
│  Sign in to continue             │
├──────────────────────────────────┤
│  [G] Continue with Google        │  ← primary
│  ─── or continue with email ───  │
│  Email     [______________]      │
│  Password  [______________] ✦    │  ← ✦ = forgot link
│  [ Continue with email →]        │
├──────────────────────────────────┤
│  Don't have an account? Sign up  │
│  Terms of Service                │
└──────────────────────────────────┘
```

### 7.2 The Google button

Styling: white background, 1px charcoal-300 border, Google "G" mark on the left, "Continue with Google" text. Hover: charcoal-50 background. **Do not** restyle the G mark or use any other color than Google's official multi-color palette. Required by Google brand guidelines.

```tsx
<button type="button" onClick={signInWithGoogle} className="w-full h-11 flex items-center justify-center gap-3 border border-charcoal-300 rounded-xl bg-white hover:bg-charcoal-50 ...">
  <GoogleIcon /> {/* official G mark, see Google brand assets */}
  <span>Continue with Google</span>
</button>
```

### 7.3 Loading + error states

- While the OAuth round-trip is in flight (after user clicks "Continue with Google", before browser redirect fires), show a spinner inside the button.
- If Google denies consent (user clicks Cancel on Google's screen), they redirect back with `error=access_denied`. Detect via URL query string in `App.tsx`, show toast "Sign-in cancelled."
- If Supabase OAuth config is missing/broken (network 500), surface the actual error from Supabase, don't swallow.

---

## 8. Error handling

| Error | Surface |
|---|---|
| Google consent denied | Toast: "Sign-in cancelled." Stay on LoginScreen. |
| Network error during redirect | Toast: "Couldn't connect to Google. Try again." |
| Supabase OAuth config missing | Console.error + toast: "Sign-in temporarily unavailable." Surface the underlying Supabase error in dev only. |
| Identity already linked (other account) | Toast: "An account already exists with that Google email. Sign in to that account first." (Only possible if manual-linking is off — recommended config has it on.) |
| Already signed in, different Google email | Toast: "You're already signed in. Sign out first to use a different Google account." Don't proceed. |
| Email/password user signs in via Google with same email, manual-linking off | Toast: "An account already exists with `user@example.com`. Sign in with email/password and link Google from Profile." Suggests the future "Connect Google" feature. |

---

## 9. Edge cases

1. **User signs in via Google on Tab A, then opens Tab B.** Supabase's session is in localStorage; Tab B sees the user immediately. No special handling needed.
2. **User clicks the "Continue with Google" button twice rapidly.** Disable the button during the redirect (race-protect via the `loading` state already in LoginScreen).
3. **User clicks the Google button from inside a deeply-nested route (e.g. they were prompted to re-auth).** `redirectTo` defaults to `<origin>/` (LandingScreen). If we want to preserve the route, capture `window.location.pathname` and pass it through Supabase's `redirectTo` option. Out of scope for the initial PR.
4. **Browser blocks third-party cookies.** Supabase OAuth uses the implicit flow with localStorage, not cookies. Should work even in strict-cookie browsers (Safari ITP, Brave shields). Verify in QA.
5. **Google account has 2FA.** Google handles 2FA at their domain. We see only the final success/cancel. No change needed on our side.
6. **User on a corporate firewall blocking accounts.google.com.** Sign-in fails with a network error. Fall back to email/password — visible in the existing UI.
7. **Supabase project's "Google Provider" toggle is OFF when this PR ships.** Calling signInWithOAuth returns an immediate error. Confirm the toggle + Client ID/Secret are configured in Supabase BEFORE merging.

---

## 10. Mobile (Flutter) compatibility

The Flutter app in `apps/mobile/` is the operator's SMS watcher — it does NOT have a customer sign-in flow. So this OAuth work has zero mobile-side impact.

**If we ever build a customer-side mobile app:** Supabase's Flutter SDK supports the same OAuth provider abstraction. The web's `redirectTo` becomes a deep link (`com.topcandidate.app://auth-callback`). The customer-facing user model stays unified.

---

## 11. Suggested implementation steps

In order, with intended checkpoints:

1. **Supabase config first** (no code changes):
   - Auth → Providers → Google → enable
   - Add Client ID + Client Secret from Google Cloud Console (OAuth 2.0 Client ID, type "Web application")
   - Add the production origin to "Authorized redirect URIs" in Google Cloud Console
   - Add the production origin (and any `*.vercel.app` preview wildcards) to Supabase Auth → URL Configuration → Redirect URLs
   - Enable "Allow manual linking" + "Auto-confirm linked identities"
   - Smoke test: from a Supabase project member's perspective, click the test sign-in button in Supabase dashboard → should land on Google consent → back to dashboard with a session.
2. **AuthContext additions** (small):
   - Add `signInWithGoogle()` method that calls `supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } })`.
   - Surface `provider` from `user.app_metadata.provider` via the context type.
3. **LoginScreen layout flip** (small):
   - Set `OAUTH_GOOGLE_ENABLED = true`.
   - Add the `<ContinueWithGoogleButton />` component (file: `src/presentation/auth/ContinueWithGoogleButton.tsx`).
   - Verify the OR divider renders.
   - Verify the email form is still visible underneath.
4. **App.tsx callback handling**:
   - On mount, detect `?code=…` or `?error=…` in URL; if `error=access_denied`, toast cancelled and clean URL; otherwise let Supabase's auto-callback consume it.
5. **QA matrix** (manual):
   - Fresh account via Google (no existing email/password row) → lands on PROFILE_SETUP.
   - Returning Google account → lands on DASHBOARD.
   - Email/password account exists, clicks Google with same email → linked, signed in.
   - Email/password account exists, clicks Google with different email → blocked with clear toast.
   - Already signed in, clicks Google → blocked.
   - Cancel on Google's consent screen → back to LoginScreen with toast.
   - Sign out → back to LoginScreen, both Google and email work again.
6. **Profile page surface** (small): show "Signed in via Google" / "Signed in via email" badge.
7. **Docs**: update `AGENTS.md §3 product surface` to add the OAuth row; update `README.md` env requirements (no new env vars on our side, but document the Supabase Auth config); add a "OAuth troubleshooting" row to `DEPLOYING.md`.

---

## 12. Out of scope for the OAuth-first PR

- "Sign in with Apple" — separate PR.
- "Sign in with LinkedIn" — separate PR. Would be a strong fit for a hiring product; deferred.
- In-Profile "Connect Google" button — covered in §4.3.
- Multi-account support per browser — Supabase doesn't support it natively.
- Mobile app — see §10.
