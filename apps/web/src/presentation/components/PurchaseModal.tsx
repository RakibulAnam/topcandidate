// PurchaseModal — buy a pack of toolkit generations via bKash.
//
// Flow (no payment gateway):
//   1. User sees the owner's bKash number and the package amount.
//   2. User sends the amount via bKash to that number out-of-band.
//   3. User pastes the Transaction ID (TrxID) from the bKash confirmation
//      SMS into the form here.
//   4. We POST to /api/purchase which records a 'pending' purchase row.
//   5. The owner's Flutter SMS-watcher app reads the bKash SMS on the
//      owner's phone, matches the TrxID, and POSTs to /api/confirm-purchase
//      which flips the row to 'completed' and grants credits.
//   6. The VerifyingPurchasePill in the navbar polls /api/my-purchase-status
//      and surfaces the result. This modal hands off to it via
//      writePendingPurchase().
//
// Design notes:
//   - Split-sheet checkout: a warm-cream receipt panel on the left tells
//     the user what they're getting and the price; a clean white action
//     panel on the right is the only place anything happens.
//   - bKash magenta (#E2136E) is the action color for THIS component only,
//     authorised by the user. Saffron is intentionally not used here so
//     the user feels they are in a bKash-branded surface for the duration
//     of the payment. See AGENTS.md §10 for the scoped exception.
//   - Body scroll is locked while open so wheel/swipe events don't move
//     the page behind. The right panel has its own scrollable middle so
//     the sticky CTA at the bottom is always visible.

import React, { useEffect, useRef, useState } from 'react';
import {
  X,
  Loader2,
  Check,
  Copy,
  ArrowRight,
  ShieldCheck,
  Plus,
} from 'lucide-react';
import { toast } from 'sonner';
import { useT } from '../i18n/LocaleContext';
import { purchasePackage, type PackageId } from '../../infrastructure/api/purchaseClient';
import { ApiCallError } from '../../infrastructure/ai/proxy/ProxyClients';
import { writePendingPurchase } from '../../infrastructure/api/purchaseStatusClient';
import { track } from '../../infrastructure/analytics/track';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** Called after a pending purchase is recorded (mock mode: after credits land). */
  onSuccess?: () => void;
}

const PACKAGE_ID: PackageId = 'five-pack';

// Direct `import.meta.env.X` so Vite's AST-based static substitution kicks in.
const OWNER_BKASH_NUMBER = import.meta.env.VITE_BKASH_PAYMENT_NUMBER || '01XXXXXXXXX';

const TXN_MIN_LEN = 6;
const TXN_TARGET_LEN = 10;

const BKASH = '#E2136E';
const BKASH_DEEP = '#B80E5D';

type Phase = 'idle' | 'submitting' | 'confirmed' | 'error';

