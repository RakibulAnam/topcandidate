// Pure Dart value types for the dispatcher state machine.
// See spec/04-state-machine.md.

/// Lifecycle state of a row in `processed_sms`.
enum ProcessedSmsState {
  queued,
  sending,
  retrying,
  waitingUser,
  done,
  failed,
  mismatch,
  ignoredRefund,
  ignoredSent,
  ignoredIbanking;

  /// Stable string for SQLite storage. Do NOT rename — it's persisted.
  String get db {
    switch (this) {
      case ProcessedSmsState.queued:
        return 'queued';
      case ProcessedSmsState.sending:
        return 'sending';
      case ProcessedSmsState.retrying:
        return 'retrying';
      case ProcessedSmsState.waitingUser:
        return 'waiting_user';
      case ProcessedSmsState.done:
        return 'done';
      case ProcessedSmsState.failed:
        return 'failed';
      case ProcessedSmsState.mismatch:
        return 'mismatch';
      case ProcessedSmsState.ignoredRefund:
        return 'ignored_refund';
      case ProcessedSmsState.ignoredSent:
        return 'ignored_sent';
      case ProcessedSmsState.ignoredIbanking:
        return 'ignored_ibanking';
    }
  }

  static ProcessedSmsState fromDb(String s) {
    switch (s) {
      case 'queued':
        return ProcessedSmsState.queued;
      case 'sending':
        return ProcessedSmsState.sending;
      case 'retrying':
        return ProcessedSmsState.retrying;
      case 'waiting_user':
        return ProcessedSmsState.waitingUser;
      case 'done':
        return ProcessedSmsState.done;
      case 'failed':
        return ProcessedSmsState.failed;
      case 'mismatch':
        return ProcessedSmsState.mismatch;
      case 'ignored_refund':
        return ProcessedSmsState.ignoredRefund;
      case 'ignored_sent':
        return ProcessedSmsState.ignoredSent;
      case 'ignored_ibanking':
        return ProcessedSmsState.ignoredIbanking;
    }
    throw ArgumentError('Unknown ProcessedSmsState string: $s');
  }

  bool get isTerminal {
    switch (this) {
      case ProcessedSmsState.done:
      case ProcessedSmsState.failed:
      case ProcessedSmsState.mismatch:
      case ProcessedSmsState.ignoredRefund:
      case ProcessedSmsState.ignoredSent:
      case ProcessedSmsState.ignoredIbanking:
        return true;
      default:
        return false;
    }
  }

  String get displayLabel {
    switch (this) {
      case ProcessedSmsState.queued:
        return 'QUEUED';
      case ProcessedSmsState.sending:
        return 'SENDING';
      case ProcessedSmsState.retrying:
        return 'RETRYING';
      case ProcessedSmsState.waitingUser:
        return 'WAITING';
      case ProcessedSmsState.done:
        return 'DONE';
      case ProcessedSmsState.failed:
        return 'FAILED';
      case ProcessedSmsState.mismatch:
        return 'MISMATCH';
      case ProcessedSmsState.ignoredRefund:
        return 'REFUND';
      case ProcessedSmsState.ignoredSent:
        return 'SENT';
      case ProcessedSmsState.ignoredIbanking:
        return 'IBANKING';
    }
  }
}

/// One row in `processed_sms`.
class ProcessedSms {
  const ProcessedSms({
    required this.id,
    required this.trxId,
    required this.senderMsisdn,
    required this.amountTaka,
    required this.rawBody,
    required this.smsTimestamp,
    required this.state,
    required this.nextAttemptAt,
    required this.attemptCount,
    required this.lastError,
    required this.createdAt,
    required this.updatedAt,
  });

  final int id;
  final String trxId;
  final String? senderMsisdn;
  final int amountTaka;
  final String rawBody;
  final DateTime smsTimestamp;
  final ProcessedSmsState state;
  final DateTime? nextAttemptAt;
  final int attemptCount;
  final String? lastError;
  final DateTime createdAt;
  final DateTime updatedAt;
}

/// Outcome of a single dispatch attempt. The dispatcher computes one of these
/// in [Dispatcher.applyResponse] and the DAO writes it to disk.
class DispatchTransition {
  const DispatchTransition({
    required this.nextState,
    required this.nextAttemptAt,
    required this.incrementAttempts,
    required this.lastError,
    this.notify,
  });

  final ProcessedSmsState nextState;
  final DateTime? nextAttemptAt;
  final bool incrementAttempts;
  final String? lastError;

  /// User-facing notification to fire after applying. Null for silent
  /// transitions (e.g. routine retry).
  final NotificationSpec? notify;
}

class NotificationSpec {
  const NotificationSpec({required this.title, required this.body});
  final String title;
  final String body;
}

/// Response from the webhook, normalized so the dispatcher logic doesn't
/// depend on the http package.
class WebhookResponse {
  const WebhookResponse({required this.statusCode, this.body, this.errorTag});

  /// HTTP status code, or `null` for network errors / timeouts.
  final int? statusCode;

  /// Response body, truncated to ~512 chars by the client.
  final String? body;

  /// For network errors: a short tag like `timeout` or `dns`.
  final String? errorTag;

  bool get isNetworkError => statusCode == null;
}
