-- ============================================================================
-- PAPER-TRADING RPC VALUE VALIDATION
--
-- 0004_financial_lockdown.sql closed the privilege gap: a client cannot write
-- orders/trades/positions/cash_balance directly, only through these
-- SECURITY DEFINER RPCs. What none of place_paper_order, update_position_risk
-- or fill_order_internal have ever checked is whether the *values* a caller
-- supplies make sense. A caller with nothing more than the anon/authenticated
-- key can call these RPCs directly (PostgREST exposes every granted function),
-- so two gaps are closed here without changing any RPC's signature, grants,
-- or the shape of the engine:
--
--   1. place_paper_order / update_position_risk accepted any stop_loss /
--      target_price, including one on the wrong side of the entry (e.g. a
--      BUY with a stop *above* the entry price) or a negative one. Both now
--      require a stop/target, when supplied, to be positive and on the
--      correct side of the order's reference price (place_paper_order) or
--      the position's average price (update_position_risk).
--
--   2. fill_order_internal — the single chokepoint both place_paper_order's
--      immediate-fill path and the client-callable execute_pending_order
--      route through — trusted its caller-supplied p_price completely. A
--      caller could fabricate an unrealistic fill price (e.g. 0.01 for a
--      stock trading near 5000) and manufacture P&L. It now bounds p_price
--      against public.market_data_cache.last_price, the same table the
--      app's own provider fetches already keep current, for the order's
--      symbol. A symbol with no cached quote yet is let through unchanged —
--      this is a plausibility check against data the app already has, not a
--      new price source, and it must never block a fill that would otherwise
--      have worked.
--
-- No RPC signature, grant, or trigger changes. No new tables. Everything
-- else in each function body is byte-for-byte the prior version.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- place_paper_order (v3) — add stop/target sanity relative to the order's
-- own reference price. v_reference is now computed before the account
-- lookup (it previously was not needed until the buying-power check) since
-- the new validation needs it too; its value and the rest of the function
-- are otherwise unchanged.
-- ----------------------------------------------------------------------------
create or replace function public.place_paper_order(
  p_symbol text,
  p_side text,
  p_quantity numeric,
  p_variety text default 'MARKET',
  p_product text default 'MIS',
  p_price numeric default null,
  p_limit_price numeric default null,
  p_trigger_price numeric default null,
  p_instrument_kind text default 'EQUITY',
  p_quote_source text default null,
  p_quote_as_of timestamptz default null,
  p_stop_loss numeric default null,
  p_target_price numeric default null,
  p_signal_id uuid default null,
  p_notes text default null
)
returns public.orders
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_account public.paper_accounts%rowtype;
  v_order public.orders%rowtype;
  v_symbol text := upper(btrim(p_symbol));
  v_reserve numeric := 0;
  v_reference numeric;
  v_available numeric;
