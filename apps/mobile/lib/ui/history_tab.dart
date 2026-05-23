import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../dispatch/dispatcher.dart';
import '../dispatch/state.dart';
import '../storage/processed_sms_dao.dart';
import 'widgets/sms_row_tile.dart';
import 'widgets/state_badge.dart';

class HistoryTab extends StatefulWidget {
  const HistoryTab({super.key, required this.dao, required this.dispatcher});
  final ProcessedSmsDao dao;
  final Dispatcher dispatcher;

  @override
  State<HistoryTab> createState() => _HistoryTabState();
}

class _HistoryTabState extends State<HistoryTab> {
  static const _pageSize = 50;
  ProcessedSmsState? _filter;
  final List<ProcessedSms> _rows = [];
  bool _loadingMore = false;
  bool _exhausted = false;

  @override
  void initState() {
    super.initState();
    _reload();
  }

  Future<void> _reload() async {
    setState(() {
      _rows.clear();
      _exhausted = false;
    });
    await _loadMore();
  }

  Future<void> _loadMore() async {
    if (_loadingMore || _exhausted) return;
    _loadingMore = true;
    final next = await widget.dao.page(
      state: _filter,
      limit: _pageSize,
      offset: _rows.length,
    );
    if (!mounted) return;
    setState(() {
      _rows.addAll(next);
      _exhausted = next.length < _pageSize;
      _loadingMore = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          child: SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                _filterChip(null, 'all'),
                for (final s in ProcessedSmsState.values)
                  _filterChip(s, s.displayLabel.toLowerCase()),
              ],
            ),
          ),
        ),
        const Divider(height: 0),
        Expanded(
          child: NotificationListener<ScrollNotification>(
            onNotification: (notif) {
              if (notif.metrics.pixels >
                  notif.metrics.maxScrollExtent - 200) {
                _loadMore();
              }
              return false;
            },
            child: RefreshIndicator(
              onRefresh: _reload,
              child: ListView.separated(
                physics: const AlwaysScrollableScrollPhysics(),
                itemCount: _rows.length + (_exhausted ? 0 : 1),
                separatorBuilder: (_, _) => const Divider(height: 0),
                itemBuilder: (context, i) {
                  if (i >= _rows.length) {
                    return const Padding(
                      padding: EdgeInsets.all(16),
                      child: Center(child: CircularProgressIndicator()),
                    );
                  }
                  final row = _rows[i];
                  return SmsRowTile(
                    row: row,
                    onTap: () => _openDetails(row),
                  );
                },
              ),
            ),
          ),
        ),
      ],
    );
  }

  Widget _filterChip(ProcessedSmsState? state, String label) {
    final selected = _filter == state;
    return Padding(
      padding: const EdgeInsets.only(right: 6),
      child: FilterChip(
        selected: selected,
        label: Text(label),
        onSelected: (_) async {
          setState(() => _filter = state);
          await _reload();
        },
      ),
    );
  }

  Future<void> _openDetails(ProcessedSms row) async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (_) => _DetailSheet(
        row: row,
        dao: widget.dao,
        dispatcher: widget.dispatcher,
        onChanged: _reload,
      ),
    );
  }
}

class _DetailSheet extends StatelessWidget {
  const _DetailSheet({
    required this.row,
    required this.dao,
    required this.dispatcher,
    required this.onChanged,
  });

  final ProcessedSms row;
  final ProcessedSmsDao dao;
  final Dispatcher dispatcher;
  final VoidCallback onChanged;

  bool get _canRetry =>
      row.state == ProcessedSmsState.retrying ||
      row.state == ProcessedSmsState.waitingUser ||
      row.state == ProcessedSmsState.failed;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    row.trxId,
                    style: const TextStyle(
                      fontFamily: 'monospace',
                      fontSize: 18,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
                IconButton(
                  icon: const Icon(Icons.copy, size: 18),
                  onPressed: () => Clipboard.setData(
                    ClipboardData(text: row.trxId),
                  ),
                ),
                StateBadge(row.state),
              ],
            ),
            const SizedBox(height: 12),
            _kv('Sender', row.senderMsisdn ?? '—'),
            _kv('Amount', 'Tk ${row.amountTaka}'),
            _kv('Received', row.smsTimestamp.toString()),
            _kv('Attempts', '${row.attemptCount}'),
            if (row.nextAttemptAt != null)
              _kv('Next attempt', row.nextAttemptAt.toString()),
            if (row.lastError != null) _kv('Last error', row.lastError!),
            const SizedBox(height: 12),
            const Text('Raw SMS body', style: TextStyle(fontWeight: FontWeight.w600)),
            const SizedBox(height: 4),
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: Theme.of(context).colorScheme.surfaceContainerHighest,
                borderRadius: BorderRadius.circular(4),
              ),
              child: Text(
                row.rawBody,
                style: const TextStyle(fontFamily: 'monospace', fontSize: 12),
              ),
            ),
            const SizedBox(height: 16),
            Row(
              children: [
                if (_canRetry)
                  Expanded(
                    child: FilledButton.icon(
                      icon: const Icon(Icons.refresh),
                      label: const Text('Retry now'),
                      onPressed: () async {
                        await dao.retryNow(row.id, DateTime.now());
                        unawaited(dispatcher.tick());
                        if (context.mounted) Navigator.of(context).pop();
                        onChanged();
                      },
                    ),
                  ),
                if (_canRetry) const SizedBox(width: 8),
                Expanded(
                  child: OutlinedButton.icon(
                    icon: const Icon(Icons.block),
                    label: const Text('Mark as ignored'),
                    onPressed: () async {
                      await dao.markIgnored(row.id, DateTime.now());
                      if (context.mounted) Navigator.of(context).pop();
                      onChanged();
                    },
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _kv(String k, String v) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 2),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(
              width: 110,
              child: Text(k, style: const TextStyle(color: Colors.grey)),
            ),
            Expanded(child: Text(v)),
          ],
        ),
      );
}
