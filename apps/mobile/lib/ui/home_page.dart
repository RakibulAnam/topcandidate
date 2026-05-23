import 'package:disable_battery_optimization/disable_battery_optimization.dart';
import 'package:flutter/material.dart';

import '../dispatch/dispatcher.dart';
import '../dispatch/webhook_client.dart';
import '../service/background_service.dart';
import '../settings/settings_repository.dart';
import '../storage/processed_sms_dao.dart';
import 'history_tab.dart';
import 'settings_tab.dart';
import 'status_tab.dart';

class HomePage extends StatefulWidget {
  const HomePage({
    super.key,
    required this.dao,
    required this.dispatcher,
    required this.settings,
    required this.webhookClient,
  });

  final ProcessedSmsDao dao;
  final Dispatcher dispatcher;
  final SettingsRepository settings;
  final WebhookClient webhookClient;

  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> {
  bool _serviceRunning = false;

  @override
  void initState() {
    super.initState();
    _refresh();
    // Defer until the first frame so we can use this State's BuildContext
    // to show the rationale dialog.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _maybePromptBatteryExemption();
    });
  }

  Future<void> _refresh() async {
    final running = await BackgroundServiceController.isRunning();
    if (!mounted) return;
    setState(() => _serviceRunning = running);
  }

  /// First-launch nudge to disable battery optimization. On Android 13/14
  /// OEMs that aggressively kill background services, this is the #1
  /// silent-failure mode for the watcher. We only ask once — if the user
  /// declines, they can still toggle it from the Settings tab.
  Future<void> _maybePromptBatteryExemption() async {
    final alreadyPrompted = await widget.settings.batteryPrompted();
    if (alreadyPrompted) return;
    final exempt = await DisableBatteryOptimization
            .isBatteryOptimizationDisabled ??
        false;
    if (exempt) {
      // Already exempt (e.g. user toggled it manually before opening the
      // app, or the OEM doesn't optimize by default). Mark as prompted so
      // we don't ask the next launch either.
      await widget.settings.setBatteryPrompted();
      return;
    }
    if (!mounted) return;
    final go = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Keep the watcher running'),
        content: const Text(
          'Android will kill the SMS watcher in the background unless you '
          "exempt it from battery optimization. Tap 'Open settings' and "
          "toggle 'Don't optimize' for TOP CANDIDATE bKash Watcher.",
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Not now'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('Open settings'),
          ),
        ],
      ),
    );
    await widget.settings.setBatteryPrompted();
    if (go == true) {
      await DisableBatteryOptimization
          .showDisableBatteryOptimizationSettings();
    }
  }

  @override
  Widget build(BuildContext context) {
    return DefaultTabController(
      length: 3,
      child: Scaffold(
        appBar: AppBar(
          title: Row(
            children: [
              const Text('bKash Watcher'),
              const SizedBox(width: 8),
              Icon(
                Icons.circle,
                size: 10,
                color: _serviceRunning ? Colors.green : Colors.red,
              ),
            ],
          ),
          bottom: const TabBar(
            tabs: [
              Tab(text: 'Status'),
              Tab(text: 'History'),
              Tab(text: 'Settings'),
            ],
          ),
        ),
        body: TabBarView(
          children: [
            StatusTab(dao: widget.dao),
            HistoryTab(dao: widget.dao, dispatcher: widget.dispatcher),
            SettingsTab(
              settings: widget.settings,
              webhookClient: widget.webhookClient,
            ),
          ],
        ),
      ),
    );
  }
}