begin
  if v_uid is null then
    raise exception 'Not authenticated.' using errcode = '42501';
  end if;
  if v_symbol is null or v_symbol = '' then
    raise exception 'Symbol is required.';
  end if;
  if p_side not in ('BUY', 'SELL') then
    raise exception 'Invalid side: %', p_side;
  end if;
  if p_variety not in ('MARKET', 'LIMIT', 'SL', 'SL_M') then
    raise exception 'Invalid order variety: %', p_variety;
  end if;
  if p_product not in ('CNC', 'MIS') then
    raise exception 'Invalid product: %', p_product;
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Quantity must be positive.';
  end if;

  -- Each variety needs exactly the prices that define it. Accepting a LIMIT
  -- order without a limit would leave an order that can never fill.
  if p_variety in ('LIMIT', 'SL') and (p_limit_price is null or p_limit_price <= 0) then
    raise exception 'A positive limit price is required for a % order.', p_variety;
  end if;
  if p_variety in ('SL', 'SL_M') and (p_trigger_price is null or p_trigger_price <= 0) then
    raise exception 'A positive trigger price is required for a % order.', p_variety;
  end if;
  if p_variety = 'MARKET' and (p_price is null or p_price <= 0) then
    raise exception 'A market order needs a live quoted price; none was supplied.';
  end if;

  v_reference := case p_variety
    when 'MARKET' then p_price
    when 'SL_M' then p_trigger_price
    else p_limit_price
  end;

  -- A stop/target on the wrong side of the order's own reference price can
  -- never do what it claims (e.g. a BUY "stop loss" above the entry is not a
  -- loss limiter at all), so it is rejected rather than silently accepted.
  if p_stop_loss is not null then
    if p_stop_loss <= 0 then
      raise exception 'Stop loss must be positive.';
    end if;
    if p_side = 'BUY' and p_stop_loss >= v_reference then
      raise exception 'Stop loss % must be below the order price % for a BUY.',
        p_stop_loss, v_reference;
    end if;
    if p_side = 'SELL' and p_stop_loss <= v_reference then
      raise exception 'Stop loss % must be above the order price % for a SELL.',
        p_stop_loss, v_reference;
    end if;
  end if;

  if p_target_price is not null then
    if p_target_price <= 0 then
      raise exception 'Target price must be positive.';
    end if;
    if p_side = 'BUY' and p_target_price <= v_reference then
      raise exception 'Target price % must be above the order price % for a BUY.',
        p_target_price, v_reference;
    end if;
    if p_side = 'SELL' and p_target_price >= v_reference then
      raise exception 'Target price % must be below the order price % for a SELL.',
        p_target_price, v_reference;
    end if;
  end if;

  select * into v_account from public.paper_accounts where user_id = v_uid for update;
  if not found then
    raise exception 'No paper trading account exists for this user.';
  end if;

  perform public.begin_trusted_write();

  -- Buying power is reserved against the worst price the order can fill at:
  -- the limit for a LIMIT/SL, the trigger for an SL-M, the live quote for a
  -- MARKET. Charges are not reserved — they are a fraction of a percent, and
  -- the fill path re-checks affordability including them.
  v_available := v_account.cash_balance - v_account.reserved_cash;

  if p_side = 'BUY' then
    v_reserve := round(p_quantity * v_reference, 2);
    if v_reserve > v_available then
      insert into public.orders(
        account_id, user_id, symbol, instrument_kind, side, quantity, price,
        variety, product, limit_price, trigger_price,
        status, reject_reason, quote_source, quote_as_of,
        stop_loss, target_price, signal_id, notes
      )
      values (
        v_account.id, v_uid, v_symbol, p_instrument_kind::public.instrument_kind,
        p_side::public.order_side, p_quantity, null,
        p_variety::public.order_variety, p_product::public.order_product,
        p_limit_price, p_trigger_price,
        'REJECTED', 'Insufficient buying power', p_quote_source, p_quote_as_of,
        p_stop_loss, p_target_price, p_signal_id, p_notes
      )
      returning * into v_order;

      insert into public.order_events(order_id, user_id, event, detail)
      values (v_order.id, v_uid, 'REJECTED',
              jsonb_build_object('reason', 'insufficient_buying_power',
                                 'required', v_reserve, 'available', v_available));
      return v_order;
    end if;
  end if;

  insert into public.orders(
    account_id, user_id, symbol, instrument_kind, side, quantity, price,
    variety, product, limit_price, trigger_price, status,
    quote_source, quote_as_of, stop_loss, target_price, signal_id, notes,
    reserved_cash
  )
  values (
    v_account.id, v_uid, v_symbol, p_instrument_kind::public.instrument_kind,
    p_side::public.order_side, p_quantity, null,
    p_variety::public.order_variety, p_product::public.order_product,
    p_limit_price, p_trigger_price, 'PENDING',
    p_quote_source, p_quote_as_of, p_stop_loss, p_target_price, p_signal_id, p_notes,
    case when p_side = 'BUY' then v_reserve else 0 end
  )
  returning * into v_order;

  if p_side = 'BUY' and v_reserve > 0 then
    update public.paper_accounts
      set reserved_cash = reserved_cash + v_reserve, updated_at = now()
      where id = v_account.id;
  end if;

  insert into public.order_events(order_id, user_id, event, detail)
  values (v_order.id, v_uid, 'PLACED',
          jsonb_build_object('variety', p_variety, 'product', p_product,
                             'quantity', p_quantity, 'limit', p_limit_price,
                             'trigger', p_trigger_price, 'reserved', v_reserve));

  -- An order whose condition the market already satisfies fills immediately,
  -- exactly as it would on an exchange. This is also the only path a MARKET
  -- order takes.
  if public.should_fill(p_variety, p_side, p_price, p_limit_price, p_trigger_price) then
    return public.fill_order_internal(v_order.id, p_price, p_quote_source, p_quote_as_of);
  end if;

  return v_order;
