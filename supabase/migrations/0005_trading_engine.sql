-- ============================================================================
-- PAPER-TRADING ENGINE (v2)
--
-- Supersedes the SECURITY INVOKER `place_paper_order` from 0003. After
-- 0004_financial_lockdown.sql clients have no write path to orders /
-- trades / positions / cash at all, so the bookkeeping must run as a trusted
-- SECURITY DEFINER routine. Ownership is re-derived from auth.uid() inside
-- the function rather than trusted from any argument, so a caller cannot
-- act on an account that is not theirs by passing someone else's id.
--
-- What is NOT in here, deliberately: any notion of a price. The function
-- receives `p_price` from the caller and does arithmetic on it. The caller
-- (src/lib/trading/actions.ts) is required to obtain that price from a live
-- market-data provider and to refuse the order outright when no real quote
-- is available. Nothing in this file can invent, interpolate or carry
-- forward a stale price.
--
-- Cash model (unchanged from 0003, restated because it is load-bearing):
--   BUY  debits cash_balance by quantity * price, in full.
--   SELL credits cash_balance by quantity * price, in full.
--   No margin, no leverage, no shorting credit. trades.realized_pnl is a
--   reporting figure for the journal, not a second cash entry.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Risk fields: a paper order can now carry the stop-loss and target the
-- trader committed to, which is what makes R-multiple analytics possible.
-- ----------------------------------------------------------------------------
alter table public.orders     add column if not exists stop_loss    numeric(16,4);
alter table public.orders     add column if not exists target_price numeric(16,4);
alter table public.orders     add column if not exists notes        text;

alter table public.positions  add column if not exists stop_loss    numeric(16,4);
alter table public.positions  add column if not exists target_price numeric(16,4);

alter table public.trades     add column if not exists stop_loss    numeric(16,4);
alter table public.trades     add column if not exists target_price numeric(16,4);
alter table public.trades     add column if not exists r_multiple   numeric(10,4);

-- The old invoker-rights version must go: leaving it in place would be a
-- second, weaker door into the same tables.
drop function if exists public.place_paper_order(
  uuid, text, text, numeric, numeric, text, text, timestamptz
);

