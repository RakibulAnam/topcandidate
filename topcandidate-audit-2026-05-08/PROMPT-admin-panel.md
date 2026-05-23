# Prompt — Build the operator admin panel

> Paste the entire body below into a fresh Claude (or other) chat session
> with access to the existing repo. The receiving session has no memory
> of prior conversations — this prompt is fully self-contained.

---

I have a single-tenant SaaS web app (Vite + React + Vercel + Supabase + Postgres + RLS) that sells credit packs in BDT. Payments come in via bKash to my personal/agent number, customers paste the bKash Transaction ID into a web form, and a Flutter SMS-watcher app on my own phone confirms each payment via signed webhook to `/api/confirm-purchase`. The wire contract between the two repos is documented in `companion-app/WHAT_IT_DOES.md`.

I am the operator. I am the only operator. This admin panel is a tool for me to run support, reconciliation, and recovery for the bKash purchase flow. **It is NOT a multi-role enterprise admin product.** Don't design as if there could ever be a second operator.

---

## 1. Dependencies — read before starting

This prompt assumes `PROMPT-transaction-flow-edge-cases.md` has already been run and merged. Specifically you can rely on:

- New `purchases.status` values: `pending`, `completed`, `failed`, `expired`, `underpaid`, `msisdn_mismatch_review`, `refunded`.
- New tables: `purchase_topups`, `purchase_overpayments`, `unmatched_inbound_sms`, `purchase_disputes`, `purchase_state_changes`.
- New endpoints already exist: `/api/admin/confirm-purchase`, `/api/admin/refund-purchase`, `/api/admin/match-orphan`, `/api/admin/resolve-dispute`, `/api/orphan-inbound-sms`, `/api/reverse-purchase`, `/api/admin/parser-failures`, `/api/my-purchase-status`, `/api/dispute-purchase`.
- `ADMIN_API_KEY` env var is set; existing admin endpoints validate it via the `X-Admin-Key` header.

If any of those aren't present in the repo, stop and ask the operator before proceeding. If the edge-cases prompt has only been partially run, build the admin panel against whatever IS there and leave clear "feature unavailable — run the edge-cases prompt first" placeholders for the missing screens (Orphans, Disputes, Parser Failures).

---

## 2. Auth model

Single operator, gated by `ADMIN_API_KEY`. All new `/api/admin/*` endpoints (and the existing ones) verify the `X-Admin-Key` header against this env var with a timing-safe compare.

The admin SPA at `/admin`:
- On first visit, shows a single password-style input: "Paste your admin key to continue."
- Stores the key in `localStorage` under `top_candidate_admin_key`.
- Includes `X-Admin-Key: <stored value>` on every API call via a single fetch wrapper.
- On any 401 response from the backend, clears the key and shows the input again.
- "Lock" button in the corner clears the key and reloads to the input.

This auth model is intentionally ugly. Do NOT add SSO, magic links, RBAC, invitation flows, or anything resembling user management. Single tenant. If the key leaks, rotate the env var and reload.

---

## 3. Routes

All under `/admin/*`, gated by the AdminAuthGate component:

- `/admin` — Dashboard (landing).
- `/admin/users` — User list + search.
- `/admin/users/:userId` — User detail.
- `/admin/purchases` — Purchase list + filters.
- `/admin/purchases/:purchaseId` — Purchase detail.
- `/admin/orphans` — Unmatched inbound SMS.
- `/admin/disputes` — Customer disputes.
- `/admin/parser-failures` — SMS the Flutter watcher couldn't classify.
- `/admin/audit-log` — Every admin action with reason + diff.
- `/admin/settings` — System health, env status, lock button.

Add a top nav bar inside the admin shell with tabs for each route, the current operator timestamp, and a global TrxID search input that deep-links to `/admin/purchases?q=<trxid>`.

---

## 4. Screen-by-screen detail

### 4.1 `/admin` — Dashboard

