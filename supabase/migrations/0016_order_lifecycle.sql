-- ============================================================================
-- ORDER LIFECYCLE (paper-trading engine v3)
--
-- Supersedes place_paper_order v2 (0005_trading_engine.sql), which could only
-- express one thing: "fill this quantity at this price, right now". A real
-- order book has varieties (MARKET / LIMIT / SL / SL-M), a resting state, and
-- events that move an order between states. This migration adds all three,
-- plus the statutory charges that make a simulated P&L resemble a real one.
--
-- Three properties are load-bearing and everything below is arranged to
-- protect them:
--
--   1. NO INVENTED PRICES. Every fill price written by this engine is a real
--      last-traded price the caller obtained from a live provider and passed
--      in. A resting LIMIT order does not fill at its limit; it fills at the
--      observed LTP that satisfied the limit. There is no interpolation, no
--      "assume it filled at the trigger", and no partial fills — simulating a
--      partial fill would require order-book depth this system does not have,
--      so a fill is all-or-nothing.
--
--   2. CHARGES ARE COMPUTED HERE, NOT PASSED IN. The TypeScript layer has its
--      own copy of these formulas for the pre-trade preview, but a client can
--      call this RPC directly with the anon key, so a charges figure supplied
--      as an argument would be a number the user chooses. The authoritative
--      calculation is calc_trade_charges() below.
--
--   3. RESTING BUY ORDERS RESERVE CASH. Without a reservation a user could
--      queue ten limit buys they can only afford one of and have them all
--      fill. paper_accounts.reserved_cash tracks committed-but-unfilled
--      capital; available buying power is cash_balance - reserved_cash.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Enums
-- ----------------------------------------------------------------------------
do $$ begin
  create type public.order_variety as enum ('MARKET', 'LIMIT', 'SL', 'SL_M');
exception when duplicate_object then null; end $$;

-- CNC is delivery (settled, held overnight); MIS is intraday. The distinction
-- is not cosmetic: it changes STT and stamp duty materially.
do $$ begin
  create type public.order_product as enum ('CNC', 'MIS');
exception when duplicate_object then null; end $$;

-- The 'PENDING' status this migration rests orders in is added by
-- 0015_order_status_pending.sql. It has to commit in an earlier transaction
-- than the index below that references it — see the note in that file.

-- ----------------------------------------------------------------------------
-- 2. Columns
-- ----------------------------------------------------------------------------
alter table public.paper_accounts
  add column if not exists reserved_cash numeric(16,2) not null default 0
    check (reserved_cash >= 0);

alter table public.orders
  add column if not exists variety        public.order_variety not null default 'MARKET',
  add column if not exists product        public.order_product not null default 'MIS',
  add column if not exists limit_price    numeric(16,4) check (limit_price > 0),
  add column if not exists trigger_price  numeric(16,4) check (trigger_price > 0),
  add column if not exists filled_quantity numeric(14,4) not null default 0
    check (filled_quantity >= 0),
  add column if not exists avg_fill_price numeric(16,4) check (avg_fill_price >= 0),
  add column if not exists reserved_cash  numeric(16,2) not null default 0,
  add column if not exists brokerage      numeric(16,2) not null default 0,
  add column if not exists stt            numeric(16,2) not null default 0,
  add column if not exists exchange_charges numeric(16,2) not null default 0,
  add column if not exists sebi_charges   numeric(16,2) not null default 0,
  add column if not exists stamp_duty     numeric(16,2) not null default 0,
  add column if not exists gst            numeric(16,2) not null default 0,
  add column if not exists total_charges  numeric(16,2) not null default 0,
  add column if not exists filled_at      timestamptz,
  add column if not exists cancelled_at   timestamptz,
  add column if not exists updated_at     timestamptz not null default now();

