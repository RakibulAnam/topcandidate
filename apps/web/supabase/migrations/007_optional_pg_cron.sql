-- 007_optional_pg_cron.sql — opt-in pg_cron schedule
--
-- Only run this if your Supabase project has the pg_cron extension enabled
-- (Database → Extensions → pg_cron). It schedules the 24h-TTL pending
-- expiry every 15 minutes. If you're on a Vercel plan that supports the
-- 15-minute cadence (Pro+), use the vercel.json cron entry instead and skip
-- this file — the two would just race harmlessly but the Vercel cron is
-- easier to monitor.

create extension if not exists pg_cron;

-- Unschedule any prior job with the same name (idempotent re-run).
do $$
declare
  job_id integer;
begin
  select jobid into job_id from cron.job where jobname = 'expire_pending_purchases';
  if job_id is not null then
    perform cron.unschedule(job_id);
  end if;
end$$;

select cron.schedule(
  'expire_pending_purchases',
  '*/15 * * * *',
  $$ select public.expire_stale_pending_purchases(); $$
);
