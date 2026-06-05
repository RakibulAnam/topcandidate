// Admin session tokens + password verification for the owner login.
//
// AUTH MODEL (replaces the old "paste ADMIN_API_KEY" gate)
// ========================================================
// Single owner. The owner logs in with ADMIN_USERNAME + a password at
// POST /api/admin/login. On success the server mints a short-lived,
// HMAC-signed session token (see signSessionToken). The /admin SPA stores
// it in sessionStorage — so it is dropped the moment the tab/browser closes —
// and sends it as `Authorization: Bearer <token>` on every call. requireAdmin
// verifies the signature + expiry.
//
// SECRETS / ENV
// -------------
//   ADMIN_USERNAME       — the owner's username.
//   ADMIN_PASSWORD_HASH  — scrypt hash, format "<saltHex>:<keyHex>" (preferred).
//                          Generate with the one-liner in .env.example.
//   ADMIN_PASSWORD       — plaintext fallback if no hash is set (easier to
//                          configure, less safe — the hash is recommended).
//   ADMIN_API_KEY        — REPURPOSED: no longer pasted by the operator; it is
//                          now the HMAC secret used to sign/verify session
//                          tokens. Must be a long random string.
//
// Stateless by design: there is no session table. The token carries its own
// expiry and is verified by signature. "Logout" is purely client-side (drop
// the token); a stolen token stays valid until exp — keep TTL short.

import { createHmac, scryptSync, timingSafeEqual } from 'crypto';

/** Session lifetime. Short because the SPA also drops the token on tab close;
 * this is the server-side backstop for a token that leaks or lingers. */
export const SESSION_TTL_SEC = 12 * 60 * 60; // 12h

const SIGNING_SECRET = process.env.ADMIN_API_KEY ?? '';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? '';
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH ?? '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? '';

/** True when the server has everything it needs to authenticate a login. */
export function loginConfigured(): boolean {
  return Boolean(SIGNING_SECRET) && Boolean(ADMIN_USERNAME) &&
    (Boolean(ADMIN_PASSWORD_HASH) || Boolean(ADMIN_PASSWORD));
}

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function sign(msg: string): string {
  return b64url(createHmac('sha256', SIGNING_SECRET).update(msg).digest());
}

interface SessionPayload {
  sub: string; // 'owner'
  iat: number; // issued-at (epoch sec)
  exp: number; // expiry (epoch sec)
}

/** Mint a signed `<payload>.<sig>` token for the owner. */
export function signSessionToken(nowSec: number): string {
  const payload: SessionPayload = { sub: 'owner', iat: nowSec, exp: nowSec + SESSION_TTL_SEC };
  const body = b64url(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}

/**
 * Verify a session token. Returns the payload if the signature is valid AND
 * the token has not expired; otherwise null. Constant-time signature compare.
 */
export function verifySessionToken(token: string, nowSec: number): SessionPayload | null {
  if (!SIGNING_SECRET) return null;
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let payload: SessionPayload;
  try {
    payload = JSON.parse(fromB64url(body).toString('utf8')) as SessionPayload;
  } catch {
    return null;
  }
  if (payload.sub !== 'owner' || typeof payload.exp !== 'number' || payload.exp <= nowSec) return null;
  return payload;
}

function safeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Verify the supplied username + password against the configured owner
 * credentials. Prefers the scrypt hash; falls back to plaintext ADMIN_PASSWORD.
 * Returns false (never throws) on any mismatch or malformed hash.
 */
export function verifyCredentials(username: string, password: string): boolean {
  if (!ADMIN_USERNAME) return false;
  const userOk = safeEqualStr(username, ADMIN_USERNAME);

  let passOk = false;
  if (ADMIN_PASSWORD_HASH) {
    const sep = ADMIN_PASSWORD_HASH.indexOf(':');
    if (sep > 0) {
      const saltHex = ADMIN_PASSWORD_HASH.slice(0, sep);
      const keyHex = ADMIN_PASSWORD_HASH.slice(sep + 1);
      try {
        const salt = Buffer.from(saltHex, 'hex');
        const expected = Buffer.from(keyHex, 'hex');
        const derived = scryptSync(password, salt, expected.length || 64);
        passOk = expected.length === derived.length && timingSafeEqual(expected, derived);
      } catch {
        passOk = false;
      }
    }
  } else if (ADMIN_PASSWORD) {
    passOk = safeEqualStr(password, ADMIN_PASSWORD);
  }

  // Evaluate both regardless of order so timing doesn't leak which field failed.
  return userOk && passOk;
}
