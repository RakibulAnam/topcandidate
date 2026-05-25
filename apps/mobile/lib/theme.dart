// Monochrome theme. See spec/06-ui-spec.md.

import 'package:flutter/material.dart';

import 'dispatch/state.dart';

const kAccent = Color(0xFF0E7C66);

ThemeData buildLightTheme() {
  final base = ThemeData(
    useMaterial3: true,
    brightness: Brightness.light,
    colorSchemeSeed: kAccent,
  );
  return base.copyWith(
    appBarTheme: const AppBarTheme(centerTitle: false, elevation: 0),
    cardTheme: const CardThemeData(elevation: 1, margin: EdgeInsets.zero),
    dividerTheme: const DividerThemeData(thickness: 0.5),
    textTheme: base.textTheme.apply(fontFamilyFallback: const ['monospace']),
  );
}

ThemeData buildDarkTheme() {
  final base = ThemeData(
    useMaterial3: true,
    brightness: Brightness.dark,
    colorSchemeSeed: kAccent,
  );
  return base.copyWith(
    appBarTheme: const AppBarTheme(centerTitle: false, elevation: 0),
    cardTheme: const CardThemeData(elevation: 1, margin: EdgeInsets.zero),
    dividerTheme: const DividerThemeData(thickness: 0.5),
  );
}

({Color bg, Color fg}) badgeColors(ProcessedSmsState state) {
  switch (state) {
    case ProcessedSmsState.queued:
      return (bg: const Color(0xFFF1F3F4), fg: const Color(0xFF424242));
    case ProcessedSmsState.sending:
      return (bg: const Color(0xFFE3F2FD), fg: const Color(0xFF1565C0));
    case ProcessedSmsState.retrying:
      return (bg: const Color(0xFFFFF3E0), fg: const Color(0xFF8C5A00));
    case ProcessedSmsState.waitingUser:
      return (bg: const Color(0xFFEDE7F6), fg: const Color(0xFF512DA8));
    case ProcessedSmsState.reversing:
      return (bg: const Color(0xFFFFF3E0), fg: const Color(0xFF8C5A00));
    case ProcessedSmsState.done:
      return (bg: const Color(0xFFE7F5EC), fg: const Color(0xFF1B5E20));
    case ProcessedSmsState.failed:
    case ProcessedSmsState.mismatch:
      return (bg: const Color(0xFFFDECEA), fg: const Color(0xFFB71C1C));
    case ProcessedSmsState.ignoredRefund:
    case ProcessedSmsState.ignoredSent:
    case ProcessedSmsState.ignoredIbanking:
      return (bg: const Color(0xFFEEEEEE), fg: const Color(0xFF616161));
  }
}
