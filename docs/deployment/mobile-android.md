# Deployment — Mobile (Android, sideload)

The mobile bKash watcher is **not** distributed through Google Play. It's a single-operator app, sideloaded onto one phone.

## Build

```bash
cd apps/mobile
flutter pub get
flutter analyze
flutter test
flutter build apk --release
# APK at: build/app/outputs/flutter-apk/app-release.apk
```

## Install on the operator's phone

1. Transfer the APK (Bluetooth, USB, or a private share link).
2. Enable "Install from unknown sources" for the file manager.
3. Open the APK and accept the install.
4. Grant runtime permissions: `RECEIVE_SMS`, `READ_SMS`, `POST_NOTIFICATIONS`, battery-optimization exclusion.
5. In Settings tab: paste the webhook URL and HMAC secret (matching `BKASH_WEBHOOK_SECRET` on Vercel).

The detailed QA checklist before release: [`apps/mobile/spec/09-qa-checklist.md`](../../apps/mobile/spec/09-qa-checklist.md).

## Versioning

`pubspec.yaml` has a `version:` field. Bump it manually on each release. There is no automated release pipeline.
