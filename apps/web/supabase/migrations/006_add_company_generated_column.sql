-- Add a stored generated column that extracts the target company name from the
-- JSONB payload. This avoids full JSONB scans and enables efficient server-side
-- search on company in the dashboard list.
--
-- Run this in the Supabase SQL editor before deploying the corresponding
-- application code update.

-- Enable the trigram extension for fast ILIKE search (enabled by default on
-- Supabase, but idempotent here in case it was dropped).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE generated_resumes
  ADD COLUMN IF NOT EXISTS company text
    GENERATED ALWAYS AS ((data -> 'targetJob' ->> 'company')) STORED;

-- Composite index for the list query (user_id filter + date ordering)
CREATE INDEX IF NOT EXISTS idx_generated_resumes_created
  ON generated_resumes (user_id, created_at DESC);

-- Trigram indexes for fast substring search on title and company
CREATE INDEX IF NOT EXISTS idx_generated_resumes_title_trgm
  ON generated_resumes USING gin (title gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_generated_resumes_company_trgm
  ON generated_resumes USING gin (company gin_trgm_ops);
