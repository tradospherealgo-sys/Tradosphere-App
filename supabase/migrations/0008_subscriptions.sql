-- ============================================================================
-- SUBSCRIPTIONS + ENTITLEMENTS
--
-- Access control for the paid surfaces. Deliberately gateway-agnostic: this
-- migration models plans, subscription periods and entitlements, and records
-- payment *attempts* — it never marks a payment succeeded on its own. A real
-- gateway (Razorpay / Stripe / PayU) is wired in later by having its verified
-- webhook call `record_payment_success`, which is the only path that can
-- move a subscription to 'active' with source 'payment_gateway'.
--
-- Until then the sanctioned way to give someone access is an explicit admin
-- grant, which is recorded as such (source = 'admin_grant') so paid and
-- comped access are never confused with each other in reporting.
-- ============================================================================

do $$ begin
  create type public.billing_interval as enum ('monthly', 'quarterly', 'yearly');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.subscription_status as enum (
    'trialing', 'active', 'past_due', 'expired', 'cancelled'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.payment_status as enum ('pending', 'succeeded', 'failed', 'refunded');
exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------------------------
-- plans
-- ----------------------------------------------------------------------------
create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text,
  billing_interval public.billing_interval not null,
  -- Stored in the smallest currency unit (paise) as an integer. Never a float:
  -- money and binary floating point do not mix.
  price_minor integer not null check (price_minor >= 0),
  currency text not null default 'INR',
  -- Entitlement keys this plan grants, e.g. ["signals","option_chain"].
  entitlements jsonb not null default '[]'::jsonb,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- subscriptions — one active row per user at a time (partial unique index)
-- ----------------------------------------------------------------------------
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  plan_id uuid not null references public.plans(id) on delete restrict,
  status public.subscription_status not null default 'active',
  started_at timestamptz not null default now(),
  current_period_start timestamptz not null default now(),
  current_period_end timestamptz not null,
  cancelled_at timestamptz,
  -- How this subscription came to exist. 'admin_grant' is a comp; only a
  -- verified gateway webhook may write 'payment_gateway'.
  source text not null default 'admin_grant'
    check (source in ('admin_grant', 'payment_gateway')),
  external_ref text,
  granted_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subscriptions_period_ordered check (current_period_end > current_period_start)
);

create unique index if not exists subscriptions_one_live_per_user
  on public.subscriptions(user_id)
  where status in ('trialing', 'active', 'past_due');

create index if not exists subscriptions_expiry_idx
  on public.subscriptions(status, current_period_end);

-- ----------------------------------------------------------------------------
-- payments — an attempt log. Rows start 'pending'.
-- ----------------------------------------------------------------------------
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  plan_id uuid not null references public.plans(id) on delete restrict,
  subscription_id uuid references public.subscriptions(id) on delete set null,
  amount_minor integer not null check (amount_minor >= 0),
  currency text not null default 'INR',
  status public.payment_status not null default 'pending',
  gateway text,
  gateway_ref text,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists payments_user_idx on public.payments(user_id, created_at desc);

do $$
declare t text;
begin
  foreach t in array array['plans', 'subscriptions', 'payments']
  loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format('create trigger set_updated_at before update on public.%I
                      for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- Entitlement resolution
--
-- `is_subscription_live` deliberately re-checks the period end against now()
-- rather than trusting `status` alone, so an expiry that no scheduled job has
-- swept yet still reads as expired everywhere in the app.
-- ----------------------------------------------------------------------------
create or replace function public.current_entitlements()
returns jsonb
language sql
security definer set search_path = public
stable
as $$
  select coalesce(
    (
      select p.entitlements
      from public.subscriptions s
      join public.plans p on p.id = s.plan_id
      where s.user_id = auth.uid()
        and s.status in ('trialing', 'active')
        and s.current_period_end > now()
      order by s.current_period_end desc
      limit 1
    ),
    '[]'::jsonb
  );
$$;

grant execute on function public.current_entitlements() to authenticated;

create or replace function public.has_entitlement(p_key text)
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select public.is_admin() or (public.current_entitlements() ? p_key);
$$;

grant execute on function public.has_entitlement(text) to authenticated;

-- Sweeps subscriptions whose period has elapsed. Idempotent; intended to run
-- from a scheduled job (pg_cron or an external scheduler hitting the app).
create or replace function public.expire_lapsed_subscriptions()
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  v_count integer;
begin
  with expired as (
    update public.subscriptions
      set status = 'expired', updated_at = now()
      where status in ('trialing', 'active', 'past_due')
        and current_period_end <= now()
      returning user_id, plan_id
  )
  insert into public.notifications(user_id, kind, title, body)
  select user_id, 'system', 'Your subscription has expired',
         'Renew to restore access to signals, the option chain and premium courses.'
  from expired;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.expire_lapsed_subscriptions() from public, anon, authenticated;
grant execute on function public.expire_lapsed_subscriptions() to service_role;

-- ----------------------------------------------------------------------------
-- Admin grant / revoke
-- ----------------------------------------------------------------------------
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
    when 'monthly'   then interval '1 month'
    when 'quarterly' then interval '3 months'
    when 'yearly'    then interval '1 year'
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

grant execute on function public.admin_grant_subscription(uuid, uuid) to authenticated;

create or replace function public.admin_cancel_subscription(p_subscription_id uuid)
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
    set status = 'cancelled', cancelled_at = now(), updated_at = now()
    where id = p_subscription_id
    returning * into v_sub;

  if not found then
    raise exception 'Subscription not found.';
  end if;

  insert into public.audit_logs(actor_id, action, target_table, target_id, metadata)
  values (v_actor, 'subscription.cancel', 'subscriptions', p_subscription_id::text, '{}'::jsonb);

  return v_sub;
end;
$$;

grant execute on function public.admin_cancel_subscription(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Gateway hook. Service-role only: it must be called from a webhook handler
-- that has already verified the gateway's signature. There is no client path
-- to this function, so a user cannot self-activate a plan.
-- ----------------------------------------------------------------------------
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
    when 'monthly'   then interval '1 month'
    when 'quarterly' then interval '3 months'
    when 'yearly'    then interval '1 year'
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

revoke all on function public.record_payment_success(uuid, text, text) from public, anon, authenticated;
grant execute on function public.record_payment_success(uuid, text, text) to service_role;

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------
alter table public.plans         enable row level security;
alter table public.subscriptions enable row level security;
alter table public.payments      enable row level security;

drop policy if exists plans_read_active on public.plans;
create policy plans_read_active on public.plans
  for select using (is_active or is_admin());

drop policy if exists plans_admin_write on public.plans;
create policy plans_admin_write on public.plans
  for all using (is_admin()) with check (is_admin());

drop policy if exists subscriptions_read_own on public.subscriptions;
create policy subscriptions_read_own on public.subscriptions
  for select using (is_self(user_id) or is_admin());

-- No client INSERT/UPDATE policy: subscriptions are created only by the
-- SECURITY DEFINER functions above.
revoke insert, update, delete on public.subscriptions from anon, authenticated;

drop policy if exists payments_read_own on public.payments;
create policy payments_read_own on public.payments
  for select using (is_self(user_id) or is_admin());

revoke insert, update, delete on public.payments from anon, authenticated;
