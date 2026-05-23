import 'package:flutter/material.dart';

import '../../dispatch/state.dart';
import '../../theme.dart';

class StateBadge extends StatelessWidget {
  const StateBadge(this.state, {super.key});
  final ProcessedSmsState state;

  @override
  Widget build(BuildContext context) {
    final c = badgeColors(state);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: c.bg,
        borderRadius: BorderRadius.circular(3),
      ),
      child: Text(
        state.displayLabel,
        style: TextStyle(
          color: c.fg,
          fontFamily: 'monospace',
          fontSize: 11,
          fontWeight: FontWeight.w700,
          letterSpacing: 0.5,
        ),
      ),
    );
  }
}
