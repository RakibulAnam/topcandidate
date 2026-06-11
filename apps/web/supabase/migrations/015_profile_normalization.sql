-- 015_profile_normalization.sql
--
-- "Polished profile": one cheap AI normalization per profile item, run on
-- SAVE (not per generation). The result — canonical English bullets +
-- evidenced skills + coaching gaps — is stored beside the raw description
-- (never replacing it) and reused as pre-cleaned evidence by every later
-- resume/toolkit generation.
--
-- normalized:             { bullets: text[], skills: text[], gaps: text[] }
-- normalized_source_hash: client-computed hash of the description text the
--                         normalization was computed from; lets the client
--                         skip re-normalizing an unchanged description.

alter table experiences add column if not exists normalized jsonb;
alter table experiences add column if not exists normalized_source_hash text;

-- Widen the ai_call_log kind CHECK with 'normalize' (the /api/normalize-item
-- telemetry kind). Supersedes the list from migration 014 — includes both
-- 'toolkit' (014) and 'normalize'. Idempotent drop-and-recreate.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'ai_call_log_kind_check' and conrelid = 'public.ai_call_log'::regclass
  ) then
    alter table ai_call_log drop constraint ai_call_log_kind_check;
  end if;
  alter table ai_call_log add constraint ai_call_log_kind_check
    check (kind in ('optimize', 'optimize_general', 'toolkit', 'toolkit_item', 'extract_resume', 'normalize'));
end $$;

-- RLS: experiences already has owner-scoped ALL policies (schema.sql) — the
-- new columns are covered by the existing row policies; column-level GRANTs
-- on experiences were never restricted, so user JWTs can write `normalized`
-- through the existing update path. No policy changes needed.
