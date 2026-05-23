import 'package:disable_battery_optimization/disable_battery_optimization.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:permission_handler/permission_handler.dart';

import '../dispatch/webhook_client.dart';
import '../settings/settings_repository.dart';

class SettingsTab extends StatefulWidget {
  const SettingsTab({
    super.key,
    required this.settings,
    required this.webhookClient,
  });

  final SettingsRepository settings;
  final WebhookClient webhookClient;

  @override
  State<SettingsTab> createState() => _SettingsTabState();
}

class _SettingsTabState extends State<SettingsTab> {
  final _urlCtrl = TextEditingController();
  final _secretCtrl = TextEditingController();
  bool _showSecret = false;
  bool _secretSaved = false;
  bool _smsGranted = false;
  bool _notifGranted = false;
  bool _batteryExempt = false;
  String? _urlError;
  _TestResult? _testResult;
  bool _testing = false;

  @override
  void initState() {
    super.initState();
    _hydrate();
  }

  Future<void> _hydrate() async {
    final url = await widget.settings.webhookUrl() ?? '';
    final hasSecret = await widget.settings.hasSecret();
    final sms = await Permission.sms.isGranted;
    final notif = await Permission.notification.isGranted;
    final battery = await DisableBatteryOptimization
            .isBatteryOptimizationDisabled ??
        false;
    if (!mounted) return;
    setState(() {
      _urlCtrl.text = url;
      _secretSaved = hasSecret;
      _smsGranted = sms;
      _notifGranted = notif;
      _batteryExempt = battery;
    });
  }

  @override
  void dispose() {
    _urlCtrl.dispose();
    _secretCtrl.dispose();
    super.dispose();
  }

  Future<void> _saveUrl() async {
    final value = _urlCtrl.text.trim();
    final error = SettingsRepository.validateWebhookUrl(
      value,
      allowHttp: kDebugMode,
    );
    setState(() => _urlError = error);
    if (error != null) return;
    await widget.settings.setWebhookUrl(value);
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Webhook URL saved')),
    );
  }

  Future<void> _saveSecret() async {
    final value = _secretCtrl.text;
    if (value.isEmpty) return;
    await widget.settings.setHmacSecret(value);
    _secretCtrl.clear();
    setState(() => _secretSaved = true);
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('HMAC secret saved')),
    );
  }

  Future<void> _runTest() async {
    setState(() {
      _testing = true;
      _testResult = null;
    });
    final response = await widget.webhookClient.postRaw(const {});
    final result = _interpretTest(response.statusCode, response.body, response.errorTag);
    if (!mounted) return;
    setState(() {
      _testResult = result;
      _testing = false;
    });
  }

  _TestResult _interpretTest(int? status, String? body, String? err) {
    if (status == null) {
      return _TestResult.bad(
          'Could not reach server (${err ?? "network"})');
    }
    if (status == 400 && (body?.contains('transactionId') ?? false)) {
      return _TestResult.good('URL and secret look correct');
    }
    if (status == 401) {
      return _TestResult.bad('HMAC secret is wrong');
    }
    if (status == 503) {
      return _TestResult.bad('Server reports misconfig');
    }
    return _TestResult.warn('Unexpected HTTP $status — see body below');
  }

  Future<void> _requestSms() async {
    final status = await [Permission.sms].request();
    if (status[Permission.sms]?.isPermanentlyDenied ?? false) {
      await openAppSettings();
    }
    await _hydrate();
  }

  Future<void> _requestNotif() async {
    await Permission.notification.request();
    await _hydrate();
  }

  Future<void> _requestBattery() async {
    await DisableBatteryOptimization
        .showDisableBatteryOptimizationSettings();
    await _hydrate();
  }

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Text('Webhook', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 8),
        TextField(
          controller: _urlCtrl,
          decoration: InputDecoration(
            labelText: 'Webhook URL',
            hintText: 'https://example.com/api/confirm-purchase',
            errorText: _urlError,
            border: const OutlineInputBorder(),
          ),
          keyboardType: TextInputType.url,
        ),
        const SizedBox(height: 8),
        Align(
          alignment: Alignment.centerRight,
          child: OutlinedButton(
            onPressed: _saveUrl,
            child: const Text('Save URL'),
          ),
        ),
        const SizedBox(height: 16),
        TextField(
          controller: _secretCtrl,
          obscureText: !_showSecret,
          decoration: InputDecoration(
            labelText: _secretSaved
                ? 'HMAC secret (•••••••• saved — enter to replace)'
                : 'HMAC secret',
            border: const OutlineInputBorder(),
            suffixIcon: IconButton(
              icon: Icon(_showSecret ? Icons.visibility_off : Icons.visibility),
              onPressed: () => setState(() => _showSecret = !_showSecret),
            ),
          ),
        ),
        const SizedBox(height: 8),
        Align(
          alignment: Alignment.centerRight,
          child: OutlinedButton(
            onPressed: _saveSecret,
            child: const Text('Save secret'),
          ),
        ),
        const SizedBox(height: 16),
        FilledButton.icon(
          icon: const Icon(Icons.wifi_protected_setup),
          label: Text(_testing ? 'Testing…' : 'Test webhook'),
          onPressed: _testing ? null : _runTest,
        ),
        if (_testResult != null) ...[
          const SizedBox(height: 8),
          _TestResultCard(result: _testResult!),
        ],
        const Divider(height: 32),
        Text('Permissions', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 8),
        _PermissionRow(
          label: 'SMS read',
          granted: _smsGranted,
          onAction: _requestSms,
          actionLabel: _smsGranted ? 'Granted' : 'Request',
        ),
        _PermissionRow(
          label: 'Notifications',
          granted: _notifGranted,
          onAction: _requestNotif,
          actionLabel: _notifGranted ? 'Granted' : 'Request',
        ),
        _PermissionRow(
          label: 'Battery optimization disabled',
          granted: _batteryExempt,
          onAction: _requestBattery,
          actionLabel: _batteryExempt ? 'Exempt' : 'Open settings',
        ),
        const SizedBox(height: 8),
        const Text(
          'Android will kill background services if battery optimization is '
          'enabled for this app. Disable it to keep the watcher alive 24/7.',
          style: TextStyle(color: Colors.grey, fontSize: 12),
        ),
      ],
    );
  }
}

