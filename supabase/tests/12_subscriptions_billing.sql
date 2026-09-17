-- ============================================================================
-- Subscriptions / billing tests (migration 0008).
--
-- No automated coverage existed for this path before this file: subscriptions
-- and payments are financial-sensitive (entitlement grants, payment records)
-- and every write goes through a SECURITY DEFINER function by design, so RLS
-- alone can't be trusted to hold without a test proving it.
--
-- What this is actually protecting:
--   - a user can read only their own subscriptions/payments, never anyone else's
--   - a non-admin cannot insert/update subscriptions or payments directly,
--     bypassing the RPCs entirely
--   - a non-admin cannot call admin_grant_subscription / admin_cancel_subscription
--   - record_payment_success is unreachable from the client roles (anon/authenticated)
--   - admin_grant_subscription supersedes a user's prior live subscription so the
--     "one live subscription per user" partial unique index never trips
-- ============================================================================

\set ON_ERROR_STOP on

create or replace function pg_temp.assert(p_condition boolean, p_message text)
returns void language plpgsql as $$
begin
  if not coalesce(p_condition, false) then
    raise exception 'ASSERTION FAILED: %', p_message;
  end if;
end;
$$;

create or replace function pg_temp.assert_eq(p_actual anyelement, p_expected anyelement, p_message text)
returns void language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'ASSERTION FAILED: % (expected %, got %)', p_message, p_expected, p_actual;
  end if;
end;
$$;

create or replace function pg_temp.become(p_uid uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
                     json_build_object('sub', p_uid, 'role', 'authenticated')::text,
                     false);
end;
$$;

do $$
declare
  v_alice uuid;
  v_bob uuid;
  v_admin uuid;
  v_plan_a uuid;
  v_plan_b uuid;
  v_sub public.subscriptions%rowtype;
  v_sub2 public.subscriptions%rowtype;
  v_payment_id uuid;
  v_count int;
  v_caught boolean;
