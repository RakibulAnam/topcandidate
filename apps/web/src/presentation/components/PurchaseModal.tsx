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
//   6. The VerifyingPurchasePill in the navbar tracks the purchase in the
//      background. This modal hands off to it via writePendingPurchase().
//
// VERIFICATION UX (migration 028)
// ===============================
// The modal used to close the instant /api/purchase returned anything other
// than 'completed', with a success toast. That was wrong twice over: a
// mistyped TrxID got the same "credits will land soon" message as a matched
// payment (then span in the navbar until the 24h expiry sweep), and the two
// genuinely-bad settle states the server already reports — 'underpaid' and
// 'msisdn_mismatch_review' — were announced as successes.
//
// Now the modal stays open and owns the outcome:
//   - 'completed'                → green check, in-modal (unchanged).
//   - 'underpaid' / 'mismatch'   → the matching problem card, never a success.
//   - 'pending'                  → a VERIFYING panel that watches the purchase
//     row over Supabase Realtime for VERIFY_WINDOW_MS. Landing inside the
//     window shows the green check here.
//   - window elapses             → ask /api/purchase-ops/verify-txn WHY it is
//     still pending and render that specific verdict, instead of a shrug.
//
// The verdict distinction is the point: 'likely_typo' means we can see an
// unclaimed verified payment resembling what they typed, so "check your TrxID"
// is fair. 'awaiting_sms' / 'watcher_stale' mean the delay is OURS and saying
// anything else would blame a paying customer for our latency. After
// ESCALATE_AFTER_ATTEMPTS tries we stop asking them to retry and put the
// operator's own contact channels in front of them, plus a one-tap dispute so
// the request reaches the admin queue even if they never write the email.
//
// The pending-purchase handoff still happens immediately, so closing the modal
// (or the tab) never loses the purchase — the navbar pill picks it up.
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
  AlertTriangle,
  Clock,
  LifeBuoy,
  Mail,
  MessageCircle,
  Phone,
  RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';
import { useT } from '../i18n/LocaleContext';
import { purchasePackage, type PackageId } from '../../infrastructure/api/purchaseClient';
import { ApiCallError } from '../../infrastructure/ai/proxy/ProxyClients';
import {
  clearPendingPurchase,
  fetchPurchaseStatus,
  filePurchaseDispute,
  subscribeToPurchase,
  verifyTxn,
  voidTxn,
  writePendingPurchase,
  type PurchaseStatus,
  type PurchaseVerdict,
  type PurchaseVerification,
} from '../../infrastructure/api/purchaseStatusClient';
import { track } from '../../infrastructure/analytics/track';
import { CONTACT_EMAIL, CONTACT_FACEBOOK_URL, contactMailto } from '../support';

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

// How long the modal watches the purchase row before giving a verdict.
// Matched to the watcher's first `waiting_user` retry (20s, see
// apps/mobile/lib/dispatch/backoff.dart) and the pill's fallback poll: a
// genuine slow SMS resolves inside this window, and past it the honest thing
// to say is "not matched yet", not "still checking".
const VERIFY_WINDOW_MS = 20_000;
// Realtime is the primary signal; this only covers a dropped socket. Tighter
// than the pill's 20s because we are only alive for one window.
const VERIFY_POLL_MS = 5_000;
// Stop asking the customer to re-check and put a human in front of them.
const ESCALATE_AFTER_ATTEMPTS = 3;

const TERMINAL_STATUSES: PurchaseStatus[] = [
  'completed', 'underpaid', 'msisdn_mismatch_review', 'expired', 'refunded', 'failed',
];

/** 01712345678 -> 8801712345678. wa.me wants digits only, no + and no leading 0. */
const toIntlDigits = (msisdn: string): string => {
  const digits = msisdn.replace(/\D/g, '');
  if (digits.startsWith('880')) return digits;
  if (digits.startsWith('0')) return `880${digits.slice(1)}`;
  return `880${digits}`;
};

const BKASH = '#E2136E';
const BKASH_DEEP = '#B80E5D';

type Phase = 'idle' | 'submitting' | 'verifying' | 'confirmed' | 'problem';

