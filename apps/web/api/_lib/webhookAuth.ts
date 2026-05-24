// Shared HMAC-SHA256 verification for Flutter-callable webhooks.
//
// Three endpoints — /api/confirm-purchase, /api/orphan-inbound-sms,
// /api/reverse-purchase, /api/admin/parser-failures — all sign with the
// same BKASH_WEBHOOK_SECRET (no per-route key rotation today). HMAC is
// over the raw request body bytes; do NOT re-serialize the parsed JSON
// before hashing.
//
// Why not include this in confirm-purchase.ts directly: we now have four
// callers and copy-pasting timing-safe-compare logic is the exact shape
// of bug we want to avoid in a payment surface.

import type { VercelRequest } from '@vercel/node';
import { createHmac, timingSafeEqual } from 'crypto';

const BKASH_WEBHOOK_SECRET = process.env.BKASH_WEBHOOK_SECRET ?? '';

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

export function verifyBkashSignature(rawBody: string, providedHex: string | undefined): boolean {
  if (!providedHex || !BKASH_WEBHOOK_SECRET) return false;
  const expected = createHmac('sha256', BKASH_WEBHOOK_SECRET).update(rawBody, 'utf8').digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(providedHex, 'hex');
  } catch {
    return false;
  }
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

export function getSignatureHeader(req: VercelRequest): string | undefined {
  const sig = req.headers['x-bkash-webhook-signature'];
  return Array.isArray(sig) ? sig[0] : sig;
}