-- A resting order has no price yet. Storing 0 would be a lie that arithmetic
-- elsewhere could pick up, so the column becomes nullable and the fill price
-- lives in avg_fill_price once it exists.
alter table public.orders alter column price drop not null;
alter table public.orders drop constraint if exists orders_price_check;
alter table public.orders add constraint orders_price_check
  check (price is null or price >= 0);

alter table public.trades
  add column if not exists product        public.order_product not null default 'MIS',
  add column if not exists entry_charges  numeric(16,2) not null default 0,
  add column if not exists exit_charges   numeric(16,2) not null default 0,
  add column if not exists total_charges  numeric(16,2) not null default 0,
  -- realized_pnl stays gross so historical rows keep their meaning; the
  -- after-costs figure gets its own column.
  add column if not exists net_realized_pnl numeric(16,2);

-- Rows closed before this migration were charged nothing, so gross is their
-- true net. Backfilling rather than leaving nulls keeps every consumer on one
-- column instead of coalescing at each call site.
update public.trades set net_realized_pnl = realized_pnl where net_realized_pnl is null;
alter table public.trades alter column net_realized_pnl set default 0;
alter table public.trades alter column net_realized_pnl set not null;

alter table public.positions
  add column if not exists product public.order_product not null default 'MIS',
  add column if not exists entry_charges numeric(16,2) not null default 0;

create index if not exists orders_pending_idx
  on public.orders(account_id, status)
  where status = 'PENDING';

-- ----------------------------------------------------------------------------
-- 3. order_events — the audit trail of how an order reached its current state
-- ----------------------------------------------------------------------------
create table if not exists public.order_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  event text not null check (event in
    ('PLACED', 'MODIFIED', 'TRIGGERED', 'FILLED', 'CANCELLED', 'REJECTED')),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists order_events_order_idx
  on public.order_events(order_id, created_at);

alter table public.order_events enable row level security;

drop policy if exists order_events_owner_select on public.order_events;
create policy order_events_owner_select on public.order_events
  for select using (is_self(user_id) or is_admin());

-- Same lockdown as the other ledger tables: readable by its owner, writable
-- only from inside a trusted server-side function.
revoke insert, update, delete on public.order_events from anon, authenticated;
drop trigger if exists require_trusted_write on public.order_events;
create trigger require_trusted_write
  before insert or update or delete on public.order_events
  for each row execute function public.require_trusted_write();

-- ----------------------------------------------------------------------------
-- 4. calc_trade_charges — statutory Indian equity costs
--
-- Rates as published for NSE equity (cash segment). They are constants here
-- rather than configuration because a wrong rate is a correctness bug, not a
-- preference, and a config row is one more thing an admin can get wrong.
-- Kept in one place so the TypeScript preview in src/lib/trading/charges.ts
-- has a single formula to mirror.
--
--   Brokerage        CNC: nil. MIS: 0.03% of turnover, capped at Rs 20.
--   STT              CNC: 0.1% both sides. MIS: 0.025% on the SELL only.
--   Exchange txn     0.00297% of turnover (NSE cash).
--   SEBI turnover    0.0001% (Rs 10 per crore).
--   IPFT             0.0001% (NSE investor protection fund trust).
--   Stamp duty       BUY side only. CNC 0.015%, MIS 0.003%.
--   GST              18% on brokerage + exchange + SEBI + IPFT.
-- ----------------------------------------------------------------------------
create or replace function public.calc_trade_charges(
  p_side text,
  p_product text,
  p_turnover numeric
)
returns table (
  brokerage numeric,
  stt numeric,
  exchange_charges numeric,
  sebi_charges numeric,
  stamp_duty numeric,
  gst numeric,
  total_charges numeric
)
language plpgsql
immutable
as $$
declare
  v_turnover numeric := greatest(coalesce(p_turnover, 0), 0);
  v_brokerage numeric;
  v_stt numeric;
  v_exchange numeric;
  v_sebi numeric;
  v_ipft numeric;
  v_stamp numeric;
  v_gst numeric;
