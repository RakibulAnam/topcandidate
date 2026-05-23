# Web architecture

Authoritative reference: [`apps/web/AGENTS.md`](../../apps/web/AGENTS.md) (long-form, §4 Architecture and §6 Application flow specifically).

In brief: Clean Architecture with four layers (Presentation → Application → Domain ← Infrastructure). AI calls capped at 2 concurrent on the hot path due to free-tier RPM. Server-only Vercel Functions in `apps/web/api/` hold all provider keys; client never sees them.

_This file exists as a navigation hint — content stays in `apps/web/AGENTS.md` to avoid drift._