export const PurchaseModal: React.FC<Props> = ({ isOpen, onClose, onSuccess }) => {
  const t = useT();
  const [phase, setPhase] = useState<Phase>('idle');
  const [transactionId, setTransactionId] = useState('');
  const [senderMsisdn, setSenderMsisdn] = useState('');
  const [copied, setCopied] = useState(false);
  const [showPhone, setShowPhone] = useState(false);
  const txnInputRef = useRef<HTMLInputElement | null>(null);

  // Funnel: one event per open (effect re-fires only when isOpen flips true).
  useEffect(() => {
    if (!isOpen) return;
    track('purchase_modal_opened');
  }, [isOpen]);

  // Body scroll lock — keeps the page behind the backdrop still.
  useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [isOpen]);

  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(id);
  }, [copied]);

  // Auto-focus the TrxID input so users with the code on the clipboard
  // can paste in one motion.
  useEffect(() => {
    if (!isOpen) return;
    const id = setTimeout(() => txnInputRef.current?.focus(), 140);
    return () => clearTimeout(id);
  }, [isOpen]);

  if (!isOpen) return null;

  const trimmedTxn = transactionId.trim();
  const txnIsValid = trimmedTxn.length >= TXN_MIN_LEN;
  const busy = phase === 'submitting';
  const charCount = Math.min(trimmedTxn.length, TXN_TARGET_LEN);

  const reset = () => {
    setTransactionId('');
    setSenderMsisdn('');
    setShowPhone(false);
    setCopied(false);
    setPhase('idle');
  };

  const finishAndClose = () => {
    reset();
    onSuccess?.();
    onClose();
  };

  const handleCopyNumber = async () => {
    try {
      await navigator.clipboard.writeText(OWNER_BKASH_NUMBER);
      setCopied(true);
    } catch {
      toast.error(t('toolkit.copyFailed'));
    }
  };

  const handleSubmit = async () => {
    if (busy || !txnIsValid) return;
    setPhase('submitting');
    track('purchase_submitted', { packageId: PACKAGE_ID });
    try {
      const result = await purchasePackage({
        packageId: PACKAGE_ID,
        transactionId: trimmedTxn,
        senderMsisdn: senderMsisdn.trim() || undefined,
      });

      // Match-on-submit (migration 012): if the verified bKash SMS already
      // arrived, the server settled the purchase synchronously. Show the
      // confirmed overlay immediately instead of handing off to the pill.
      if (result.status === 'completed') {
        track('purchase_confirmed', { status: result.status, creditsGranted: result.creditsGranted });
        setPhase('confirmed');
        toast.success(t('purchaseModal.successToast'));
        // Hold the green check briefly, then refresh credits + close.
        setTimeout(() => finishAndClose(), 1800);
        return;
      }

      // Otherwise hand off to the navbar VerifyingPurchasePill, which subscribes
      // to Supabase Realtime and surfaces the right action card per observed
      // status (verifying / underpaid / mismatch / expired / completed).
      track('purchase_pending');
      writePendingPurchase({ txnId: trimmedTxn, submittedAt: Date.now() });

      toast.success(t('purchaseModal.successToast'));
      finishAndClose();
    } catch (err) {
      let msg: string;
      if (err instanceof ApiCallError) {
        if (err.code === 'duplicate_transaction_id') msg = t('purchaseModal.duplicateTxn');
        else if (err.code === 'invalid_transaction_id') msg = t('purchaseModal.invalidTxn');
        else msg = err.message;
      } else if (err instanceof Error) {
        msg = err.message;
      } else {
        msg = t('purchaseModal.failureFallback');
      }
      toast.error(msg);
      setPhase('idle');
    }
  };

  const features = [
    t('purchaseModal.feature1'),
    t('purchaseModal.feature2'),
    t('purchaseModal.feature3'),
    t('purchaseModal.feature4'),
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-3 sm:p-4" role="dialog" aria-modal="true">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-[#0E0D09]/65 backdrop-blur-md"
        onClick={busy ? undefined : onClose}
      />

      {/* Sheet — split layout: receipt (left) + action (right). Top-aligned on
          phones (with dvh height) so the auto-focused TrxID input and the
          footer CTA stay reachable when the keyboard opens. */}
      <div className="relative w-full max-w-4xl max-h-[100dvh] sm:max-h-[92vh] flex flex-col md:flex-row bg-white rounded-3xl sm:rounded-[28px] shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* ─── LEFT: receipt / value panel ─── */}
        <aside className="md:w-[42%] bg-[#FAF7F0] flex flex-col px-6 py-5 md:px-9 md:py-10 shrink-0 md:border-r border-b md:border-b-0 border-[#E5E1D8]">
          {/* bKash trust chip */}
          <div className="flex items-center gap-2">
            <span
              className="inline-flex items-center px-2.5 py-1 rounded-full text-[10.5px] font-bold uppercase tracking-[0.22em]"
              style={{ backgroundColor: `${BKASH}1A`, color: BKASH }}
            >
              bKash
            </span>
            <span className="text-[10.5px] uppercase tracking-[0.18em] text-[#6B6759] font-semibold">
              {t('purchaseModal.bkashChipSubtitle')}
            </span>
          </div>

          {/* Hero — price + what */}
          <div className="mt-4 md:mt-10">
            <div className="text-[10.5px] uppercase tracking-[0.22em] text-[#6B6759] font-bold">
              {t('purchaseModal.packEyebrow')}
            </div>
            <div className="mt-1.5 md:mt-2 font-display text-4xl sm:text-5xl md:text-6xl font-semibold text-[#1A1812] leading-none tracking-tight">
              {t('purchaseModal.packPrice')}
            </div>
            <div className="mt-2 md:mt-3 text-base md:text-lg font-semibold text-[#1A1812] leading-tight">
              {t('purchaseModal.packName')}
            </div>
            <div className="text-[13px] text-[#6B6759] mt-0.5">
              {t('purchaseModal.packPerUnit')}
            </div>
          </div>

          {/* Features — condensed on mobile, full on desktop. */}
          <ul className="mt-4 md:mt-8 space-y-1.5 md:space-y-2.5">
            {features.map((f, i) => (
              <li key={i} className="flex items-center gap-2.5 text-[13px] md:text-[13.5px] text-[#1A1812]">
                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-500/15 text-emerald-600 shrink-0">
                  <Check size={12} strokeWidth={3.5} />
                </span>
                <span>{f}</span>
              </li>
            ))}
          </ul>

          {/* Trust line at the bottom of the panel */}
          <div className="mt-auto pt-6 hidden md:flex items-start gap-2 text-[11.5px] text-[#6B6759] leading-relaxed">
            <ShieldCheck size={14} className="text-emerald-600 mt-0.5 shrink-0" />
            <span>{t('purchaseModal.trustLine')}</span>
          </div>
        </aside>

        {/* ─── RIGHT: action panel ─── */}
        <div className="md:w-[58%] flex flex-col min-h-0 bg-white relative">
          {/* Confirmed overlay — covers the whole right panel */}
          {phase === 'confirmed' && (
            <div className="absolute inset-0 z-10 bg-white flex items-center justify-center flex-col gap-3 animate-in fade-in duration-200 px-6 text-center">
              <div
                className="w-16 h-16 rounded-full flex items-center justify-center shadow-md"
                style={{ backgroundColor: '#10B981' }}
              >
                <Check size={32} strokeWidth={3} className="text-white" />
              </div>
              <div className="font-display text-2xl font-semibold text-[#1A1812]">
                {t('purchaseModal.confirmedHeading')}
              </div>
              <div className="text-sm text-[#6B6759] max-w-xs">
                {t('purchaseModal.confirmedSub')}
              </div>
            </div>
          )}

          {/* Header */}
          <header className="flex items-start justify-between px-6 md:px-9 pt-6 pb-3 shrink-0">
            <div>
              <h2 className="font-display text-lg font-semibold text-[#1A1812] tracking-tight">
                {t('purchaseModal.panelTitle')}
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="-mt-1 -mr-2 p-2 text-[#9F998A] hover:text-[#1A1812] hover:bg-[#F2F1EB] rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
              aria-label={t('common.close')}
            >
              <X size={18} />
            </button>
          </header>

          {/* Scrollable middle */}
          <div className="flex-1 overflow-y-auto px-6 md:px-9 pb-2">
            {/* Step 1 — Send money */}
            <section className="pt-2">
              <StepLabel n={1} label={t('purchaseModal.step1Label')} />
              <div
                className="mt-2.5 rounded-2xl bg-white border-2 px-4 py-3.5 flex flex-col sm:flex-row sm:items-center gap-2.5 sm:gap-3"
                style={{ borderColor: '#EAE6DA' }}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-[#6B6759] font-bold">
                    {t('purchaseModal.bkashNumberLabel')}
                  </div>
                  <div className="mt-0.5 font-mono text-2xl text-[#1A1812] font-bold tracking-wide truncate">
                    {OWNER_BKASH_NUMBER}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleCopyNumber}
                  className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-full text-[13px] font-bold transition-colors shrink-0 w-full sm:w-auto"
                  style={{
                    backgroundColor: copied ? '#10B981' : BKASH,
                    color: '#fff',
                  }}
                  onMouseEnter={(e) => {
                    if (!copied) (e.currentTarget as HTMLButtonElement).style.backgroundColor = BKASH_DEEP;
                  }}
                  onMouseLeave={(e) => {
                    if (!copied) (e.currentTarget as HTMLButtonElement).style.backgroundColor = BKASH;
                  }}
                  aria-label={t('purchaseModal.copyNumber')}
                >
                  {copied ? (
                    <>
                      <Check size={14} strokeWidth={3} />
                      {t('purchaseModal.copied')}
                    </>
                  ) : (
                    <>
                      <Copy size={14} />
                      {t('purchaseModal.copyNumber')}
                    </>
                  )}
                </button>
              </div>
              <p className="mt-2 text-[12.5px] text-[#6B6759] leading-snug">
                {t('purchaseModal.step1HintBefore')}
                <strong className="font-bold" style={{ color: BKASH }}>Send Money</strong>
                {t('purchaseModal.step1HintAfter')}
              </p>
            </section>

            {/* Step 2 — Paste TrxID */}
            <section className="mt-6">
              <StepLabel n={2} label={t('purchaseModal.step2Label')} />
              <div className="mt-2.5">
                <div className="relative">
                  <input
                    ref={txnInputRef}
                    type="text"
                    value={transactionId}
                    onChange={(e) => setTransactionId(e.target.value.toUpperCase())}
                    placeholder={t('purchaseModal.bkashTxnIdPlaceholder')}
                    disabled={busy}
                    className="block w-full px-4 py-3.5 pr-14 rounded-2xl border-2 bg-white font-mono text-xl tracking-wider text-[#1A1812] placeholder:text-[#CFCBBC] placeholder:font-sans placeholder:text-base focus:outline-none disabled:opacity-60 transition-colors"
                    style={{
                      borderColor: txnIsValid ? '#10B981' : '#EAE6DA',
                      boxShadow: 'none',
                    }}
                    onFocus={(e) => {
                      e.currentTarget.style.borderColor = txnIsValid ? '#10B981' : BKASH;
                      e.currentTarget.style.boxShadow = `0 0 0 3px ${BKASH}26`;
                    }}
                    onBlur={(e) => {
                      e.currentTarget.style.borderColor = txnIsValid ? '#10B981' : '#EAE6DA';
                      e.currentTarget.style.boxShadow = 'none';
                    }}
                    maxLength={32}
                    autoComplete="off"
                    spellCheck={false}
                    aria-describedby="trxid-hint"
                  />
                  {txnIsValid && (
                    <span
                      className="absolute right-3 top-1/2 -translate-y-1/2 inline-flex items-center justify-center w-7 h-7 rounded-full shadow-sm"
                      style={{ backgroundColor: '#10B981' }}
                    >
                      <Check size={16} strokeWidth={3} className="text-white" />
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-between mt-1.5">
                  <p id="trxid-hint" className="text-[12px] text-[#6B6759]">
                    {t('purchaseModal.step2Hint')}
                  </p>
                  <span
                    className={[
                      'text-[11px] font-mono tabular-nums tracking-tight transition-colors',
                      txnIsValid ? 'font-bold' : 'text-[#9F998A]',
                    ].join(' ')}
                    style={{ color: txnIsValid ? '#10B981' : undefined }}
                    aria-live="polite"
                  >
                    {charCount}/{TXN_TARGET_LEN}
                  </span>
                </div>
              </div>

              {/* Optional phone */}
              <div className="mt-3">
                {!showPhone && !senderMsisdn ? (
                  <button
                    type="button"
                    onClick={() => setShowPhone(true)}
                    className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[#6B6759] hover:text-[#1A1812] transition-colors"
                  >
                    <Plus size={13} />
                    {t('purchaseModal.addPhoneToggle')}
                  </button>
                ) : (
                  <label className="block">
                    <span className="block text-[11.5px] font-semibold text-[#1A1812] mb-1">
                      {t('purchaseModal.bkashSenderLabel')}
                    </span>
                    <input
                      type="tel"
                      value={senderMsisdn}
                      onChange={(e) => setSenderMsisdn(e.target.value)}
                      placeholder={t('purchaseModal.bkashSenderPlaceholder')}
                      disabled={busy}
                      className="block w-full px-3 py-2.5 rounded-xl border-2 bg-white text-sm text-[#1A1812] placeholder:text-[#CFCBBC] focus:outline-none disabled:opacity-60 transition-colors"
                      style={{ borderColor: '#EAE6DA' }}
                      onFocus={(e) => {
                        e.currentTarget.style.borderColor = BKASH;
                        e.currentTarget.style.boxShadow = `0 0 0 3px ${BKASH}26`;
                      }}
                      onBlur={(e) => {
                        e.currentTarget.style.borderColor = '#EAE6DA';
                        e.currentTarget.style.boxShadow = 'none';
                      }}
                      maxLength={20}
                      autoComplete="tel"
                      autoFocus
                    />
                    <span className="mt-1 block text-[11px] text-[#6B6759]">
                      {t('purchaseModal.bkashSenderHint')}
                    </span>
                  </label>
                )}
              </div>
            </section>

            {/* Mobile trust line — sits inside the action panel because the left panel hides it on small screens */}
            <div className="md:hidden mt-5 flex items-start gap-2 text-[11.5px] text-[#6B6759] leading-relaxed">
              <ShieldCheck size={13} className="text-emerald-600 mt-0.5 shrink-0" />
              <span>{t('purchaseModal.trustLine')}</span>
            </div>
          </div>

          {/* Sticky footer with the big CTA */}
          <footer className="px-6 md:px-9 pt-3 pb-5 bg-white shrink-0 border-t border-[#EAE6DA]">
            <button
              type="button"
              onClick={handleSubmit}
              disabled={busy || !txnIsValid || phase === 'confirmed'}
              className="w-full inline-flex items-center justify-center gap-2 px-5 py-4 rounded-2xl text-base font-bold text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
              style={{
                backgroundColor: busy || !txnIsValid || phase === 'confirmed' ? '#CFCBBC' : BKASH,
              }}
              onMouseEnter={(e) => {
                if (!busy && txnIsValid && phase !== 'confirmed') {
                  (e.currentTarget as HTMLButtonElement).style.backgroundColor = BKASH_DEEP;
                }
              }}
              onMouseLeave={(e) => {
                if (!busy && txnIsValid && phase !== 'confirmed') {
                  (e.currentTarget as HTMLButtonElement).style.backgroundColor = BKASH;
                }
              }}
            >
              {phase === 'submitting' && (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  {t('purchaseModal.processing')}
                </>
              )}
              {(phase === 'idle' || phase === 'error' || phase === 'confirmed') && (
                <>
                  {t('purchaseModal.submitCta')}
                  <ArrowRight size={18} />
                </>
              )}
            </button>
            <div className="mt-2 text-center">
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="text-[12.5px] font-semibold text-[#6B6759] hover:text-[#1A1812] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {t('purchaseModal.cancel')}
              </button>
            </div>
          </footer>
        </div>
      </div>
    </div>
  );
};

const StepLabel: React.FC<{ n: number; label: string }> = ({ n, label }) => (
  <div className="flex items-center gap-2">
    <span
      className="inline-flex items-center justify-center w-6 h-6 rounded-full text-white text-[12px] font-bold"
      style={{ backgroundColor: BKASH }}
    >
      {n}
    </span>
    <h3 className="text-[13.5px] font-bold text-[#1A1812] tracking-tight uppercase">
      {label}
    </h3>
  </div>
);
