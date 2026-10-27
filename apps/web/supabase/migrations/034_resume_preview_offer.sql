-- 034_resume_preview_offer.sql
--
-- Dashboard resume-preview offer (branch feat/resume-preview-offer,
-- 2026-10-27). Owner's call: once the profile is finished, the dashboard shows
-- the user's own master resume — summary readable, the rest fading into blur —
-- with one price, ৳99 (shown against ৳200), and nothing else.
--
--   0. EXISTING ACCOUNTS KEEP THEIR DEAL (owner, 2026-10-27). New column
--      profiles.legacy_pricing, set ONCE for every account that exists when
--      this migration first runs (the column is added and back-filled in one
--      guarded block, so a re-run never flags later sign-ups). For those
--      accounts the master resume stays ৳50 and the one-time welcome credit
--      still applies — including the ones who haven't finished their profile
--      yet, who were promised it at sign-up. New sign-ups default to false.
--
--   1. initiate_purchase: 'master-resume' is ৳99 (৳50 for legacy_pricing
--      accounts; was ৳50 for everyone, migration 033) and 'five-pack' is ৳199
--      for everyone (was ৳200). Paying ৳100 / ৳200 already settles
--      them — anything at or above the row's amount_taka completes, and the
--      surplus is logged to purchase_overpayments — so "accept 99 or 100"
--      needs nothing else. Rows already pending keep their own amount_taka.
--
--   2. claim_welcome_credit() grants only to legacy_pricing accounts: new
--      accounts no longer get a free credit (it returns NULL for them, same
--      signature and grants). Credits already granted are untouched.
--
--   3. master_previews: the master resume the preview's summary came from,
--      built ONCE by /api/optimize-general (preview mode) and reused when the
--      ৳99 purchase lands, so the summary someone read is the one they get.
--      RLS on and NO policies — the optimized resume is the paid product, so
--      only the service role (the API) reads or writes it; the client only
--      ever receives `summary`. Keyed on the profile content hash: an edited
--      profile gets a fresh preview.
--
-- The bKash watcher (apps/mobile) never sees package ids or prices — it posts
-- TrxID + observed amount — so the webhook contract is unchanged.
--
-- Idempotent: safe to re-run.

-- ---------------------------------------------------------------------------
-- 0. Grandfather every existing account (added + back-filled exactly once).
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'legacy_pricing'
  ) then
    alter table public.profiles add column legacy_pricing boolean not null default false;
    update public.profiles set legacy_pricing = true;
  end if;
end $$;

comment on column public.profiles.legacy_pricing is
  'Account existed before migration 034: master resume stays ৳50 and the one-time welcome credit still applies. Set once by 034; new sign-ups are false.';

create or replace function initiate_purchase(
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
    -- ৳99, or the ৳50 these accounts were offered before migration 034.
    when 'master-resume' then
      v_credits := 0;
      v_amount_taka := case when exists (
        select 1 from public.profiles where id = auth.uid() and legacy_pricing
      ) then 50 else 99 end;
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

revoke all on function public.initiate_purchase(text, text, text) from public, anon;
grant execute on function public.initiate_purchase(text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Welcome credit: legacy accounts only.
-- ---------------------------------------------------------------------------
create or replace function public.claim_welcome_credit()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_balance integer;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  perform set_config('app.credit_reason', 'welcome_credit', true);

  -- 032's grant, now only for accounts that existed before 034.
  update public.profiles
    set toolkit_credits = toolkit_credits + 1,
        welcome_credit_at = now()
    where id = v_uid
      and legacy_pricing
      and welcome_credit_at is null
      and coalesce(onboarding_complete, false)
    returning toolkit_credits into v_balance;

  return v_balance;
end;
$$;
revoke execute on function public.claim_welcome_credit() from public, anon;
grant execute on function public.claim_welcome_credit() to authenticated;

-- ---------------------------------------------------------------------------
-- Saved master-resume preview (service role only).
-- ---------------------------------------------------------------------------
create table if not exists public.master_previews (
  user_id      uuid primary key references auth.users on delete cascade,
  profile_hash text not null,
  summary      text not null,
  optimized    jsonb not null,
  created_at   timestamptz not null default timezone('utc', now()),
  updated_at   timestamptz not null default timezone('utc', now())
);

comment on table public.master_previews is
  'Master resume built for the dashboard preview (migration 034). Service role only: the client gets the summary, never the rest.';

alter table public.master_previews enable row level security;
revoke all on table public.master_previews from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 'master_preview' call kind for the preview builds.
-- ---------------------------------------------------------------------------
do $$ begin
  if exists (select 1 from pg_constraint where conname='ai_call_log_kind_check' and conrelid='public.ai_call_log'::regclass) then
    alter table ai_call_log drop constraint ai_call_log_kind_check;
  end if;
  alter table ai_call_log add constraint ai_call_log_kind_check
    check (kind in ('optimize','optimize_general','master_preview','toolkit','toolkit_item','extract_resume','normalize'));
end $$;
