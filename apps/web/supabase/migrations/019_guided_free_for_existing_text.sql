-- 019_guided_free_for_existing_text.sql
--
-- Fix for the Guided Mode data-loss / hidden-text wrinkle.
--
-- Migration 018 added `input_mode text default 'guided'`, which Postgres
-- backfilled onto ALL existing rows. So every item that predates Guided Mode —
-- and every item imported from an uploaded resume (the extractor only fills the
-- description, never `guided`) — ended up with input_mode='guided' but a real
-- free-text `description` and NO guided answers. Two consequences:
--   1. Opening such an item for edit showed an EMPTY guided questionnaire,
--      hiding the existing text behind the "Free write" tab.
--   2. Answering the guided questions overwrote `description` with the
--      assembled answers on save — silently discarding the original text
--      (the protective Free→Guided carry-over only fires on an actual toggle).
--
-- Fix: flip those rows back to 'free'. The edit view then shows the real text,
-- and a later switch to Guided goes through the safe carry-over (which seeds
-- the required question with the existing text) instead of overwriting it.
--
-- Scope guard: ONLY rows that have description text AND no guided answers are
-- touched. Genuine guided items (guided populated) are left exactly as-is.
-- Idempotent: re-running flips nothing further (already-'free' rows excluded).

update experiences      set input_mode = 'free'
  where input_mode = 'guided'
    and coalesce(description, '') <> ''
    and (guided is null or guided = '{}'::jsonb);

update projects         set input_mode = 'free'
  where input_mode = 'guided'
    and coalesce(description, '') <> ''
    and (guided is null or guided = '{}'::jsonb);

update extracurriculars set input_mode = 'free'
  where input_mode = 'guided'
    and coalesce(description, '') <> ''
    and (guided is null or guided = '{}'::jsonb);

update awards           set input_mode = 'free'
  where input_mode = 'guided'
    and coalesce(description, '') <> ''
    and (guided is null or guided = '{}'::jsonb);
