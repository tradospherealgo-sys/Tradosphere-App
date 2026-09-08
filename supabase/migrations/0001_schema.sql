-- ============================================================================
-- Tradosphere Wealth Management — V1 schema
-- Educational paper-trading + market-intelligence platform.
-- No real-money trading, no broker execution. All positions/orders here are
-- simulated against market data (real if a provider is configured, or
-- withheld/empty if not — never fabricated).
-- ============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- Roles
-- ----------------------------------------------------------------------------
do $$ begin
  create type public.app_role as enum ('user', 'admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.order_side as enum ('BUY', 'SELL');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.order_status as enum ('FILLED', 'REJECTED', 'CANCELLED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.instrument_kind as enum ('EQUITY', 'INDEX_OPTION', 'STOCK_OPTION');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.notification_kind as enum ('system', 'trade', 'signal', 'education', 'announcement');
exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------------------------
-- profiles — one row per auth.users row (created by trigger below)
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  avatar_url text,
  role public.app_role not null default 'user',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_role_idx on public.profiles(role);

-- ----------------------------------------------------------------------------
-- paper_accounts — one simulated brokerage account per user (V1: 1:1)
-- ----------------------------------------------------------------------------
create table if not exists public.paper_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  starting_capital numeric(16,2) not null default 1000000,
  cash_balance numeric(16,2) not null default 1000000,
  risk_per_trade_pct numeric(5,2) not null default 1.0,
  currency text not null default 'INR',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id)
);

-- ----------------------------------------------------------------------------
-- orders — every simulated order attempt (filled or rejected)
-- ----------------------------------------------------------------------------
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.paper_accounts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  symbol text not null,
  instrument_kind public.instrument_kind not null default 'EQUITY',
  side public.order_side not null,
  quantity numeric(14,4) not null check (quantity > 0),
  price numeric(16,4) not null check (price >= 0),
  status public.order_status not null default 'FILLED',
  reject_reason text,
  quote_source text,
  quote_as_of timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists orders_account_idx on public.orders(account_id, created_at desc);
create index if not exists orders_user_idx on public.orders(user_id, created_at desc);

-- ----------------------------------------------------------------------------
-- positions — current open exposure per account+symbol+side
-- ----------------------------------------------------------------------------
create table if not exists public.positions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.paper_accounts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  symbol text not null,
  instrument_kind public.instrument_kind not null default 'EQUITY',
  side public.order_side not null,
  quantity numeric(14,4) not null check (quantity > 0),
  avg_price numeric(16,4) not null,
  opened_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, symbol, side)
);

create index if not exists positions_account_idx on public.positions(account_id);

-- ----------------------------------------------------------------------------
-- trades — closed-position journal (realized P&L)
-- ----------------------------------------------------------------------------
create table if not exists public.trades (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.paper_accounts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  symbol text not null,
  side public.order_side not null,
  quantity numeric(14,4) not null,
  entry_price numeric(16,4) not null,
  exit_price numeric(16,4) not null,
  realized_pnl numeric(16,2) not null,
  opened_at timestamptz not null,
  closed_at timestamptz not null default now(),
  origin text,
  notes text
);

create index if not exists trades_account_idx on public.trades(account_id, closed_at desc);

-- ----------------------------------------------------------------------------
-- watchlists / watchlist_items
-- ----------------------------------------------------------------------------
create table if not exists public.watchlists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null default 'My Watchlist',
  created_at timestamptz not null default now()
);

create table if not exists public.watchlist_items (
  id uuid primary key default gen_random_uuid(),
  watchlist_id uuid not null references public.watchlists(id) on delete cascade,
  symbol text not null,
  added_at timestamptz not null default now(),
  unique (watchlist_id, symbol)
);

