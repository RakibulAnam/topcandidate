-- 014_add_toolkit_call_kind.sql
--
-- The combined toolkit bundle moved off /api/optimize onto its own endpoint
-- (/api/toolkit) so a slow toolkit generation can never push the optimizer
-- request past Vercel's 60s function cap. The new endpoint logs its own
-- ai_call_log rows under kind = 'toolkit' (distinct from 'toolkit_item',
-- which remains the single-artifact retry path).
--
-- Idempotent: drop-and-recreate the kind CHECK with the widened list.

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'ai_call_log_kind_check' and conrelid = 'public.ai_call_log'::regclass
  ) then
    alter table ai_call_log drop constraint ai_call_log_kind_check;
  end if;
  alter table ai_call_log add constraint ai_call_log_kind_check
    check (kind in ('optimize', 'optimize_general', 'toolkit', 'toolkit_item', 'extract_resume'));
end $$;
