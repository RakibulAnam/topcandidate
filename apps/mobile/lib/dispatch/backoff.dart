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

/// Spacing for `waiting_user` (HTTP 404) retries. With server-side
/// match-on-submit (web migration 012) the server settles most pay-first
/// transactions the instant the customer submits their TrxID, so these retries
/// are now a backstop that flips the watcher's local row to `done` (via a 200
/// `alreadyConfirmed`) rather than the path the customer waits on. Fast at
/// first so the operator's History reflects reality quickly; backs off to save
/// battery on the long tail.
///
/// [attempt] is the post-increment count, so the first retry uses 1.
Duration waitingUserBackoff(int attempt) {
  if (attempt <= 1) return const Duration(seconds: 20);
  if (attempt == 2) return const Duration(seconds: 40);
  if (attempt == 3) return const Duration(minutes: 1);
  if (attempt <= 6) return const Duration(minutes: 2);
  return const Duration(minutes: 5);
}

/// Hard cap on `waiting_user` retries. Combined with [kTransientGiveUp] (24h)
/// this bounds how long the watcher chases an unclaimed payment before giving
/// up and dumping it as an orphan for the operator.
const int kWaitingUserMaxAttempts = 288;
