-- 035_admin_test_accounts.sql
--
-- Admin tooling for test accounts (2026-10-28):
--
--   1. purchases.is_test — the operator marks a payment made from a test
--      account as a test. Test purchases stay fully functional for the user
--      (credits, master-resume unlock) but are left out of every revenue /
--      paying-user number in the admin panel. The admin handlers filter
--      `is_test = false`; the two SQL views that sum purchases are recreated
--      below with the same filter.
--   2. admin_grant_master_resume(user) — stamps profiles.master_resume_unlocked_at
--      by hand (same column trg_unlock_master_resume sets on a purchase).
--   3. admin_delete_user(user) — removes an account and everything it owns,
--      including its auth.users row, in one transaction. Refuses while the
--      account has a non-test purchase that involved (or may involve) real
--      money — completed, refunded, underpaid, mismatch review or pending — so
--      a real customer's payment record can't vanish by accident.
--      Most user tables reference auth.users / profiles with NO ACTION, so
--      the children are deleted explicitly; a table added later without a
--      cascade makes the whole call fail rather than half-delete.
--   4. profiles.master_price_taka — per-user master-resume price set by the
--      operator. initiate_purchase charges it when set, else ৳50 (legacy
--      account) / ৳99. admin_set_master_price(user, price | null).
--   5. apply_purchase_topup fix: observed_amount_taka already holds every
--      earlier top-up (each call writes the running total back), so adding
--      sum(all top-ups) again double-counted from the second top-up on.
--      The total is now the stored observed amount + this top-up.
--   6. v_daily_revenue buckets by Bangladesh day (Asia/Dhaka), not UTC.
--
-- Service role only (called from /api/admin/*). Idempotent: safe to re-run.

alter table public.purchases
  add column if not exists is_test boolean not null default false;

alter table public.profiles
  add column if not exists master_price_taka integer;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_master_price_taka_check') then
    alter table public.profiles
      add constraint profiles_master_price_taka_check check (master_price_taka between 1 and 100000);
  end if;
end $$;
comment on column public.profiles.master_price_taka is
  'Operator-set master-resume price for this account (taka). Null = default: ৳50 if legacy_pricing else ৳99. Not user-writable (column UPDATE grants are whitelisted).';

comment on column public.purchases.is_test is
  'Operator-marked test payment (test account). Excluded from admin revenue / paying-user analytics; the purchase itself still counts for the user.';

-- ---------------------------------------------------------------------------
-- Views that sum purchases: exclude test payments.
-- ---------------------------------------------------------------------------
create or replace view v_daily_revenue as
select
  date(created_at at time zone 'Asia/Dhaka') as day,
  count(*)                              as orders,
  coalesce(sum(amount_taka), 0)         as revenue_taka,
  coalesce(sum(credits_granted), 0)     as credits_sold
from purchases
where status = 'completed' and not is_test
group by date(created_at at time zone 'Asia/Dhaka');
alter view v_daily_revenue set (security_invoker = true);
revoke all on v_daily_revenue from anon, authenticated;

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
  end as stage,
  -- Master-resume offer (035): what initiate_purchase would charge.
  coalesce(p.legacy_pricing, false) as legacy_pricing,
  p.master_price_taka,
  coalesce(p.master_price_taka, case when p.legacy_pricing then 50 else 99 end) as master_offer_taka,
  p.master_resume_unlocked_at
from profiles p
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
-- Test payments (035) don't make a user "paid".
left join lateral (
  select count(*) as paid_count, sum(pc.amount_taka) as paid_taka, min(pc.created_at) as first_paid_at
  from purchases pc
  where pc.user_id = p.id and pc.status = 'completed' and not pc.is_test
) pu on true;

revoke all on v_admin_user_funnel from anon, authenticated;
grant select on v_admin_user_funnel to service_role;

-- ---------------------------------------------------------------------------
-- Mark / unmark a purchase as a test payment. Returns the new flag.
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_purchase_test(p_purchase_id uuid, p_is_test boolean)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_flag boolean;
begin
  if p_purchase_id is null then raise exception 'purchase_id_required'; end if;
  if p_is_test is null then raise exception 'is_test_required'; end if;
  update purchases set is_test = p_is_test where id = p_purchase_id returning is_test into v_flag;
  if v_flag is null then raise exception 'purchase_not_found'; end if;
  return v_flag;
end; $$;
revoke execute on function public.admin_set_purchase_test(uuid, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Unlock the master resume by hand. Returns the unlock time (the existing one
-- when the account was already unlocked).
-- ---------------------------------------------------------------------------
create or replace function public.admin_grant_master_resume(p_user_id uuid)
returns timestamptz language plpgsql security definer set search_path = public, pg_temp as $$
declare v_at timestamptz;
begin
  if p_user_id is null then raise exception 'user_id_required'; end if;
  update profiles
    set master_resume_unlocked_at = coalesce(master_resume_unlocked_at, now())
    where id = p_user_id
    returning master_resume_unlocked_at into v_at;
  if v_at is null then raise exception 'user_not_found'; end if;
  return v_at;
end; $$;
revoke execute on function public.admin_grant_master_resume(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Delete an account and everything it owns. Returns the deleted login email.
-- ---------------------------------------------------------------------------
create or replace function public.admin_delete_user(p_user_id uuid)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_email text;
  v_real  integer;
begin
  if p_user_id is null then raise exception 'user_id_required'; end if;

  select email into v_email from auth.users where id = p_user_id for update;
  if not found and not exists (select 1 from profiles where id = p_user_id) then
    raise exception 'user_not_found';
  end if;

  select count(*) into v_real from purchases
    where user_id = p_user_id and not is_test
      and status in ('completed', 'refunded', 'underpaid', 'msisdn_mismatch_review', 'pending');
  if v_real > 0 then
    raise exception 'has_real_purchases'
      using hint = format('%s purchase(s) that involve real money are not marked as test. Mark them as test first.', v_real);
  end if;

  -- Purchases and what hangs off them. SMS rows are bKash's record of real
  -- money movement, so they are kept and just unlinked.
  update inbound_payments set consumed_purchase_id = null
    where consumed_purchase_id in (select id from purchases where user_id = p_user_id);
  update unmatched_inbound_sms set matched_to_purchase_id = null
    where matched_to_purchase_id in (select id from purchases where user_id = p_user_id);
  delete from purchase_disputes where user_id = p_user_id;
  delete from purchases where user_id = p_user_id;  -- cascades state changes, top-ups, overpayments

  -- Telemetry (no cascade on these).
  delete from ai_call_log      where user_id = p_user_id;
  delete from analytics_events where user_id = p_user_id;

  -- Profile content.
  delete from affiliations      where user_id = p_user_id;
  delete from applications      where user_id = p_user_id;
  delete from awards            where user_id = p_user_id;
  delete from certifications    where user_id = p_user_id;
  delete from educations        where user_id = p_user_id;
  delete from experiences       where user_id = p_user_id;
  delete from extracurriculars  where user_id = p_user_id;
  delete from languages         where user_id = p_user_id;
  delete from projects          where user_id = p_user_id;
  delete from publications      where user_id = p_user_id;
  delete from references_list   where user_id = p_user_id;
  delete from skills            where user_id = p_user_id;

  -- Cascades credit_ledger, profile_notes, account_ip_signals.
  delete from profiles where id = p_user_id;
  -- Cascades generated_resumes, master_previews, auth sessions/identities.
  delete from auth.users where id = p_user_id;

  return v_email;
end; $$;
revoke execute on function public.admin_delete_user(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Per-user master-resume price. p_price null = back to the default.
-- Returns the effective price.
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_master_price(p_user_id uuid, p_price integer)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_effective integer;
begin
  if p_user_id is null then raise exception 'user_id_required'; end if;
  if p_price is not null and (p_price < 1 or p_price > 100000) then raise exception 'price_out_of_range'; end if;
  update profiles set master_price_taka = p_price where id = p_user_id
    returning coalesce(master_price_taka, case when legacy_pricing then 50 else 99 end) into v_effective;
  if v_effective is null then raise exception 'user_not_found'; end if;
  return v_effective;
end; $$;
revoke execute on function public.admin_set_master_price(uuid, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- initiate_purchase: identical to 034 except the master-resume price, which
-- now honours profiles.master_price_taka. Grants are kept by create or replace.
-- ---------------------------------------------------------------------------
create or replace function public.initiate_purchase(
  p_package_id     text,
  p_transaction_id text,
  p_sender_msisdn  text default null
) returns table (
  purchase_id     uuid,
  status_out      text,
  credits_granted integer,
  new_balance     integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_credits       integer;
  v_amount_taka   integer;
  v_purchase_id   uuid;
  v_pending_count integer;
  v_inbound       public.inbound_payments%rowtype;
  v_status        text := 'pending';
  v_balance       integer := null;
  v_surplus       integer;
begin
  case p_package_id
    when 'five-pack' then v_credits := 5; v_amount_taka := 199;
    -- Master resume on its own (migration 033): no credits; the completed
    -- purchase unlocks the master resume via trg_unlock_master_resume.
    -- The operator-set price (035) if any, else ৳99, or the ৳50 these
    -- accounts were offered before migration 034.
    when 'master-resume' then
      v_credits := 0;
      select coalesce(master_price_taka, case when legacy_pricing then 50 else 99 end)
        into v_amount_taka
        from public.profiles where id = auth.uid();
      v_amount_taka := coalesce(v_amount_taka, 99);
    else
      raise exception 'unknown_package_id'
        using hint = 'Valid packages: five-pack, master-resume.';
  end case;

  -- Nothing to sell an account that already has the master resume unlocked.
  if p_package_id = 'master-resume' and exists (
    select 1 from public.profiles
    where id = auth.uid() and master_resume_unlocked_at is not null
  ) then
    raise exception 'already_unlocked'
      using hint = 'The master resume is already unlocked for this account.';
  end if;

  if length(coalesce(p_transaction_id, '')) < 6 then
    raise exception 'invalid_transaction_id'
      using hint = 'bKash transaction ID is required and must be at least 6 characters.';
  end if;

  if exists (
    select 1 from public.purchases where payment_reference = p_transaction_id
  ) then
    raise exception 'duplicate_transaction_id'
      using hint = 'This bKash transaction ID has already been submitted.';
  end if;

  -- Anti-spam: cap pending purchases per user in the rolling 24h window.
  select count(*) into v_pending_count
  from public.purchases
  where user_id = auth.uid()
    and status = 'pending'
    and created_at > now() - interval '24 hours';

  if v_pending_count >= 5 then
    raise exception 'too_many_pending'
      using hint = 'Too many pending purchases. Wait for confirmation or contact support.';
  end if;

  insert into public.purchases (
    user_id, credits_granted, amount_taka, payment_reference, sender_msisdn, status
  ) values (
    auth.uid(), v_credits, v_amount_taka, p_transaction_id, p_sender_msisdn, 'pending'
  )
  returning id into v_purchase_id;

  -- Match-on-submit: settle now if the verified SMS already arrived.
  select * into v_inbound
  from public.inbound_payments
  where payment_reference = p_transaction_id and consumed_at is null
  for update;

  if found then
    if p_sender_msisdn is not null
       and v_inbound.sender_msisdn is not null
       and p_sender_msisdn <> v_inbound.sender_msisdn then
      update public.purchases
        set status = 'msisdn_mismatch_review', observed_amount_taka = v_inbound.amount_taka
        where id = v_purchase_id;
      insert into public.purchase_state_changes (purchase_id, from_status, to_status, actor, reason)
        values (v_purchase_id, 'pending', 'msisdn_mismatch_review', 'system-match',
                format('claimed=%s observed=%s', p_sender_msisdn, v_inbound.sender_msisdn));
      v_status := 'msisdn_mismatch_review';
    elsif v_inbound.amount_taka < v_amount_taka then
      update public.purchases
        set status = 'underpaid', observed_amount_taka = v_inbound.amount_taka
        where id = v_purchase_id;
      insert into public.purchase_state_changes (purchase_id, from_status, to_status, actor, reason)
        values (v_purchase_id, 'pending', 'underpaid', 'system-match',
                format('observed=%s expected=%s', v_inbound.amount_taka, v_amount_taka));
      v_status := 'underpaid';
    else
      update public.purchases
        set status = 'completed', observed_amount_taka = v_inbound.amount_taka
        where id = v_purchase_id;
      update public.profiles
        set toolkit_credits = toolkit_credits + v_credits
        where id = auth.uid()
        returning toolkit_credits into v_balance;
      insert into public.purchase_state_changes (purchase_id, from_status, to_status, actor, reason)
        values (v_purchase_id, 'pending', 'completed', 'system-match',
                format('matched inbound SMS observed=%s', v_inbound.amount_taka));
      if v_inbound.amount_taka > v_amount_taka then
        v_surplus := v_inbound.amount_taka - v_amount_taka;
        insert into public.purchase_overpayments (purchase_id, surplus_taka)
          values (v_purchase_id, v_surplus);
      end if;
      v_status := 'completed';
    end if;

    update public.inbound_payments
      set consumed_at = timezone('utc', now()), consumed_purchase_id = v_purchase_id
      where payment_reference = p_transaction_id;
  end if;

  return query select v_purchase_id, v_status, v_credits, v_balance;
end;
$$;

-- ---------------------------------------------------------------------------
-- apply_purchase_topup: identical to 007 except the running total. Every call
-- writes the total back to observed_amount_taka, so that column already
-- includes earlier top-ups; the new total is it + this top-up.
-- ---------------------------------------------------------------------------
create or replace function public.apply_purchase_topup(
  p_purchase_id   uuid,
  p_payment_ref   text,
  p_sender_msisdn text,
  p_amount_taka   integer,
  p_actor         text default 'operator',
  p_reason        text default null
) returns table (status_out text, observed_total integer, new_balance integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_purchase public.purchases%rowtype;
  v_total    integer;
  v_balance  integer;
  v_surplus  integer;
begin
  select * into v_purchase
  from public.purchases
  where id = p_purchase_id
  for update;

  if not found then
    raise exception 'purchase_not_found';
  end if;
  if v_purchase.status not in ('pending', 'underpaid') then
    raise exception 'purchase_not_topup_eligible'
      using hint = format('Status is %s; only pending/underpaid accept top-ups.', v_purchase.status);
  end if;

  insert into public.purchase_topups (purchase_id, payment_reference, sender_msisdn, amount_taka)
    values (p_purchase_id, p_payment_ref, p_sender_msisdn, p_amount_taka);

  v_total := coalesce(v_purchase.observed_amount_taka, 0) + coalesce(p_amount_taka, 0);

  if v_total >= v_purchase.amount_taka then
    update public.purchases
      set status = 'completed',
          observed_amount_taka = v_total
      where id = p_purchase_id;

    update public.profiles
      set toolkit_credits = toolkit_credits + v_purchase.credits_granted
      where id = v_purchase.user_id
      returning toolkit_credits into v_balance;

    insert into public.purchase_state_changes (purchase_id, from_status, to_status, actor, reason)
      values (p_purchase_id, v_purchase.status, 'completed', p_actor,
              format('topup ref=%s amount=%s new_total=%s', p_payment_ref, p_amount_taka, v_total)
              || coalesce(' ' || p_reason, ''));

    if v_total > v_purchase.amount_taka then
      v_surplus := v_total - v_purchase.amount_taka;
      insert into public.purchase_overpayments (purchase_id, surplus_taka)
        values (p_purchase_id, v_surplus);
    end if;

    return query select 'completed'::text, v_total, v_balance;
  else
    -- Still short. Flip to 'underpaid' (a no-op if already underpaid) so the
    -- customer's status pill shows the "send Tk N more" action card and
    -- operator queries for stuck rows surface this one.
    update public.purchases
      set status = 'underpaid',
          observed_amount_taka = v_total
      where id = p_purchase_id;

    insert into public.purchase_state_changes (purchase_id, from_status, to_status, actor, reason)
      values (p_purchase_id, v_purchase.status, 'underpaid', p_actor,
              format('topup ref=%s amount=%s still_short=%s',
                     p_payment_ref, p_amount_taka, v_purchase.amount_taka - v_total)
              || coalesce(' ' || p_reason, ''));

    return query select 'underpaid'::text, v_total, null::integer;
  end if;
end;
$$;