begin
  -- --------------------------------------------------------------------------
  -- Fixtures.
  -- --------------------------------------------------------------------------
  -- Non-'email' provider tag skips the invite-code gate in handle_new_user(),
  -- same mechanism OAuth signups use — see 10_order_lifecycle.sql.
  insert into auth.users(email, raw_app_meta_data) values ('sub-alice@test.invalid', '{"provider":"test"}') returning id into v_alice;
  insert into auth.users(email, raw_app_meta_data) values ('sub-bob@test.invalid', '{"provider":"test"}') returning id into v_bob;
  insert into auth.users(email, raw_app_meta_data) values ('sub-admin@test.invalid', '{"provider":"test"}') returning id into v_admin;

  -- prevent_role_self_escalation reads auth.role() (the jwt claim), which
  -- PostgREST only sets to 'service_role' when the service-role key is used,
  -- alongside the actual Postgres role. Match both, as the real
  -- bootstrap-admin.mjs script does.
  set local role service_role;
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, false);
  update public.profiles set role = 'admin' where id = v_admin;

  -- service_role bypasses RLS outright, so plan fixtures are seeded here
  -- rather than needing an admin identity for plans_admin_write.
  insert into public.plans(slug, name, billing_interval, price_minor, entitlements)
    values ('pro-monthly-test', 'Pro Monthly (test)', 'monthly', 99900, '["signals","option_chain"]'::jsonb)
    returning id into v_plan_a;
  insert into public.plans(slug, name, billing_interval, price_minor, entitlements)
    values ('pro-yearly-test', 'Pro Yearly (test)', 'yearly', 999900, '["signals","option_chain"]'::jsonb)
    returning id into v_plan_b;

  set local role authenticated;

  -- ==========================================================================
  -- 1. A non-admin cannot grant or cancel subscriptions.
  -- ==========================================================================
  perform pg_temp.become(v_alice);

  v_caught := false;
  begin
    perform public.admin_grant_subscription(v_alice, v_plan_a);
  exception when others then
    v_caught := true;
    perform pg_temp.assert(sqlerrm = 'Admin privileges are required.',
      'admin_grant_subscription rejects a non-admin with the expected message');
  end;
  perform pg_temp.assert(v_caught, 'a non-admin cannot call admin_grant_subscription');

  v_caught := false;
  begin
    perform public.admin_cancel_subscription(gen_random_uuid());
  exception when others then
    v_caught := true;
  end;
  perform pg_temp.assert(v_caught, 'a non-admin cannot call admin_cancel_subscription');

  -- ==========================================================================
  -- 2. A non-admin cannot write subscriptions/payments directly, bypassing
  --    the RPCs. RLS revokes insert/update/delete outright for these tables.
  -- ==========================================================================
  v_caught := false;
  begin
    insert into public.subscriptions(user_id, plan_id, current_period_end)
      values (v_alice, v_plan_a, now() + interval '30 days');
  exception when others then
    v_caught := true;
  end;
  perform pg_temp.assert(v_caught, 'a client cannot insert into subscriptions directly');

  v_caught := false;
  begin
    insert into public.payments(user_id, plan_id, amount_minor)
      values (v_alice, v_plan_a, 99900);
  exception when others then
    v_caught := true;
  end;
  perform pg_temp.assert(v_caught, 'a client cannot insert into payments directly');

  -- ==========================================================================
  -- 3. record_payment_success is unreachable from anon/authenticated: only a
  --    verified gateway webhook (running as service_role) may call it.
  -- ==========================================================================
  v_caught := false;
  begin
    perform public.record_payment_success(gen_random_uuid(), 'razorpay', 'pay_test123');
  exception when others then
    v_caught := true;
  end;
  perform pg_temp.assert(v_caught, 'authenticated cannot call record_payment_success');

  set local role anon;
  v_caught := false;
  begin
    perform public.record_payment_success(gen_random_uuid(), 'razorpay', 'pay_test123');
  exception when others then
    v_caught := true;
  end;
  perform pg_temp.assert(v_caught, 'anon cannot call record_payment_success');
  set local role authenticated;

  -- ==========================================================================
  -- 4. Admin grants a subscription to alice. It becomes her one live sub.
  -- ==========================================================================
  perform pg_temp.become(v_admin);
  v_sub := public.admin_grant_subscription(v_alice, v_plan_a);
  perform pg_temp.assert_eq(v_sub.status::text, 'active', 'a fresh grant is active');
  perform pg_temp.assert_eq(v_sub.source, 'admin_grant', 'the grant is recorded as an admin comp');
  perform pg_temp.assert(v_sub.current_period_end > now(), 'the period extends into the future');

  -- Granting again supersedes the first grant instead of violating the
  -- "one live subscription per user" partial unique index.
  v_sub2 := public.admin_grant_subscription(v_alice, v_plan_b);
  perform pg_temp.assert(v_sub2.id != v_sub.id, 'the second grant is a new subscription row');

  select count(*) into v_count from public.subscriptions
    where user_id = v_alice and status in ('trialing', 'active', 'past_due');
  perform pg_temp.assert_eq(v_count, 1, 'only one live subscription exists for alice after re-granting');

  select * into strict v_sub from public.subscriptions where id = v_sub.id;
  perform pg_temp.assert_eq(v_sub.status::text, 'cancelled', 'the superseded grant was cancelled, not deleted');

  -- ==========================================================================
  -- 5. RLS: alice can read her own subscription; bob cannot read alice's.
  -- ==========================================================================
  perform pg_temp.become(v_alice);
  select count(*) into v_count from public.subscriptions where id = v_sub2.id;
  perform pg_temp.assert_eq(v_count, 1, 'alice can read her own subscription');

  perform pg_temp.become(v_bob);
  select count(*) into v_count from public.subscriptions where id = v_sub2.id;
  perform pg_temp.assert_eq(v_count, 0, 'bob cannot read alice''s subscription');

  select count(*) into v_count from public.subscriptions where user_id = v_alice;
  perform pg_temp.assert_eq(v_count, 0,
    'bob cannot read alice''s subscriptions even when filtering by her user_id');

  -- Admin can read anyone's.
  perform pg_temp.become(v_admin);
  select count(*) into v_count from public.subscriptions where user_id = v_alice;
  perform pg_temp.assert(v_count >= 1, 'an admin can read alice''s subscriptions');

  -- ==========================================================================
  -- 6. Entitlements reflect only the live subscription's plan.
  -- ==========================================================================
  perform pg_temp.become(v_alice);
  perform pg_temp.assert(public.has_entitlement('signals'), 'alice has the entitlement her live plan grants');
  perform pg_temp.assert(not public.has_entitlement('nonexistent_key'),
    'alice does not have an entitlement no plan grants');

  perform pg_temp.become(v_bob);
  perform pg_temp.assert(not public.has_entitlement('signals'), 'bob has no subscription and so no entitlements');

  -- ==========================================================================
  -- 6b. Suspend pauses access reversibly; unsuspend restores it. Neither a
  --     non-admin nor a suspend on a non-live subscription is allowed.
  -- ==========================================================================
  perform pg_temp.become(v_alice);
  v_caught := false;
  begin
    perform public.admin_suspend_subscription(v_sub2.id, 'test');
  exception when others then
    v_caught := true;
  end;
  perform pg_temp.assert(v_caught, 'a non-admin cannot call admin_suspend_subscription');

  perform pg_temp.become(v_admin);
  v_sub2 := public.admin_suspend_subscription(v_sub2.id, 'billing dispute under review');
  perform pg_temp.assert_eq(v_sub2.status::text, 'suspended', 'admin_suspend_subscription suspends the subscription');

  perform pg_temp.become(v_alice);
  perform pg_temp.assert(not public.has_entitlement('signals'), 'a suspended subscription grants nothing');

  -- Suspension does not free the "one live subscription" slot: a second
  -- grant attempt must still supersede it, not violate the unique index.
  perform pg_temp.become(v_admin);
  select count(*) into v_count from public.subscriptions
    where user_id = v_alice and status in ('trialing', 'active', 'past_due', 'suspended');
  perform pg_temp.assert_eq(v_count, 1, 'a suspended subscription still occupies the one-live-per-user slot');

  v_caught := false;
  begin
    perform public.admin_suspend_subscription(v_sub2.id, 'already suspended');
  exception when others then
    v_caught := true;
  end;
  perform pg_temp.assert(v_caught, 'suspending an already-suspended subscription is rejected');

  v_sub2 := public.admin_unsuspend_subscription(v_sub2.id);
  perform pg_temp.assert_eq(v_sub2.status::text, 'active', 'admin_unsuspend_subscription restores active status');

  perform pg_temp.become(v_alice);
  perform pg_temp.assert(public.has_entitlement('signals'), 'access is restored after unsuspend');

  -- ==========================================================================
  -- 7. Admin cancels alice's subscription; her entitlement disappears.
  -- ==========================================================================
  perform pg_temp.become(v_admin);
  v_sub := public.admin_cancel_subscription(v_sub2.id);
  perform pg_temp.assert_eq(v_sub.status::text, 'cancelled', 'admin_cancel_subscription cancels the subscription');

  perform pg_temp.become(v_alice);
  perform pg_temp.assert(not public.has_entitlement('signals'), 'a cancelled subscription grants nothing');

  -- ==========================================================================
  -- 8. payments RLS mirrors subscriptions: a user's own row is readable, a
  --    stranger's is not, an admin can read anyone's, and no client can
  --    write. The payment row itself is created here directly as fixture
  --    data under service_role, mirroring how a checkout flow would insert
  --    a 'pending' row server-side before the gateway redirect.
  -- ==========================================================================
  set local role service_role;
  insert into public.payments(user_id, plan_id, amount_minor, status)
    values (v_alice, v_plan_a, 99900, 'pending')
    returning id into v_payment_id;
  set local role authenticated;

  perform pg_temp.become(v_alice);
  select count(*) into v_count from public.payments where id = v_payment_id;
  perform pg_temp.assert_eq(v_count, 1, 'alice can read her own payment');

  perform pg_temp.become(v_bob);
  select count(*) into v_count from public.payments where id = v_payment_id;
  perform pg_temp.assert_eq(v_count, 0, 'bob cannot read alice''s payment');

  perform pg_temp.become(v_admin);
  select count(*) into v_count from public.payments where id = v_payment_id;
  perform pg_temp.assert_eq(v_count, 1, 'an admin can read alice''s payment');

  raise notice 'subscriptions/billing tests passed';
end $$;
