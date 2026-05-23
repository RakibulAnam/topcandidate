// Backoff schedule for transient (5xx / network) errors.
// See spec/04-state-machine.md §3.

/// Returns the delay to wait BEFORE the [attempt]-th retry. [attempt] is the
/// post-increment count, so the first retry uses [attempt] == 1.
///
/// Pure function, easily unit-testable. Bounded at 60 minutes.
Duration transientBackoff(int attempt) {
  if (attempt <= 1) return const Duration(seconds: 5);
  if (attempt == 2) return const Duration(seconds: 15);
  if (attempt == 3) return const Duration(seconds: 45);
  if (attempt == 4) return const Duration(minutes: 2);
  if (attempt == 5) return const Duration(minutes: 6);
  if (attempt == 6) return const Duration(minutes: 18);
  return const Duration(minutes: 60);
}

/// 24-hour budget — once a row is this old without success, the dispatcher
/// gives up on transient retries.
const Duration kTransientGiveUp = Duration(hours: 24);

/// Fixed 5-minute spacing for `waiting_user` retries. 288 attempts × 5 min
/// = 24 h budget.
const Duration kWaitingUserDelay = Duration(minutes: 5);
const int kWaitingUserMaxAttempts = 288;
