// Shared HMAC verification + replay protection for Flutter-callable webhooks.
//
// Four endpoints sign with the same BKASH_WEBHOOK_SECRET:
//   /api/confirm-purchase
//   /api/orphan-inbound-sms
//   /api/reverse-purchase
//   /api/admin/parser-failures (POST path)
//
// REPLAY PROTECTION (added 2026-05-31, migration 011)
// ===================================================
// Original protocol — body-only HMAC — proves the request was signed with
// our secret but says nothing about WHEN. A captured signed request was
// replayable indefinitely.
//
// New protocol:
//   1. Watcher includes a UTC ISO-8601 timestamp in the
//      `X-Bkash-Webhook-Timestamp` header.
//   2. The HMAC is computed over the byte sequence `<timestamp>.<body>`
//      (the literal ASCII dot is the separator).
//   3. Server rejects requests whose timestamp is more than ±5 min from
//      its own clock (REPLAY_WINDOW_SEC below).
//   4. Server computes `nonce = sha256("<timestamp>:<body>")`, atomically
//      inserts it into `webhook_nonces` via `acquire_webhook_nonce()`.
//      Duplicate → reject as replay.
//
// BACKWARD COMPATIBILITY
// ----------------------
// The Flutter watcher in production today (v1.1.x) sends only the legacy
// header `X-Bkash-Webhook-Signature` over the raw body. The new format is
// rolled out by:
//   (a) shipping this server-side support (this PR — accepts both formats);
//   (b) updating the Flutter watcher to send timestamp + body-prefixed HMAC;
//   (c) flipping `BKASH_WEBHOOK_REQUIRE_TIMESTAMP=true` in Vercel env to
//       reject the legacy format permanently.
//
// While `BKASH_WEBHOOK_REQUIRE_TIMESTAMP` is unset/false (default), requests
// without a timestamp header are accepted under the legacy path with a
// console warning. Watcher releases that have shipped the new format are
// validated under the new (stronger) path automatically.
//
// SECURITY NOTES
// --------------
// - `timingSafeEqual` is used for both signature and timestamp comparison
//   surfaces that touch attacker-controlled input.
// - The signed string MUST include the literal `.` separator between
//   timestamp and body. Without it, a watcher could swap a fresh
//   timestamp with a stale body and the HMAC would still verify (because
//   concatenation without a separator is structurally weak).
// - We accept ISO-8601 with millisecond precision (Flutter's default).
//   The window is ±5 min — generous for clock drift, tight enough that
//   a captured request becomes useless within minutes.
// - The nonce store has a 10-min TTL (2× the window) cleaned up by the
//   `prune_webhook_nonces()` function. Pruning lag is bounded by the
//   window: an attacker can't replay a request after 5 min anyway because
//   the timestamp window check fails.

import type { VercelRequest } from '@vercel/node';
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const BKASH_WEBHOOK_SECRET = process.env.BKASH_WEBHOOK_SECRET ?? '';
const REQUIRE_TIMESTAMP = process.env.BKASH_WEBHOOK_REQUIRE_TIMESTAMP === 'true';

/** ±5 min window. Tight enough that captured requests rot fast; generous
 * enough to absorb realistic clock skew on the watcher phone. */
export const REPLAY_WINDOW_SEC = 5 * 60;

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

export function webhookSecretConfigured(): boolean {
  return BKASH_WEBHOOK_SECRET.length > 0;
}

/**
 * Read the raw request body as UTF-8. Prefers the unbuffered stream; falls
 * back to re-serializing a pre-parsed body in `vercel dev` environments
 * where the auto-parser ran ahead of us. For Flutter's `jsonEncode(map)`
 * payloads the round-trip is byte-equivalent.
 */
export async function readRawBody(req: VercelRequest): Promise<string> {
  if (typeof req.body === 'string') return req.body;
  if (req.body && typeof req.body === 'object') return JSON.stringify(req.body);
  const chunks: Buffer[] = [];
  for await (const chunk of req as AsyncIterable<Buffer | string>) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function constantTimeEqualBuffers(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Legacy verification path — HMAC over raw body only. Used when no timestamp
 * header is present AND the operator hasn't required timestamps yet.
 */
function verifyLegacySignature(rawBody: string, providedHex: string): boolean {
  const expected = createHmac('sha256', BKASH_WEBHOOK_SECRET).update(rawBody, 'utf8').digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(providedHex, 'hex');
  } catch {
    return false;
  }
  return constantTimeEqualBuffers(expected, provided);
}

/**
 * v2 verification path — HMAC over `<timestamp>.<rawBody>`. Includes the
 * literal ASCII period as a separator so an attacker can't swap one for
 * another at the boundary.
 */
function verifyV2Signature(timestamp: string, rawBody: string, providedHex: string): boolean {
  const expected = createHmac('sha256', BKASH_WEBHOOK_SECRET)
    .update(timestamp, 'utf8')
    .update('.', 'utf8')
    .update(rawBody, 'utf8')
    .digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(providedHex, 'hex');
  } catch {
    return false;
  }
  return constantTimeEqualBuffers(expected, provided);
}

