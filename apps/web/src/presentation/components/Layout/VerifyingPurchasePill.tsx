// VerifyingPurchasePill — navbar widget that tracks the latest pending
// bKash purchase end-to-end on the customer's screen.
//
// Lifecycle:
//   - Visible whenever the SERVER says this user has a purchase they can still
//     act on (`useOpenPurchase`), not when a localStorage crumb says so.
//   - Polls /api/my-purchase-status as a fallback; Realtime is the fast path.
//   - On terminal status: shows the matching action card and stops polling.
//   - Two DIFFERENT exits, deliberately not one button:
//       "Hide"   — folds the pill away for this session. The purchase is
//                  untouched and the modal still reopens straight into it.
//       "Cancel" — actually voids the row (`voidTxn`), which frees a slot
//                  against the 5-per-24h cap AND releases the Transaction ID
//                  so it can be entered again. Never offered while a payment
//                  may still be in flight.
//     The old single "Dismiss" did neither: it deleted the only pointer to a
//     still-pending server row, so the customer lost the payment from view and
//     could not re-submit the same (correct) TrxID afterwards.
//
// Design: Saffron/Ink/Charcoal only. No gradients. No blue/indigo/purple.
// The bKash magenta exception is scoped to PurchaseModal; this widget uses
// the standard brand palette.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, CheckCircle2, AlertTriangle, Clock, XCircle, X, Check, Mail } from 'lucide-react';
import { toast } from 'sonner';
import {
  clearPendingPurchase,
  fetchPurchaseStatus,
  filePurchaseDispute,
  subscribeToPurchase,
  voidTxn,
  type PurchaseStatus,
  type PurchaseStatusResponse,
} from '../../../infrastructure/api/purchaseStatusClient';
import { refreshOpenPurchase, useOpenPurchase } from '../../hooks/useOpenPurchase';
import { useT } from '../../i18n/LocaleContext';
import { CONTACT_EMAIL, contactMailto } from '../../support';

// Slow fallback poll for the rare case the realtime socket drops. The primary
// update path is the Supabase Realtime subscription (sub-second). No time cap —
// the pill resolves whenever the grant lands.
const FALLBACK_POLL_MS = 20_000;
const TERMINAL: PurchaseStatus[] = ['completed', 'underpaid', 'msisdn_mismatch_review', 'expired', 'refunded', 'failed'];

interface Props {
  /** Distinguishes concurrently-mounted instances. The navbar renders this pill
   *  twice — a `hidden md:flex` desktop row and a `flex md:hidden` mobile row —
   *  and although only one is ever VISIBLE, React mounts both and runs both
   *  sets of effects. Without a distinct suffix they open two Supabase Realtime
   *  channels on the identical `purchase:<txn>` topic, and two joins on one
   *  socket can cost one of them its subscription. */
  channelSuffix?: string;
  /** Called when the customer clicks "Resubmit" on an expired pill so the
   *  shell can open PurchaseModal again. */
  onResubmit?: () => void;
  /** Called once when the tracked purchase reaches 'completed' so the host can
   *  refresh the credits badge without a page reload. */
  onCredited?: () => void;
  /** Called after the customer cancels (voids) the tracked purchase, so hosts
   *  holding their own derived state can re-read. */
  onPurchaseChanged?: () => void;
}

