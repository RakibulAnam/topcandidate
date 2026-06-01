import 'package:flutter_test/flutter_test.dart';
import 'package:bkash_watcher/dispatch/backoff.dart';

void main() {
  group('transientBackoff', () {
    test('attempt 1 -> 5s', () {
      expect(transientBackoff(1), const Duration(seconds: 5));
    });
    test('attempt 2 -> 15s', () {
      expect(transientBackoff(2), const Duration(seconds: 15));
    });
    test('attempt 3 -> 45s', () {
      expect(transientBackoff(3), const Duration(seconds: 45));
    });
    test('attempt 4 -> 2 min', () {
      expect(transientBackoff(4), const Duration(minutes: 2));
    });
    test('attempt 5 -> 6 min', () {
      expect(transientBackoff(5), const Duration(minutes: 6));
    });
    test('attempt 6 -> 18 min', () {
      expect(transientBackoff(6), const Duration(minutes: 18));
    });
    test('attempt 7+ -> 60 min', () {
      expect(transientBackoff(7), const Duration(minutes: 60));
      expect(transientBackoff(20), const Duration(minutes: 60));
    });
    test('attempt 0 falls back to 5s (defensive)', () {
      expect(transientBackoff(0), const Duration(seconds: 5));
    });
  });

  group('waitingUserBackoff', () {
    test('attempt 1 -> 20s', () {
      expect(waitingUserBackoff(1), const Duration(seconds: 20));
    });
    test('attempt 2 -> 40s', () {
      expect(waitingUserBackoff(2), const Duration(seconds: 40));
    });
    test('attempt 3 -> 1 min', () {
      expect(waitingUserBackoff(3), const Duration(minutes: 1));
    });
    test('attempts 4-6 -> 2 min', () {
      expect(waitingUserBackoff(4), const Duration(minutes: 2));
      expect(waitingUserBackoff(6), const Duration(minutes: 2));
    });
    test('attempt 7+ -> 5 min (bounded)', () {
      expect(waitingUserBackoff(7), const Duration(minutes: 5));
      expect(waitingUserBackoff(50), const Duration(minutes: 5));
    });
    test('attempt 0 falls back to 20s (defensive)', () {
      expect(waitingUserBackoff(0), const Duration(seconds: 20));
    });
  });
}
