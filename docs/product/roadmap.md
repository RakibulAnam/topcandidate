# Roadmap

_TODO: populate when there's a decided sequence. Solo-dev — keep it tight, no aspirational backlog._

## Shipped

- Manual-pay bKash flow with the Android watcher (single five-pack: 5 credits / 200 BDT).
- Admin panel (`/admin`) — purchases, pending/orphan handling, disputes, audit log, manual expiry trigger.
- Purchase disputes (`api/dispute-purchase.ts` + admin resolution).
- Webhook replay protection — v2 protocol (timestamp ±5 min + one-time nonce), migration 011.

## Now

- Monorepo stabilization (this restructure).

## Next

_(open)_

## Later (parked, not committed)

- Mock-interview marketplace.
- Real bKash payment-gateway integration (would obsolete the mobile watcher).
- iOS watcher port.
