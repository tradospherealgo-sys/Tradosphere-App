-- ============================================================================
-- Order-lifecycle engine tests (migration 0016).
--
-- Runs as the `authenticated` role with a real session identity, so every RPC
-- is exercised through the same door a browser uses. Assertions are plain
-- `raise exception` — a failure aborts the script and fails verify-db.sh.
--
-- What this is actually protecting:
--   - money cannot be created or destroyed by the order path
--   - a resting order cannot be filled at a price the market never printed
--   - buying power cannot be committed twice
--   - one user cannot touch another user's orders
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

create or replace function pg_temp.assert_eq(p_actual numeric, p_expected numeric, p_message text)
returns void language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'ASSERTION FAILED: % (expected %, got %)', p_message, p_expected, p_actual;
  end if;
end;
$$;

/** Adopts a user's identity for subsequent statements, as PostgREST does. */
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
  v_order public.orders%rowtype;
  v_account public.paper_accounts%rowtype;
  v_position public.positions%rowtype;
  v_trade public.trades%rowtype;
  v_charges record;
  v_start numeric;
  v_count int;
  v_caught boolean;
begin
  -- --------------------------------------------------------------------------
  -- Fixtures. The handle_new_user trigger opens a paper account per user.
  -- --------------------------------------------------------------------------
  insert into auth.users(email) values ('alice@test.invalid') returning id into v_alice;
  insert into auth.users(email) values ('bob@test.invalid') returning id into v_bob;

  set local role authenticated;
  perform pg_temp.become(v_alice);

  select * into v_account from public.paper_accounts where user_id = v_alice;
  perform pg_temp.assert(v_account.id is not null, 'alice has a paper account');
  v_start := v_account.cash_balance;
  perform pg_temp.assert_eq(v_account.reserved_cash, 0, 'a new account reserves nothing');

  -- ==========================================================================
  -- 1. A market order fills immediately, at the quoted price, net of charges
  --    the database computed for itself.
  -- ==========================================================================
  v_order := public.place_paper_order(
    p_symbol => 'RELIANCE', p_side => 'BUY', p_quantity => 10,
    p_variety => 'MARKET', p_product => 'MIS', p_price => 100,
    p_quote_source => 'test_fixture', p_quote_as_of => now()
  );

  perform pg_temp.assert(v_order.status = 'FILLED', 'a market order fills on arrival');
  perform pg_temp.assert_eq(v_order.avg_fill_price, 100, 'it fills at the quoted price');
  perform pg_temp.assert_eq(v_order.filled_quantity, 10, 'the whole order fills');
  perform pg_temp.assert(v_order.total_charges > 0, 'charges were levied');
  perform pg_temp.assert_eq(v_order.reserved_cash, 0, 'a filled order holds no reservation');

  select * into v_charges
    from public.calc_trade_charges('BUY', 'MIS', 1000);
  perform pg_temp.assert_eq(v_order.total_charges, v_charges.total_charges,
    'the order records exactly what calc_trade_charges says');

  select * into v_account from public.paper_accounts where user_id = v_alice;
  perform pg_temp.assert_eq(v_account.cash_balance, v_start - 1000 - v_charges.total_charges,
    'cash falls by notional plus charges, and by nothing else');
  perform pg_temp.assert_eq(v_account.reserved_cash, 0, 'nothing stays reserved after a fill');

  select * into v_position from public.positions where user_id = v_alice and symbol = 'RELIANCE';
  perform pg_temp.assert_eq(v_position.quantity, 10, 'the position carries the filled quantity');
  perform pg_temp.assert_eq(v_position.avg_price, 100, 'at the filled price');
  perform pg_temp.assert_eq(v_position.entry_charges, v_charges.total_charges,
    'the position remembers what it cost to open');

  -- ==========================================================================
  -- 2. A resting limit order reserves buying power but books nothing.
  -- ==========================================================================
  v_start := v_account.cash_balance;

  v_order := public.place_paper_order(
    p_symbol => 'TCS', p_side => 'BUY', p_quantity => 5,
    p_variety => 'LIMIT', p_product => 'CNC', p_price => 200, p_limit_price => 150
  );

  perform pg_temp.assert(v_order.status = 'PENDING',
    'a buy limit below the market rests rather than filling');
  perform pg_temp.assert(v_order.price is null, 'a resting order has no traded price');
  perform pg_temp.assert_eq(v_order.reserved_cash, 750, 'it reserves quantity x limit');

  select * into v_account from public.paper_accounts where user_id = v_alice;
  perform pg_temp.assert_eq(v_account.cash_balance, v_start,
    'resting an order moves no cash');
  perform pg_temp.assert_eq(v_account.reserved_cash, 750,
    'but it does commit buying power');

  -- ==========================================================================
  -- 3. A resting order cannot be filled at a price its own terms reject.
  --    The call is a no-op rather than an error (a matching pass racing the
  --    market is expected to miss), so the proof is that nothing changed.
  -- ==========================================================================
  v_order := public.execute_pending_order(v_order.id, 175, 'test_fixture', now());
  perform pg_temp.assert(v_order.status = 'PENDING',
    'filling a 150 limit buy at 175 does nothing — the market never printed a qualifying price');
  perform pg_temp.assert(v_order.avg_fill_price is null, 'and books no fill price');

  select count(*) into v_count from public.trades where user_id = v_alice and symbol = 'TCS';
  perform pg_temp.assert_eq(v_count, 0, 'and writes no trade');

  select * into v_account from public.paper_accounts where user_id = v_alice;
  perform pg_temp.assert_eq(v_account.cash_balance, v_start, 'and moves no cash');

  -- ==========================================================================
  -- 4. Modifying a resting order re-reserves against the new terms.
  -- ==========================================================================
  v_order := public.modify_paper_order(v_order.id, p_quantity => 10, p_limit_price => 140);
  perform pg_temp.assert_eq(v_order.quantity, 10, 'the modification took');
  perform pg_temp.assert_eq(v_order.limit_price, 140, 'including the new limit');
  perform pg_temp.assert_eq(v_order.reserved_cash, 1400, 'and the reservation was recomputed');

  select * into v_account from public.paper_accounts where user_id = v_alice;
  perform pg_temp.assert_eq(v_account.reserved_cash, 1400,
    'the account holds the new reservation, not the sum of both');

  -- ==========================================================================
  -- 5. Cancelling releases the reservation exactly.
  -- ==========================================================================
  v_order := public.cancel_paper_order(v_order.id);
  perform pg_temp.assert(v_order.status = 'CANCELLED', 'the order is cancelled');
  perform pg_temp.assert(v_order.cancelled_at is not null, 'and stamped');

  select * into v_account from public.paper_accounts where user_id = v_alice;
  perform pg_temp.assert_eq(v_account.reserved_cash, 0, 'the reservation is fully released');
  perform pg_temp.assert_eq(v_account.cash_balance, v_start, 'and no cash moved');

  -- ==========================================================================
  -- 6. A resting order fills when a real quote satisfies it, at that quote.
  -- ==========================================================================
  v_order := public.place_paper_order(
    p_symbol => 'INFY', p_side => 'BUY', p_quantity => 4,
    p_variety => 'LIMIT', p_product => 'MIS', p_price => 300, p_limit_price => 250
  );
  perform pg_temp.assert(v_order.status = 'PENDING', 'it rests at first');

  v_order := public.execute_pending_order(v_order.id, 240, 'test_fixture', now());
  perform pg_temp.assert(v_order.status = 'FILLED', 'a qualifying price fills it');
  perform pg_temp.assert_eq(v_order.avg_fill_price, 240,
    'at the observed price, not at the limit — a limit is a cap, not a promise');

  -- ==========================================================================
  -- 7. Buying power cannot be committed twice.
  -- ==========================================================================
  select * into v_account from public.paper_accounts where user_id = v_alice;

  v_order := public.place_paper_order(
    p_symbol => 'WIPRO', p_side => 'BUY',
    p_quantity => floor(v_account.cash_balance / 100),
    p_variety => 'LIMIT', p_product => 'MIS',
    p_price => 500, p_limit_price => 100
  );
  perform pg_temp.assert(v_order.status = 'PENDING', 'the first order takes the whole balance');

  v_order := public.place_paper_order(
    p_symbol => 'WIPRO', p_side => 'BUY', p_quantity => 1,
    p_variety => 'LIMIT', p_product => 'MIS', p_price => 500, p_limit_price => 100
  );
  perform pg_temp.assert(v_order.status = 'REJECTED',
    'a second order against already-committed cash is rejected');
  perform pg_temp.assert(v_order.reject_reason = 'Insufficient buying power',
    'and says why');

  -- Tidy up so later assertions are not fighting the reservation.
  for v_order in select * from public.orders where user_id = v_alice and status = 'PENDING' loop
    perform public.cancel_paper_order(v_order.id);
  end loop;

  -- ==========================================================================
  -- 8. Closing a position books a trade whose net P&L is gross minus both
  --    legs' charges.
  -- ==========================================================================
  v_order := public.place_paper_order(
    p_symbol => 'RELIANCE', p_side => 'SELL', p_quantity => 10,
    p_variety => 'MARKET', p_product => 'MIS', p_price => 120,
    p_quote_source => 'test_fixture', p_quote_as_of => now()
  );
  perform pg_temp.assert(v_order.status = 'FILLED', 'the closing order fills');

  select * into v_trade from public.trades
    where user_id = v_alice and symbol = 'RELIANCE' order by closed_at desc limit 1;
  perform pg_temp.assert_eq(v_trade.realized_pnl, 200, 'gross P&L is (120 - 100) x 10');
  perform pg_temp.assert_eq(v_trade.total_charges,
    round(v_trade.entry_charges + v_trade.exit_charges, 2),
    'total charges are both legs');
  perform pg_temp.assert_eq(v_trade.net_realized_pnl,
    round(v_trade.realized_pnl - v_trade.total_charges, 2),
    'net P&L is gross less charges');
  perform pg_temp.assert(v_trade.net_realized_pnl < v_trade.realized_pnl,
    'charges made the net strictly worse than the gross');

  select count(*) into v_count from public.positions
    where user_id = v_alice and symbol = 'RELIANCE';
  perform pg_temp.assert_eq(v_count, 0, 'a fully closed position is gone');

  -- ==========================================================================
  -- 9. An SL-M order rests until its trigger and then fills at the market.
  -- ==========================================================================
  v_order := public.place_paper_order(
    p_symbol => 'HDFCBANK', p_side => 'BUY', p_quantity => 2,
    p_variety => 'SL_M', p_product => 'MIS', p_price => 100, p_trigger_price => 110
  );
  perform pg_temp.assert(v_order.status = 'PENDING', 'a buy stop above the market rests');

  v_order := public.execute_pending_order(v_order.id, 112, 'test_fixture', now());
  perform pg_temp.assert(v_order.status = 'FILLED', 'trading through the trigger fills it');
  perform pg_temp.assert_eq(v_order.avg_fill_price, 112, 'at the market, not at the trigger');

  -- ==========================================================================
  -- 10. Validation refuses orders that could never behave sensibly.
  -- ==========================================================================
  v_caught := false;
  begin
    perform public.place_paper_order(
      p_symbol => 'SBIN', p_side => 'BUY', p_quantity => 1,
      p_variety => 'LIMIT', p_product => 'MIS', p_price => 100
    );
  exception when others then v_caught := true; end;
  perform pg_temp.assert(v_caught, 'a limit order without a limit price is refused');

  v_caught := false;
  begin
    perform public.place_paper_order(
      p_symbol => 'SBIN', p_side => 'BUY', p_quantity => 1,
      p_variety => 'MARKET', p_product => 'MIS', p_price => null
    );
  exception when others then v_caught := true; end;
  perform pg_temp.assert(v_caught,
    'a market order with no live price is refused rather than filled at a guess');

  v_caught := false;
  begin
    perform public.place_paper_order(
      p_symbol => 'SBIN', p_side => 'BUY', p_quantity => -5,
      p_variety => 'MARKET', p_product => 'MIS', p_price => 100
    );
  exception when others then v_caught := true; end;
  perform pg_temp.assert(v_caught, 'a negative quantity is refused');

  -- ==========================================================================
  -- 11. Cross-user isolation: Bob cannot see, fill or cancel Alice's order.
  -- ==========================================================================
  v_order := public.place_paper_order(
    p_symbol => 'ITC', p_side => 'BUY', p_quantity => 1,
    p_variety => 'LIMIT', p_product => 'MIS', p_price => 500, p_limit_price => 400
  );
  perform pg_temp.assert(v_order.status = 'PENDING', 'alice has a resting order');

  perform pg_temp.become(v_bob);

  select count(*) into v_count from public.orders where id = v_order.id;
  perform pg_temp.assert_eq(v_count, 0, 'RLS hides the order from bob entirely');

  v_caught := false;
  begin
    perform public.cancel_paper_order(v_order.id);
  exception when others then v_caught := true; end;
  perform pg_temp.assert(v_caught, 'bob cannot cancel it');

  v_caught := false;
  begin
    perform public.execute_pending_order(v_order.id, 390, 'test_fixture', now());
  exception when others then v_caught := true; end;
  perform pg_temp.assert(v_caught, 'bob cannot fill it either');

  perform pg_temp.become(v_alice);
  select status into v_order.status from public.orders where id = v_order.id;
  perform pg_temp.assert(v_order.status = 'PENDING',
    'and alice''s order is exactly as she left it');

  reset role;
  raise notice 'order lifecycle: fill, rest, modify, cancel and isolation passed';
