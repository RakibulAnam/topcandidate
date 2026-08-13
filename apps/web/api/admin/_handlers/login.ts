// POST /api/admin/login   — owner username+password → short-lived session token
//
// The ONLY unauthenticated admin endpoint. On success returns
// { token, expiresInSec }; the SPA stores the token in sessionStorage and
// sends it as `Authorization: Bearer <token>` thereafter. See _lib/session.ts
// for the token format and credential model.
//
// Guessing is throttled per IP in Postgres (migration 026, _lib/loginThrottle):
// a slot is reserved BEFORE credentials are checked, so concurrent requests
// count against each other. Every attempt — allowed, failed, or refused — lands
// in admin_login_attempts and surfaces in the System tab.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { loginConfigured, verifyCredentials, signSessionToken, SESSION_TTL_SEC } from '../_lib/session.js';
import { beginLoginAttempt, finalizeLoginAttempt, clientIp } from '../_lib/loginThrottle.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!loginConfigured()) {
    console.error('[admin/login] ADMIN_USERNAME / ADMIN_PASSWORD(_HASH) / ADMIN_API_KEY not configured');
    res.status(503).json({ error: 'Admin login is not configured on the server.' });
    return;
  }

  const body = (req.body ?? {}) as { username?: unknown; password?: unknown };
  const username = typeof body.username === 'string' ? body.username : '';
  const password = typeof body.password === 'string' ? body.password : '';
  // A malformed body is not a guess, so it is rejected before the throttle and
  // costs the caller nothing from their attempt budget.
  if (!username || !password) {
    res.status(400).json({ error: 'username and password are required' });
    return;
  }

  const ip = clientIp(req);
  const userAgent = Array.isArray(req.headers['user-agent']) ? req.headers['user-agent'][0] : req.headers['user-agent'];
  const attempt = await beginLoginAttempt(ip, username, userAgent);

  if (!attempt.allowed) {
    console.warn(`[admin/login] locked out ip=${ip} failures=${attempt.recentFailures} retryAfter=${attempt.retryAfterSec}s`);
    res.setHeader('Retry-After', String(attempt.retryAfterSec));
    res.status(429).json({
      error: `Too many failed attempts. Try again in ${attempt.retryAfterSec}s.`,
      retryAfterSec: attempt.retryAfterSec,
    });
    return;
  }

  const ok = verifyCredentials(username, password);
  await finalizeLoginAttempt(attempt.id, ok);

  if (!ok) {
    // Kept alongside the lockout: it costs a lone guesser real wall-clock time
    // before the ladder engages. It is NOT the control — see loginThrottle.
    await new Promise((r) => setTimeout(r, 400));
    console.warn(`[admin/login] failed attempt ip=${ip} failuresInWindow=${attempt.recentFailures + 1}`);
    res.status(401).json({ error: 'Invalid username or password.' });
    return;
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const token = signSessionToken(nowSec);
  res.status(200).json({ token, expiresInSec: SESSION_TTL_SEC });
}
