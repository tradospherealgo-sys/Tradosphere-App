-- ============================================================================
-- SUBSCRIPTION SUSPENSION (2/2): index + RPCs
--
-- Split from 0020 because Postgres forbids referencing a value added via
-- ALTER TYPE ... ADD VALUE within the same transaction/file (SQLSTATE
-- 55P04). The enum value must be committed first.
-- ============================================================================

-- A suspended subscription still occupies the user's "one live subscription"
-- slot (it is not cancelled, just paused), so it must be included in the
-- partial unique index alongside the other live statuses.
drop index if exists public.subscriptions_one_live_per_user;
create unique index subscriptions_one_live_per_user
  on public.subscriptions(user_id)
  where status in ('trialing', 'active', 'past_due', 'suspended');

create or replace function public.admin_suspend_subscription(
  p_subscription_id uuid,
  p_reason text default null
)
returns public.subscriptions
language plpgsql
security definer set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_sub public.subscriptions%rowtype;
begin
  if not public.is_admin() then
    raise exception 'Admin privileges are required.' using errcode = '42501';
  end if;

  update public.subscriptions
    set status = 'suspended', updated_at = now()
    where id = p_subscription_id
      and status in ('trialing', 'active', 'past_due')
    returning * into v_sub;

  if not found then
    raise exception 'Subscription not found or not currently live.';
  end if;

  insert into public.audit_logs(actor_id, action, target_table, target_id, metadata)
  values (v_actor, 'subscription.suspend', 'subscriptions', p_subscription_id::text,
          jsonb_build_object('reason', p_reason));

  insert into public.notifications(user_id, kind, title, body)
  values (v_sub.user_id, 'system', 'Your access has been suspended',
          coalesce(p_reason, 'Contact support for details.'));

  return v_sub;
end;
$$;

grant execute on function public.admin_suspend_subscription(uuid, text) to authenticated;

-- Reinstates a suspended subscription to 'active', provided its original
-- period has not since lapsed (a suspension does not extend the period —
-- reinstating an already-expired period would fabricate access).
create or replace function public.admin_unsuspend_subscription(p_subscription_id uuid)
returns public.subscriptions
language plpgsql
security definer set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_sub public.subscriptions%rowtype;
begin
  if not public.is_admin() then
    raise exception 'Admin privileges are required.' using errcode = '42501';
  end if;

  select * into v_sub from public.subscriptions
    where id = p_subscription_id and status = 'suspended';
  if not found then
    raise exception 'Subscription not found or not suspended.';
  end if;

  if v_sub.current_period_end <= now() then
    raise exception 'This subscription''s billing period has already lapsed; grant a new one instead of unsuspending.';
  end if;

  update public.subscriptions
    set status = 'active', updated_at = now()
    where id = p_subscription_id
    returning * into v_sub;

  insert into public.audit_logs(actor_id, action, target_table, target_id, metadata)
  values (v_actor, 'subscription.unsuspend', 'subscriptions', p_subscription_id::text, '{}'::jsonb);

  insert into public.notifications(user_id, kind, title, body)
  values (v_sub.user_id, 'system', 'Your access has been restored',
          'Your subscription is active again.');

  return v_sub;
end;
$$;

grant execute on function public.admin_unsuspend_subscription(uuid) to authenticated;
