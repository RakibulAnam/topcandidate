# Mobile environments

The mobile app has **no `.env` file**. All configuration is operator-supplied at runtime via the Settings tab and persisted to encrypted secure storage (Android Keystore-backed):

- Webhook URL (e.g. `https://topcandidate.app/api/confirm-purchase`).
- HMAC secret (matches `BKASH_WEBHOOK_SECRET` on the Vercel side).

There is no staging/production split in the app itself — debug builds accept `http://` URLs (for ngrok / localhost development), release builds reject them. See [`apps/mobile/WHAT_IT_DOES.md`](../../apps/mobile/WHAT_IT_DOES.md) §8.