end;
$$;

-- ============================================================================
-- 12. Direct table writes remain impossible — the RPCs are the only door.
--
-- This MUST run in its own transaction. The lockdown works by having the
-- trading functions set `tradosphere.trusted_write` transaction-locally; once
-- any of them has run, the flag stays on for the remainder of that
-- transaction. In production that is exactly right, because PostgREST gives
-- every request its own transaction. But it means a direct-write test sharing
-- a transaction with a successful order would pass through the guard and
-- prove nothing. Being a separate statement, this block gets the clean flag
-- state a real request has.
-- ============================================================================
do $$
declare
  v_alice uuid;
  v_account_id uuid;
  v_caught boolean;
begin
  select id into v_alice from auth.users where email = 'alice@test.invalid';
  select id into v_account_id from public.paper_accounts where user_id = v_alice;

  set local role authenticated;
  perform pg_temp.become(v_alice);

  -- Not `= 'off'`: once any transaction has set this GUC, later transactions
  -- see it reset to the empty string rather than to undefined. The guard is
  -- written as `<> 'on'` for exactly that reason, so the assertion matches it.
  perform pg_temp.assert(
    current_setting('tradosphere.trusted_write', true) is distinct from 'on',
    'this transaction starts untrusted, as a real request does');

  v_caught := false;
  begin
    update public.paper_accounts set cash_balance = 99999999 where user_id = v_alice;
  exception when others then v_caught := true; end;
  perform pg_temp.assert(v_caught, 'a client cannot simply set its own cash balance');

  v_caught := false;
  begin
    insert into public.trades(account_id, user_id, symbol, side, quantity,
                              entry_price, exit_price, realized_pnl, opened_at)
    values (v_account_id, v_alice, 'FAKE', 'BUY', 1, 1, 2, 1, now());
  exception when others then v_caught := true; end;
  perform pg_temp.assert(v_caught, 'nor invent a trade');

  v_caught := false;
  begin
    update public.orders set status = 'FILLED', price = 1 where user_id = v_alice;
  exception when others then v_caught := true; end;
  perform pg_temp.assert(v_caught, 'nor mark its own order filled');

  v_caught := false;
  begin
    insert into public.positions(account_id, user_id, symbol, side, quantity, avg_price)
    values (v_account_id, v_alice, 'FAKE', 'BUY', 1, 1);
  exception when others then v_caught := true; end;
  perform pg_temp.assert(v_caught, 'nor conjure a position');

  reset role;
  raise notice 'order lifecycle: financial lockdown holds';
end;
$$;

-- ============================================================================
-- 13. Resetting restores starting capital and clears every commitment.
-- ============================================================================
do $$
declare
  v_alice uuid;
  v_account public.paper_accounts%rowtype;
  v_count int;
begin
  select id into v_alice from auth.users where email = 'alice@test.invalid';

  set local role authenticated;
  perform pg_temp.become(v_alice);

  select * into v_account from public.reset_paper_account();
  perform pg_temp.assert_eq(v_account.cash_balance, v_account.starting_capital,
    'reset restores exactly the starting capital');
  perform pg_temp.assert_eq(v_account.reserved_cash, 0, 'and releases every reservation');

  select count(*) into v_count from public.orders where user_id = v_alice;
  perform pg_temp.assert_eq(v_count, 0, 'the order book is empty');
  select count(*) into v_count from public.positions where user_id = v_alice;
  perform pg_temp.assert_eq(v_count, 0, 'no positions remain');
  select count(*) into v_count from public.trades where user_id = v_alice;
  perform pg_temp.assert_eq(v_count, 0, 'no trades remain');

  reset role;
  raise notice 'order lifecycle: all assertions passed';
end;
$$;
