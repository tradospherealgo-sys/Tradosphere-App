-- ============================================================================
-- Account erasure (migration 0017).
--
-- Two properties that pull in opposite directions, which is why both are
-- asserted here:
--   1. deleting a user removes their ledger rows, so closing an account and
--      honouring an erasure request actually work;
--   2. a signed-in user still cannot delete their own trades to tidy up a
--      losing record.
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

-- ----------------------------------------------------------------------------
-- A live user cannot delete their own ledger rows.
--
-- Runs first, and in its own transaction: the trading call below sets the
-- trusted-write flag transaction-locally, so a direct-write check sharing its
-- transaction would sail straight through the guard and prove nothing.
-- ----------------------------------------------------------------------------
do $$
declare
  v_user uuid;
  v_caught boolean := false;
begin
  -- Non-'email' provider tag skips the invite-code gate in handle_new_user(),
  -- same mechanism OAuth signups use — see 10_order_lifecycle.sql.
  insert into auth.users(email, raw_app_meta_data) values ('erasure@test.invalid', '{"provider":"test"}') returning id into v_user;

  set local role authenticated;
  perform set_config('request.jwt.claims',
                     json_build_object('sub', v_user, 'role', 'authenticated')::text, false);

  perform public.place_paper_order(
    p_symbol => 'RELIANCE', p_side => 'BUY', p_quantity => 1,
    p_variety => 'MARKET', p_product => 'MIS', p_price => 100,
    p_quote_source => 'test_fixture', p_quote_as_of => now()
  );

  perform pg_temp.assert(
    exists (select 1 from public.orders where user_id = v_user),
    'the fixture order was booked');

  reset role;
end;
$$;

do $$
declare
  v_user uuid;
  v_caught boolean := false;
begin
  select id into v_user from auth.users where email = 'erasure@test.invalid';

  set local role authenticated;
  perform set_config('request.jwt.claims',
                     json_build_object('sub', v_user, 'role', 'authenticated')::text, false);

  begin
    delete from public.orders where user_id = v_user;
  exception when others then v_caught := true; end;

  perform pg_temp.assert(v_caught,
    'a user whose profile still exists cannot delete their own orders');

  reset role;
  raise notice 'erasure: the ledger guard still holds for a live user';
end;
$$;

-- ----------------------------------------------------------------------------
-- Deleting the user cascades through the ledger.
--
-- Runs as the table owner, which is what the auth service does when GoTrue
-- deletes a row from auth.users.
-- ----------------------------------------------------------------------------
do $$
declare
  v_user uuid;
  v_count int;
begin
  select id into v_user from auth.users where email = 'erasure@test.invalid';

  perform pg_temp.assert(
    exists (select 1 from public.orders where user_id = v_user),
    'there is still something to erase');

  delete from auth.users where id = v_user;

  select count(*) into v_count from public.profiles where id = v_user;
  perform pg_temp.assert(v_count = 0, 'the profile is gone');

  select count(*) into v_count from public.orders where user_id = v_user;
  perform pg_temp.assert(v_count = 0, 'and the orders with it');

  select count(*) into v_count from public.trades where user_id = v_user;
  perform pg_temp.assert(v_count = 0, 'and the trades');

  select count(*) into v_count from public.positions where user_id = v_user;
  perform pg_temp.assert(v_count = 0, 'and the positions');

  select count(*) into v_count from public.paper_accounts where user_id = v_user;
  perform pg_temp.assert(v_count = 0, 'and the paper account');

  raise notice 'erasure: deleting a user clears their ledger';
end;
$$;
