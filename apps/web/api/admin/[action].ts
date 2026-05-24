// Vercel dynamic route — single function file that dispatches /api/admin/*
// to the per-action handlers under _handlers/. Consolidated 2026-05-24
// because Vercel Hobby caps a deployment at 12 Serverless Functions and
// nine separate admin files would have blown the budget.
//
// URLs are unchanged. `/api/admin/dashboard` routes here with
// `req.query.action === 'dashboard'`; we forward to the dashboard handler.
// Files under `_handlers/` are NOT treated as functions by Vercel because
// the segment starts with an underscore.
//
// To add a new admin endpoint:
//   1. Drop the handler at `api/admin/_handlers/<name>.ts` with a default
//      export of `(req, res) => Promise<void>`.
//   2. Add an entry to HANDLERS below.
//   3. Hit `/api/admin/<name>`. Done.

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

type Handler = (req: VercelRequest, res: VercelResponse) => Promise<void> | void;

const HANDLERS: Record<string, Handler> = {
  'confirm-purchase': confirmPurchase,
  'refund-purchase': refundPurchase,
  'match-orphan': matchOrphan,
  'resolve-dispute': resolveDispute,
  'dashboard': dashboard,
  'pending': pending,
  'orphans': orphans,
  'disputes': disputes,
  'parser-failures': parserFailures,
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