Single page. Operator should be able to glance at this for ~5 seconds and know if anything needs attention.

**Stat tiles (one row, 4 tiles):**

| Tile | Value | Color rule |
|---|---|---|
| Pending purchases | count + age of oldest | red if oldest > 12 h, saffron if > 30 min |
| Today's confirms | count + ৳ total | always neutral |
| Open disputes | count | red if > 0 |
| Watcher health | "Last confirm: 3 min ago" | red if last confirm > 30 min |

**Action queue (table):**

Combined view of anything requiring operator attention, age-descending:

- Pending purchases older than 10 min.
- All `msisdn_mismatch_review` rows.
- All `underpaid` rows.
- All `expired` rows from the last 24 h (so you can see what auto-expired).
- All open disputes.
- All orphan SMS not yet matched.

Columns: age | type | TrxID | amount | customer (if known) | quick action.

Quick action depends on type:
- pending → "View" deep links to `/admin/purchases/:id`.
- mismatch → inline "Approve anyway" / "Reject" with reason prompt.
- underpaid → "Resolve" opens modal: refund / top-up matching / grant anyway.
- expired → "Reopen" with reason.
- orphan → "Match to pending" opens orphan-match modal.
- dispute → "Resolve" deep links to dispute detail.

Top 50 rows. "View full queue" link.

### 4.2 `/admin/users` — User list

Top: search bar (email substring or user_id). Auto-search after 300 ms idle.

Table columns: email | name | credits | total paid (Tk lifetime) | last active | pending purchase count | flagged.

Click row → `/admin/users/:userId`.

Pagination at 50/page.

### 4.3 `/admin/users/:userId` — User detail

**Header:** name, email, user_id, signup date, current credit balance with inline +/- buttons (open grant/deduct modal).

**Tabs:**
- **Purchases** — list of all this user's rows with status badges, TrxID, amount, age, click-through.
- **Resumes** — list of generated resumes (read-only; for support context).
- **Applications** — list of tailored applications (read-only).
- **AI usage** — last 30 days from `ai_call_log` for this user (read-only).
- **Audit** — every admin action targeting this user, with reason + actor + diff.
- **Notes** — append-only free-text notes (from `profile_notes` table).

