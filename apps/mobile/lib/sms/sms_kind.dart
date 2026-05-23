/// Classification of a bKash SMS body. See spec/02-sms-formats.md §3.
///
/// Only [received] SMS are POSTed to the webhook. The other kinds are stored
/// for audit purposes but never dispatched.
enum BkashSmsKind {
  /// Money received from a customer: "You have received Tk ... from 01...",
  /// "Cash In Tk ...", "Send Money received Tk ...".
  received,

  /// Outbound payment from this account. Real bKash wording is
  /// `Payment of Tk X to <merchant> is successful.`; legacy/spec wording was
  /// `Make Payment of Tk ...`. Both match.
  sent,

  /// Reversal / refund: "Reversal: Tk ... has been credited to your Account
  /// from `<merchant>`".
  refund,

  /// Deposit from the operator's own bank into the bKash wallet via iBanking,
  /// e.g. "You have received deposit from iBanking of Tk X from City Bank."
  /// These look superficially like customer payments (the body starts with
  /// "You have received") but have no customer MSISDN and must never be
  /// POSTed to the credit-confirmation webhook.
  ibankingDeposit,

  /// Anything we can't classify but that came from sender "bKash".
  unknown,
}
