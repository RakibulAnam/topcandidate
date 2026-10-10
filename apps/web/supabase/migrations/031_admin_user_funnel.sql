-- 031_admin_user_funnel.sql
--
-- Per-user activation funnel for the admin Users tab. One row per profile with
-- how far the user got: signed up → started profile → finished profile →
-- got the free General Resume → generated a tailored (paid) resume → paid.
--
-- `stage` is the furthest step reached, so the list can be filtered and the
-- funnel strip counted server-side. Read only by /api/admin/users and
-- /api/admin/user-detail (service role).
--
-- Definitions (match the app):
--   profile complete  = profiles.onboarding_complete (set by ProfileSetupScreen's final step)
--   general resume    = generated_resumes.title = 'General Resume' (ResumeService.GENERAL_RESUME_TITLE)
--   tailored resume   = any other generated_resumes row
--   paid              = >= 1 purchases row with status 'completed'
--   headline_role     = current experience's role, else the most recent one (for "who is this user")
--   last_active_at    = latest of analytics event, AI call, resume save, profile update.
--                       (profiles.last_active_at is never written by the app, so it is ignored.)
--
-- Idempotent: create or replace + grants re-applied.

create or replace view v_admin_user_funnel
with (security_invoker = true) as
select
  p.id,
  p.email,
  p.full_name,
  p.toolkit_credits,
  p.flagged_at,
  p.created_at,
  p.updated_at,
  p.user_type,
  p.location,
  p.linkedin,
  coalesce(p.onboarding_complete, false) as onboarding_complete,
  nullif(trim(hx.role), '')    as headline_role,
  nullif(trim(hx.company), '') as headline_company,
  p.utm_source,
  p.utm_medium,
  p.utm_campaign,
  p.signup_referrer,
  (select count(*) from experiences  x where x.user_id = p.id)::int as experience_count,
  (select count(*) from educations   x where x.user_id = p.id)::int as education_count,
  (select count(*) from skills       x where x.user_id = p.id)::int as skill_count,
  (select count(*) from projects     x where x.user_id = p.id)::int as project_count,
  r.general_at,
  coalesce(r.tailored_count, 0)::int as tailored_count,
  r.first_tailored_at,
  r.last_resume_at,
  coalesce(pu.paid_count, 0)::int as paid_count,
  coalesce(pu.paid_taka, 0)::int as paid_taka,
  pu.first_paid_at,
  greatest(
    (select max(e.created_at) from analytics_events e where e.user_id = p.id),
    (select max(a.created_at) from ai_call_log a where a.user_id = p.id),
    r.last_resume_at,
    p.updated_at
  ) as last_active_at,
  case
    when coalesce(pu.paid_count, 0) > 0                then 'paid'
    when coalesce(r.tailored_count, 0) > 0             then 'tailored'
    when r.general_at is not null                      then 'general_resume'
    when coalesce(p.onboarding_complete, false)        then 'profile_complete'
    when exists (select 1 from experiences x where x.user_id = p.id)
      or exists (select 1 from educations  x where x.user_id = p.id)
      or exists (select 1 from skills      x where x.user_id = p.id)
      or exists (select 1 from projects    x where x.user_id = p.id) then 'profile_started'
    else 'signed_up'
  end as stage
from profiles p
-- Headline job: the current role if any, else the most recent one. Dates are
-- 'YYYY-MM' text (MonthPicker), so they sort lexically.
left join lateral (
  select x.role, x.company
  from experiences x
  where x.user_id = p.id and coalesce(nullif(trim(x.role), ''), nullif(trim(x.company), '')) is not null
  order by coalesce(x.is_current, false) desc, coalesce(nullif(x.end_date, ''), '9999') desc, x.start_date desc nulls last, x.created_at desc
  limit 1
) hx on true
left join lateral (
  select
    min(g.created_at) filter (where g.title = 'General Resume')                       as general_at,
    count(*)          filter (where g.title is distinct from 'General Resume')        as tailored_count,
    min(g.created_at) filter (where g.title is distinct from 'General Resume')        as first_tailored_at,
    max(greatest(g.created_at, coalesce(g.updated_at, g.created_at)))                 as last_resume_at
  from generated_resumes g
  where g.user_id = p.id
) r on true
left join lateral (
  select count(*) as paid_count, sum(pc.amount_taka) as paid_taka, min(pc.created_at) as first_paid_at
  from purchases pc
  where pc.user_id = p.id and pc.status = 'completed'
) pu on true;

-- Admin-only (see 021): never readable with the public anon key.
revoke all on v_admin_user_funnel from anon, authenticated;
grant select on v_admin_user_funnel to service_role;

-- Per-user lookups used by the lateral subqueries above.
create index if not exists experiences_user_id_idx       on experiences (user_id);
create index if not exists educations_user_id_idx        on educations (user_id);
create index if not exists skills_user_id_idx            on skills (user_id);
create index if not exists projects_user_id_idx          on projects (user_id);
create index if not exists generated_resumes_user_id_idx on generated_resumes (user_id, created_at desc);
