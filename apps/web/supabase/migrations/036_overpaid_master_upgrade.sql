-- 036_overpaid_master_upgrade.sql
--
-- A payment that covers the pack buys the pack (2026-11-25).
--
-- Incident (2026-11-22): a customer opened the sheet from the dashboard
-- resume preview, which sells only the master resume (৳99, shown against a
-- struck-through ৳200). She sent ৳203.70 (৳200 + the bKash cash-out fee).
-- The watcher reported 203 correctly and match-on-submit settled the row
-- exactly as written: a ৳99 'master-resume' purchase, 0 credits, the ৳104
-- surplus parked in purchase_overpayments as 'pending'. She paid more than
-- the ৳199 pack and got only the master resume.
--
-- The package is fixed when the TrxID is submitted, before anyone knows how
-- much was actually sent. So the settle step now looks at the money: when a
-- master-resume row (0 credits) is settled with a verified amount of at least
-- the pack price, the row becomes the pack (5 credits, ৳199) before credits
-- are granted. The pack also unlocks the master resume (trg_unlock_master_resume
-- fires on any completed purchase), so the customer loses nothing.
--
-- All three settle paths change in the same way:
--   * initiate_purchase     — match-on-submit (the SMS arrived first)
--   * confirm_purchase      — the watcher webhook (the TrxID arrived first)
--   * apply_purchase_topup  — operator-matched top-up SMS
-- operator_confirm_purchase is untouched: it has no observed amount to judge.
--
-- The upgrade is recorded in the completion's purchase_state_changes reason
-- ("… upgraded master-resume→five-pack"), not as an extra row, so the
-- System tab's completed-transition counts stay exact.
--
-- The pack price (৳199) and credits (5) are the same constants
-- initiate_purchase uses for 'five-pack'; change them together.
--
-- Backfill: completed, non-test master-resume purchases whose observed amount
-- already covers ৳199 are upgraded and credited 5 credits now (one row on
-- 2026-11-25: TrxID DKM1SB5U5R). Their pending overpayment row is reduced to
-- the amount above ৳199, or removed when nothing is left.
--
-- The webhook contract is unchanged: same request, same response codes; a
-- confirmed upgrade simply reports creditsGranted = 5.
--
-- Same signatures and return types as the live functions, so CREATE OR
-- REPLACE keeps their grants. Idempotent: safe to re-run (an upgraded row has
-- credits_granted = 5 and is never picked up again).

-- ─── initiate_purchase (match-on-submit) ─────────────────────────────────

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
  v_upgraded      boolean := false;
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
    else
      -- Paid enough for the pack on a master-resume row: sell the pack (036).
      if v_credits = 0 and v_inbound.amount_taka >= 199 then
        v_credits := 5;
        v_amount_taka := 199;
        v_upgraded := true;
        update public.purchases
          set credits_granted = v_credits, amount_taka = v_amount_taka
          where id = v_purchase_id;
      end if;

      if v_inbound.amount_taka < v_amount_taka then
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
                  format('matched inbound SMS observed=%s', v_inbound.amount_taka)
                  || case when v_upgraded then ' upgraded master-resume→five-pack' else '' end);
        if v_inbound.amount_taka > v_amount_taka then
          v_surplus := v_inbound.amount_taka - v_amount_taka;
          insert into public.purchase_overpayments (purchase_id, surplus_taka)
            values (v_purchase_id, v_surplus);
        end if;
        v_status := 'completed';
      end if;
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

-- ─── confirm_purchase (watcher webhook) ──────────────────────────────────

