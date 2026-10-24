-- 033_master_resume_package.sql
--
-- Sell the master resume on its own (branch feat/master-resume-offer,
-- 2026-10-24).
--
-- Since 032 the master resume has been the first pack's bonus. Prod funnel
-- (2026-10-24): the master-resume lock is the single biggest driver of
-- purchase-sheet opens, yet nobody paid ৳200 for it. This adds a ৳50
-- 'master-resume' package next to the ৳200 'five-pack'.
--
-- Only initiate_purchase changes:
--   * 'master-resume' → 0 credits, ৳50. Everything downstream already works
--     for it unchanged: trg_unlock_master_resume (032) stamps
--     profiles.master_resume_unlocked_at on ANY completed purchase, the
--     +0 credit update writes no credit_ledger row (log_credit_change skips
--     zero deltas), confirm_purchase / underpaid / overpayment checks key on
--     the row's own amount_taka, and admin revenue sums amount_taka.
--   * Refuses 'master-resume' with already_unlocked when the account is
--     already unlocked, so nobody can pay ৳50 for nothing.
--
-- The bKash watcher (apps/mobile) never sees package ids — it posts TrxID +
-- observed amount — so the webhook contract is unchanged.
--
-- Same signature and return type as v3 (012), so CREATE OR REPLACE keeps the
-- 025 grants. Idempotent: safe to re-run.

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
    when 'five-pack' then v_credits := 5; v_amount_taka := 200;
    -- Master resume on its own (migration 033): no credits; the completed
    -- purchase unlocks the master resume via trg_unlock_master_resume.
    when 'master-resume' then v_credits := 0; v_amount_taka := 50;
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
