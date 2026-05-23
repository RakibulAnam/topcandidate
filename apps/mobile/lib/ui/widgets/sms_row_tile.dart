import 'package:flutter/material.dart';
import 'package:timeago/timeago.dart' as timeago;

import '../../dispatch/state.dart';
import 'state_badge.dart';

class SmsRowTile extends StatelessWidget {
  const SmsRowTile({super.key, required this.row, this.onTap});

  final ProcessedSms row;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      onTap: onTap,
      dense: true,
      title: Row(
        children: [
          Expanded(
            child: Text(
              row.trxId,
              style: const TextStyle(
                fontFamily: 'monospace',
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
          StateBadge(row.state),
        ],
      ),
      subtitle: Padding(
        padding: const EdgeInsets.only(top: 4),
        child: Text(
          '${row.senderMsisdn ?? "—"} · Tk ${row.amountTaka} · '
          '${timeago.format(row.smsTimestamp)}',
          style: const TextStyle(fontSize: 12),
        ),
      ),
      trailing: const Icon(Icons.chevron_right, size: 18),
    );
  }
}
