// VerifyingPurchasePill — navbar widget that tracks the latest pending
// bKash purchase end-to-end on the customer's screen.
//
// Lifecycle:
//   - Hidden when localStorage has no PENDING_PURCHASE_KEY entry.
//   - Visible the moment PurchaseModal writes one (we subscribe to a custom
//     window event so we update without a refresh).
//   - Polls /api/my-purchase-status every 10s for up to 5 min (POLL_LIMIT_MS).
//   - On terminal status: shows the matching action card and stops polling.
//   - "Dismiss" clears the localStorage entry and hides the pill until the
//     next purchase.
//
// Design: Saffron/Ink/Charcoal only. No gradients. No blue/indigo/purple.
// The bKash magenta exception is scoped to PurchaseModal; this widget uses
// the standard brand palette.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, CheckCircle2, AlertTriangle, Clock, XCircle, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  clearPendingPurchase,
  fetchPurchaseStatus,
  filePurchaseDispute,
  PENDING_PURCHASE_EVENT,
  readPendingPurchase,
  type PendingPurchaseRecord,
  type PurchaseStatus,
  type PurchaseStatusResponse,
} from '../../../infrastructure/api/purchaseStatusClient';
import { useT } from '../../i18n/LocaleContext';

const POLL_INTERVAL_MS = 10_000;
const POLL_LIMIT_MS = 5 * 60 * 1000;
const TERMINAL: PurchaseStatus[] = ['completed', 'underpaid', 'msisdn_mismatch_review', 'expired', 'refunded', 'failed'];

interface Props {
  /** Called when the customer clicks "Resubmit" on an expired pill so the
   *  shell can open PurchaseModal again. */
  onResubmit?: () => void;
}

export const VerifyingPurchasePill: React.FC<Props> = ({ onResubmit }) => {
  const t = useT();
  const [pending, setPending] = useState<PendingPurchaseRecord | null>(() => readPendingPurchase());
  const [statusResp, setStatusResp] = useState<PurchaseStatusResponse | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [disputeOpen, setDisputeOpen] = useState(false);
  const stopRef = useRef(false);

  // Re-read when the modal writes / clears the key.
  useEffect(() => {
    const onChange = () => setPending(readPendingPurchase());
    window.addEventListener(PENDING_PURCHASE_EVENT, onChange);
    return () => window.removeEventListener(PENDING_PURCHASE_EVENT, onChange);
  }, []);

  // Reset poll state whenever the underlying pending purchase changes.
  useEffect(() => {
    stopRef.current = false;
    setStatusResp(null);
    setExpanded(false);
  }, [pending?.txnId]);

  // Poll loop.
  useEffect(() => {
    if (!pending) return;
    const startedAt = pending.submittedAt;

    const tick = async () => {
      if (stopRef.current) return;
      // ALWAYS do at least one poll regardless of age — covers the case
      // where the localStorage entry is older than POLL_LIMIT_MS (page
      // reloaded long after submit, admin-confirmed out of band, etc.).
      // The age check only gates whether to keep polling after.
      try {
        const s = await fetchPurchaseStatus(pending.txnId);
        setStatusResp(s);
        if (TERMINAL.includes(s.status)) {
          stopRef.current = true;
          if (s.status === 'completed') {
            // Auto-dismiss the pill 4s after a successful credit grant.
            setTimeout(() => clearPendingPurchase(), 4000);
          }
          return;
        }
      } catch {
        // Quiet — transient 404s are expected while the watcher is in flight.
      }
      // Non-terminal status. Stop polling if we've exceeded the active
      // window — the pill stays visible with the help text and the user
      // can file a dispute or just check Purchase history below.
      if (Date.now() - startedAt > POLL_LIMIT_MS) {
        stopRef.current = true;
      }
    };

    void tick();
    const id = setInterval(() => { void tick(); }, POLL_INTERVAL_MS);
    return () => { clearInterval(id); stopRef.current = true; };
  }, [pending?.txnId, pending?.submittedAt]);

  if (!pending) return null;

  const status: PurchaseStatus = statusResp?.status ?? 'pending';
  const visual = STATUS_VISUALS[status];

  return (
    <>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className={[
          'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12.5px] font-semibold border transition-colors',
          visual.chipClass,
        ].join(' ')}
        title={statusResp?.message ?? t('verifyPill.pending')}
        aria-haspopup="dialog"
        aria-expanded={expanded}
      >
        {visual.icon}
        <span className="truncate max-w-[160px]">{visual.label(t, statusResp)}</span>
      </button>

      {expanded && (
        <div
          // top-full anchors the popover BELOW the full height of the relative
          // parent (the navbar's flex row). Without it, mt-2 alone leaves the
          // popover overlapping the navbar row — hiding sibling buttons.
          className="absolute right-0 top-full mt-2 w-[340px] z-50 rounded-2xl bg-white border border-charcoal-200 shadow-xl p-4 text-sm"
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
              onClick={() => { clearPendingPurchase(); setExpanded(false); }}
              className="-mt-1 -mr-1 p-1.5 text-charcoal-400 hover:text-brand-700 rounded-full transition-colors"
              aria-label={t('verifyPill.dismiss')}
            >
              <X size={16} />
            </button>
          </div>

          <div className="mt-3 text-[13.5px] text-brand-700 leading-snug">
            {statusResp?.message ?? t('verifyPill.pendingDetail')}
          </div>

          <ActionCard
            status={status}
            response={statusResp}
            onResubmit={onResubmit}
            onContactSupport={() => setDisputeOpen(true)}
            onFileDispute={() => setDisputeOpen(true)}
          />
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
          className="mt-2 inline-flex items-center justify-center px-3 py-1.5 rounded-full bg-brand-700 hover:bg-brand-800 text-white text-[12px] font-semibold transition-colors"
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
          className="mt-2 inline-flex items-center justify-center px-3 py-1.5 rounded-full bg-brand-700 hover:bg-brand-800 text-white text-[12px] font-semibold transition-colors"
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
        <div className="mt-2 flex items-center gap-2">
          {onResubmit && (
            <button
              type="button"
              onClick={onResubmit}
              className="inline-flex items-center justify-center px-3 py-1.5 rounded-full bg-brand-700 hover:bg-brand-800 text-white text-[12px] font-semibold transition-colors"
            >
              {t('verifyPill.resubmit')}
            </button>
          )}
          <button
            type="button"
            onClick={onFileDispute}
            className="inline-flex items-center justify-center px-3 py-1.5 rounded-full bg-white border border-charcoal-300 text-brand-700 text-[12px] font-semibold hover:bg-charcoal-50 transition-colors"
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
            className="px-4 py-2 rounded-full text-[13px] font-semibold text-charcoal-500 hover:text-brand-700 disabled:opacity-40"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className="px-4 py-2 rounded-full text-[13px] font-semibold bg-brand-700 hover:bg-brand-800 text-white disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? t('verifyPill.disputeSubmitting') : t('verifyPill.disputeSubmit')}
          </button>
        </div>
      </div>
    </div>
  );
};
