// Vercel dynamic route — single function file that dispatches a few
// purchase-lifecycle endpoints to per-action handlers under _handlers/.
// Consolidated 2026-06-15 because Vercel Hobby caps a deployment at 12
// Serverless Functions and the polished-profile + toolkit-split work pushed
// the count to 14. Grouping these three (all default-body, no HMAC, all
// purchase-lifecycle) reclaims two slots without a Pro upgrade.
//
// Public URLs are UNCHANGED — vercel.json rewrites the original paths here:
//   /api/my-purchase-status   -> /api/purchase-ops/status
//   /api/dispute-purchase     -> /api/purchase-ops/dispute
//   /api/cron/expire-pending  -> /api/purchase-ops/expire-pending
// so the frontend (purchaseStatusClient) and any manual cron trigger keep
// calling the same URLs. Files under `_handlers/` are NOT treated as
// functions by Vercel because the segment starts with an underscore.
//
// NOTE: the HMAC webhook endpoints (confirm-purchase, reverse-purchase,
// orphan-inbound-sms) are deliberately NOT folded in here — they need
// `bodyParser: false` for raw-body signature verification, which conflicts
// with the default JSON body parser these three rely on. They stay as their
// own function files; the mobile contract is untouched.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import status from './_handlers/status.js';
import dispute from './_handlers/dispute.js';
import expirePending from './_handlers/expire-pending.js';

type Handler = (req: VercelRequest, res: VercelResponse) => Promise<void> | void;

const HANDLERS: Record<string, Handler> = {
  'status': status,
  'dispute': dispute,
  'expire-pending': expirePending,
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const raw = req.query.action;
  const action = Array.isArray(raw) ? raw[0] : raw;
  if (!action || !(action in HANDLERS)) {
    res.status(404).json({ error: `Unknown purchase-ops action: ${action ?? '(empty)'}` });
    return;
  }
  await HANDLERS[action](req, res);
}