function timestampWithinWindow(iso: string): boolean {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return false;
  const delta = Math.abs(Date.now() - ms);
  return delta <= REPLAY_WINDOW_SEC * 1000;
}

export function getSignatureHeader(req: VercelRequest): string | undefined {
  const sig = req.headers['x-bkash-webhook-signature'];
  return Array.isArray(sig) ? sig[0] : sig;
}

export function getTimestampHeader(req: VercelRequest): string | undefined {
  const ts = req.headers['x-bkash-webhook-timestamp'];
  return Array.isArray(ts) ? ts[0] : ts;
}

export interface VerifyResult {
  ok: boolean;
  /** When ok=false, why. Surface to logs; do NOT echo to the watcher. */
  reason?: 'no_secret' | 'no_signature' | 'bad_signature' | 'no_timestamp' | 'timestamp_skew' | 'replay';
  /** v2 path was taken (timestamp + nonce verified). Always true once we
   *  flip BKASH_WEBHOOK_REQUIRE_TIMESTAMP=true. */
  v2?: boolean;
}

/**
 * Top-level webhook verifier. Either the legacy or v2 path verifies; if
 * the request includes a timestamp header we MUST be on v2 (we never
 * accept a v2 timestamp under the legacy signature path — that would
 * give a downgrade attack).
 *
 * Side effect: acquires a nonce when v2 — duplicate requests are
 * rejected by the DB. Pass a supabase client if you want nonce protection;
 * omit (or pass null) on read-only test paths.
 *
 * Returns `{ ok: false, reason }` instead of throwing so callers can log
 * the reason internally without leaking it to the watcher (the response
 * body just says "Invalid or missing signature").
 */
export async function verifyWebhook(
  req: VercelRequest,
  rawBody: string,
  supabase: SupabaseClient | null
): Promise<VerifyResult> {
  if (!BKASH_WEBHOOK_SECRET) return { ok: false, reason: 'no_secret' };

  const signature = getSignatureHeader(req);
  if (!signature) return { ok: false, reason: 'no_signature' };

  const timestamp = getTimestampHeader(req);

  // ── v2 path: timestamp present ────────────────────────────────────────
  if (timestamp) {
    if (!timestampWithinWindow(timestamp)) {
      return { ok: false, reason: 'timestamp_skew' };
    }
    if (!verifyV2Signature(timestamp, rawBody, signature)) {
      return { ok: false, reason: 'bad_signature' };
    }
    if (supabase) {
      const nonce = createHash('sha256').update(`${timestamp}:${rawBody}`, 'utf8').digest('hex');
      const { data: acquired, error } = await supabase.rpc('acquire_webhook_nonce', {
        p_nonce: nonce,
        p_source: 'bkash',
      });
      if (error) {
        // DB hiccup — fail closed: better to reject a legitimate retry
        // (watcher will back off) than to allow a replay through.
        console.error('[webhookAuth] acquire_webhook_nonce failed:', error.message);
        return { ok: false, reason: 'replay' };
      }
      if (!acquired) {
        return { ok: false, reason: 'replay' };
      }
    }
    return { ok: true, v2: true };
  }

  // ── Legacy path: no timestamp ─────────────────────────────────────────
  if (REQUIRE_TIMESTAMP) {
    return { ok: false, reason: 'no_timestamp' };
  }
  console.warn('[webhookAuth] legacy signature path (no X-Bkash-Webhook-Timestamp). Update the watcher and set BKASH_WEBHOOK_REQUIRE_TIMESTAMP=true to enforce v2.');
  if (!verifyLegacySignature(rawBody, signature)) {
    return { ok: false, reason: 'bad_signature' };
  }
  return { ok: true, v2: false };
}

/**
 * Convenience: legacy body-only verifier kept for the few call sites that
 * haven't been migrated to `verifyWebhook` yet (and for tests). Prefer
 * `verifyWebhook` for any new code path.
 */
export function verifyBkashSignature(rawBody: string, providedHex: string | undefined): boolean {
  if (!providedHex || !BKASH_WEBHOOK_SECRET) return false;
  return verifyLegacySignature(rawBody, providedHex);
}

/**
 * Build a service-role Supabase client for the nonce acquire. Cached at
 * module level so warm Vercel invocations don't re-create.
 */
let _serviceRoleClient: SupabaseClient | null = null;
export function getServiceRoleClient(): SupabaseClient | null {
  if (_serviceRoleClient) return _serviceRoleClient;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  _serviceRoleClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _serviceRoleClient;
}
