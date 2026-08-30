// Settings > Test tools — drive the web app's purchase states without a real
// payment or a real SMS.
//
// HOW IT WORKS (and why it is trustworthy)
// ========================================
// It composes a realistic bKash SMS body and hands it to the SAME entry point
// the Android broadcast uses (`ingestBkashSms`): real parser, real dedupe, real
// state machine, real HMAC signature, real webhook. The only thing simulated is
// the SMS arriving on the handset. So if a scenario works here it works in
// production, and if the parser would have choked on that body, this chokes too.
//
// ⚠️ THIS WRITES TO THE LIVE SERVER. There is one environment. A simulated
// payment creates real rows and can grant real credits to whichever account
// submits the TrxID on the web. Everything it generates is prefixed `TST` so it
// is greppable and sweepable afterwards.
//
// Gated behind a persisted, default-off switch so it cannot be tapped by
// accident while the watcher is doing its actual job.

import 'dart:math';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../dispatch/dispatcher.dart';
import '../dispatch/heartbeat.dart';
import '../settings/settings_repository.dart';
import '../sms/sms_ingest.dart';
import '../storage/processed_sms_dao.dart';

class TestToolsPanel extends StatefulWidget {
  const TestToolsPanel({
    super.key,
    required this.dao,
    required this.dispatcher,
    required this.settings,
  });

  final ProcessedSmsDao dao;
  final Dispatcher dispatcher;
  final SettingsRepository settings;

  @override
  State<TestToolsPanel> createState() => _TestToolsPanelState();
}

class _TestToolsPanelState extends State<TestToolsPanel> {
  static const _packPriceTaka = 200;
  static const _defaultSender = '01711234567';
  static const _otherSender = '01799999999';

  String _trxId = '';
  String _status = '';
  bool _busy = false;
  bool _heartbeatPaused = false;

  @override
  void initState() {
    super.initState();
    _trxId = _newTrxId();
    _hydrate();
  }

  Future<void> _hydrate() async {
    final paused = await widget.settings.heartbeatPaused();
    if (!mounted) return;
    setState(() => _heartbeatPaused = paused);
  }

