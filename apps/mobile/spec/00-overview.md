# Spec 00 — Overview

## Purpose

`bkash_watcher` automates the last step of a manual bKash payment flow used by
a SaaS web app that sells credit packs in BDT. The web app records pending
purchases keyed by bKash Transaction ID (TrxID). When the operator's phone
receives a "money received" SMS from bKash, the watcher app reads it, signs
it, and POSTs it to the web app's confirm-purchase webhook. The web app then
grants credits.

## Roles

| Role     | Where                          | What it does                                  |
| -------- | ------------------------------ | --------------------------------------------- |
| Customer | Web app                        | Pays bKash to operator, pastes TrxID in form. |
| Web app  | Vercel + Supabase              | Creates `pending` purchase row keyed by TrxID.|
| Operator | Owns the phone                 | Installs and configures this app once.        |
| Watcher  | Operator's Android phone       | Reads SMS, POSTs signed confirmation.         |

## Non-goals

- iOS support — Apple doesn't allow programmatic SMS read.
- Multi-tenant: one phone, one operator, one webhook URL.
- A backend of its own. The web app is authoritative.
- A polished consumer UX. This is a back-office tool.
- App-store distribution. APK sideload only.

## Success criteria

- A bKash "money received" SMS arrives → the customer sees credits in their
  web account within 30 seconds, 95% of the time.
- After a phone reboot, the watcher is alive without operator intervention.
- After 24 h offline, queued SMS deliver successfully when connectivity
  returns.
- Operator can audit every SMS the app has seen and explain its state.

## Glossary

- **TrxID** — 10-character alphanumeric bKash transaction reference.
- **MSISDN** — Mobile Subscriber ISDN, i.e. the 11-digit phone number
  `01XXXXXXXXX` for Bangladesh.
- **HMAC** — HMAC-SHA256 of `"<timestamp>.<rawBody>"` (protocol v2),
  hex-encoded, sent in the `X-Bkash-Webhook-Signature` header alongside the
  `X-Bkash-Webhook-Timestamp` header. See spec/01-server-contract.md.
- **Pending purchase** — a row the web app creates when the customer says
  "I paid, here's my TrxID". The watcher's POST flips it to `confirmed`.
- **Foreground service** — Android construct for a process with a persistent
  notification, not killed by the system under normal memory pressure.

## Reading order for new agents

1. AGENTS.md (entry point)
2. spec/00-overview.md (this file)
3. spec/01-server-contract.md
4. spec/02-sms-formats.md
5. spec/03-architecture.md
6. spec/04-state-machine.md
7. Other spec files as needed.
