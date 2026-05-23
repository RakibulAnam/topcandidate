// Encrypted key/value store for the webhook URL + HMAC secret.
// See spec/08-security.md.

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class SettingsRepository {
  // flutter_secure_storage 10.x: `encryptedSharedPreferences` is deprecated
  // because Android Jetpack Security itself is deprecated. The plugin
  // auto-migrates existing data to its own ciphers on first read, so passing
  // any AndroidOptions is unnecessary — defaults are correct.
  SettingsRepository({FlutterSecureStorage? storage})
      : _storage = storage ?? const FlutterSecureStorage();

  final FlutterSecureStorage _storage;

  static const _kUrl = 'bkash_webhook_url';
  static const _kSecret = 'bkash_webhook_secret';
  static const _kBiometricLock = 'bkash_biometric_lock';
  static const _kBatteryPrompted = 'bkash_battery_prompted';

  Future<String?> webhookUrl() => _storage.read(key: _kUrl);
  Future<void> setWebhookUrl(String value) =>
      _storage.write(key: _kUrl, value: value);

  Future<String?> hmacSecret() => _storage.read(key: _kSecret);
  Future<void> setHmacSecret(String value) =>
      _storage.write(key: _kSecret, value: value);

  Future<bool> hasSecret() async => (await hmacSecret())?.isNotEmpty ?? false;

  Future<bool> biometricLockEnabled() async {
    final v = await _storage.read(key: _kBiometricLock);
    return v == 'true';
  }

  Future<void> setBiometricLock(bool enabled) =>
      _storage.write(key: _kBiometricLock, value: enabled ? 'true' : 'false');

  /// Whether the user has already been shown the battery-optimization
  /// rationale dialog on first launch. We persist this so we don't nag on
  /// every launch if the user declined — they can still toggle the
  /// exemption from the Settings tab.
  Future<bool> batteryPrompted() async {
    final v = await _storage.read(key: _kBatteryPrompted);
    return v == 'true';
  }

  Future<void> setBatteryPrompted() =>
      _storage.write(key: _kBatteryPrompted, value: 'true');

  /// Validate the URL against spec/06-ui-spec.md §1. Returns null on success
  /// or an error message string.
  static String? validateWebhookUrl(String value, {bool allowHttp = false}) {
    final re = RegExp(r'^https?://.+/api/confirm-purchase$');
    if (!re.hasMatch(value)) {
      return 'Must look like https://your-domain/api/confirm-purchase';
    }
    if (!allowHttp && value.startsWith('http://')) {
      return 'Only https:// is allowed in release builds';
    }
    return null;
  }
}