  /// bKash TrxIDs are exactly 10 alphanumeric characters (the parser enforces
  /// it), so the marker has to fit inside that budget: `TST` + 7 random.
  String _newTrxId() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no O/0, I/1 — we retype these
    final rnd = Random.secure();
    return 'TST${List.generate(7, (_) => alphabet[rnd.nextInt(alphabet.length)]).join()}';
  }

  Future<void> _send({required int amountTaka, required String sender}) async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _status = 'Sending…';
    });
    final body = composeSyntheticBkashSms(
      amountTaka: amountTaka,
      senderMsisdn: sender,
      trxId: _trxId,
    );
    try {
      final result = await ingestBkashSms(
        body: body,
        smsTimestamp: DateTime.now(),
        dao: widget.dao,
        dispatcher: widget.dispatcher,
        isolate: 'test',
      );
      if (!mounted) return;
      setState(() {
        switch (result.outcome) {
          case SmsIngestOutcome.unparsed:
            _status = '✗ Parser rejected the composed body — that is a real parser bug.';
          case SmsIngestOutcome.duplicate:
            _status = '• Already sent this TrxID. Generate a new one.';
          case SmsIngestOutcome.inserted:
            _status = '✓ Sent ৳$amountTaka as $_trxId from $sender.\n'
                'Check the History tab for the delivery result.';
        }
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _status = '✗ Failed: $e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _sendHeartbeatNow() async {
    setState(() => _status = 'Pinging…');
    final res = await Heartbeat(
      webhookClient: widget.dispatcher.webhookClient,
      deviceIdProvider: widget.settings.deviceId,
      queueDepthProvider: widget.dao.pendingCount,
      pausedProvider: widget.settings.heartbeatPaused,
    ).maybeSend(force: true);
    if (!mounted) return;
    // Report what actually happened. Claiming success unconditionally was
    // worse than useless here: a wrong secret, an unset URL or no connectivity
    // all produced a green tick, and the operator then trusted the liveness
    // recipes in spec/09 that depend on the ping having landed.
    setState(() {
      if (res == null) {
        _status = '• Heartbeat is paused — nothing sent.';
      } else if (res.statusCode == 200) {
        _status = '✓ Heartbeat accepted. The web app now counts us as live.';
      } else if (res.statusCode != null) {
        _status = '✗ Heartbeat rejected (HTTP ${res.statusCode}). '
            '401 = wrong secret; 400 = this build of the server has no heartbeat route.';
      } else {
        _status = '✗ Heartbeat not delivered (${res.errorTag ?? "unknown"}). '
            'Check the webhook URL and connectivity.';
      }
    });
  }

  Future<void> _togglePause(bool paused) async {
    await widget.settings.setHeartbeatPaused(paused);
    if (!mounted) return;
    setState(() {
      _heartbeatPaused = paused;
      _status = paused
          ? '• Heartbeat paused. After ~5 minutes the web app shows '
              '"Verification is running behind".'
          : '✓ Heartbeat resumed.';
    });
  }

  void _copy(String value, String label) {
    Clipboard.setData(ClipboardData(text: value));
    if (!mounted) return;
    setState(() => _status = '✓ Copied $label');
  }

  /// One character of the TrxID swapped, so the web app's `likely_typo` path
  /// can be triggered without hand-editing anything.
  String get _typoVariant {
    if (_trxId.length < 10) return _trxId;
    final last = _trxId[9];
    return '${_trxId.substring(0, 9)}${last == 'A' ? 'B' : 'A'}';
  }

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Card(
          color: t.colorScheme.errorContainer,
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Row(
              children: [
                const Icon(Icons.warning_amber_rounded),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    'These post SYNTHETIC payments to the LIVE server. They create real '
                    'rows and can grant real credits. Every TrxID starts with "TST".',
                    style: t.textTheme.bodySmall,
                  ),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 12),

        // ── The TrxID under test ──────────────────────────────────────────
        Text('Transaction ID', style: t.textTheme.titleSmall),
        const SizedBox(height: 4),
        Row(
          children: [
            Expanded(
              child: SelectableText(_trxId, style: t.textTheme.headlineSmall?.copyWith(
                fontFeatures: const [FontFeature.tabularFigures()],
              )),
            ),
            IconButton(
              tooltip: 'Copy',
              icon: const Icon(Icons.copy),
              onPressed: () => _copy(_trxId, 'the correct ID'),
            ),
            IconButton(
              tooltip: 'New ID',
              icon: const Icon(Icons.refresh),
              onPressed: _busy ? null : () => setState(() {
                _trxId = _newTrxId();
                _status = '';
              }),
            ),
          ],
        ),
        const SizedBox(height: 2),
        Row(
          children: [
            Expanded(
              child: Text(
                'One character off: $_typoVariant',
                style: t.textTheme.bodySmall,
              ),
            ),
            TextButton.icon(
              icon: const Icon(Icons.copy, size: 16),
              label: const Text('Copy typo'),
              onPressed: () => _copy(_typoVariant, 'the mistyped ID'),
            ),
          ],
        ),
        const Divider(height: 24),

        // ── Scenarios ─────────────────────────────────────────────────────
        Text('Simulate a payment', style: t.textTheme.titleSmall),
        const SizedBox(height: 8),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            FilledButton.icon(
              icon: const Icon(Icons.payments),
              label: const Text('Pay ৳200'),
              onPressed: _busy ? null : () => _send(amountTaka: _packPriceTaka, sender: _defaultSender),
            ),
            OutlinedButton.icon(
              icon: const Icon(Icons.money_off),
              label: const Text('Pay ৳150 (underpaid)'),
              onPressed: _busy ? null : () => _send(amountTaka: 150, sender: _defaultSender),
            ),
            OutlinedButton.icon(
              icon: const Icon(Icons.phone_disabled),
              label: const Text('Pay from another number'),
              onPressed: _busy ? null : () => _send(amountTaka: _packPriceTaka, sender: _otherSender),
            ),
          ],
        ),
        const Divider(height: 24),

        // ── Liveness ──────────────────────────────────────────────────────
        Text('Liveness', style: t.textTheme.titleSmall),
        SwitchListTile(
          contentPadding: EdgeInsets.zero,
          value: _heartbeatPaused,
          onChanged: _busy ? null : _togglePause,
          title: const Text('Pause heartbeat'),
          subtitle: const Text(
            'After ~5 min the web app says verification is running behind. '
            'Switch it back off when you are done.',
          ),
        ),
        OutlinedButton.icon(
          icon: const Icon(Icons.favorite),
          label: const Text('Send heartbeat now'),
          onPressed: _busy ? null : _sendHeartbeatNow,
        ),

        if (_status.isNotEmpty) ...[
          const SizedBox(height: 12),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Text(_status, style: t.textTheme.bodyMedium),
            ),
          ),
        ],
      ],
    );
  }
}
