// POST /api/admin/login   — owner username+password → short-lived session token
//
// The ONLY unauthenticated admin endpoint. On success returns
// { token, expiresInSec }; the SPA stores the token in sessionStorage and
// sends it as `Authorization: Bearer <token>` thereafter. See _lib/session.ts
// for the token format and credential model.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { loginConfigured, verifyCredentials, signSessionToken, SESSION_TTL_SEC } from '../_lib/session.js';

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
  if (!username || !password) {
    res.status(400).json({ error: 'username and password are required' });
    return;
  }

  if (!verifyCredentials(username, password)) {
    // Small constant-ish delay to blunt online brute force. Vercel functions
    // are stateless so we can't keep an attempt counter reliably; rely on a
    // strong password + this delay. Single operator, so UX cost is negligible.
    await new Promise((r) => setTimeout(r, 400));
    res.status(401).json({ error: 'Invalid username or password.' });
    return;
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const token = signSessionToken(nowSec);
  res.status(200).json({ token, expiresInSec: SESSION_TTL_SEC });
}