export const PurchaseModal: React.FC<Props> = ({ isOpen, onClose, onSuccess }) => {
  const t = useT();
  const [phase, setPhase] = useState<Phase>('idle');
  const [transactionId, setTransactionId] = useState('');
  const [senderMsisdn, setSenderMsisdn] = useState('');
  const [copied, setCopied] = useState(false);
  const [showPhone, setShowPhone] = useState(false);
  const [featuresOpen, setFeaturesOpen] = useState(false); // mobile receipt disclosure
  // The TrxID currently being verified. Held separately from `transactionId`
  // so that going back to edit the input never changes what we're tracking.
  const [trackedTxn, setTrackedTxn] = useState('');
  const [verdict, setVerdict] = useState<PurchaseVerdict | null>(null);
  const [verification, setVerification] = useState<PurchaseVerification | null>(null);
  const [settled, setSettled] = useState<{ observed: number | null; expected: number } | null>(null);
  const [attempts, setAttempts] = useState(0);
  const [helpOpen, setHelpOpen] = useState(false);
  const [notifyState, setNotifyState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [creditsGranted, setCreditsGranted] = useState<number | null>(null);
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

  const reset = () => {
    setTransactionId('');
    setSenderMsisdn('');
    setShowPhone(false);
    setFeaturesOpen(false);
    setCopied(false);
    setTrackedTxn('');
    setVerdict(null);
    setVerification(null);
    setSettled(null);
    setAttempts(0);
    setHelpOpen(false);
    setNotifyState('idle');
    setCreditsGranted(null);
    setPhase('idle');
  };

  const finishAndClose = () => {
    reset();
    onSuccess?.();
    onClose();
  };

  // Kept in a ref so the verification effect's deadline/realtime callbacks
  // always call the CURRENT closure, never one captured from an earlier render.
  const finishRef = useRef(finishAndClose);
  finishRef.current = finishAndClose;

  // ── Verification watch ───────────────────────────────────────────────────
  // Realtime first (sub-second via migration 012's publication), a slow
  // fallback poll for a dropped socket, and a hard deadline that converts
  // "still pending" into a specific verdict instead of an endless spinner.
  useEffect(() => {
    if (!isOpen || phase !== 'verifying' || !trackedTxn) return;
    let active = true;
    let done = false;

    const settle = (status: PurchaseStatus, observed: number | null, expected: number) => {
      if (!active || done) return;
      done = true;
      if (status === 'completed') {
        track('purchase_confirmed', { status, via: 'verify_window' });
        setPhase('confirmed');
        // Closing is owned by the dedicated 'confirmed' effect below. Doing it
        // here with an `active`-guarded timer could never fire: setting the
        // phase re-runs THIS effect, and its cleanup clears `active` first.
        return;
      }
      // 'underpaid' / 'msisdn_mismatch_review' / 'expired' / 'refunded' /
      // 'failed' — all real problems. Never a success toast.
      setSettled({ observed, expected });
      setVerdict(status);
      track('purchase_problem', { verdict: status });
      setPhase('problem');
    };

    const refresh = async () => {
      if (!active || done) return;
      try {
        const st = await fetchPurchaseStatus(trackedTxn);
        if (!active || done) return;
        if (TERMINAL_STATUSES.includes(st.status)) {
          settle(st.status, st.observedAmountTaka, st.amountTaka);
        }
      } catch {
        // Transient 404 while the row propagates, or a network blip. The next
        // realtime event, the poll, or the deadline covers it.
      }
    };

    void refresh();
    const unsubscribe = subscribeToPurchase(
      trackedTxn,
      () => { void refresh(); },
      // The navbar pill is subscribed to this same TrxID right now (the pending
      // handoff is written before this panel opens). Two channels sharing one
      // topic on a single socket can cost us one of the subscriptions, so take
      // a distinct topic and leave the pill's alone.
      { channelSuffix: 'modal' },
    );
    const poll = setInterval(() => { void refresh(); }, VERIFY_POLL_MS);

    const deadline = setTimeout(() => {
      void (async () => {
        if (!active || done) return;
        try {
          const v = await verifyTxn(trackedTxn);
          if (!active || done) return;
          if (v.status === 'completed') {
            settle('completed', v.observedAmountTaka, v.amountTaka);
            return;
          }
          done = true;
          setVerification(v);
          setVerdict(v.verdict);
          setSettled({ observed: v.observedAmountTaka, expected: v.amountTaka });
          // Server-side attempt count wins over our per-session counter: it
          // sees tries from earlier sessions and other devices too.
          setAttempts((n) => Math.max(n, v.attempts));
          if (v.attempts >= ESCALATE_AFTER_ATTEMPTS) setHelpOpen(true);
          track('purchase_verify_verdict', { verdict: v.verdict, attempts: v.attempts });
          setPhase('problem');
        } catch {
          if (!active || done) return;
          // Couldn't reach the diagnosis endpoint. Fall back to the softest
          // honest verdict rather than implying the customer did something
          // wrong — the pill keeps tracking either way.
          done = true;
          setVerdict('awaiting_sms');
          setPhase('problem');
        }
      })();
    }, VERIFY_WINDOW_MS);

    return () => {
      active = false;
      unsubscribe();
      clearInterval(poll);
      clearTimeout(deadline);
    };
  }, [isOpen, phase, trackedTxn]);

  // Hold the green check briefly, then refresh credits and close. One place,
  // so both success paths behave the same: match-on-submit (settled inside the
  // /api/purchase response) and a Realtime arrival during the verify window.
  useEffect(() => {
    if (!isOpen || phase !== 'confirmed') return;
    const id = setTimeout(() => finishRef.current(), 1800);
    return () => clearTimeout(id);
  }, [isOpen, phase]);

  if (!isOpen) return null;

  const trimmedTxn = transactionId.trim();
  const txnIsValid = trimmedTxn.length >= TXN_MIN_LEN;
  const busy = phase === 'submitting';
  const charCount = Math.min(trimmedTxn.length, TXN_TARGET_LEN);

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
    const attempt = attempts + 1;
    setPhase('submitting');
    setAttempts(attempt);
    track('purchase_submitted', { packageId: PACKAGE_ID, attempt });
    try {
      const result = await purchasePackage({
        packageId: PACKAGE_ID,
        transactionId: trimmedTxn,
        senderMsisdn: senderMsisdn.trim() || undefined,
      });

      // Hand off to the navbar pill immediately, whatever happens next: if the
      // customer closes the modal or the tab mid-verification, the purchase is
      // still tracked. Cleared again only if they void a mistyped TrxID.
      writePendingPurchase({ txnId: trimmedTxn, submittedAt: Date.now() });
      setTrackedTxn(trimmedTxn);

      // Match-on-submit (migration 012): if the verified bKash SMS already
      // arrived, the server settled the purchase synchronously.
      if (result.status === 'completed') {
        track('purchase_confirmed', {
          status: result.status,
          creditsGranted: result.creditsGranted,
          via: 'match_on_submit',
        });
        setCreditsGranted(result.creditsGranted ?? null);
        setPhase('confirmed');
        // The credits are already in the account at this point, so say that.
        // `successToast` ("will land within a few minutes") is the wrong tense
        // here — it belonged to the old flow where submitting only queued.
        toast.success(t('purchaseModal.confirmedToast', { credits: result.creditsGranted ?? 5 }));
        // Hold the green check briefly, then refresh credits + close — see the
        // 'confirmed' effect. Kept in one place so both success paths (this one
        // and the mid-window Realtime arrival) behave identically.
        return;
      }

      // Two settle states the server has ALREADY diagnosed. These used to fall
      // through to a success toast and an instant close — the customer was told
      // "credits will land soon" when in fact their payment was short or their
      // sender number didn't match. Show the real thing.
      if (result.status === 'underpaid' || result.status === 'msisdn_mismatch_review') {
        track('purchase_problem', { verdict: result.status, via: 'match_on_submit' });
        setVerdict(result.status);
        try {
          // The submit response carries no observed amount; the status endpoint
          // does, and the underpaid copy needs it to name the shortfall.
          const st = await fetchPurchaseStatus(trimmedTxn);
          setSettled({ observed: st.observedAmountTaka, expected: st.amountTaka });
        } catch {
          // Copy falls back to the pack price.
        }
        setPhase('problem');
        return;
      }

      // 'pending' — stay open and watch the row. The effect above resolves this
      // into 'confirmed' or a specific verdict; it no longer closes behind a
      // toast and leaves the navbar spinner as the only affordance.
      track('purchase_pending', { attempt });
      setPhase('verifying');
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

  /** "Check and try again" after a suspected typo. */
  const handleRetry = async () => {
    if (trackedTxn) {
      try {
        // Retire the mistyped row so the corrected submit doesn't consume
        // another of the customer's 5 pending slots per 24h.
        await voidTxn(trackedTxn);
      } catch {
        // Already settled or already gone — nothing to undo.
      }
      // Stop the navbar pill tracking a TrxID we've abandoned.
      clearPendingPurchase();
    }
    setTrackedTxn('');
    setVerdict(null);
    setVerification(null);
    setSettled(null);
    setHelpOpen(false);
    setNotifyState('idle');
    setPhase('idle');
    // Land them back on the field with the old value selected, ready to retype.
    setTimeout(() => {
      txnInputRef.current?.focus();
      txnInputRef.current?.select();
    }, 80);
  };

  /** One-tap escalation: puts the TrxID in the operator's dispute queue so the
   *  request lands even if the customer never sends the email. */
  const handleNotify = async () => {
    if (notifyState !== 'idle' || !trackedTxn) return;
    setNotifyState('sending');
    try {
      await filePurchaseDispute(
        trackedTxn,
        t('purchaseModal.helpDisputeNote', { attempts, verdict: verdict ?? 'unknown' }),
      );
      setNotifyState('sent');
      track('purchase_dispute_filed', { verdict: verdict ?? 'unknown', attempts });
    } catch (err) {
      setNotifyState('idle');
      toast.error(err instanceof Error ? err.message : t('purchaseModal.failureFallback'));
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

  // Verification takeover — shown while we watch the purchase row. The three
  // beats are literal, not a fake progress animation: step 1 is genuinely done
  // (the row exists), step 2 is what we are actually waiting on, step 3 only
  // happens on success — at which point this panel is replaced by the check.
  const verifyingContent = (
    <div className="flex w-full flex-col items-center gap-5 px-6 text-center">
      <div className="relative flex h-16 w-16 items-center justify-center">
        <span className="absolute inset-0 rounded-full" style={{ backgroundColor: `${BKASH}14` }} />
        <Loader2 size={30} className="animate-spin" style={{ color: BKASH }} />
      </div>
      <div>
        <div className="font-display text-2xl font-semibold text-[#1A1812]">
          {t('purchaseModal.verifyingTitle')}
        </div>
        <div className="mt-1.5 max-w-xs text-sm text-[#6B6759]">
          {t('purchaseModal.verifyingSub')}
        </div>
      </div>
      <ol className="w-full max-w-[17rem] space-y-2.5 text-left">
        <VerifyBeat state="done" label={t('purchaseModal.verifyStep1')} />
        <VerifyBeat state="active" label={t('purchaseModal.verifyStep2')} />
        <VerifyBeat state="pending" label={t('purchaseModal.verifyStep3')} />
      </ol>
      <div className="w-full max-w-[17rem] rounded-xl border border-[#EAE6DA] bg-[#FAF7F0] px-3 py-2 text-left">
        <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#6B6759]">
          {t('purchaseModal.verifyTxnLabel')}
        </div>
        <div className="mt-0.5 break-all font-mono text-[13px] tracking-wide text-[#1A1812]">
          {trackedTxn}
        </div>
      </div>
    </div>
  );

  // What to say, and what to offer, for each verdict. `primary` decides the
  // main button: retry (we have evidence the ID is wrong), wait (the delay is
  // ours — closing is safe, the pill keeps tracking), or help (needs a human).
  const expectedTaka = settled?.expected ?? 200;
  const observedTaka = settled?.observed ?? null;
  const missingTaka = observedTaka != null ? Math.max(0, expectedTaka - observedTaka) : null;

  const problem: {
    tone: 'warn' | 'calm';
    title: string;
    body: string;
    primary: 'retry' | 'wait' | 'help';
  } = (() => {
    switch (verdict) {
      case 'likely_typo':
        // Says nothing about the payment we matched against. We cannot prove it
        // belongs to this customer, so describing it — even the amount, even a
        // masked number — would leak a stranger's data. See migration 029.
        return {
          tone: 'warn',
          title: t('purchaseModal.problemTypoTitle'),
          body: t('purchaseModal.problemTypoBody'),
          primary: 'retry',
        };
      case 'nothing_found':
      // After the 24h TTL the honest message is the same: no payment reached us.
      case 'expired':
        return {
          tone: 'warn',
          title: t('purchaseModal.problemNothingTitle'),
          body: t('purchaseModal.problemNothingBody'),
          primary: 'retry',
        };
      case 'watcher_stale':
        return {
          tone: 'calm',
          title: t('purchaseModal.problemStaleTitle'),
          body: t('purchaseModal.problemStaleBody'),
          primary: 'wait',
        };
      case 'underpaid':
        return {
          tone: 'warn',
          title: t('purchaseModal.problemUnderpaidTitle', { expected: expectedTaka }),
          body: t('purchaseModal.problemUnderpaidBody', {
            observed: observedTaka ?? '—',
            expected: expectedTaka,
            missing: missingTaka ?? '—',
          }),
          primary: 'help',
        };
      case 'msisdn_mismatch_review':
        return {
          tone: 'calm',
          title: t('purchaseModal.problemMismatchTitle'),
          body: t('purchaseModal.problemMismatchBody'),
          primary: 'wait',
        };
      // 'awaiting_sms' plus the operator-driven states ('refunded' / 'failed')
      // the navbar pill owns properly — the modal's 20s window can't realistically
      // observe those, so the calm wait copy is the safe default.
      default:
        return {
          tone: 'calm',
          title: t('purchaseModal.problemAwaitingTitle'),
          body: t('purchaseModal.problemAwaitingBody'),
          primary: 'wait',
        };
    }
  })();

  // Past this many tries, stop asking them to re-check and put a human in front
  // of them — the user's own escalation rule.
  const escalated = helpOpen || attempts >= ESCALATE_AFTER_ATTEMPTS || problem.primary === 'help';
  const waMessage = t('purchaseModal.helpEmailSubject', { txn: trackedTxn });

  const helpCard = (
    <div className="mt-4 w-full rounded-2xl border border-[#EAE6DA] bg-[#FAF7F0] p-4 text-left">
      <div className="flex items-center gap-2">
        <LifeBuoy size={15} style={{ color: BKASH }} />
        <div className="text-[13.5px] font-bold text-[#1A1812]">{t('purchaseModal.helpTitle')}</div>
      </div>
      <p className="mt-1.5 text-[12.5px] leading-snug text-[#6B6759]">{t('purchaseModal.helpBody')}</p>

      <div className="mt-3 grid gap-2">
        <a
          href={`https://wa.me/${toIntlDigits(OWNER_BKASH_NUMBER)}?text=${encodeURIComponent(waMessage)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[#EAE6DA] bg-white px-3 py-2 text-[13px] font-semibold text-[#1A1812] transition-colors hover:border-[#CFCBBC]"
        >
          <MessageCircle size={14} style={{ color: BKASH }} />
          {t('purchaseModal.helpWhatsapp', { number: OWNER_BKASH_NUMBER })}
        </a>
        <a
          href={`tel:+${toIntlDigits(OWNER_BKASH_NUMBER)}`}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[#EAE6DA] bg-white px-3 py-2 text-[13px] font-semibold text-[#1A1812] transition-colors hover:border-[#CFCBBC]"
        >
          <Phone size={14} style={{ color: BKASH }} />
          {t('purchaseModal.helpCall', { number: OWNER_BKASH_NUMBER })}
        </a>
        <a
          href={CONTACT_FACEBOOK_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[#EAE6DA] bg-white px-3 py-2 text-[13px] font-semibold text-[#1A1812] transition-colors hover:border-[#CFCBBC]"
        >
          <MessageCircle size={14} className="text-[#6B6759]" />
          {t('purchaseModal.helpFacebook')}
        </a>
        <a
          href={contactMailto(
            t('purchaseModal.helpEmailSubject', { txn: trackedTxn }),
            `TrxID: ${trackedTxn}\nAmount: ${expectedTaka} BDT\nAttempts: ${attempts}`,
          )}
          title={CONTACT_EMAIL}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[#EAE6DA] bg-white px-3 py-2 text-[13px] font-semibold text-[#1A1812] transition-colors hover:border-[#CFCBBC]"
        >
          <Mail size={14} className="text-[#6B6759]" />
          {t('purchaseModal.helpEmail')}
        </a>
      </div>

      {notifyState === 'sent' ? (
        <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
          <div className="flex items-center gap-1.5 text-[12.5px] font-bold text-emerald-700">
            <Check size={13} strokeWidth={3} />
            {t('purchaseModal.helpNotifiedTitle')}
          </div>
          <p className="mt-1 text-[12px] leading-snug text-emerald-800">
            {t('purchaseModal.helpNotifiedBody')}
          </p>
        </div>
      ) : (
        <button
          type="button"
          onClick={handleNotify}
          disabled={notifyState === 'sending'}
          className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl px-3 py-2 text-[13px] font-bold text-white transition-colors disabled:opacity-60"
          style={{ backgroundColor: BKASH }}
        >
          {notifyState === 'sending' ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              {t('purchaseModal.helpNotifying')}
            </>
          ) : (
            t('purchaseModal.helpNotify')
          )}
        </button>
      )}
    </div>
  );

  const problemContent = (
    <div className="flex w-full flex-col items-center px-6 text-center">
      <div
        className="flex h-14 w-14 items-center justify-center rounded-full"
        style={{ backgroundColor: problem.tone === 'warn' ? '#FEF5E7' : '#F2F1EB' }}
      >
        {problem.tone === 'warn' ? (
          <AlertTriangle size={26} style={{ color: '#9C6113' }} />
        ) : (
          <Clock size={26} className="text-[#6B6759]" />
        )}
      </div>

      <div className="mt-3 font-display text-xl font-semibold leading-tight text-[#1A1812]">
        {problem.title}
      </div>
      <p className="mt-2 max-w-sm text-[13.5px] leading-relaxed text-[#6B6759]">{problem.body}</p>

      <div className="mt-3 w-full max-w-sm rounded-xl border border-[#EAE6DA] bg-[#FAF7F0] px-3 py-2 text-left">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#6B6759]">
            {t('purchaseModal.verifyTxnLabel')}
          </span>
          {attempts > 1 && (
            <span className="text-[10.5px] font-semibold text-[#9F998A]">
              {t('purchaseModal.attemptCounter', { n: attempts })}
            </span>
          )}
        </div>
        <div className="mt-0.5 break-all font-mono text-[13px] tracking-wide text-[#1A1812]">
          {trackedTxn}
        </div>
      </div>

      {/* Action first, help card second. When escalated the help card is long,
          and burying the primary button beneath it meant scrolling past four
          contact rows to reach the thing most people want: another go. */}
      {/* Rendered only when it has something in it — for the underpaid case the
          remedy is the help card, and an empty container just left a gap. */}
      {(problem.primary === 'retry' || problem.primary === 'wait' || !escalated) && (
      <div className="mt-4 w-full max-w-sm space-y-2">
        {problem.primary === 'retry' && (
          <button
            type="button"
            onClick={() => { void handleRetry(); }}
            className="inline-flex min-h-[50px] w-full items-center justify-center gap-2 rounded-2xl px-5 py-3.5 text-[15px] font-bold text-white transition-colors"
            style={{ backgroundColor: BKASH }}
          >
            <RefreshCw size={16} />
            {t('purchaseModal.retryCta')}
          </button>
        )}
        {problem.primary === 'wait' && (
          <button
            type="button"
            onClick={finishAndClose}
            className="inline-flex min-h-[50px] w-full items-center justify-center gap-2 rounded-2xl px-5 py-3.5 text-[15px] font-bold text-white transition-colors"
            style={{ backgroundColor: BKASH }}
          >
            {t('purchaseModal.keepWaitingCta')}
            <ArrowRight size={16} />
          </button>
        )}

        {!escalated && (
          <button
            type="button"
            onClick={() => setHelpOpen(true)}
            className="inline-flex w-full items-center justify-center gap-1.5 py-2 text-[12.5px] font-semibold text-[#6B6759] transition-colors hover:text-[#1A1812]"
          >
            <LifeBuoy size={13} />
            {t('purchaseModal.needHelpCta')}
          </button>
        )}
      </div>
      )}

      {escalated && <div className={`w-full max-w-sm${problem.primary === 'help' ? ' mt-4' : ''}`}>{helpCard}</div>}

      <div className="mt-3 w-full max-w-sm space-y-1">
        {/* 'help' is the underpaid case: no big button of its own, because the
            remedy IS the contact card above. Closing stays available here and
            on the ✕, which is now always visible. */}
        {problem.primary === 'help' && (
          <button
            type="button"
            onClick={finishAndClose}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-2xl border-2 px-4 py-2.5 text-[13px] font-bold text-[#1A1812] transition-colors"
            style={{ borderColor: '#EAE6DA' }}
          >
            {t('common.close')}
          </button>
        )}
        {escalated && problem.primary === 'wait' && (
          <button
            type="button"
            onClick={() => { void handleRetry(); }}
            className="inline-flex w-full items-center justify-center gap-1.5 py-2 text-[12.5px] font-semibold text-[#6B6759] transition-colors hover:text-[#1A1812]"
          >
            <RefreshCw size={13} />
            {t('purchaseModal.retryCta')}
          </button>
        )}
      </div>
    </div>
  );

  // One takeover surface, three states. Rendered by the two wrappers below
  // (mobile full-sheet, desktop right-panel).
  const takeoverContent =
    phase === 'confirmed' ? confirmedContent : phase === 'verifying' ? verifyingContent : problemContent;
  const showTakeover = phase === 'confirmed' || phase === 'verifying' || phase === 'problem';

  // Closing mid-verification is safe (the navbar pill keeps tracking), but the
  // panel state must not survive into the next open.
  const handleDismiss = () => {
    if (showTakeover) {
      reset();
      onClose();
      return;
    }
    onClose();
  };

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
        onClick={busy ? undefined : handleDismiss}
      />

      {/* Sheet — bottom sheet on mobile (slides up), split card on desktop (zooms in). */}
      <div className="relative flex max-h-full w-full flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-8 motion-safe:duration-300 md:max-h-[92vh] md:max-w-4xl md:flex-row md:rounded-[28px] md:slide-in-from-bottom-0 md:zoom-in-95 md:duration-200">


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
                onClick={handleDismiss}
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
          {/* Header — desktop only (mobile close X lives in the ribbon). Kept
              mounted during a takeover so the ✕ never disappears; the title is
              dropped there because "Send your bKash payment" would contradict
              the panel underneath it. */}
          <header className="hidden shrink-0 items-start justify-between px-9 pt-6 pb-3 md:flex">
            <h2 className="font-display text-lg font-semibold text-[#1A1812] tracking-tight">
              {showTakeover ? '' : t('purchaseModal.panelTitle')}
            </h2>
            <button
              type="button"
              onClick={handleDismiss}
              disabled={busy}
              className="-mt-1 -mr-2 shrink-0 rounded-full p-2 text-[#9F998A] transition-colors hover:bg-[#F2F1EB] hover:text-[#1A1812] disabled:cursor-not-allowed disabled:opacity-40"
              aria-label={t('common.close')}
            >
              <X size={18} />
            </button>
          </header>

          {/* Takeover replaces the form IN FLOW rather than covering it, so the
              sheet hugs whichever content is showing. As an absolute overlay it
              inherited the (much taller) form's height and left the panel
              stranded in the middle of a field of white on a phone. */}
          {showTakeover ? (
            <div className="min-h-0 flex-1 overflow-y-auto py-7 motion-safe:animate-in motion-safe:fade-in">
              {takeoverContent}
            </div>
          ) : (
          <>
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
              disabled={busy || !txnIsValid || phase !== 'idle'}
              className="w-full inline-flex min-h-[52px] items-center justify-center gap-2 px-5 py-4 rounded-2xl text-base font-bold text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
              style={{
                backgroundColor: busy || !txnIsValid || phase !== 'idle' ? '#CFCBBC' : BKASH,
              }}
              onMouseEnter={(e) => {
                if (!busy && txnIsValid && phase === 'idle') {
                  (e.currentTarget as HTMLButtonElement).style.backgroundColor = BKASH_DEEP;
                }
              }}
              onMouseLeave={(e) => {
                if (!busy && txnIsValid && phase === 'idle') {
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
              {phase !== 'submitting' && (
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
                onClick={handleDismiss}
                disabled={busy}
                className="text-[12.5px] font-semibold text-[#6B6759] hover:text-[#1A1812] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {t('purchaseModal.cancel')}
              </button>
            </div>
          </footer>
          </>
          )}
        </div>
      </div>
    </div>
  );
};

/** One literal step of the verification panel — done / in-flight / not yet. */
const VerifyBeat: React.FC<{ state: 'done' | 'active' | 'pending'; label: string }> = ({
  state,
  label,
}) => (
  <li className="flex items-center gap-2.5 text-[13.5px]">
    <span
      className={[
        'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full',
        state === 'done'
          ? 'bg-emerald-500/15 text-emerald-600'
          : state === 'active'
            ? ''
            : 'border border-[#EAE6DA]',
      ].join(' ')}
      style={state === 'active' ? { backgroundColor: `${BKASH}1A`, color: BKASH } : undefined}
    >
      {state === 'done' && <Check size={12} strokeWidth={3.5} />}
      {state === 'active' && <Loader2 size={12} className="animate-spin" />}
    </span>
    <span className={state === 'pending' ? 'text-[#9F998A]' : 'font-semibold text-[#1A1812]'}>
      {label}
    </span>
  </li>
);

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