export const VerifyingPurchasePill: React.FC<Props> = ({ onResubmit, onCredited, onPurchaseChanged, channelSuffix }) => {
  const t = useT();
  const openPurchase = useOpenPurchase();
  const pending = openPurchase && openPurchase.paymentReference
    ? { txnId: openPurchase.paymentReference }
    : null;
  const [statusResp, setStatusResp] = useState<PurchaseStatusResponse | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  // Folded away for THIS session only. Deliberately not persisted and
  // deliberately not a delete: the purchase stays live, the modal still opens
  // straight into it, and any status change unhides the pill again.
  const [hiddenTxn, setHiddenTxn] = useState<string | null>(null);
  const stopRef = useRef(false);
  const creditedRef = useRef(false);
  // Keep the latest onCredited without making it an effect dependency — hosts
  // pass an inline arrow whose identity changes every render.
  const onCreditedRef = useRef(onCredited);
  onCreditedRef.current = onCredited;
  const onPurchaseChangedRef = useRef(onPurchaseChanged);
  onPurchaseChangedRef.current = onPurchaseChanged;

  // Reset tracking whenever the underlying pending purchase changes.
  useEffect(() => {
    stopRef.current = false;
    creditedRef.current = false;
    setStatusResp(null);
    setExpanded(false);
    setConfirmCancel(false);
    setHiddenTxn(null);
  }, [pending?.txnId]);

  // Push-based status tracking: an initial fetch (covers match-on-submit having
  // already completed the purchase before this mounts), a Supabase Realtime
  // subscription for sub-second updates, and a slow fallback poll for a dropped
  // socket. No time cap — resolves whenever the grant lands.
  useEffect(() => {
    if (!pending) return;
    let active = true;

    const refresh = async () => {
      if (!active || stopRef.current) return;
      try {
        const s = await fetchPurchaseStatus(pending.txnId);
        if (!active) return;
        setStatusResp(s);
        if (TERMINAL.includes(s.status)) {
          stopRef.current = true;
          if (s.status === 'completed' && !creditedRef.current) {
            creditedRef.current = true;
            onCreditedRef.current?.();
            // Let the customer read the green state, then re-resolve: the row
            // is `completed` now, so it is no longer "open" and the pill
            // retires on its own. No local delete — the server decides.
            setTimeout(() => {
              if (!active) return;
              clearPendingPurchase();
              void refreshOpenPurchase();
            }, 4000);
          }
        }
      } catch {
        // Transient 404 while the watcher is in flight — the next realtime
        // event or fallback poll will pick it up.
      }
    };

    void refresh();
    const unsubscribe = subscribeToPurchase(
      pending.txnId,
      () => { void refresh(); },
      channelSuffix ? { channelSuffix } : undefined,
    );
    const fallback = setInterval(() => { void refresh(); }, FALLBACK_POLL_MS);

    return () => {
      active = false;
      unsubscribe();
      clearInterval(fallback);
    };
  }, [pending?.txnId, channelSuffix]);

  if (!pending) return null;
  if (hiddenTxn === pending.txnId) return null;

  const status: PurchaseStatus = statusResp?.status ?? 'pending';
  const visual = STATUS_VISUALS[status];

  // Hide: fold the pill away for this session. Non-destructive, so no confirm.
  const onHide = () => {
    setHiddenTxn(pending.txnId);
    setExpanded(false);
  };

  // Cancel is only safe once we know no payment is still on its way. While the
  // status is plain `pending` the watcher may be seconds from matching a real
  // bKash SMS, and voiding then is exactly how a paying customer's money goes
  // quiet. `underpaid` and `msisdn_mismatch_review` have already been matched
  // and stalled, so releasing them is a real choice the customer can make.
  const canCancel = status === 'underpaid' || status === 'msisdn_mismatch_review' || status === 'expired';

  const onCancelConfirmed = async () => {
    if (cancelling) return;
    setCancelling(true);
    try {
      // Void the SERVER row, not a browser key. This is what frees a slot
      // against the 5-per-24h cap and releases the Transaction ID so the same
      // (correct) one can be submitted again.
      await voidTxn(pending.txnId);
      clearPendingPurchase();
      await refreshOpenPurchase();
      onPurchaseChangedRef.current?.();
      toast.success(t('verifyPill.cancelDone'));
    } catch (err) {
      console.error('Could not cancel the purchase', err);
      toast.error(t('verifyPill.cancelFailed'));
    } finally {
      setCancelling(false);
      setConfirmCancel(false);
      setExpanded(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className={[
          'inline-flex items-center gap-1.5 px-3 py-1.5 min-h-11 sm:min-h-0 rounded-full text-[12.5px] font-semibold border transition-colors',
          visual.chipClass,
        ].join(' ')}
        title={statusResp?.message ?? t('verifyPill.pending')}
        aria-haspopup="dialog"
        aria-expanded={expanded}
      >
        {visual.icon}
        {/* Label hidden on the narrowest phones (icon-only) so the navbar row
            never overflows; full label returns at `sm`. */}
        <span className="hidden sm:inline truncate max-w-[160px]">{visual.label(t, statusResp)}</span>
      </button>

      {expanded && (
        <div
          // top-full anchors the popover BELOW the full height of the relative
          // parent (the navbar's flex row). Without it, mt-2 alone leaves the
          // popover overlapping the navbar row — hiding sibling buttons.
          className="absolute right-0 top-full mt-2 w-[min(340px,calc(100vw-1.5rem))] z-50 rounded-2xl bg-white border border-charcoal-200 shadow-xl p-4 text-sm"
          onClick={(e) => e.stopPropagation()}
          role="dialog"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[10.5px] uppercase tracking-[0.18em] text-charcoal-500 font-bold">
                {t('verifyPill.txnLabel')}
              </div>
              <div className="mt-0.5 font-mono text-[13px] text-brand-700 break-all">{pending.txnId}</div>
            </div>
            <button
              type="button"
              onClick={() => { setExpanded(false); setConfirmCancel(false); }}
              className="-mt-1 -mr-1 p-1.5 text-charcoal-400 hover:text-brand-700 rounded-full transition-colors"
              aria-label={t('verifyPill.close')}
            >
              <X size={16} />
            </button>
          </div>

          <div className="mt-3 text-[13.5px] text-brand-700 leading-snug">
            {statusResp?.message ?? t('verifyPill.pendingDetail')}
          </div>

          <PurchaseTimeline status={status} />

          <ActionCard
            status={status}
            response={statusResp}
            onResubmit={onResubmit}
            onContactSupport={() => setDisputeOpen(true)}
            onFileDispute={() => setDisputeOpen(true)}
          />

          {confirmCancel ? (
            <div className="mt-3 pt-3 border-t border-charcoal-100">
              <div className="text-[12.5px] font-semibold text-brand-700">
                {t('verifyPill.cancelConfirmTitle')}
              </div>
              <div className="mt-1 text-[12px] text-charcoal-600 leading-snug">
                {t('verifyPill.cancelConfirmBody')}
              </div>
              <div className="mt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmCancel(false)}
                  className="px-3 py-2 rounded-full text-[12px] font-semibold text-charcoal-500 hover:text-brand-700"
                >
                  {t('verifyPill.cancelKeep')}
                </button>
                <button
                  type="button"
                  disabled={cancelling}
                  onClick={() => { void onCancelConfirmed(); }}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-full text-[12px] font-semibold bg-brand-700 hover:bg-brand-800 text-white transition-colors disabled:opacity-60"
                >
                  {cancelling && <Loader2 size={12} className="animate-spin" />}
                  {t('verifyPill.cancelConfirm')}
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-3 pt-3 border-t border-charcoal-100 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
              <a
                href={contactMailto(t('verifyPill.emailSubject', { txn: pending.txnId }))}
                title={CONTACT_EMAIL}
                className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-brand-600 hover:text-accent-600 transition-colors"
              >
                <Mail size={13} />
                {t('verifyPill.contactUs')}
              </a>
              <div className="flex items-center gap-3">
                {/* Two exits, and the labels have to earn the difference:
                    Hide is a view control, Cancel ends the transaction. */}
                <button
                  type="button"
                  onClick={onHide}
                  className="text-[12px] text-charcoal-500 hover:text-brand-700 underline underline-offset-2"
                >
                  {t('verifyPill.hide')}
                </button>
                {canCancel && (
                  <button
                    type="button"
                    onClick={() => setConfirmCancel(true)}
                    className="text-[12px] text-charcoal-500 hover:text-brand-700 underline underline-offset-2"
                  >
                    {t('verifyPill.cancelTxn')}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {disputeOpen && (
        <DisputeDialog
          txnId={pending.txnId}
          onClose={(filed) => {
            setDisputeOpen(false);
            if (filed) {
              toast.success(t('verifyPill.disputeFiled'));
            }
          }}
        />
      )}
    </>
  );
};

// ─── helpers ─────────────────────────────────────────────────────────────

interface Visual {
  icon: React.ReactNode;
  chipClass: string;
  label: (t: ReturnType<typeof useT>, r: PurchaseStatusResponse | null) => string;
}

const STATUS_VISUALS: Record<PurchaseStatus, Visual> = {
  pending: {
    icon: <Loader2 size={14} className="animate-spin text-accent-600" />,
    chipClass: 'bg-accent-50 border-accent-200 text-brand-700 hover:bg-accent-100',
    label: (t) => t('verifyPill.pendingChip'),
  },
  completed: {
    icon: <CheckCircle2 size={14} className="text-emerald-600" />,
    chipClass: 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100',
    label: (t) => t('verifyPill.completedChip'),
  },
  underpaid: {
    icon: <AlertTriangle size={14} className="text-accent-600" />,
    chipClass: 'bg-accent-50 border-accent-200 text-brand-700 hover:bg-accent-100',
    label: (t) => t('verifyPill.underpaidChip'),
  },
  msisdn_mismatch_review: {
    icon: <AlertTriangle size={14} className="text-accent-600" />,
    chipClass: 'bg-accent-50 border-accent-200 text-brand-700 hover:bg-accent-100',
    label: (t) => t('verifyPill.reviewChip'),
  },
  expired: {
    icon: <Clock size={14} className="text-red-600" />,
    chipClass: 'bg-red-50 border-red-200 text-red-700 hover:bg-red-100',
    label: (t) => t('verifyPill.expiredChip'),
  },
  refunded: {
    icon: <XCircle size={14} className="text-red-600" />,
    chipClass: 'bg-red-50 border-red-200 text-red-700 hover:bg-red-100',
    label: (t) => t('verifyPill.refundedChip'),
  },
  failed: {
    icon: <XCircle size={14} className="text-red-600" />,
    chipClass: 'bg-red-50 border-red-200 text-red-700 hover:bg-red-100',
    label: (t) => t('verifyPill.failedChip'),
  },
};

// Compact vertical stepper: Submitted → Verifying → Done/Needs attention.
// Brand palette only (emerald = done, saffron accent = active, red = error).
type StepState = 'done' | 'active' | 'error' | 'idle';

const PurchaseTimeline: React.FC<{ status: PurchaseStatus }> = ({ status }) => {
  const t = useT();
  const isTerminal = TERMINAL.includes(status);
  const ok = status === 'completed';

  const steps: { label: string; state: StepState }[] = [
    { label: t('verifyPill.timelineSubmitted'), state: 'done' },
    { label: t('verifyPill.timelineVerifying'), state: isTerminal ? 'done' : 'active' },
    {
      label: ok ? t('verifyPill.timelineDone') : isTerminal ? t('verifyPill.timelineActionNeeded') : t('verifyPill.timelineDone'),
      state: ok ? 'done' : isTerminal ? 'error' : 'idle',
    },
  ];

  const dotBg = (s: StepState) =>
    s === 'done' ? 'bg-emerald-500'
    : s === 'active' ? 'bg-accent-500'
    : s === 'error' ? 'bg-red-500'
    : 'bg-charcoal-200';

  return (
    <ol className="mt-3 space-y-1.5">
      {steps.map((s, i) => (
        <li key={i} className="flex items-center gap-2">
          <span className={['inline-flex items-center justify-center w-4 h-4 rounded-full shrink-0', dotBg(s.state)].join(' ')}>
            {s.state === 'done' && <Check size={10} strokeWidth={3} className="text-white" />}
            {s.state === 'active' && <Loader2 size={10} className="animate-spin text-white" />}
            {s.state === 'error' && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
          </span>
          <span
            className={[
              'text-[12px]',
              s.state === 'idle' ? 'text-charcoal-400' : 'text-brand-700',
              s.state === 'active' ? 'font-semibold' : '',
            ].join(' ')}
          >
            {s.label}
          </span>
        </li>
      ))}
    </ol>
  );
};

interface ActionCardProps {
  status: PurchaseStatus;
  response: PurchaseStatusResponse | null;
  onResubmit?: () => void;
  onContactSupport: () => void;
  onFileDispute: () => void;
}

const ActionCard: React.FC<ActionCardProps> = ({ status, response, onResubmit, onContactSupport, onFileDispute }) => {
  const t = useT();
  if (status === 'underpaid' && response?.missing && response.missing > 0) {
    return (
      <div className="mt-3 rounded-xl bg-accent-50 border border-accent-200 px-3 py-2.5">
        <div className="text-[12.5px] font-semibold text-brand-700">
          {t('verifyPill.underpaidActionTitle', { missing: response.missing })}
        </div>
        <div className="mt-1 text-[12px] text-charcoal-600 leading-snug">
          {t('verifyPill.underpaidActionBody')}
        </div>
        <button
          type="button"
          onClick={onFileDispute}
          className="mt-2 inline-flex items-center justify-center px-3 py-2.5 rounded-full bg-brand-700 hover:bg-brand-800 text-white text-[12px] font-semibold transition-colors"
        >
          {t('verifyPill.contactSupport')}
        </button>
      </div>
    );
  }
  if (status === 'msisdn_mismatch_review') {
    return (
      <div className="mt-3 rounded-xl bg-accent-50 border border-accent-200 px-3 py-2.5">
        <div className="text-[12.5px] font-semibold text-brand-700">
          {t('verifyPill.reviewActionTitle')}
        </div>
        <button
          type="button"
          onClick={onContactSupport}
          className="mt-2 inline-flex items-center justify-center px-3 py-2.5 rounded-full bg-brand-700 hover:bg-brand-800 text-white text-[12px] font-semibold transition-colors"
        >
          {t('verifyPill.contactSupport')}
        </button>
      </div>
    );
  }
  if (status === 'expired') {
    return (
      <div className="mt-3 rounded-xl bg-red-50 border border-red-200 px-3 py-2.5">
        <div className="text-[12.5px] font-semibold text-red-700">
          {t('verifyPill.expiredActionTitle')}
        </div>
        <div className="mt-1 text-[12px] text-charcoal-600 leading-snug">
          {t('verifyPill.expiredActionBody')}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {onResubmit && (
            <button
              type="button"
              onClick={onResubmit}
              className="inline-flex items-center justify-center px-3 py-2.5 rounded-full bg-brand-700 hover:bg-brand-800 text-white text-[12px] font-semibold transition-colors"
            >
              {t('verifyPill.resubmit')}
            </button>
          )}
          <button
            type="button"
            onClick={onFileDispute}
            className="inline-flex items-center justify-center px-3 py-2.5 rounded-full bg-white border border-charcoal-300 text-brand-700 text-[12px] font-semibold hover:bg-charcoal-50 transition-colors"
          >
            {t('verifyPill.fileDispute')}
          </button>
        </div>
      </div>
    );
  }
  if (status === 'pending') {
    return (
      <div className="mt-3 text-[12px] text-charcoal-500 leading-snug">
        {t('verifyPill.pendingHelp')}
        <button
          type="button"
          onClick={onFileDispute}
          className="ml-1 text-brand-700 hover:text-brand-800 underline underline-offset-2"
        >
          {t('verifyPill.fileDispute')}
        </button>
      </div>
    );
  }
  return null;
};

// ─── dispute dialog ──────────────────────────────────────────────────────

interface DisputeDialogProps {
  txnId: string;
  onClose: (filed: boolean) => void;
}

const DisputeDialog: React.FC<DisputeDialogProps> = ({ txnId, onClose }) => {
  const t = useT();
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = useMemo(() => notes.trim().length >= 10 && !submitting, [notes, submitting]);

  const submit = useCallback(async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await filePurchaseDispute(txnId, notes.trim());
      onClose(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not file dispute.');
      setSubmitting(false);
    }
  }, [canSubmit, notes, onClose, txnId]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-brand-900/60 backdrop-blur-sm" onClick={() => onClose(false)} />
      <div className="relative w-full max-w-md bg-white rounded-2xl shadow-xl p-6">
        <h3 className="font-display text-lg font-semibold text-brand-700">{t('verifyPill.disputeTitle')}</h3>
        <p className="mt-1 text-[13px] text-charcoal-500">{t('verifyPill.disputeSub')}</p>
        <div className="mt-3">
          <div className="text-[10.5px] uppercase tracking-[0.18em] text-charcoal-500 font-bold">
            {t('verifyPill.txnLabel')}
          </div>
          <div className="font-mono text-[13px] text-brand-700">{txnId}</div>
        </div>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={t('verifyPill.disputeNotesPlaceholder')}
          rows={5}
          className="mt-3 block w-full px-3 py-2 rounded-xl border border-charcoal-300 text-[13px] text-brand-700 focus:outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-200"
        />
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => onClose(false)}
            disabled={submitting}
            className="px-4 py-2.5 rounded-full text-[13px] font-semibold text-charcoal-500 hover:text-brand-700 disabled:opacity-40"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className="px-4 py-2.5 rounded-full text-[13px] font-semibold bg-brand-700 hover:bg-brand-800 text-white disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? t('verifyPill.disputeSubmitting') : t('verifyPill.disputeSubmit')}
          </button>
        </div>

        <p className="mt-4 pt-3 border-t border-charcoal-100 text-[12px] text-charcoal-500">
          {t('verifyPill.disputeOrEmail')}{' '}
          <a
            href={contactMailto(t('verifyPill.emailSubject', { txn: txnId }), notes.trim() || undefined)}
            className="font-mono text-brand-700 hover:text-accent-600 underline underline-offset-2 break-all"
          >
            {CONTACT_EMAIL}
          </a>
        </p>
      </div>
    </div>
  );
};
