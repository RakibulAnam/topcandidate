# Supabase schema

Canonical schema and migrations live with the web app:

- Full schema: [`apps/web/supabase/schema.sql`](../../apps/web/supabase/schema.sql)
- Migrations (idempotent, cumulative, `IF NOT EXISTS` patterns): [`apps/web/supabase/migrations/`](../../apps/web/supabase/migrations/)

## Migration discipline (mandatory)

Any schema change must:
1. Add a new `apps/web/supabase/migrations/<NNN>_<name>.sql` (next sequential number).
2. Use `IF NOT EXISTS` and other idempotent patterns so re-running is safe.
3. Reflect the change in `apps/web/supabase/schema.sql` (the consolidated view).
4. Be surfaced to the operator as a script to paste into the Supabase SQL editor.

Detail: [`apps/web/CLAUDE.md`](../../apps/web/CLAUDE.md) rule 6 and [`apps/web/AGENTS.md`](../../apps/web/AGENTS.md) §8.
