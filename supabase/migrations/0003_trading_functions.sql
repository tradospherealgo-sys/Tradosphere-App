-- ============================================================================
-- Paper-trading order-placement function.
--
-- Runs as SECURITY INVOKER (the calling user's own role/JWT), so every
-- read/write inside this function is still subject to the RLS policies
-- defined in 0002_rls.sql — it gets no extra privilege, it just lets
-- multiple related writes (order, position, trade, cash balance) commit
-- atomically in one statement instead of several round trips from the
-- app that could partially fail.
--
-- Cash accounting model (deliberately simple, no margin/leverage):
--   - A BUY always debits cash_balance by quantity * price, in full.
--   - A SELL always credits cash_balance by quantity * price, in full.
--   This holds whether the order opens a new position, adds to an existing
--   same-side position, or closes/flips an opposite-side position — the
--   notional-based cash movement already nets out to the correct economic
--   result across the open and close legs. `trades.realized_pnl` is a
--   reporting figure for trade history / stats, not a second cash entry.
--
-- Never fabricates a price: `p_price` must be supplied by the caller from
-- a real quote (see src/lib/market-data). This function only does the
-- bookkeeping math on whatever price it's given.
-- ============================================================================

create or replace function public.place_paper_order(
  p_account_id uuid,
  p_symbol text,
  p_side text,
  p_quantity numeric,
  p_price numeric,
  p_instrument_kind text default 'EQUITY',
  p_quote_source text default null,
  p_quote_as_of timestamptz default null
)
returns public.orders
language plpgsql
security invoker
as $$
declare
  v_account public.paper_accounts%rowtype;
  v_opp public.positions%rowtype;
  v_same public.positions%rowtype;
  v_order public.orders%rowtype;
  v_notional numeric;
  v_close_qty numeric := 0;
  v_open_qty numeric;
  v_realized_pnl numeric;
  v_opposite_side public.order_side;
begin
  if p_side not in ('BUY', 'SELL') then
    raise exception 'invalid side: %', p_side;
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'quantity must be positive';
  end if;
  if p_price is null or p_price <= 0 then
    raise exception 'price must be positive';
  end if;

  select * into v_account from public.paper_accounts where id = p_account_id for update;
  if not found then
    raise exception 'paper account not found';
  end if;
  if v_account.user_id <> auth.uid() then
    raise exception 'not your account';
  end if;

  v_notional := round(p_quantity * p_price, 2);
  v_open_qty := p_quantity;

  -- Conservative cash gate: a BUY must be fully covered by cash on hand,
  -- even when it's covering a short. No margin is modeled in V1.
  if p_side = 'BUY' and v_notional > v_account.cash_balance then
    insert into public.orders(
      account_id, user_id, symbol, instrument_kind, side, quantity, price,
      status, reject_reason, quote_source, quote_as_of
    )
    values (
      p_account_id, v_account.user_id, p_symbol, p_instrument_kind::public.instrument_kind,
      p_side::public.order_side, p_quantity, p_price,
      'REJECTED', 'Insufficient cash balance', p_quote_source, p_quote_as_of
    )
    returning * into v_order;
    return v_order;
  end if;

  v_opposite_side := case p_side when 'BUY' then 'SELL' else 'BUY' end;

  select * into v_opp from public.positions
    where account_id = p_account_id and symbol = p_symbol and side = v_opposite_side
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

    insert into public.trades(
      account_id, user_id, symbol, side, quantity, entry_price, exit_price,
      realized_pnl, opened_at, closed_at, origin
    )
    values (
      p_account_id, v_account.user_id, p_symbol, v_opp.side, v_close_qty,
      v_opp.avg_price, p_price, v_realized_pnl, v_opp.opened_at, now(), 'paper_trade'
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
      where account_id = p_account_id and symbol = p_symbol and side = p_side::public.order_side
      for update;

    if found then
      update public.positions
        set quantity = v_same.quantity + v_open_qty,
            avg_price = round(
              ((v_same.quantity * v_same.avg_price) + (v_open_qty * p_price))
              / (v_same.quantity + v_open_qty),
              4
            ),
            updated_at = now()
        where id = v_same.id;
    else
      insert into public.positions(
        account_id, user_id, symbol, instrument_kind, side, quantity, avg_price
      )
      values (
        p_account_id, v_account.user_id, p_symbol, p_instrument_kind::public.instrument_kind,
        p_side::public.order_side, v_open_qty, p_price
      );
    end if;
  end if;

  update public.paper_accounts
    set cash_balance = cash_balance + (case p_side when 'BUY' then -v_notional else v_notional end),
        updated_at = now()
    where id = p_account_id;

  insert into public.orders(
    account_id, user_id, symbol, instrument_kind, side, quantity, price,
    status, quote_source, quote_as_of
  )
  values (
    p_account_id, v_account.user_id, p_symbol, p_instrument_kind::public.instrument_kind,
    p_side::public.order_side, p_quantity, p_price, 'FILLED', p_quote_source, p_quote_as_of
  )
  returning * into v_order;

  return v_order;
end;
$$;

grant execute on function public.place_paper_order(
  uuid, text, text, numeric, numeric, text, text, timestamptz
) to authenticated;
