-- ============================================================================
-- CHECKOUT INTENT
--
-- `payments` has INSERT revoked from authenticated (migration 0008), which is
-- deliberate: a client that can write payment rows can write the amount too.
-- This function is the only client-reachable way to open a payment, and it
-- takes the amount from the `plans` row rather than from the caller, so the
-- price is not a client-supplied value.
--
-- It grants nothing. The row is created 'pending'; only `record_payment_success`
-- (service-role only, called from a signature-verified gateway webhook) can
-- turn a pending payment into an active subscription.
-- ============================================================================

create or replace function public.start_checkout(p_plan_id uuid)
returns public.payments
language plpgsql
security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_plan public.plans%rowtype;
  v_payment public.payments%rowtype;
begin
  if v_user is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  select * into v_plan from public.plans where id = p_plan_id and is_active;
  if not found then
    raise exception 'Plan not found or inactive.';
  end if;

  -- Reuse an open intent for the same plan instead of littering the ledger
  -- with a new pending row on every page refresh.
  select * into v_payment
    from public.payments
    where user_id = v_user
      and plan_id = p_plan_id
      and status = 'pending'
      and created_at > now() - interval '1 hour'
    order by created_at desc
    limit 1;

  if found then
    return v_payment;
  end if;

  insert into public.payments(user_id, plan_id, amount_minor, currency, status)
  values (v_user, p_plan_id, v_plan.price_minor, v_plan.currency, 'pending')
  returning * into v_payment;

  return v_payment;
end;
$$;

revoke all on function public.start_checkout(uuid) from public, anon;
grant execute on function public.start_checkout(uuid) to authenticated;
