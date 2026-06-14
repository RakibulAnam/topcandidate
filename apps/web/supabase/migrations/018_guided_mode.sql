-- 018_guided_mode.sql
--
-- Guided Mode: every description-bearing profile item can be filled via a short
-- questionnaire instead of a single brain-dump box. The structured answers are
-- stored in `guided` (JSONB, keyed by question id, verbatim in any language)
-- and ALSO assembled into the item's existing description column, so the AI
-- refinement pipeline (normalizer → optimizer canonicalBullets → toolkit
-- evidence → fabrication guards) consumes them exactly like a free brain dump.
--
--   input_mode      'free' | 'guided'  (default 'guided')
--   guided          jsonb  structured answers (guided mode only)
--   guided_version  int    which question-set version `guided` maps to
--
-- Awards previously had no AI polish; this also gives them the normalized
-- columns (mirrors migrations 015/016) so Guided/Free awards get refined too.

-- experiences / projects / extracurriculars already have `normalized` +
-- `normalized_source_hash` (migrations 015/016); they only need guided columns.
alter table experiences      add column if not exists input_mode text default 'guided';
alter table experiences      add column if not exists guided jsonb;
alter table experiences      add column if not exists guided_version int;

alter table projects         add column if not exists input_mode text default 'guided';
alter table projects         add column if not exists guided jsonb;
alter table projects         add column if not exists guided_version int;

alter table extracurriculars add column if not exists input_mode text default 'guided';
alter table extracurriculars add column if not exists guided jsonb;
alter table extracurriculars add column if not exists guided_version int;

-- awards: guided columns + the polish columns it never had.
alter table awards           add column if not exists input_mode text default 'guided';
alter table awards           add column if not exists guided jsonb;
alter table awards           add column if not exists guided_version int;
alter table awards           add column if not exists normalized jsonb;
alter table awards           add column if not exists normalized_source_hash text;

-- RLS unchanged: all four tables already have owner-scoped policies; the new
-- columns are covered. No column-level GRANT restrictions on these tables
-- (only profiles was locked), so user JWTs can write the new columns.