create or replace function public.confirm_purchase(
  p_transaction_id         text,
  p_observed_sender_msisdn text default null,
  p_observed_amount_taka   integer default null
) returns table (
  user_id         uuid,
  new_balance     integer,
  credits_granted integer,
  status_out      text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_purchase    public.purchases%rowtype;
  v_balance     integer;
  v_surplus     integer;
  v_upgraded    boolean := false;
begin
  -- Lock the row that's still in a non-terminal state we can advance from.
  -- 'pending' is the normal entry point; 'underpaid' lets a fresh SMS for
  -- the same TrxID resolve a previously-stuck row (rare but possible if
  -- the customer somehow re-uses the same TrxID for the topup, e.g. via
  -- an unusual bKash flow). 'msisdn_mismatch_review' is operator-only.
  select * into v_purchase
  from public.purchases
  where payment_reference = p_transaction_id
    and status in ('pending', 'underpaid')
  for update;

  if not found then
    raise exception 'no_pending_purchase'
      using hint = 'No pending purchase matches the given transaction ID.';
  end if;

  -- msisdn check
  if v_purchase.sender_msisdn is not null
     and p_observed_sender_msisdn is not null
     and v_purchase.sender_msisdn <> p_observed_sender_msisdn
  then
    update public.purchases
      set status = 'msisdn_mismatch_review',
          observed_amount_taka = coalesce(p_observed_amount_taka, observed_amount_taka)
      where id = v_purchase.id;
    insert into public.purchase_state_changes (purchase_id, from_status, to_status, actor, reason)
      values (v_purchase.id, v_purchase.status, 'msisdn_mismatch_review', 'flutter',
              format('claimed=%s observed=%s', v_purchase.sender_msisdn, p_observed_sender_msisdn));
    raise exception 'msisdn_mismatch'
      using hint = format(
        'Pending purchase claims sender %s but observed SMS came from %s.',
        v_purchase.sender_msisdn, p_observed_sender_msisdn
      );
  end if;

  -- Paid enough for the pack on a master-resume row: sell the pack (036).
  if v_purchase.credits_granted = 0
     and p_observed_amount_taka is not null
     and p_observed_amount_taka >= 199
  then
    update public.purchases
      set credits_granted = 5, amount_taka = 199
      where id = v_purchase.id;
    v_purchase.credits_granted := 5;
    v_purchase.amount_taka := 199;
    v_upgraded := true;
  end if;

  -- Amount check
  if p_observed_amount_taka is not null
     and p_observed_amount_taka < v_purchase.amount_taka
  then
    update public.purchases
      set status = 'underpaid',
          observed_amount_taka = p_observed_amount_taka
      where id = v_purchase.id;
    insert into public.purchase_state_changes (purchase_id, from_status, to_status, actor, reason)
      values (v_purchase.id, v_purchase.status, 'underpaid', 'flutter',
              format('observed=%s expected=%s', p_observed_amount_taka, v_purchase.amount_taka));
    raise exception 'underpaid'
      using hint = format(
        'Observed amount %s is less than required %s.',
        p_observed_amount_taka, v_purchase.amount_taka
      );
  end if;

  -- Happy path: grant credits, flip to completed.
  update public.purchases
    set status = 'completed',
        observed_amount_taka = coalesce(p_observed_amount_taka, observed_amount_taka)
    where id = v_purchase.id;

  update public.profiles
    set toolkit_credits = toolkit_credits + v_purchase.credits_granted
    where id = v_purchase.user_id
    returning toolkit_credits into v_balance;

  insert into public.purchase_state_changes (purchase_id, from_status, to_status, actor, reason)
    values (v_purchase.id, v_purchase.status, 'completed', 'flutter',
            case when p_observed_amount_taka is null then null
                 else format('observed=%s', p_observed_amount_taka)
                      || case when v_upgraded then ' upgraded master-resume→five-pack' else '' end
            end);

  -- Overpayment surplus (case #4)
  if p_observed_amount_taka is not null
     and p_observed_amount_taka > v_purchase.amount_taka
  then
    v_surplus := p_observed_amount_taka - v_purchase.amount_taka;
    insert into public.purchase_overpayments (purchase_id, surplus_taka)
      values (v_purchase.id, v_surplus);
  end if;

  return query select v_purchase.user_id, v_balance, v_purchase.credits_granted, 'completed'::text;
end;
$$;

revoke all on function public.confirm_purchase(text, text, integer) from public, anon, authenticated;
grant execute on function public.confirm_purchase(text, text, integer) to service_role;

-- ─── apply_purchase_topup (operator-matched top-up) ──────────────────────

create or replace function public.apply_purchase_topup(
  p_purchase_id   uuid,
  p_payment_ref   text,
  p_sender_msisdn text,
  p_amount_taka   integer,
  p_actor         text default 'operator',
  p_reason        text default null
) returns table (
  status_out     text,
  observed_total integer,
  new_balance    integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_purchase public.purchases%rowtype;
  v_total    integer;
  v_balance  integer;
  v_surplus  integer;
  v_upgraded boolean := false;
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

  -- observed_amount_taka already holds every earlier top-up (035).
  v_total := coalesce(v_purchase.observed_amount_taka, 0) + coalesce(p_amount_taka, 0);

  -- Paid enough for the pack on a master-resume row: sell the pack (036).
  if v_purchase.credits_granted = 0 and v_total >= 199 then
    update public.purchases
      set credits_granted = 5, amount_taka = 199
      where id = p_purchase_id;
    v_purchase.credits_granted := 5;
    v_purchase.amount_taka := 199;
    v_upgraded := true;
  end if;

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
              || case when v_upgraded then ' upgraded master-resume→five-pack' else '' end
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

revoke all on function public.apply_purchase_topup(uuid, text, text, integer, text, text) from public, anon, authenticated;
grant execute on function public.apply_purchase_topup(uuid, text, text, integer, text, text) to service_role;

-- ─── Backfill: completed master-resume purchases that already paid for the pack ──

do $$
declare
  r         record;
  v_balance integer;
begin
  for r in
    select id, user_id, amount_taka, observed_amount_taka
    from public.purchases
    where status = 'completed'
      and credits_granted = 0
      and not is_test
      and observed_amount_taka >= 199
    for update
  loop
    update public.purchases
      set credits_granted = 5, amount_taka = 199
      where id = r.id;

    -- log_credit_change reads this into credit_ledger.reason.
    perform set_config('app.credit_reason', 'pack_upgrade_backfill', true);
    update public.profiles
      set toolkit_credits = toolkit_credits + 5
      where id = r.user_id
      returning toolkit_credits into v_balance;
    perform set_config('app.credit_reason', '', true);

    -- The surplus was measured against the master-resume price; re-measure it
    -- against the pack. Nothing left over → no overpayment to resolve.
    if r.observed_amount_taka > 199 then
      update public.purchase_overpayments
        set surplus_taka = r.observed_amount_taka - 199
        where purchase_id = r.id and resolution = 'pending';
    else
      delete from public.purchase_overpayments
        where purchase_id = r.id and resolution = 'pending';
    end if;

    insert into public.admin_audit_log (actor, action, target_kind, target_id, before_state, after_state, reason)
      values ('migration-036', 'pack_upgrade_backfill', 'purchase', r.id,
              jsonb_build_object('package', 'master-resume', 'amount_taka', r.amount_taka, 'credits_granted', 0),
              jsonb_build_object('package', 'five-pack', 'amount_taka', 199, 'credits_granted', 5, 'new_balance', v_balance),
              format('Paid ৳%s, which covers the ৳199 pack; settled as the pack.', r.observed_amount_taka));
  end loop;
end;
$$;