-- ----------------------------------------------------------------------------
-- place_paper_order
-- ----------------------------------------------------------------------------
create or replace function public.place_paper_order(
  p_symbol text,
  p_side text,
  p_quantity numeric,
  p_price numeric,
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
  v_opp public.positions%rowtype;
  v_same public.positions%rowtype;
  v_order public.orders%rowtype;
  v_symbol text := upper(btrim(p_symbol));
  v_notional numeric;
  v_close_qty numeric := 0;
  v_open_qty numeric;
  v_realized_pnl numeric;
  v_risk_per_unit numeric;
  v_r_multiple numeric;
  v_opposite_side public.order_side;
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
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Quantity must be positive.';
  end if;
  -- A null or non-positive price means the caller had no real quote. Refusing
  -- here rather than defaulting to anything is the whole point of the design.
  if p_price is null or p_price <= 0 then
    raise exception 'A positive, real quoted price is required to fill an order.';
  end if;

  -- Ownership is derived, never accepted from the client.
  select * into v_account
    from public.paper_accounts
    where user_id = v_uid
    for update;
  if not found then
    raise exception 'No paper trading account exists for this user.';
  end if;

  perform public.begin_trusted_write();

  v_notional := round(p_quantity * p_price, 2);
  v_open_qty := p_quantity;

  if p_side = 'BUY' and v_notional > v_account.cash_balance then
    insert into public.orders(
      account_id, user_id, symbol, instrument_kind, side, quantity, price,
      status, reject_reason, quote_source, quote_as_of, stop_loss, target_price, notes
    )
    values (
      v_account.id, v_uid, v_symbol, p_instrument_kind::public.instrument_kind,
      p_side::public.order_side, p_quantity, p_price,
      'REJECTED', 'Insufficient cash balance', p_quote_source, p_quote_as_of,
      p_stop_loss, p_target_price, p_notes
    )
    returning * into v_order;
    return v_order;
  end if;

  v_opposite_side := case p_side when 'BUY' then 'SELL' else 'BUY' end;

  select * into v_opp from public.positions
    where account_id = v_account.id and symbol = v_symbol and side = v_opposite_side
    for update;

  if found then
    v_close_qty := least(v_opp.quantity, p_quantity);
    v_open_qty := p_quantity - v_close_qty;

    v_realized_pnl := round(
      case v_opp.side
        when 'BUY' then (p_price - v_opp.avg_price) * v_close_qty
        else (v_opp.avg_price - p_price) * v_close_qty
      end,
      2
    );

    -- R-multiple: realized P&L expressed in units of the risk the trader
    -- originally accepted. Only computable when the position carried a stop.
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
      realized_pnl, opened_at, closed_at, origin, stop_loss, target_price, r_multiple
    )
    values (
      v_account.id, v_uid, v_symbol, v_opp.side, v_close_qty,
      v_opp.avg_price, p_price, v_realized_pnl, v_opp.opened_at, now(), 'paper_trade',
      v_opp.stop_loss, v_opp.target_price, v_r_multiple
    );

    if v_close_qty >= v_opp.quantity then
      delete from public.positions where id = v_opp.id;
    else
      update public.positions
        set quantity = v_opp.quantity - v_close_qty, updated_at = now()
        where id = v_opp.id;
    end if;
  end if;

  if v_open_qty > 0 then
    select * into v_same from public.positions
      where account_id = v_account.id and symbol = v_symbol and side = p_side::public.order_side
      for update;

    if found then
      update public.positions
        set quantity = v_same.quantity + v_open_qty,
            avg_price = round(
              ((v_same.quantity * v_same.avg_price) + (v_open_qty * p_price))
              / (v_same.quantity + v_open_qty),
              4
            ),
            stop_loss    = coalesce(p_stop_loss, v_same.stop_loss),
            target_price = coalesce(p_target_price, v_same.target_price),
            updated_at = now()
        where id = v_same.id;
    else
      insert into public.positions(
        account_id, user_id, symbol, instrument_kind, side, quantity, avg_price,
        stop_loss, target_price
      )
      values (
        v_account.id, v_uid, v_symbol, p_instrument_kind::public.instrument_kind,
        p_side::public.order_side, v_open_qty, p_price, p_stop_loss, p_target_price
      );
    end if;
  end if;

  update public.paper_accounts
    set cash_balance = cash_balance + (case p_side when 'BUY' then -v_notional else v_notional end),
        updated_at = now()
    where id = v_account.id;

  insert into public.orders(
    account_id, user_id, symbol, instrument_kind, side, quantity, price,
    status, quote_source, quote_as_of, stop_loss, target_price, notes
  )
  values (
    v_account.id, v_uid, v_symbol, p_instrument_kind::public.instrument_kind,
    p_side::public.order_side, p_quantity, p_price, 'FILLED',
    p_quote_source, p_quote_as_of, p_stop_loss, p_target_price, p_notes
  )
  returning * into v_order;

  insert into public.notifications(user_id, kind, title, body)
  values (
    v_uid, 'trade',
    format('%s %s x%s filled at %s', p_side, v_symbol, trim(to_char(p_quantity, 'FM999999990.####')), trim(to_char(p_price, 'FM999999990.00'))),
    case when p_quote_source is null then null
         else format('Simulated fill against a live %s quote.', p_quote_source) end
  );

  return v_order;
end;
$$;

grant execute on function public.place_paper_order(
  text, text, numeric, numeric, text, text, timestamptz, numeric, numeric, uuid, text
) to authenticated;

-- ----------------------------------------------------------------------------
-- update_position_risk — lets a trader attach/adjust a stop and target on an
-- open position without going through an order. Financial columns
-- (quantity, avg_price) are untouchable here by construction.
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
-- reset_paper_account — wipes the simulation back to starting capital. This
-- is the only sanctioned way for a user to change their own cash balance,
-- and it can only ever set it back to starting_capital, never to an
-- arbitrary figure.
-- ----------------------------------------------------------------------------
create or replace function public.reset_paper_account()
returns public.paper_accounts
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_account public.paper_accounts%rowtype;
begin
  if v_uid is null then
    raise exception 'Not authenticated.' using errcode = '42501';
  end if;

  select * into v_account from public.paper_accounts where user_id = v_uid for update;
  if not found then
    raise exception 'No paper trading account exists for this user.';
  end if;

  perform public.begin_trusted_write();

  delete from public.positions where account_id = v_account.id;
  delete from public.trades    where account_id = v_account.id;
  delete from public.orders    where account_id = v_account.id;

  update public.paper_accounts
    set cash_balance = starting_capital, updated_at = now()
    where id = v_account.id
    returning * into v_account;

  insert into public.notifications(user_id, kind, title, body)
  values (v_uid, 'system', 'Paper account reset',
          'Your simulated account was reset to its starting capital. Order, trade and position history was cleared.');

  return v_account;
end;
$$;

grant execute on function public.reset_paper_account() to authenticated;