end;
$$;

grant execute on function public.place_paper_order(
  text, text, numeric, text, text, numeric, numeric, numeric, text, text,
  timestamptz, numeric, numeric, uuid, text
) to authenticated;

-- ----------------------------------------------------------------------------
-- update_position_risk — add the same positivity/directional sanity, this
-- time relative to the position's own average price and side.
-- ----------------------------------------------------------------------------
create or replace function public.update_position_risk(
  p_position_id uuid,
  p_stop_loss numeric default null,
  p_target_price numeric default null
)
returns public.positions
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_position public.positions%rowtype;
begin
  if v_uid is null then
    raise exception 'Not authenticated.' using errcode = '42501';
  end if;

  select * into v_position from public.positions where id = p_position_id for update;
  if not found or v_position.user_id <> v_uid then
    raise exception 'Position not found.' using errcode = '42501';
  end if;

  if p_stop_loss is not null then
    if p_stop_loss <= 0 then
      raise exception 'Stop loss must be positive.';
    end if;
    if v_position.side = 'BUY' and p_stop_loss >= v_position.avg_price then
      raise exception 'Stop loss % must be below the average entry price % for a long position.',
        p_stop_loss, v_position.avg_price;
    end if;
    if v_position.side = 'SELL' and p_stop_loss <= v_position.avg_price then
      raise exception 'Stop loss % must be above the average entry price % for a short position.',
        p_stop_loss, v_position.avg_price;
    end if;
  end if;

  if p_target_price is not null then
    if p_target_price <= 0 then
      raise exception 'Target price must be positive.';
    end if;
    if v_position.side = 'BUY' and p_target_price <= v_position.avg_price then
      raise exception 'Target price % must be above the average entry price % for a long position.',
        p_target_price, v_position.avg_price;
    end if;
    if v_position.side = 'SELL' and p_target_price >= v_position.avg_price then
      raise exception 'Target price % must be below the average entry price % for a short position.',
        p_target_price, v_position.avg_price;
    end if;
  end if;

  perform public.begin_trusted_write();

  update public.positions
    set stop_loss = p_stop_loss,
        target_price = p_target_price,
        updated_at = now()
    where id = p_position_id
    returning * into v_position;

  return v_position;
end;
$$;

grant execute on function public.update_position_risk(uuid, numeric, numeric) to authenticated;

