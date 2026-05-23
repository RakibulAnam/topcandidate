-- Migration: add the `toolkit` JSONB column to generated_resumes.
--
-- Stores AI-generated artifacts that accompany a tailored resume:
--   • outreachEmail      { subject: string, body: string }
--   • linkedInMessage    string  (<= 280 chars)
--   • interviewQuestions [{ question, category, whyAsked, answerStrategy }]
--
-- The resume payload itself stays in the existing `data` JSONB column.
-- Keeping toolkit separate makes it independently queryable and avoids
-- bloating the resume document with sibling artifacts.
--
-- Safe to re-run: the IF NOT EXISTS guard skips the add if already applied.

alter table generated_resumes
  add column if not exists toolkit jsonb;

-- Optional: a small index to speed up later lookups of resumes that actually
-- have toolkit artifacts (e.g. "list my applications with interview prep").
create index if not exists generated_resumes_toolkit_not_null
  on generated_resumes ((toolkit is not null))
  where toolkit is not null;

-- Also reflect this change in schema.sql for anyone bootstrapping a fresh DB.
-- (This is a comment, not a runnable statement — the schema.sql file has been
--  updated separately.)
