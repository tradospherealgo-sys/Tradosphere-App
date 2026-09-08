-- ============================================================================
-- INSTRUMENT REGISTRY
--
-- A symbol master so the app stops treating instruments as free text. It
-- gives three things the audit called out as missing:
--   * a typeahead source for the order ticket and watchlist, instead of a
--     free-text box that silently accepts a typo and then reports "no quote";
--   * lot sizes, without which lot-based position sizing is impossible;
--   * an explicit list of which symbols are indices, which is what the
--     dashboard market-snapshot cards iterate over.
--
-- Rows here are reference data (names, lot sizes, exchange codes) — not
-- prices. Nothing in this table is or implies a quote. It is populated by an
-- admin sync from the configured market-data provider; an unsynced
-- deployment simply has an empty registry and the pickers say so.
-- ============================================================================

create table if not exists public.instruments (
  id uuid primary key default gen_random_uuid(),
  symbol text not null,
  exchange text not null default 'NSE',
  name text,
  instrument_kind public.instrument_kind not null default 'EQUITY',
  -- Contract multiplier. 1 for cash equity; the real lot size for F&O.
  lot_size integer not null default 1 check (lot_size > 0),
  tick_size numeric(10,4) not null default 0.05 check (tick_size > 0),
  is_index boolean not null default false,
  is_active boolean not null default true,
  -- Provider-specific identifier (SMC token, exchange scrip code, ...) so the
  -- provider adapter can map our symbol to whatever the vendor expects.
  provider_token text,
  sort_order integer not null default 0,
  updated_at timestamptz not null default now(),
  unique (exchange, symbol)
);

create index if not exists instruments_lookup_idx
  on public.instruments(is_active, is_index, symbol);

drop trigger if exists set_updated_at on public.instruments;
create trigger set_updated_at before update on public.instruments
  for each row execute function public.set_updated_at();

alter table public.instruments enable row level security;

drop policy if exists instruments_read_all on public.instruments;
create policy instruments_read_all on public.instruments
  for select using (auth.role() = 'authenticated');

drop policy if exists instruments_admin_write on public.instruments;
create policy instruments_admin_write on public.instruments
  for all using (is_admin()) with check (is_admin());

-- ----------------------------------------------------------------------------
-- Index reference set. These are identifiers and lot sizes only — the
-- dashboard renders an empty card for each until a provider supplies a quote.
-- ----------------------------------------------------------------------------
insert into public.instruments (symbol, exchange, name, instrument_kind, lot_size, is_index, sort_order)
values
  ('NIFTY 50',        'NSE', 'Nifty 50',        'EQUITY', 75, true, 1),
  ('NIFTY BANK',      'NSE', 'Bank Nifty',      'EQUITY', 30, true, 2),
  ('NIFTY FIN SERVICE','NSE','Nifty Financial Services', 'EQUITY', 65, true, 3),
  ('NIFTY MIDCAP 100','NSE', 'Nifty Midcap 100','EQUITY', 1,  true, 4)
on conflict (exchange, symbol) do nothing;
