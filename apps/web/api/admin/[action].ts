// Vercel dynamic route — single function file that dispatches /api/admin/*
// to the per-action handlers under _handlers/. Consolidated 2026-05-24
// because Vercel Hobby caps a deployment at 12 Serverless Functions and
// nine separate admin files would have blown the budget. The full admin
// panel (migration 009, ~20 new actions) extends this dispatcher rather
// than adding new top-level api/admin/* files.
//
// URLs are unchanged from the client's perspective. `/api/admin/dashboard`
// routes here with `req.query.action === 'dashboard'`; we forward to the
// dashboard handler. Files under `_handlers/` are NOT treated as functions
// by Vercel because the segment starts with an underscore.
//
// To add a new admin endpoint:
//   1. Drop the handler at `api/admin/_handlers/<name>.ts` with a default
//      export of `(req, res) => Promise<void>`.
//   2. Add an entry to HANDLERS below.
//   3. Hit `/api/admin/<name>`. Done.
//
// URL convention: flat verbs. We never use `/api/admin/users/:id/...`
// because the [action] dispatcher would have to nest, defeating the
// one-function constraint. Body / query string carries the target id.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import confirmPurchase from './_handlers/confirm-purchase.js';
import refundPurchase from './_handlers/refund-purchase.js';
import matchOrphan from './_handlers/match-orphan.js';
import resolveDispute from './_handlers/resolve-dispute.js';
import dashboard from './_handlers/dashboard.js';
import pending from './_handlers/pending.js';
import orphans from './_handlers/orphans.js';
import disputes from './_handlers/disputes.js';
import parserFailures from './_handlers/parser-failures.js';
// Admin panel expansion (migration 009)
import users from './_handlers/users.js';
import userDetail from './_handlers/user-detail.js';
import grantCredits from './_handlers/grant-credits.js';
import deductCredits from './_handlers/deduct-credits.js';
import userNote from './_handlers/user-note.js';
import flagUser from './_handlers/flag-user.js';
import purchases from './_handlers/purchases.js';
import purchaseDetail from './_handlers/purchase-detail.js';
import expirePurchase from './_handlers/expire-purchase.js';
import reopenPurchase from './_handlers/reopen-purchase.js';
import grantOverride from './_handlers/grant-override.js';
import purchaseNote from './_handlers/purchase-note.js';
import parserMarkReviewed from './_handlers/parser-mark-reviewed.js';
import parserExport from './_handlers/parser-export.js';
import orphanMarkIgnored from './_handlers/orphan-mark-ignored.js';
import auditLog from './_handlers/audit-log.js';
import settings from './_handlers/settings.js';
import actionQueue from './_handlers/action-queue.js';

type Handler = (req: VercelRequest, res: VercelResponse) => Promise<void> | void;

const HANDLERS: Record<string, Handler> = {
  // Original (P0 recovery surface)
  'confirm-purchase': confirmPurchase,
  'refund-purchase': refundPurchase,
  'match-orphan': matchOrphan,
  'resolve-dispute': resolveDispute,
  'dashboard': dashboard,
  'pending': pending,
  'orphans': orphans,
  'disputes': disputes,
  'parser-failures': parserFailures,
  // Admin panel expansion
  'users': users,
  'user-detail': userDetail,
  'grant-credits': grantCredits,
  'deduct-credits': deductCredits,
  'user-note': userNote,
  'flag-user': flagUser,
  'purchases': purchases,
  'purchase-detail': purchaseDetail,
  'expire-purchase': expirePurchase,
  'reopen-purchase': reopenPurchase,
  'grant-override': grantOverride,
  'purchase-note': purchaseNote,
  'parser-mark-reviewed': parserMarkReviewed,
  'parser-export': parserExport,
  'orphan-mark-ignored': orphanMarkIgnored,
  'audit-log': auditLog,
  'settings': settings,
  'action-queue': actionQueue,
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const raw = req.query.action;
  const action = Array.isArray(raw) ? raw[0] : raw;
  if (!action || !(action in HANDLERS)) {
    res.status(404).json({ error: `Unknown admin action: ${action ?? '(empty)'}` });
    return;
  }
  await HANDLERS[action](req, res);
}
