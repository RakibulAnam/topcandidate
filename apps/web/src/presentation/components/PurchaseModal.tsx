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
//   - DESKTOP (md+): split-sheet checkout — a warm-cream receipt panel on the
//     left tells the user what they're getting and the price; a clean white
//     action panel on the right is the only place anything happens.
//   - MOBILE (<md): a native bottom sheet. The buyer already decided to pay,
//     so it LEADS WITH THE ACTION: the receipt collapses to a one-line
//     disclosure ribbon at the top, the bKash number + Copy and the TrxID
//     field own the viewport, and the sheet is sized to window.visualViewport
//     so the input and the sticky CTA stay above the soft keyboard.
//   - bKash magenta (#E2136E) is the action color for THIS component only,
//     authorised by the user. Saffron is intentionally not used here so the
//     user feels they are in a bKash-branded surface for the duration of the
//     payment. See AGENTS.md §10 for the scoped exception.
//   - Body scroll is locked while open.

import React, { useEffect, useRef, useState } from 'react';
import {
  X,
  Loader2,
  Check,
  Copy,
  ArrowRight,
  ShieldCheck,
  Plus,
  ChevronDown,
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
  const [featuresOpen, setFeaturesOpen] = useState(false); // mobile receipt disclosure
  const txnInputRef = useRef<HTMLInputElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);

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

  // Keyboard-aware sizing (mobile). The positioning wrapper is sized to the
  // VISUAL viewport so, bottom-anchored, the sheet's footer CTA rides just
  // above the soft keyboard instead of hiding behind it. Desktop ignores this
  // entirely via the `md:` height/inset overrides. We only ever set CSS
  // *variables* (never element.style.height) so desktop can override.
  useEffect(() => {
    if (!isOpen) return;
    const vv = window.visualViewport;
    const el = overlayRef.current;
    if (!vv || !el) return;
    const apply = () => {
      el.style.setProperty('--sheet-h', `${vv.height}px`);
      el.style.setProperty('--vv-top', `${vv.offsetTop}px`);
    };
    apply();
    vv.addEventListener('resize', apply);
    vv.addEventListener('scroll', apply);
    return () => {
      vv.removeEventListener('resize', apply);
      vv.removeEventListener('scroll', apply);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(id);
  }, [copied]);

  // Auto-focus the TrxID input so users with the code on the clipboard can
  // paste in one motion — DESKTOP ONLY. On mobile, auto-focusing pops the
  // keyboard before the user has even seen the bKash number to send to.
  useEffect(() => {
    if (!isOpen) return;
    if (!window.matchMedia('(min-width: 768px)').matches) return;
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
    setFeaturesOpen(false);
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

  // Success takeover — reused for the mobile full-sheet overlay and the
  // desktop right-panel overlay.
  const confirmedContent = (
    <div className="flex flex-col items-center justify-center gap-3 px-6 text-center">
      <div
        className="flex h-16 w-16 items-center justify-center rounded-full shadow-md motion-safe:animate-in motion-safe:zoom-in-75 motion-safe:duration-300"
        style={{ backgroundColor: '#10B981' }}
      >
        <Check size={32} strokeWidth={3} className="text-white" />
      </div>
      <div className="font-display text-2xl font-semibold text-[#1A1812]">
        {t('purchaseModal.confirmedHeading')}
      </div>
      <div className="max-w-xs text-sm text-[#6B6759]">
        {t('purchaseModal.confirmedSub')}
      </div>
    </div>
  );

  return (
    <div
      ref={overlayRef}
      className="fixed inset-x-0 top-[var(--vv-top,0px)] z-50 flex h-[var(--sheet-h,100dvh)] items-end justify-center p-0 md:inset-0 md:top-0 md:h-auto md:items-center md:p-4"
      role="dialog"
      aria-modal="true"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-[#0E0D09]/65 backdrop-blur-md"
        onClick={busy ? undefined : onClose}
      />

      {/* Sheet — bottom sheet on mobile (slides up), split card on desktop (zooms in). */}
      <div className="relative flex max-h-full w-full flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-8 motion-safe:duration-300 md:max-h-[92vh] md:max-w-4xl md:flex-row md:rounded-[28px] md:slide-in-from-bottom-0 md:zoom-in-95 md:duration-200">

        {/* Mobile-only full-sheet confirmed overlay */}
        {phase === 'confirmed' && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-white md:hidden motion-safe:animate-in motion-safe:fade-in">
            {confirmedContent}
          </div>
        )}

        {/* ─── LEFT (desktop) / TOP RIBBON (mobile): receipt / value ─── */}
        <aside className="shrink-0 bg-[#FAF7F0] border-b border-[#E5E1D8] md:w-[42%] md:border-b-0 md:border-r">
          {/* Mobile receipt ribbon */}
          <div className="md:hidden px-5">
            {/* grabber (decorative) */}
            <div className="flex justify-center pt-2.5 pb-1.5">
              <span className="h-1 w-9 rounded-full bg-[#EAE6DA]" aria-hidden />
            </div>
            {/* chip + secure ........ close X */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className="inline-flex items-center px-2.5 py-1 rounded-full text-[10.5px] font-bold uppercase tracking-[0.22em]"
                  style={{ backgroundColor: `${BKASH}1A`, color: BKASH }}
                >
                  bKash
                </span>
                <span className="truncate text-[10.5px] uppercase tracking-[0.16em] text-[#6B6759] font-semibold">
                  {t('purchaseModal.bkashChipSubtitle')}
                </span>
              </div>
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="-mr-2 shrink-0 rounded-full p-2 text-[#9F998A] transition-colors hover:bg-[#F2F1EB] hover:text-[#1A1812] disabled:cursor-not-allowed disabled:opacity-40"
                aria-label={t('common.close')}
              >
                <X size={18} />
              </button>
            </div>
            {/* price disclosure */}
            <button
              type="button"
              onClick={() => setFeaturesOpen((v) => !v)}
              aria-expanded={featuresOpen}
              aria-controls="pm-features"
              aria-label={t('purchaseModal.packEyebrow')}
              className="mt-1 flex w-full items-baseline gap-2 pb-3 text-left"
            >
              <span className="font-display text-2xl font-semibold leading-none text-[#1A1812] tracking-tight">
                {t('purchaseModal.packPrice')}
              </span>
              <span className="text-[#CFCBBC]">·</span>
              <span className="min-w-0 truncate text-[13px] font-semibold text-[#1A1812]">
                {t('purchaseModal.packName')}
              </span>
              <span className="hidden text-[12px] text-[#6B6759] xs:inline">{t('purchaseModal.packPerUnit')}</span>
              <ChevronDown
                size={16}
                className={`ml-auto shrink-0 text-[#9F998A] transition-transform duration-200 motion-reduce:transition-none ${featuresOpen ? 'rotate-180' : ''}`}
              />
            </button>
            {/* collapsible features */}
            <div
              id="pm-features"
              className={`grid transition-all duration-200 ease-out motion-reduce:transition-none ${featuresOpen ? 'grid-rows-[1fr] opacity-100 pb-3' : 'grid-rows-[0fr] opacity-0'}`}
            >
              <ul className="min-h-0 space-y-1.5 overflow-hidden">
                {features.map((f, i) => (
                  <li key={i} className="flex items-center gap-2.5 text-[13px] text-[#1A1812]">
                    <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600">
                      <Check size={12} strokeWidth={3.5} />
                    </span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Desktop hero panel */}
          <div className="hidden md:flex md:h-full md:flex-col md:px-9 md:py-10">
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
            <div className="mt-10">
              <div className="text-[10.5px] uppercase tracking-[0.22em] text-[#6B6759] font-bold">
                {t('purchaseModal.packEyebrow')}
              </div>
              <div className="mt-2 font-display text-6xl font-semibold text-[#1A1812] leading-none tracking-tight">
                {t('purchaseModal.packPrice')}
              </div>
              <div className="mt-3 text-lg font-semibold text-[#1A1812] leading-tight">
                {t('purchaseModal.packName')}
              </div>
              <div className="text-[13px] text-[#6B6759] mt-0.5">
                {t('purchaseModal.packPerUnit')}
              </div>
            </div>

            {/* Features */}
            <ul className="mt-8 space-y-2.5">
              {features.map((f, i) => (
                <li key={i} className="flex items-center gap-2.5 text-[13.5px] text-[#1A1812]">
                  <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-500/15 text-emerald-600 shrink-0">
                    <Check size={12} strokeWidth={3.5} />
                  </span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>

            {/* Trust line at the bottom of the panel */}
            <div className="mt-auto pt-6 flex items-start gap-2 text-[11.5px] text-[#6B6759] leading-relaxed">
              <ShieldCheck size={14} className="text-emerald-600 mt-0.5 shrink-0" />
              <span>{t('purchaseModal.trustLine')}</span>
            </div>
          </div>
        </aside>

        {/* ─── RIGHT (desktop) / MAIN (mobile): action panel ─── */}
        <div className="relative flex min-h-0 flex-1 flex-col bg-white md:w-[58%] md:flex-none">
          {/* Confirmed overlay — desktop, covers the right panel only */}
          {phase === 'confirmed' && (
            <div className="absolute inset-0 z-10 hidden bg-white md:flex md:items-center md:justify-center animate-in fade-in duration-200">
              {confirmedContent}
            </div>
          )}

          {/* Header — desktop only (mobile close X lives in the ribbon) */}
          <header className="hidden shrink-0 items-start justify-between px-9 pt-6 pb-3 md:flex">
            <h2 className="font-display text-lg font-semibold text-[#1A1812] tracking-tight">
              {t('purchaseModal.panelTitle')}
            </h2>
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="-mt-1 -mr-2 shrink-0 rounded-full p-2 text-[#9F998A] transition-colors hover:bg-[#F2F1EB] hover:text-[#1A1812] disabled:cursor-not-allowed disabled:opacity-40"
              aria-label={t('common.close')}
            >
              <X size={18} />
            </button>
          </header>

          {/* Scrollable middle */}
          <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-4 pb-2 md:px-9 md:pt-0">
            {/* Step 1 — Send money */}
            <section>
              <StepLabel n={1} label={t('purchaseModal.step1Label')} />
              <div
                className="mt-2.5 flex flex-col gap-2.5 rounded-2xl border-2 bg-white px-4 py-3.5 sm:flex-row sm:items-center sm:gap-3"
                style={{ borderColor: '#EAE6DA' }}
              >
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-[#6B6759] font-bold">
                    {t('purchaseModal.bkashNumberLabel')}
                  </div>
                  <div className="mt-0.5 truncate font-mono text-2xl font-bold tracking-wide text-[#1A1812]">
                    {OWNER_BKASH_NUMBER}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleCopyNumber}
                  className="inline-flex w-full min-h-[48px] shrink-0 items-center justify-center gap-1.5 rounded-full px-4 py-2.5 text-[13px] font-bold transition-colors sm:w-auto sm:min-h-0"
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

              {/* Mobile trust line — sits at the end of Step 1 so Step 2 (below)
                  stays adjacent to the docked CTA above the keyboard. */}
              <div className="mt-4 flex items-start gap-2 text-[11.5px] text-[#6B6759] leading-relaxed md:hidden">
                <ShieldCheck size={13} className="text-emerald-600 mt-0.5 shrink-0" />
                <span>{t('purchaseModal.trustLine')}</span>
              </div>
            </section>

            {/* Step 2 — Paste TrxID (last child → sits above the docked footer) */}
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
                      className="absolute right-3 top-1/2 -translate-y-1/2 inline-flex items-center justify-center w-7 h-7 rounded-full shadow-sm motion-safe:animate-in motion-safe:zoom-in-50 motion-safe:duration-150"
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
          </div>

          {/* Sticky footer with the big CTA — docked above the keyboard on mobile */}
          <footer className="shrink-0 border-t border-[#EAE6DA] bg-white px-6 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))] md:px-9 md:pb-5">
            <button
              type="button"
              onClick={handleSubmit}
              disabled={busy || !txnIsValid || phase === 'confirmed'}
              className="w-full inline-flex min-h-[52px] items-center justify-center gap-2 px-5 py-4 rounded-2xl text-base font-bold text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
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
            {/* Cancel — desktop only; mobile uses the ribbon X + backdrop tap. */}
            <div className="mt-2 hidden text-center md:block">
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
