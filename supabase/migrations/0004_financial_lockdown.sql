-- ============================================================================
-- FINANCIAL LOCKDOWN
--
-- Closes the P0 reported by the 2026-09-08 audit: using only the public anon
-- key and an ordinary user's own JWT it was possible to
--   * PATCH paper_accounts.cash_balance to an arbitrary value, and
--   * POST a FILLED order at a self-chosen price
-- because the RLS policies granted whole-row UPDATE/INSERT on the financial
-- tables. The quote-integrity guarantee lived only in a Server Action, which
-- a client can trivially route around by talking to PostgREST directly.
--
-- The model after this migration:
--   * orders / trades / positions  -> SELECT only for clients. No INSERT,
--     UPDATE or DELETE grant or policy exists, at either the privilege layer
--     or the RLS layer.
--   * paper_accounts -> SELECT for the owner; UPDATE restricted to the single
--     non-financial preference column (risk_per_trade_pct), enforced by a
--     BEFORE UPDATE trigger that compares OLD vs NEW (RLS WITH CHECK cannot
--     see OLD, so a trigger is the correct enforcement point).
--   * Every financial mutation goes through a SECURITY DEFINER function that
--     re-derives ownership from auth.uid() and refuses to act on an account
--     the caller does not own.
--
-- Defence in depth: privileges are revoked AND policies dropped. Either alone
-- would be sufficient; both together mean a future migration that carelessly
-- re-grants one layer does not silently reopen the hole.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Remove every client-side write path to the financial tables
-- ----------------------------------------------------------------------------
drop policy if exists orders_owner_insert on public.orders;
drop policy if exists trades_owner_insert on public.trades;
drop policy if exists positions_owner_write on public.positions;
drop policy if exists paper_accounts_owner_update on public.paper_accounts;
drop policy if exists paper_accounts_owner_insert on public.paper_accounts;

revoke insert, update, delete on public.orders from anon, authenticated;
revoke insert, update, delete on public.trades from anon, authenticated;
revoke insert, update, delete on public.positions from anon, authenticated;
revoke insert, delete on public.paper_accounts from anon, authenticated;

-- SELECT stays: users must be able to read their own book. The existing
-- *_owner_select policies from 0002_rls.sql remain the only policies on
-- orders/trades, and positions keeps a select-only policy.
drop policy if exists positions_owner_select on public.positions;
create policy positions_owner_select on public.positions
  for select using (is_self(user_id) or is_admin());

-- ----------------------------------------------------------------------------
-- 2. paper_accounts: owner may update preferences, never money
-- ----------------------------------------------------------------------------
-- The UPDATE grant is retained (column-level would also work, but a trigger
-- gives a clearer error message and survives ALTER TABLE ... ADD COLUMN).
create policy paper_accounts_owner_update on public.paper_accounts
  for update using (is_self(user_id)) with check (is_self(user_id));

create or replace function public.guard_paper_account_financials()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  -- Writes performed by a SECURITY DEFINER trading function set this flag for
  -- the duration of their transaction. Anything else — including a direct
  -- PostgREST PATCH from the browser — has it unset and may not touch money.
  if coalesce(current_setting('tradosphere.trusted_write', true), 'off') = 'on' then
    return new;
  end if;

  if new.cash_balance is distinct from old.cash_balance
     or new.starting_capital is distinct from old.starting_capital
     or new.user_id is distinct from old.user_id
     or new.currency is distinct from old.currency then
    raise exception
      'Financial columns on paper_accounts are server-controlled and cannot be written directly. Place orders through place_paper_order().'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_paper_account_financials on public.paper_accounts;
create trigger guard_paper_account_financials
  before update on public.paper_accounts
  for each row execute function public.guard_paper_account_financials();

-- ----------------------------------------------------------------------------
-- 3. Belt-and-braces: reject any direct write to the ledger tables that did
--    not originate from a trusted server-side function, even if a future
--    migration re-grants privileges by accident.
-- ----------------------------------------------------------------------------
create or replace function public.require_trusted_write()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if coalesce(current_setting('tradosphere.trusted_write', true), 'off') <> 'on' then
    raise exception
      '% is an append-only ledger written by the trading engine; direct writes are rejected.', tg_table_name
      using errcode = '42501';
  end if;
  return case tg_op when 'DELETE' then old else new end;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['orders', 'trades', 'positions']
  loop
    execute format('drop trigger if exists require_trusted_write on public.%I', t);
    execute format(
      'create trigger require_trusted_write before insert or update or delete on public.%I
         for each row execute function public.require_trusted_write()', t);
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 4. Helper used by every trading function to open a trusted window.
--    `true` = local to the current transaction, so it can never leak into a
--    later statement on a pooled connection.
-- ----------------------------------------------------------------------------
create or replace function public.begin_trusted_write()
returns void
language sql
security definer set search_path = public
as $$
  select set_config('tradosphere.trusted_write', 'on', true);
$$;

-- Not callable by clients — only by other SECURITY DEFINER functions in this
-- schema, which run as the owner.
revoke all on function public.begin_trusted_write() from public, anon, authenticated;
