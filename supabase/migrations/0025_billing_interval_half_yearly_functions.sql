-- ============================================================================
-- Teach the two subscription-period functions about 'half_yearly'.
--
-- Separate migration from 0024 on purpose: the new enum label cannot be
-- referenced in the same transaction that created it.
-- ============================================================================

create or replace function public.admin_grant_subscription(
  p_user_id uuid,
  p_plan_id uuid
)
returns public.subscriptions
language plpgsql
security definer set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_plan public.plans%rowtype;
  v_sub public.subscriptions%rowtype;
  v_end timestamptz;
begin
  if not public.is_admin() then
    raise exception 'Admin privileges are required.' using errcode = '42501';
  end if;

  select * into v_plan from public.plans where id = p_plan_id and is_active;
  if not found then
    raise exception 'Plan not found or inactive.';
  end if;

  v_end := now() + case v_plan.billing_interval
    when 'monthly'     then interval '1 month'
    when 'quarterly'   then interval '3 months'
    when 'half_yearly' then interval '6 months'
    when 'yearly'      then interval '1 year'
  end;

  -- Supersede any live subscription so the partial unique index holds.
  update public.subscriptions
    set status = 'cancelled', cancelled_at = now(), updated_at = now()
    where user_id = p_user_id and status in ('trialing', 'active', 'past_due');

  insert into public.subscriptions(
    user_id, plan_id, status, current_period_start, current_period_end,
    source, granted_by
  )
  values (p_user_id, p_plan_id, 'active', now(), v_end, 'admin_grant', v_actor)
  returning * into v_sub;

  insert into public.audit_logs(actor_id, action, target_table, target_id, metadata)
  values (v_actor, 'subscription.grant', 'subscriptions', v_sub.id::text,
          jsonb_build_object('user_id', p_user_id, 'plan', v_plan.slug, 'ends', v_end));

  insert into public.notifications(user_id, kind, title, body)
  values (p_user_id, 'system', format('%s plan activated', v_plan.name),
          format('Access runs until %s.', to_char(v_end, 'DD Mon YYYY')));

  return v_sub;
end;
$$;

create or replace function public.record_payment_success(
  p_payment_id uuid,
  p_gateway text,
  p_gateway_ref text
)
returns public.subscriptions
language plpgsql
security definer set search_path = public
as $$
declare
  v_payment public.payments%rowtype;
  v_plan public.plans%rowtype;
  v_sub public.subscriptions%rowtype;
  v_end timestamptz;
begin
  select * into v_payment from public.payments where id = p_payment_id for update;
  if not found then
    raise exception 'Payment not found.';
  end if;
  if v_payment.status = 'succeeded' then
    -- Gateways retry webhooks; make this idempotent rather than double-crediting.
    select * into v_sub from public.subscriptions where id = v_payment.subscription_id;
    return v_sub;
  end if;

  select * into v_plan from public.plans where id = v_payment.plan_id;

  v_end := now() + case v_plan.billing_interval
    when 'monthly'     then interval '1 month'
    when 'quarterly'   then interval '3 months'
    when 'half_yearly' then interval '6 months'
    when 'yearly'      then interval '1 year'
  end;

  update public.subscriptions
    set status = 'cancelled', cancelled_at = now(), updated_at = now()
    where user_id = v_payment.user_id and status in ('trialing', 'active', 'past_due');

  insert into public.subscriptions(
    user_id, plan_id, status, current_period_start, current_period_end,
    source, external_ref
  )
  values (v_payment.user_id, v_payment.plan_id, 'active', now(), v_end,
          'payment_gateway', p_gateway_ref)
  returning * into v_sub;

  update public.payments
    set status = 'succeeded', gateway = p_gateway, gateway_ref = p_gateway_ref,
        subscription_id = v_sub.id, updated_at = now()
    where id = p_payment_id;

  insert into public.notifications(user_id, kind, title, body)
  values (v_payment.user_id, 'system', format('%s plan activated', v_plan.name),
          format('Payment received. Access runs until %s.', to_char(v_end, 'DD Mon YYYY')));

  return v_sub;
end;
$$;
