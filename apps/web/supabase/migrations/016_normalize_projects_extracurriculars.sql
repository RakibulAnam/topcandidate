-- 016_normalize_projects_extracurriculars.sql
--
-- Extend the "polished profile" pipeline (migration 015) from experiences to
-- the other two raw-description sources that feed generation: projects and
-- extracurriculars. Same contract: AI-normalized rendering stored beside the
-- raw text (never replacing it), hash of the source description for change
-- detection.

alter table projects add column if not exists normalized jsonb;
alter table projects add column if not exists normalized_source_hash text;

alter table extracurriculars add column if not exists normalized jsonb;
alter table extracurriculars add column if not exists normalized_source_hash text;
