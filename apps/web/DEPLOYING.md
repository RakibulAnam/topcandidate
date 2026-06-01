# Deploying TOP CANDIDATE

End-to-end guide to ship the web app on Vercel + Supabase. Assumes you've read [`README.md`](./README.md) for the architecture overview.

## Prerequisites

- A Git host with the repo pushed (GitHub recommended — Vercel integrates best)
- A [Vercel account](https://vercel.com/signup)
- A [Supabase account](https://supabase.com)
- A [Groq API key](https://console.groq.com/keys) (free)
- A [Google AI Studio API key](https://aistudio.google.com/app/apikey) (free)
- A bKash personal/agent number for receiving payments
- A copy of the Flutter SMS-watcher app on a phone (see `apps/mobile/`)

---

## Step 1 — Supabase

1. **Create a project** at [supabase.com/dashboard](https://supabase.com/dashboard). Save:
   - Project URL → `VITE_SUPABASE_URL`
   - Anon (public) key → `VITE_SUPABASE_ANON_KEY`
   - **service_role** key → `SUPABASE_SERVICE_ROLE_KEY` (Settings → API → reveal)

2. **Enable email/password auth**: Authentication → Providers → Email → enable.
   For production: turn on **Confirm email** so new accounts must verify the inbox before logging in.

3. **Enable `pg_cron`**: Database → Extensions → enable `pg_cron`. Needed on Vercel Hobby (no sub-daily cron support).

4. **Bootstrap the schema**: SQL Editor → paste the full contents of `supabase/schema.sql` → run.

5. **Apply migrations in order**: every file in `supabase/migrations/` is idempotent. At time of writing:

   ```
   001_add_toolkit_column.sql
   002_add_languages_and_references.sql
   003_add_ai_call_log.sql
   004_add_toolkit_credits.sql
   005_lock_toolkit_credits_and_bkash_pending.sql
   006_add_company_generated_column.sql
   007_transaction_flow_hardening.sql
   007_optional_pg_cron.sql       (only if pg_cron is enabled — runs the 15-min pending-expiry inside the DB)
   008_lock_credit_rpcs.sql
   009_admin_panel.sql
   010_align_profiles_columns.sql
   ```

   Re-running is safe.

---

## Step 2 — Generate operator secrets

```bash
openssl rand -hex 32   # → ADMIN_API_KEY
openssl rand -hex 32   # → CRON_SECRET
openssl rand -hex 32   # → BKASH_WEBHOOK_SECRET
```

Save these. The bKash secret must be set as the matching value in the Flutter watcher's secret config (see `apps/mobile/AGENTS.md`).

---

## Step 3 — Vercel project setup

### Option A — Git integration (recommended)

1. **Import** the repo at [vercel.com/dashboard](https://vercel.com/dashboard) → Add New → Project.
2. **Framework preset:** Vite (auto-detected). Build command `vite build`, output `dist`.
3. **Root directory:** set to `apps/web` (the repo is a polyglot monorepo; web lives at this path).
4. **Environment variables** — add every variable from `.env.example`:

| Variable | Scope | Source |
|---|---|---|
| `VITE_SUPABASE_URL` | client | Supabase API settings |
| `VITE_SUPABASE_ANON_KEY` | client | Supabase API settings |
| `VITE_BKASH_PAYMENT_NUMBER` | client | Your bKash number, shown in the purchase modal |
| `GROQ_API_KEY` | **server** | Groq console (free) |
| `GEMINI_API_KEY` | **server** | Google AI Studio (free) |
| `SUPABASE_SERVICE_ROLE_KEY` | **server** | Supabase API → service_role |
| `BKASH_WEBHOOK_SECRET` | **server** | The hex string from Step 2 |
| `ADMIN_API_KEY` | **server** | The hex string from Step 2 |
| `CRON_SECRET` | **server** | The hex string from Step 2 |

   Use Vercel's **Production / Preview / Development** dropdown to scope each variable correctly. AI keys should be set in Preview too if you smoke-test PR previews.

5. **Skip deployments when no changes to root directory** = ON (so mobile / docs-only commits don't rebuild the web app).

6. **Deploy**. You'll get a live URL on completion.

### Option B — Vercel CLI

```bash
npm i -g vercel
vercel login
vercel             # first run links the project
vercel env add     # one-by-one, or import from a file
vercel --prod      # promote after smoke test
```

---

## Step 4 — Cron for stale pending purchases

The 24h-TTL job (`expire_stale_pending_purchases()`) needs to run every 15 minutes.

- **Vercel Hobby:** sub-daily cron isn't available; run via Supabase pg_cron (migration `007_optional_pg_cron.sql`).
- **Vercel Pro:** add a `crons` block to `vercel.json` pointing at `/api/cron/expire-pending` with schedule `*/15 * * * *`. Vercel sends `Authorization: Bearer $CRON_SECRET` automatically.

You can manually trigger via:

```bash
curl -X GET https://<your-domain>/api/cron/expire-pending \
  -H "Authorization: Bearer $CRON_SECRET"
```

The query-string secret fallback (`?secret=...`) was removed in the 2026-05-30 audit because query strings leak via browser history, referer headers, and access logs.

---

## Step 5 — Verify end-to-end

1. Open the deployed URL. Sign up with a new email. Confirm a row lands in `profiles`. (If you turned on email confirmation, click the link in the inbox first.)
2. Build a resume against a real job description. Confirm:
   - The resume renders and exports (PDF + Word)
   - The cover letter, outreach email, LinkedIn note, and interview prep sections appear
   - The `generated_resumes` row has both `data` (resume payload) and `toolkit` (sibling artifacts)
3. Open `/admin`. Paste `ADMIN_API_KEY`. You should see the Dashboard tiles. Bake a manual bKash purchase end-to-end (use a small amount to test).
4. Optional but recommended: hit the `/api/cron/expire-pending` endpoint with the bearer to confirm it returns 200.

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| **404 on refresh** | `vercel.json` rewrites missing or `outputDirectory` not set to `dist`. |
| **"Missing Supabase environment variables" warning** | `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` not in the active environment. Re-check the env scope dropdown. |
| **AI not responding (502 from `/api/optimize`)** | Either `GROQ_API_KEY` and `GEMINI_API_KEY` are both missing, or the provider's free quota is exhausted. Check `dashboard.console.groq.com` / Google AI Studio. |
| **"relation generated_resumes.toolkit does not exist"** | Migration 001 not applied. Run it in the SQL editor. |
| **"Supabase: column profiles.created_at does not exist"** | Migration 010 not applied. Run it. |
| **Admin gate rejects a valid-looking key** | `ADMIN_API_KEY` differs between local and Vercel — rotate by changing the env var and reloading the page. |
| **Webhook 401 from Flutter watcher** | `BKASH_WEBHOOK_SECRET` doesn't match between web and mobile. Re-set both sides to the same hex string. |
| **Cron 401** | `CRON_SECRET` not set or sent as a query string instead of a `Bearer` header. |

---

## Post-deploy hardening checklist

- [ ] Email confirmation turned on in Supabase Auth Settings
- [ ] All migrations applied in order (especially 008, 009, 010)
- [ ] `ADMIN_API_KEY` set in Production only (not Preview, so accidental URL shares don't leak admin access)
- [ ] Vercel security headers in place (already in `vercel.json` since 2026-05-30: HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy)
- [ ] You can reach `/admin/dashboard` with the key and see live tiles
- [ ] You can hit `/api/cron/expire-pending` with the bearer and get `{ "expired": <n> }`
- [ ] Flutter watcher pointed at the production webhook URL and confirms a small real-money purchase end-to-end
