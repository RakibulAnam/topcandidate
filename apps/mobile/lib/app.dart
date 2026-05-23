import 'package:flutter/material.dart';

import 'dispatch/dispatcher.dart';
import 'dispatch/webhook_client.dart';
import 'settings/settings_repository.dart';
import 'storage/processed_sms_dao.dart';
import 'theme.dart';
import 'ui/home_page.dart';

class BkashWatcherApp extends StatelessWidget {
  const BkashWatcherApp({
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
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'bKash Watcher',
      theme: buildLightTheme(),
      darkTheme: buildDarkTheme(),
      themeMode: ThemeMode.system,
      home: HomePage(
        dao: dao,
        dispatcher: dispatcher,
        settings: settings,
        webhookClient: webhookClient,
      ),
    );
  }
}
