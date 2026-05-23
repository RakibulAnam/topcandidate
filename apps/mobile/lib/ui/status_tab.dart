import 'dart:async';

import 'package:flutter/material.dart';
import 'package:timeago/timeago.dart' as timeago;

import '../dispatch/state.dart';
import '../service/background_service.dart';
import '../storage/processed_sms_dao.dart';
import 'widgets/sms_row_tile.dart';

class StatusTab extends StatefulWidget {
  const StatusTab({super.key, required this.dao});
  final ProcessedSmsDao dao;

  @override
  State<StatusTab> createState() => _StatusTabState();
}

class _StatusTabState extends State<StatusTab> {
  Timer? _timer;
  bool _running = false;
  List<ProcessedSms> _latest = const [];
  DateTime? _lastConfirm;
  DateTime? _lastSms;

  @override
  void initState() {
    super.initState();
    _refresh();
    _timer = Timer.periodic(const Duration(seconds: 5), (_) => _refresh());
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _refresh() async {
    final running = await BackgroundServiceController.isRunning();
    final latest = await widget.dao.latest(limit: 10);
    final lastConfirm = await widget.dao.lastSuccessfulConfirmAt();
    final lastSms = await widget.dao.lastSmsSeenAt();
    if (!mounted) return;
    setState(() {
      _running = running;
      _latest = latest;
      _lastConfirm = lastConfirm;
      _lastSms = lastSms;
    });
  }

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      onRefresh: _refresh,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(16),
        children: [
          _StatusPill(running: _running),
          if (!_running) ...[
            const SizedBox(height: 12),
            FilledButton.icon(
              icon: const Icon(Icons.play_arrow),
              label: const Text('Start service'),
              onPressed: () async {
                await BackgroundServiceController.start();
                await Future.delayed(const Duration(seconds: 1));
                await _refresh();
              },
            ),
          ],
          const SizedBox(height: 24),
          _Footer(
            label: 'Last successful confirm',
            time: _lastConfirm,
          ),
          const SizedBox(height: 4),
          _Footer(
            label: 'Last SMS seen',
            time: _lastSms,
          ),
          const SizedBox(height: 24),
          Text(
            'Recent activity',
            style: Theme.of(context).textTheme.titleSmall,
          ),
          const SizedBox(height: 8),
          if (_latest.isEmpty)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 16),
              child: Text(
                'No SMS processed yet.',
                style: TextStyle(color: Colors.grey),
              ),
            )
          else
            ..._latest.map((r) => Card(
                  child: SmsRowTile(row: r),
                )),
        ],
      ),
    );
  }
}

class _StatusPill extends StatelessWidget {
  const _StatusPill({required this.running});
  final bool running;

  @override
  Widget build(BuildContext context) {
    final color = running ? const Color(0xFF1B5E20) : const Color(0xFFB71C1C);
    final bg = running ? const Color(0xFFE7F5EC) : const Color(0xFFFDECEA);
    final label = running ? 'Watching for bKash SMS' : 'Stopped';
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        children: [
          Icon(running ? Icons.podcasts : Icons.power_off, color: color),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              label,
              style: TextStyle(
                color: color,
                fontSize: 16,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _Footer extends StatelessWidget {
  const _Footer({required this.label, required this.time});
  final String label;
  final DateTime? time;

  @override
  Widget build(BuildContext context) {
    return Text(
      '$label: ${time == null ? "—" : timeago.format(time!)}',
      style: const TextStyle(color: Colors.grey),
    );
  }
}