**Right rail action panel:**
- "Grant N credits" — reason required.
- "Deduct N credits" — reason required, allows negative balance.
- "Add note" — textarea + save (appends to profile_notes).
- "Email customer" — `mailto:` link to their address (don't build a real mailer).
- "Toggle flagged" — sets/clears `profiles.flagged_at`.

Every action writes to `admin_audit_log` AND fires the action via service-role.

### 4.4 `/admin/purchases` — Purchase list

Filters at top: status (multi-select, default = all non-completed), age (today / 7d / 30d / all), search by TrxID or customer email.

Table: TrxID | user email | amount expected vs observed | status badge | age | claimed msisdn | observed msisdn | actions.

Status badge colors (per the project's design system — NO blue/indigo/purple):
- `pending` → charcoal
- `completed` → brand-700
- `failed` / `expired` / `refunded` → red
- `underpaid` / `msisdn_mismatch_review` → saffron

Click row → `/admin/purchases/:purchaseId`.

### 4.5 `/admin/purchases/:purchaseId` — Purchase detail

**Header:** big status badge, TrxID, customer email (links to user detail).

**Sections:**
- **Lifecycle** — full timeline from `purchase_state_changes`. Every transition with actor + reason + timestamp.
- **Customer-claimed values** — amount, msisdn, submitted_at.
- **bKash-observed values** — from the matched SMS or `unmatched_inbound_sms`.
- **Top-ups** — list of `purchase_topups` linked to this row.
- **Overpayment surplus** — if any, from `purchase_overpayments`.

**Right rail action panel (varies by status):**

- `pending`:
  - "Confirm now" → `/api/admin/confirm-purchase` with optional `overrideMsisdnCheck`.
  - "Force expire" → `/api/admin/purchases/:id/expire`.
- `underpaid`:
  - "Grant pack anyway" (override the underpayment).
  - "Mark refunded" (with manual bKash refund handled out-of-band).
  - "Apply top-up" (opens orphan-SMS matcher for the difference).
- `msisdn_mismatch_review`:
  - "Approve with override" — confirm despite mismatch.
  - "Reject" — flip to failed.
- `completed`:
  - "Refund" → `/api/admin/refund-purchase`, decrements credits, allows negative balance.
  - "Issue partial refund" — admin records partial amount; doesn't auto-decrement; just audit.
- `failed` / `expired`:
  - "Reopen" — back to `pending` with new `created_at`.
- Always:
  - "Add note" (free text, audit-logged).

Every write action requires a non-empty `reason` input. Every action writes to both `purchase_state_changes` AND `admin_audit_log`.

### 4.6 `/admin/orphans` — Unmatched inbound SMS

Populated by the Flutter watcher's `/api/orphan-inbound-sms` POSTs (per the edge-cases prompt).

Table: TrxID | sender msisdn | amount | received timestamp | raw body (truncated, click to expand) | actions.

Actions:
- "Match to pending" → modal listing pending purchases sorted by Levenshtein distance to the orphan's TrxID, with "this one" buttons. Selecting one calls `/api/admin/match-orphan`.
- "Mark ignored" — for personal SMS that snuck through.
- "Refund manually" — operator decision; logs to audit, doesn't trigger anything automated.

### 4.7 `/admin/disputes` — Customer disputes

Populated by `/api/dispute-purchase` from the customer side (per edge-cases).

List view with status filter (open / resolved / rejected). Each row: customer | TrxID | filed | first 80 chars of notes | actions.

Click → detail view: full notes, full purchase context (linked), action buttons: "Resolve (grant credits)", "Resolve (no action)", "Reject", "Add internal note". All require operator note. Resolutions call `/api/admin/resolve-dispute`.

### 4.8 `/admin/parser-failures` — Watcher SMS parser failures

Populated by the watcher's POST to `/api/admin/parser-failures` (per edge-cases).

Table: timestamp | full raw SMS body (collapsible) | reason classification result (e.g., "no TrxID match").

This is where YOU find new bKash SMS formats the watcher doesn't yet recognize. Bulk actions:
- "Mark reviewed" — moves out of the inbox.
- "Export reviewed batch as JSON" — downloads a file the Flutter agent can use to add new format test cases.

### 4.9 `/admin/audit-log` — Every admin action

Time-descending list. Filters: actor (always "operator" for now but future-proof), action type, target type, time range.

Each row: timestamp | actor | action | target (linked) | reason | before/after diff (JSON pretty-print, collapsible).

No edit / delete affordance — this table is append-only by design.

### 4.10 `/admin/settings` — System health

Read-only display of:
- `BKASH_WEBHOOK_SECRET` — present / missing.
- `ADMIN_API_KEY` — present / missing.
- `SUPABASE_SERVICE_ROLE_KEY` — present / missing.
- `BKASH_MOCK_AUTOCONFIRM` — value (warn red if `true` in prod).
- Last successful `/api/confirm-purchase` (from logs or a heartbeat table).
- Latest 5 entries from `purchase_state_changes` for at-a-glance recent activity.

Buttons:
- "Reset admin session" — clears localStorage key, reloads.
- "Run pending-expiry now" — manually fires `expire_stale_pending_purchases()` from the edge-cases prompt's cron RPC (with confirmation).

---

## 5. Schema additions

The edge-cases prompt already added `purchase_state_changes`. This prompt adds:

```sql
-- migration: 008_admin_panel.sql

-- Append-only audit log for every admin action. Keyed for fast "show me
-- everything we ever did to user X" queries.
create table if not exists public.admin_audit_log (
  id              uuid default uuid_generate_v4() primary key,
  actor           text not null,                      -- 'operator' for now
  action          text not null,                      -- 'grant_credits' | 'deduct_credits' | 'confirm_purchase' | 'refund_purchase' | 'resolve_dispute' | 'match_orphan' | 'expire_purchase' | 'reopen_purchase' | 'flag_user' | 'unflag_user' | 'add_note' | 'override_mismatch' | …
  target_kind     text not null,                      -- 'user' | 'purchase' | 'dispute' | 'orphan_sms' | 'system'
  target_id       uuid,
  before_state    jsonb,
  after_state     jsonb,
  reason          text,
  created_at      timestamp with time zone default timezone('utc', now())
);

create index if not exists admin_audit_log_target_idx
  on public.admin_audit_log(target_kind, target_id, created_at desc);

create index if not exists admin_audit_log_action_idx
  on public.admin_audit_log(action, created_at desc);

alter table public.admin_audit_log enable row level security;
-- service_role only; no user-facing policies.

-- Operator-private notes on customer profiles.
create table if not exists public.profile_notes (
  id              uuid default uuid_generate_v4() primary key,
  user_id         uuid references public.profiles(id) on delete cascade not null,
  note            text not null,
  created_at      timestamp with time zone default timezone('utc', now())
);

alter table public.profile_notes enable row level security;
-- service_role only.

-- Flagging known-fraud customers.
alter table public.profiles
  add column if not exists flagged_at timestamp with time zone;
```

Migration must be idempotent (use `if not exists`).

Also update `supabase/schema.sql` to mirror these.

---

## 6. API endpoints

All new endpoints under `/api/admin/*` require `X-Admin-Key` matching `ADMIN_API_KEY` (timing-safe compare). All write actions require a non-empty `reason` in the body. Every write writes to `admin_audit_log`.

**New endpoints:**

- `GET /api/admin/dashboard` — stat tiles + action queue (top 50 rows).
- `GET /api/admin/users?q=...&page=N` — search/list.
- `GET /api/admin/users/:id` — full detail.
- `POST /api/admin/users/:id/grant-credits` — `{ amount, reason }`.
- `POST /api/admin/users/:id/deduct-credits` — `{ amount, reason }`.
- `POST /api/admin/users/:id/note` — `{ note }`.
- `PATCH /api/admin/users/:id` — `{ flagged, reason }`.
- `GET /api/admin/purchases?status=...&q=...&age=...&page=N`.
- `GET /api/admin/purchases/:id`.
- `POST /api/admin/purchases/:id/expire` — `{ reason }`.
- `POST /api/admin/purchases/:id/reopen` — `{ reason }`.
- `POST /api/admin/purchases/:id/note` — `{ note }`.
- `POST /api/admin/purchases/:id/grant-override` — for underpaid rows, grants the pack anyway with reason.
- `GET /api/admin/orphans?status=unmatched&page=N`.
- `POST /api/admin/orphans/:id/mark-ignored` — `{ reason }`.
- `GET /api/admin/parser-failures?page=N`.
- `POST /api/admin/parser-failures/:id/mark-reviewed`.
- `POST /api/admin/parser-failures/export` — returns reviewed bodies as a JSON download.
- `GET /api/admin/audit-log?actor=...&action=...&target_kind=...&from=...&to=...&page=N`.
- `GET /api/admin/settings/health`.
- `POST /api/admin/settings/run-expiry-now`.

**Existing endpoints to update (extend to write `admin_audit_log`):**

- `/api/admin/confirm-purchase`
- `/api/admin/refund-purchase`
- `/api/admin/match-orphan`
- `/api/admin/resolve-dispute`

Every write endpoint must produce exactly one `admin_audit_log` row with before/after JSON snapshots of the affected row. The audit row's `created_at` and the action's effect on the target row must be in the same transaction — use Postgres transactions or a single SECURITY DEFINER RPC per action.

---

## 7. UI / design system

This is internal but it's still TOP CANDIDATE-branded. The repo's `CLAUDE.md` makes these non-negotiable:

- **No gradients.**
- **No blue / indigo / purple palettes.** Status colors are saffron (accent-*) for "needs review", red for "bad", brand-* for "good", charcoal-* for neutral.
- Saffron accent (`accent-*`), brand-* ink, charcoal-* warm stone neutrals.
- Tailwind only — the existing utility scale is sufficient.
- Same `Inter` / system font stack as the rest of the app.

This is operator-on-laptop. Mobile responsive is NOT required. Optimize for:
- **Density** — show as much information per row as fits readably.
- **Speed of action** — every common action should be one click + one reason input.
- **Legibility under stress** — when a customer is on the phone asking where their credits are, you should be able to read this without squinting.

---

## 8. Files to create

```
src/presentation/admin/
  AdminScreen.tsx           — top-level router shell
  AdminAuthGate.tsx         — key-paste page
  AdminNav.tsx              — top tab bar + global TrxID search
  DashboardTab.tsx
  UsersTab.tsx
  UserDetailScreen.tsx
  PurchasesTab.tsx
  PurchaseDetailScreen.tsx
  OrphansTab.tsx
  DisputesTab.tsx
  DisputeDetailScreen.tsx
  ParserFailuresTab.tsx
  AuditLogTab.tsx
  SettingsTab.tsx
  components/
    StatusBadge.tsx         — purchase/dispute/sms status pills
    StatTile.tsx            — dashboard stat tiles
    ReasonPromptModal.tsx   — reusable "enter a reason then confirm" modal
    JsonDiff.tsx            — collapsible before/after diff renderer
    Pagination.tsx          — shared table pagination

src/infrastructure/admin/
  AdminApiClient.ts         — single fetch wrapper with X-Admin-Key
  adminTypes.ts             — TypeScript shapes mirroring the API responses

api/admin/
  dashboard.ts
  users/index.ts
  users/[id]/index.ts
  users/[id]/grant-credits.ts
  users/[id]/deduct-credits.ts
  users/[id]/note.ts
  purchases/index.ts
  purchases/[id]/index.ts
  purchases/[id]/expire.ts
  purchases/[id]/reopen.ts
  purchases/[id]/note.ts
  purchases/[id]/grant-override.ts
  orphans/index.ts
  orphans/[id]/mark-ignored.ts
  parser-failures/index.ts
  parser-failures/[id]/mark-reviewed.ts
  parser-failures/export.ts
  audit-log.ts
  settings/health.ts
  settings/run-expiry-now.ts
  _lib/adminAuth.ts          — shared X-Admin-Key verification + audit helper
```

Wire `/admin/*` into the existing client router. The shell renders the gate first, then the matching tab.

---

## 9. Operational defaults

- All tables paginated, default page size 50.
- All times displayed in the operator's local timezone with absolute UTC on hover.
- Currency rendered as `৳200` (BDT prefix, no decimals).
- Empty states should be useful: "No pending purchases. Nice." beats "No data."
- Every destructive action (refund, force-expire, deduct credits, flag user) requires confirmation via the ReasonPromptModal.
- Reason inputs default to empty; submit is disabled until the textarea has non-whitespace content.
- After any write action, the affected table refreshes automatically — no manual reload needed.
- Sensitive values (admin key, webhook secret) are NEVER rendered, even masked. Settings tab shows "present" / "missing" only.
- Server logs from `/api/admin/*` MUST NOT log request bodies — they may contain customer PII (phone numbers, emails).

---

## 10. Tests

- **Vitest unit tests** for the audit log helper: every admin action writes exactly one row with the correct actor/action/target/before/after/reason. Wrap a test purchase row, perform each write action, assert audit row appears.
- **Vitest integration tests** for endpoint auth: every `/api/admin/*` returns 401 without the header, 401 with a wrong key, 200/4xx with the correct key.
- **End-to-end manual checklist** (or Playwright if it's wired):
  1. Paste admin key, land on dashboard.
  2. Find a pending purchase, click "Confirm now" with a reason. Status flips, credits land.
  3. Check audit log — single new entry, correct actor/action/before/after.
  4. Refund the same purchase. Status flips to refunded, credits decrement.
  5. Audit log shows both entries.
  6. Open user detail, deduct 100 credits with a reason. Balance goes negative.
  7. Grant 100 credits back. Balance recovers.
  8. Audit log shows all 4 entries with correct order.

---

## 11. Suggested implementation order

If you can't ship the whole thing in one go, this order maximizes operational value per shipped commit:

1. **Migration + AdminAuthGate + AdminApiClient + audit helper.** No screens yet, but the foundation that everything else builds on. Test by hitting one existing admin endpoint via the new client.
2. **PurchaseDetailScreen + Confirm/Refund/Expire actions.** This is the highest-value flow — it's how you recover when the watcher fails. Until this exists you can't safely run real prod transactions.
3. **DashboardTab + action queue.** Lets you see what needs attention without browsing manually.
4. **PurchasesTab + filter UI.** General-purpose browse for everything.
5. **UserDetailScreen + grant/deduct/notes.** Customer support workflow.
6. **UsersTab.** Find any user.
7. **OrphansTab, DisputesTab, ParserFailuresTab.** Less frequent but important.
8. **AuditLogTab.** Compliance / debugging surface — read-only, easy to defer.
9. **SettingsTab.** Mostly diagnostic; lowest urgency.

Step 1 → 2 is the minimum viable admin panel. If you only have a day, ship steps 1 and 2 and stop.

---

## 12. Things you should NOT do

- Do not build a "manage AI providers" or "model selection" UI here. That's a separate concern, and the existing fallback chain (`api/_lib/aiFactory.ts`) is already correct.
- Do not build customer-side admin (delete user, change email, reset password). Supabase Auth owns user lifecycle. The operator can manage auth from Supabase Dashboard directly.
- Do not allow editing a customer's submitted `claimed_msisdn` or `transactionId` post-hoc. If they got it wrong, they file a dispute or you match an orphan SMS. Editing the historical record is auditless and confusing.
- Do not introduce a charts library. If you need a sparkline, render inline SVG. The dashboard is text-first.
- Do not add multi-tenancy preparation: workspaces, organizations, roles. Single operator, single tenant — by design.
- Do not add a generic "abilities" or "permissions" framework. There is one role: operator.
- Do not skip the audit log for ANY write action. If you build a write endpoint without an audit entry, that's a bug, not an optimization.
- Do not introduce SSO, OAuth, magic links, or any auth path beyond the `ADMIN_API_KEY` header. If the operator wants to harden it later (IP allowlist, key rotation cadence), that's an ops-config decision, not a code one.
- Do not add background jobs, webhooks, or third-party integrations from the admin panel. The admin panel reads + acts on existing tables. New triggers belong in the edge-cases prompt's scope, not here.

---

## 13. Deliverables

1. `008_admin_panel.sql` (idempotent migration as in §5).
2. Updated `supabase/schema.sql` mirroring the new state.
3. All API endpoint files from §6 — new ones plus the audit-extension to the existing ones.
4. The SPA files from §8, wired into the client router.
5. Tests from §10.
6. **Update `AGENTS.md`** with the new admin panel surface area, the new env var, the new tables, and the auth model — same commit as the code (the repo's `CLAUDE.md` makes this mandatory).
7. A short `ADMIN.md` (or update existing if present) describing first-time setup: generating the admin key, setting the env var, accessing `/admin`, what to do when the watcher fails.

---

## 14. Stop and ask before

- Adding any new SDK or large dependency (anything not already in `package.json`).
- Changing the auth model (anything beyond the `X-Admin-Key` header).
- Changing the wire contract with the Flutter watcher (i.e., any change to `/api/confirm-purchase`'s request/response shape).
- Adding background jobs, cron schedules, or third-party integrations.
- Designing for a second operator.
