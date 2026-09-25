-- ============================================================================
-- WATCHLIST SYMBOL VALIDATION
--
-- addWatchlistItem (src/lib/app-data/actions.ts) now checks the symbol
-- against public.instruments before inserting, but that check runs in the
-- Next.js server action only. watchlist_items' RLS policy is `for all`
-- scoped to the owning watchlist (0002_rls.sql) — it says nothing about the
-- *symbol* value, so an authenticated client can call supabase-js directly
-- (same anon/authenticated key, same PostgREST endpoint) and insert any
-- free-text string, bypassing the action entirely. This is the same gap
-- 0033_paper_trading_rpc_validation.sql closed for the trading RPCs: the
-- application-layer check is real, but it is not the only door.
--
-- A trigger closes it here for the same reason a CHECK constraint can't:
-- validity depends on a lookup in another table (public.instruments), not
-- just the row's own columns.
-- ============================================================================

create or replace function public.validate_watchlist_symbol()
returns trigger
language plpgsql
as $$
begin
  new.symbol := upper(btrim(new.symbol));

  if new.symbol = '' then
    raise exception 'Symbol cannot be empty.';
  end if;

  if not exists (
    select 1 from public.instruments
    where symbol = new.symbol and is_active = true
  ) then
    raise exception '% is not a recognized, tradable symbol.', new.symbol;
  end if;

  return new;
end;
$$;

drop trigger if exists validate_watchlist_symbol on public.watchlist_items;
create trigger validate_watchlist_symbol
  before insert or update of symbol on public.watchlist_items
  for each row execute function public.validate_watchlist_symbol();