-- ----------------------------------------------------------------------------
-- market_data_cache — last-known real quote per symbol (provider-sourced)
-- ----------------------------------------------------------------------------
create table if not exists public.market_data_cache (
  symbol text primary key,
  name text,
  last_price numeric(16,4),
  prev_close numeric(16,4),
  day_open numeric(16,4),
  day_high numeric(16,4),
  day_low numeric(16,4),
  volume bigint,
  as_of timestamptz,
  source text not null,
  raw jsonb,
  updated_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- ohlc_candles — historical candles (provider-sourced, cached)
-- ----------------------------------------------------------------------------
create table if not exists public.ohlc_candles (
  id bigint generated always as identity primary key,
  symbol text not null,
  interval text not null, -- '1d','1h','15m',...
  ts timestamptz not null,
  open numeric(16,4) not null,
  high numeric(16,4) not null,
  low numeric(16,4) not null,
  close numeric(16,4) not null,
  volume bigint,
  source text not null,
  unique (symbol, interval, ts)
);

create index if not exists ohlc_symbol_idx on public.ohlc_candles(symbol, interval, ts desc);

-- ----------------------------------------------------------------------------
-- option_chain_snapshots — real chain pulls only (never synthetic)
-- ----------------------------------------------------------------------------
create table if not exists public.option_chain_snapshots (
  id bigint generated always as identity primary key,
  underlying text not null,
  expiry date not null,
  strike numeric(16,4) not null,
  option_type text not null check (option_type in ('CE','PE')),
  ltp numeric(16,4),
  bid numeric(16,4),
  ask numeric(16,4),
  volume bigint,
  oi bigint,
  change_oi bigint,
  iv numeric(8,4),
  delta numeric(8,4),
  gamma numeric(10,6),
  theta numeric(10,6),
  vega numeric(10,6),
  spot_at_capture numeric(16,4),
  source text not null,
  captured_at timestamptz not null default now()
);

create index if not exists occ_lookup_idx on public.option_chain_snapshots(underlying, expiry, captured_at desc);

-- ----------------------------------------------------------------------------
-- ai_signals / ai_agent_verdicts
-- ----------------------------------------------------------------------------
create table if not exists public.ai_signals (
  id uuid primary key default gen_random_uuid(),
  symbol text not null,
  label text not null,
  side public.order_side not null,
  entry_low numeric(16,4),
  entry_high numeric(16,4),
  stop_loss numeric(16,4),
  target_1 numeric(16,4),
  target_2 numeric(16,4),
  confidence numeric(5,2),
  source text,
  rationale jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.ai_agent_verdicts (
  id uuid primary key default gen_random_uuid(),
  symbol text not null,
  agent_name text not null,
  focus text,
  verdict text not null check (verdict in ('BULLISH','BEARISH','NEUTRAL')),
  confidence numeric(5,2),
  thesis text,
  rationale jsonb,
  suggested_action text,
  generated_at timestamptz not null default now()
);

create index if not exists ai_signals_symbol_idx on public.ai_signals(symbol, is_active);
create index if not exists ai_verdicts_symbol_idx on public.ai_agent_verdicts(symbol, generated_at desc);

-- ----------------------------------------------------------------------------
-- education: modules + progress
-- ----------------------------------------------------------------------------
create table if not exists public.education_modules (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  blurb text,
  icon text,
  minutes integer default 5,
  sort_order integer default 0,
  is_published boolean not null default true,
  content jsonb not null default '[]'::jsonb, -- array of {h, p}
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.education_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  module_id uuid not null references public.education_modules(id) on delete cascade,
  progress_pct integer not null default 0 check (progress_pct between 0 and 100),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (user_id, module_id)
);

-- ----------------------------------------------------------------------------
-- coach_messages — trading-coach chat log (per user)
-- ----------------------------------------------------------------------------
create table if not exists public.coach_messages (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists coach_messages_user_idx on public.coach_messages(user_id, created_at);

-- ----------------------------------------------------------------------------
-- notifications
-- ----------------------------------------------------------------------------
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade, -- null = broadcast/announcement
  kind public.notification_kind not null default 'system',
  title text not null,
  body text,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_idx on public.notifications(user_id, is_read, created_at desc);

-- ----------------------------------------------------------------------------
-- integration_configs — provider selection + non-secret config.
-- Secret values (API keys) are NEVER stored here in plaintext for
-- browser-readable rows; they live in server env vars, referenced by name.
-- This table only stores which provider is active and its public config.
-- ----------------------------------------------------------------------------
create table if not exists public.integration_configs (
  id text primary key, -- e.g. 'market_data_provider'
  provider text not null, -- e.g. 'none' | 'nse_unofficial' | 'generic_rest'
  config jsonb not null default '{}'::jsonb, -- non-secret settings (base URL, symbol map, etc.)
  secret_env_var text, -- name of the env var holding the secret, if any (never the secret itself)
  is_enabled boolean not null default false,
  last_tested_at timestamptz,
  last_test_result jsonb,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- system_settings — global app config, admin-editable
-- ----------------------------------------------------------------------------
create table if not exists public.system_settings (
  key text primary key,
  value jsonb not null,
  description text,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- audit_logs — admin/system actions
-- ----------------------------------------------------------------------------
create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id),
  action text not null,
  target_table text,
  target_id text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_logs_actor_idx on public.audit_logs(actor_id, created_at desc);

-- ----------------------------------------------------------------------------
-- updated_at triggers
-- ----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['profiles','paper_accounts','positions','education_modules','education_progress','integration_configs','system_settings']
  loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- new-user provisioning: create profile + paper account on signup
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;

  insert into public.paper_accounts (user_id, starting_capital, cash_balance)
  values (new.id, 1000000, 1000000)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