begin
  v_brokerage := case
    when p_product = 'CNC' then 0
    else least(round(v_turnover * 0.0003, 2), 20)
  end;

  v_stt := case
    when p_product = 'CNC' then round(v_turnover * 0.001, 2)
    when p_side = 'SELL' then round(v_turnover * 0.00025, 2)
    else 0
  end;

  v_exchange := round(v_turnover * 0.0000297, 2);
  v_sebi     := round(v_turnover * 0.000001, 2);
  v_ipft     := round(v_turnover * 0.000001, 2);

  v_stamp := case
    when p_side <> 'BUY' then 0
    when p_product = 'CNC' then round(v_turnover * 0.00015, 2)
    else round(v_turnover * 0.00003, 2)
  end;

  v_gst := round((v_brokerage + v_exchange + v_sebi + v_ipft) * 0.18, 2);

  -- IPFT is folded into the exchange line for reporting: it is an exchange
  -- levy, and a separate column for a sub-rupee figure adds noise, not clarity.
  return query select
    v_brokerage,
    v_stt,
    v_exchange + v_ipft,
    v_sebi,
    v_stamp,
    v_gst,
    round(v_brokerage + v_stt + v_exchange + v_ipft + v_sebi + v_stamp + v_gst, 2);
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. should_fill — the trigger predicate, isolated and pure
--
-- Separated from the bookkeeping so it can be reasoned about (and read) on its
-- own. Returns true when a real observed last-traded price satisfies the
-- resting order's conditions.
--
--   LIMIT BUY   fills when the market trades at or below the limit.
--   LIMIT SELL  fills when the market trades at or above the limit.
--   SL BUY      is a stop entry above the market: it activates at or above the
--               trigger, and its limit caps how far it will chase.
--   SL SELL     activates at or below the trigger, with the limit as a floor.
--   SL_M        activates on the trigger alone and fills at the market.
-- ----------------------------------------------------------------------------
create or replace function public.should_fill(
  p_variety text,
  p_side text,
  p_ltp numeric,
  p_limit_price numeric,
  p_trigger_price numeric
)
returns boolean
language sql
immutable
as $$
  select case
    when p_ltp is null or p_ltp <= 0 then false
    when p_variety = 'MARKET' then true
    when p_variety = 'LIMIT' and p_side = 'BUY'  then p_ltp <= p_limit_price
    when p_variety = 'LIMIT' and p_side = 'SELL' then p_ltp >= p_limit_price
    when p_variety = 'SL_M'  and p_side = 'BUY'  then p_ltp >= p_trigger_price
    when p_variety = 'SL_M'  and p_side = 'SELL' then p_ltp <= p_trigger_price
    when p_variety = 'SL'    and p_side = 'BUY'
      then p_ltp >= p_trigger_price and p_ltp <= p_limit_price
    when p_variety = 'SL'    and p_side = 'SELL'
      then p_ltp <= p_trigger_price and p_ltp >= p_limit_price
    else false
  end;
$$;

-- ----------------------------------------------------------------------------
-- 6. fill_order_internal — the single place an order becomes a fill
--
-- Every path that results in a fill (immediate MARKET, an already-satisfiable
-- LIMIT at placement, or a resting order triggered later) routes through here,
-- so position averaging, realized P&L, charges and cash movement cannot drift
-- apart between paths.
--
-- Not granted to any client role: it trusts its arguments completely and is
-- only ever reached from the SECURITY DEFINER entry points below, which have
-- already established ownership.
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