class _PermissionRow extends StatelessWidget {
  const _PermissionRow({
    required this.label,
    required this.granted,
    required this.onAction,
    required this.actionLabel,
  });

  final String label;
  final bool granted;
  final VoidCallback onAction;
  final String actionLabel;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          Icon(
            granted ? Icons.check_circle : Icons.error_outline,
            color: granted ? Colors.green : Colors.amber.shade800,
            size: 18,
          ),
          const SizedBox(width: 8),
          Expanded(child: Text(label)),
          OutlinedButton(onPressed: onAction, child: Text(actionLabel)),
        ],
      ),
    );
  }
}

class _TestResultCard extends StatelessWidget {
  const _TestResultCard({required this.result});
  final _TestResult result;

  @override
  Widget build(BuildContext context) {
    final color = switch (result.kind) {
      _Kind.good => Colors.green,
      _Kind.warn => Colors.amber.shade800,
      _Kind.bad => Colors.red,
    };
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: color.withValues(alpha: 0.4)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            result.kind == _Kind.good
                ? Icons.check_circle
                : result.kind == _Kind.warn
                    ? Icons.warning_amber
                    : Icons.error_outline,
            color: color,
            size: 18,
          ),
          const SizedBox(width: 8),
          Expanded(child: Text(result.message)),
        ],
      ),
    );
  }
}

class _TestResult {
  const _TestResult(this.kind, this.message);
  factory _TestResult.good(String m) => _TestResult(_Kind.good, m);
  factory _TestResult.warn(String m) => _TestResult(_Kind.warn, m);
  factory _TestResult.bad(String m) => _TestResult(_Kind.bad, m);

  final _Kind kind;
  final String message;
}

enum _Kind { good, warn, bad }