-- ----------------------------------------------------------------------------
-- fill_order_internal — bound the fill price against the last cached real
-- quote for the symbol. Everything else in this function is unchanged from
-- 0016_order_lifecycle.sql.
-- ----------------------------------------------------------------------------
create or replace function public.fill_order_internal(
  p_order_id uuid,
  p_price numeric,
  p_quote_source text,
  p_quote_as_of timestamptz
)
returns public.orders
language plpgsql
security definer set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_account public.paper_accounts%rowtype;
  v_opp public.positions%rowtype;
  v_same public.positions%rowtype;
  v_charges record;
  v_notional numeric;
  v_close_qty numeric := 0;
  v_open_qty numeric;
  v_realized_pnl numeric;
  v_entry_charges numeric := 0;
  v_risk_per_unit numeric;
  v_r_multiple numeric;
  v_opposite_side public.order_side;
  v_cash_delta numeric;
  v_last_known_price numeric;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Order not found.';
  end if;
  if v_order.status <> 'PENDING' then
    raise exception 'Order % is % and cannot be filled again.', v_order.id, v_order.status;
  end if;
  if p_price is null or p_price <= 0 then
    raise exception 'A positive, real quoted price is required to fill an order.';
  end if;

  -- Both entry points into this function (place_paper_order's immediate-fill
  -- path and the client-callable execute_pending_order) hand this function a
  -- caller-supplied price. Bound it against the last real quote this app has
  -- already cached for the symbol so a caller cannot fabricate an
  -- implausible fill (e.g. a fraction of a rupee for a stock trading in the
  -- thousands) and manufacture P&L. A symbol with no cached quote yet is let
  -- through unchanged — this is a plausibility check against data the app
  -- already has, not a new price source.
  select last_price into v_last_known_price
    from public.market_data_cache
    where symbol = v_order.symbol;

  if v_last_known_price is not null and v_last_known_price > 0
     and abs(p_price - v_last_known_price) / v_last_known_price > 0.20 then
    raise exception
      'Fill price % for % is implausibly far from the last known market price %.',
      p_price, v_order.symbol, v_last_known_price;
  end if;

  select * into v_account from public.paper_accounts where id = v_order.account_id for update;

  perform public.begin_trusted_write();

  v_notional := round(v_order.quantity * p_price, 2);
  select * into v_charges
    from public.calc_trade_charges(v_order.side::text, v_order.product::text, v_notional);

  -- Releasing the reservation first means the affordability test below is
  -- against true free cash, not cash the order itself is holding hostage.
  if v_order.reserved_cash > 0 then
    update public.paper_accounts
      set reserved_cash = greatest(0, reserved_cash - v_order.reserved_cash)
      where id = v_account.id;
    v_account.reserved_cash := greatest(0, v_account.reserved_cash - v_order.reserved_cash);
  end if;

  if v_order.side = 'BUY'
     and (v_notional + v_charges.total_charges) > (v_account.cash_balance - v_account.reserved_cash) then
    update public.orders
      set status = 'REJECTED',
          reject_reason = 'Insufficient cash balance at fill',
          reserved_cash = 0,
          updated_at = now()
      where id = v_order.id
      returning * into v_order;

    insert into public.order_events(order_id, user_id, event, detail)
    values (v_order.id, v_order.user_id, 'REJECTED',
            jsonb_build_object('reason', 'insufficient_cash', 'price', p_price));
    return v_order;
  end if;

  v_open_qty := v_order.quantity;
  v_opposite_side := case v_order.side when 'BUY' then 'SELL' else 'BUY' end;

  select * into v_opp from public.positions
    where account_id = v_account.id and symbol = v_order.symbol and side = v_opposite_side
    for update;

  if found then
    v_close_qty := least(v_opp.quantity, v_order.quantity);
    v_open_qty := v_order.quantity - v_close_qty;

    v_realized_pnl := round(
      case v_opp.side
        when 'BUY' then (p_price - v_opp.avg_price) * v_close_qty
        else (v_opp.avg_price - p_price) * v_close_qty
      end, 2);

    -- The entry's charges are apportioned to the slice being closed, so a
    -- partial close does not book the whole entry cost against it.
    v_entry_charges := round(
      v_opp.entry_charges * (v_close_qty / nullif(v_opp.quantity, 0)), 2);

    v_risk_per_unit := case
      when v_opp.stop_loss is null then null
      else abs(v_opp.avg_price - v_opp.stop_loss)
    end;
    v_r_multiple := case
      when v_risk_per_unit is null or v_risk_per_unit = 0 then null
      else round(v_realized_pnl / (v_risk_per_unit * v_close_qty), 4)
    end;

    insert into public.trades(
      account_id, user_id, symbol, side, quantity, entry_price, exit_price,
      realized_pnl, opened_at, closed_at, origin, stop_loss, target_price,
      r_multiple, product, signal_id, entry_charges, exit_charges, total_charges,
      net_realized_pnl
    )
    values (
      v_account.id, v_order.user_id, v_order.symbol, v_opp.side, v_close_qty,
      v_opp.avg_price, p_price, v_realized_pnl, v_opp.opened_at, now(), 'paper_trade',
      v_opp.stop_loss, v_opp.target_price, v_r_multiple, v_order.product, v_order.signal_id,
      v_entry_charges, v_charges.total_charges,
      round(v_entry_charges + v_charges.total_charges, 2),
      round(v_realized_pnl - v_entry_charges - v_charges.total_charges, 2)
    );

    if v_close_qty >= v_opp.quantity then
      delete from public.positions where id = v_opp.id;
    else
      update public.positions
        set quantity = v_opp.quantity - v_close_qty,
            entry_charges = greatest(0, v_opp.entry_charges - v_entry_charges),
            updated_at = now()
        where id = v_opp.id;
    end if;
  end if;

  if v_open_qty > 0 then
    select * into v_same from public.positions
      where account_id = v_account.id and symbol = v_order.symbol and side = v_order.side
      for update;

    if found then
      update public.positions
        set quantity = v_same.quantity + v_open_qty,
            avg_price = round(
              ((v_same.quantity * v_same.avg_price) + (v_open_qty * p_price))
              / (v_same.quantity + v_open_qty), 4),
            entry_charges = v_same.entry_charges
              + round(v_charges.total_charges * (v_open_qty / v_order.quantity), 2),
            stop_loss    = coalesce(v_order.stop_loss, v_same.stop_loss),
            target_price = coalesce(v_order.target_price, v_same.target_price),
            updated_at = now()
        where id = v_same.id;
    else
      insert into public.positions(
        account_id, user_id, symbol, instrument_kind, side, quantity, avg_price,
        stop_loss, target_price, product, entry_charges
      )
      values (
        v_account.id, v_order.user_id, v_order.symbol, v_order.instrument_kind,
        v_order.side, v_open_qty, p_price, v_order.stop_loss, v_order.target_price,
        v_order.product,
        round(v_charges.total_charges * (v_open_qty / v_order.quantity), 2)
      );
    end if;
  end if;

  -- Charges always leave the account, whichever way the trade went.
  v_cash_delta := case v_order.side when 'BUY' then -v_notional else v_notional end
                  - v_charges.total_charges;

  update public.paper_accounts
    set cash_balance = cash_balance + v_cash_delta, updated_at = now()
    where id = v_account.id;

  update public.orders
    set status = 'FILLED',
        price = p_price,
        avg_fill_price = p_price,
        filled_quantity = v_order.quantity,
        quote_source = coalesce(p_quote_source, v_order.quote_source),
        quote_as_of = coalesce(p_quote_as_of, v_order.quote_as_of),
        brokerage = v_charges.brokerage,
        stt = v_charges.stt,
        exchange_charges = v_charges.exchange_charges,
        sebi_charges = v_charges.sebi_charges,
        stamp_duty = v_charges.stamp_duty,
        gst = v_charges.gst,
        total_charges = v_charges.total_charges,
        reserved_cash = 0,
        filled_at = now(),
        updated_at = now()
    where id = v_order.id
    returning * into v_order;

  insert into public.order_events(order_id, user_id, event, detail)
  values (v_order.id, v_order.user_id, 'FILLED',
          jsonb_build_object(
            'price', p_price,
            'quantity', v_order.quantity,
            'charges', v_charges.total_charges,
            'source', p_quote_source));

  insert into public.notifications(user_id, kind, title, body)
  values (
    v_order.user_id, 'trade',
    format('%s %s x%s filled at %s',
           v_order.side, v_order.symbol,
           trim(to_char(v_order.quantity, 'FM999999990.####')),
           trim(to_char(p_price, 'FM999999990.00'))),
    case when p_quote_source is null then null
         else format('Simulated fill against a live %s quote.', p_quote_source) end
  );

  return v_order;
end;
$$;

revoke all on function public.fill_order_internal(uuid, numeric, text, timestamptz)
  from public, anon, authenticated;