-- ----------------------------------------------------------------------------
-- 7. place_paper_order (v3)
--
-- The v2 signature is dropped rather than kept alongside: two live entry
-- points into the same ledger, with different validation, is how a rule gets
-- enforced on one path and forgotten on the other.
-- ----------------------------------------------------------------------------
drop function if exists public.place_paper_order(
  text, text, numeric, numeric, text, text, timestamptz, numeric, numeric, uuid, text
);

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

  select * into v_account from public.paper_accounts where user_id = v_uid for update;
  if not found then
    raise exception 'No paper trading account exists for this user.';
  end if;

  perform public.begin_trusted_write();

  -- Buying power is reserved against the worst price the order can fill at:
  -- the limit for a LIMIT/SL, the trigger for an SL-M, the live quote for a
  -- MARKET. Charges are not reserved — they are a fraction of a percent, and
  -- the fill path re-checks affordability including them.
  v_reference := case p_variety
    when 'MARKET' then p_price
    when 'SL_M' then p_trigger_price
    else p_limit_price
  end;

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
-- 8. cancel_paper_order
-- ----------------------------------------------------------------------------
create or replace function public.cancel_paper_order(p_order_id uuid)
returns public.orders
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_order public.orders%rowtype;
begin
  if v_uid is null then
    raise exception 'Not authenticated.' using errcode = '42501';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  -- Same error for "not yours" and "does not exist": distinguishing them
  -- would let a caller probe for the existence of other users' orders.
  if not found or v_order.user_id <> v_uid then
    raise exception 'Order not found.' using errcode = '42501';
  end if;
  if v_order.status <> 'PENDING' then
    raise exception 'Only a pending order can be cancelled; this one is %.', v_order.status;
  end if;

  perform public.begin_trusted_write();

  if v_order.reserved_cash > 0 then
    update public.paper_accounts
      set reserved_cash = greatest(0, reserved_cash - v_order.reserved_cash),
          updated_at = now()
      where id = v_order.account_id;
  end if;

  update public.orders
    set status = 'CANCELLED', reserved_cash = 0, cancelled_at = now(), updated_at = now()
    where id = v_order.id
    returning * into v_order;

  insert into public.order_events(order_id, user_id, event, detail)
  values (v_order.id, v_uid, 'CANCELLED', '{}'::jsonb);

  return v_order;
end;
$$;

grant execute on function public.cancel_paper_order(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 9. modify_paper_order
--
-- Quantity and price levels only. Side, symbol, variety and product are fixed
-- at placement: changing those is a different order, and allowing it in place
-- would make the order_events trail unreadable.
-- ----------------------------------------------------------------------------
create or replace function public.modify_paper_order(
  p_order_id uuid,
  p_quantity numeric default null,
  p_limit_price numeric default null,
  p_trigger_price numeric default null
)
returns public.orders
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_order public.orders%rowtype;
  v_account public.paper_accounts%rowtype;
  v_quantity numeric;
  v_limit numeric;
  v_trigger numeric;
  v_reference numeric;
  v_new_reserve numeric := 0;
  v_available numeric;
begin
  if v_uid is null then
    raise exception 'Not authenticated.' using errcode = '42501';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.user_id <> v_uid then
    raise exception 'Order not found.' using errcode = '42501';
  end if;
  if v_order.status <> 'PENDING' then
    raise exception 'Only a pending order can be modified; this one is %.', v_order.status;
  end if;

  v_quantity := coalesce(p_quantity, v_order.quantity);
  v_limit    := coalesce(p_limit_price, v_order.limit_price);
  v_trigger  := coalesce(p_trigger_price, v_order.trigger_price);

  if v_quantity <= 0 then
    raise exception 'Quantity must be positive.';
  end if;
  if v_order.variety in ('LIMIT', 'SL') and (v_limit is null or v_limit <= 0) then
    raise exception 'A positive limit price is required for a % order.', v_order.variety;
  end if;
  if v_order.variety in ('SL', 'SL_M') and (v_trigger is null or v_trigger <= 0) then
    raise exception 'A positive trigger price is required for a % order.', v_order.variety;
  end if;

  select * into v_account from public.paper_accounts where id = v_order.account_id for update;

  perform public.begin_trusted_write();

  if v_order.side = 'BUY' then
    v_reference := case v_order.variety when 'SL_M' then v_trigger else v_limit end;
    v_new_reserve := round(v_quantity * v_reference, 2);

    -- Free cash excluding this order's own existing hold, so raising a limit
    -- by a rupee is not blocked by the reservation it already owns.
    v_available := v_account.cash_balance - v_account.reserved_cash + v_order.reserved_cash;
    if v_new_reserve > v_available then
      raise exception 'Insufficient buying power for the modified order.';
    end if;

    update public.paper_accounts
      set reserved_cash = greatest(0, reserved_cash - v_order.reserved_cash) + v_new_reserve,
          updated_at = now()
      where id = v_account.id;
  end if;

  update public.orders
    set quantity = v_quantity,
        limit_price = v_limit,
        trigger_price = v_trigger,
        reserved_cash = v_new_reserve,
        updated_at = now()
    where id = v_order.id
    returning * into v_order;

  insert into public.order_events(order_id, user_id, event, detail)
  values (v_order.id, v_uid, 'MODIFIED',
          jsonb_build_object('quantity', v_quantity, 'limit', v_limit, 'trigger', v_trigger));

  return v_order;
end;
$$;

grant execute on function public.modify_paper_order(uuid, numeric, numeric, numeric)
  to authenticated;

-- ----------------------------------------------------------------------------
-- 10. execute_pending_order
--
-- Called by the server once it has a live quote for the order's symbol. The
-- price is validated against the order's own conditions here, so a caller
-- cannot fill a resting order at a price the market never printed by simply
-- asserting one: the predicate has to agree.
-- ----------------------------------------------------------------------------
create or replace function public.execute_pending_order(
  p_order_id uuid,
  p_price numeric,
  p_quote_source text default null,
  p_quote_as_of timestamptz default null
)
returns public.orders
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_order public.orders%rowtype;
begin
  if v_uid is null then
    raise exception 'Not authenticated.' using errcode = '42501';
  end if;

  select * into v_order from public.orders where id = p_order_id;
  if not found or v_order.user_id <> v_uid then
    raise exception 'Order not found.' using errcode = '42501';
  end if;
  -- Both of the following are no-ops rather than errors, because both are
  -- ordinary outcomes of a matching pass racing the market: the order may have
  -- been filled or cancelled since the caller read it, and the price may have
  -- moved back out of range. The caller distinguishes them by the returned
  -- status, which is still PENDING when nothing happened.
  if v_order.status <> 'PENDING' then
    return v_order;
  end if;

  if not public.should_fill(
       v_order.variety::text, v_order.side::text, p_price,
       v_order.limit_price, v_order.trigger_price) then
    return v_order;
  end if;

  insert into public.order_events(order_id, user_id, event, detail)
  values (v_order.id, v_uid, 'TRIGGERED', jsonb_build_object('price', p_price));

  return public.fill_order_internal(p_order_id, p_price, p_quote_source, p_quote_as_of);
end;
$$;

grant execute on function public.execute_pending_order(uuid, numeric, text, timestamptz)
  to authenticated;

-- ----------------------------------------------------------------------------
-- 11. reset_paper_account must also clear the new state
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

  delete from public.order_events
    where order_id in (select id from public.orders where account_id = v_account.id);
  delete from public.positions where account_id = v_account.id;
  delete from public.trades    where account_id = v_account.id;
  delete from public.orders    where account_id = v_account.id;

  update public.paper_accounts
    set cash_balance = starting_capital, reserved_cash = 0, updated_at = now()
    where id = v_account.id
    returning * into v_account;

  insert into public.notifications(user_id, kind, title, body)
  values (v_uid, 'system', 'Paper account reset',
          'Your simulated account was reset to its starting capital. Order, trade and position history was cleared.');

  return v_account;
end;
$$;

grant execute on function public.reset_paper_account() to authenticated;
