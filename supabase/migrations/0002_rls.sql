-- ============================================================================
-- Row Level Security — every user-facing table is locked down by default.
-- Pattern: users can read/write only their own rows; admins (role='admin'
-- in profiles) can read everything via the is_admin() helper. Tables that
-- hold provider secrets' metadata or system config are admin-only, and
-- actual secret values never live in a table the client can query at all
-- (see integration_configs.secret_env_var — it's a pointer, not a value).
-- ============================================================================

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and is_active
  );
$$;

create or replace function public.is_self(target uuid)
returns boolean
language sql
stable
as $$
  select auth.uid() = target;
$$;

-- ---------------------------------------------------------------- profiles
alter table public.profiles enable row level security;

drop policy if exists profiles_select_own_or_admin on public.profiles;
create policy profiles_select_own_or_admin on public.profiles
  for select using (is_self(id) or is_admin());

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update using (is_self(id)) with check (is_self(id));
-- Role escalation is blocked below by a BEFORE UPDATE trigger (RLS's
-- WITH CHECK cannot reliably compare NEW vs OLD column values, so a
-- trigger is the correct enforcement point). Only the service-role
-- client — used exclusively in admin-verified API routes — may change
-- `role`.

drop policy if exists profiles_admin_all on public.profiles;
create policy profiles_admin_all on public.profiles
  for all using (is_admin()) with check (is_admin());

-- Block self-escalation: a non-admin who updates their own profile row
-- cannot change `role` or `is_active`, even though the RLS policy above
-- otherwise allows updating their own row. Runs for every update
-- regardless of actor, but only intervenes when the actor is not admin.
create or replace function public.prevent_role_self_escalation()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.is_admin() then
    if new.role is distinct from old.role or new.is_active is distinct from old.is_active then
      raise exception 'Only an admin can change role or is_active.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists prevent_role_self_escalation on public.profiles;
create trigger prevent_role_self_escalation
  before update on public.profiles
  for each row execute function public.prevent_role_self_escalation();

-- ---------------------------------------------------------- paper_accounts
alter table public.paper_accounts enable row level security;

drop policy if exists paper_accounts_owner on public.paper_accounts;
create policy paper_accounts_owner on public.paper_accounts
  for select using (is_self(user_id) or is_admin());

drop policy if exists paper_accounts_owner_update on public.paper_accounts;
create policy paper_accounts_owner_update on public.paper_accounts
  for update using (is_self(user_id) or is_admin());

drop policy if exists paper_accounts_owner_insert on public.paper_accounts;
create policy paper_accounts_owner_insert on public.paper_accounts
  for insert with check (is_self(user_id) or is_admin());

-- ------------------------------------------------------------------ orders
alter table public.orders enable row level security;

drop policy if exists orders_owner_select on public.orders;
create policy orders_owner_select on public.orders
  for select using (is_self(user_id) or is_admin());

drop policy if exists orders_owner_insert on public.orders;
create policy orders_owner_insert on public.orders
  for insert with check (is_self(user_id));

-- Orders are immutable once placed (no update/delete policy => denied by
-- default once RLS is enabled).

-- --------------------------------------------------------------- positions
alter table public.positions enable row level security;

drop policy if exists positions_owner_select on public.positions;
create policy positions_owner_select on public.positions
  for select using (is_self(user_id) or is_admin());

drop policy if exists positions_owner_write on public.positions;
create policy positions_owner_write on public.positions
  for all using (is_self(user_id) or is_admin()) with check (is_self(user_id) or is_admin());

-- ------------------------------------------------------------------ trades
alter table public.trades enable row level security;

drop policy if exists trades_owner_select on public.trades;
create policy trades_owner_select on public.trades
  for select using (is_self(user_id) or is_admin());

drop policy if exists trades_owner_insert on public.trades;
create policy trades_owner_insert on public.trades
  for insert with check (is_self(user_id));

-- -------------------------------------------------------------- watchlists
alter table public.watchlists enable row level security;
alter table public.watchlist_items enable row level security;

drop policy if exists watchlists_owner on public.watchlists;
create policy watchlists_owner on public.watchlists
  for all using (is_self(user_id) or is_admin()) with check (is_self(user_id) or is_admin());

drop policy if exists watchlist_items_owner on public.watchlist_items;
create policy watchlist_items_owner on public.watchlist_items
  for all using (
    exists (select 1 from public.watchlists w where w.id = watchlist_id and (is_self(w.user_id) or is_admin()))
  ) with check (
    exists (select 1 from public.watchlists w where w.id = watchlist_id and (is_self(w.user_id) or is_admin()))
  );

-- ------------------------------------------------ market data (read-only, public to authenticated)
alter table public.market_data_cache enable row level security;
alter table public.ohlc_candles enable row level security;
alter table public.option_chain_snapshots enable row level security;

drop policy if exists market_data_read_all on public.market_data_cache;
create policy market_data_read_all on public.market_data_cache
  for select using (auth.role() = 'authenticated');

drop policy if exists ohlc_read_all on public.ohlc_candles;
create policy ohlc_read_all on public.ohlc_candles
  for select using (auth.role() = 'authenticated');

drop policy if exists occ_read_all on public.option_chain_snapshots;
create policy occ_read_all on public.option_chain_snapshots
  for select using (auth.role() = 'authenticated');

-- Writes to market data tables happen only via the service-role client
-- inside server-side fetch routes — no client insert/update policy exists,
-- so RLS denies it by default even for authenticated users.

-- --------------------------------------------------------------- ai tables
alter table public.ai_signals enable row level security;
alter table public.ai_agent_verdicts enable row level security;

drop policy if exists ai_signals_read_all on public.ai_signals;
create policy ai_signals_read_all on public.ai_signals
  for select using (auth.role() = 'authenticated');

drop policy if exists ai_verdicts_read_all on public.ai_agent_verdicts;
create policy ai_verdicts_read_all on public.ai_agent_verdicts
  for select using (auth.role() = 'authenticated');

drop policy if exists ai_signals_admin_write on public.ai_signals;
create policy ai_signals_admin_write on public.ai_signals
  for all using (is_admin()) with check (is_admin());

drop policy if exists ai_verdicts_admin_write on public.ai_agent_verdicts;
create policy ai_verdicts_admin_write on public.ai_agent_verdicts
  for all using (is_admin()) with check (is_admin());

-- ------------------------------------------------------------- education
alter table public.education_modules enable row level security;
alter table public.education_progress enable row level security;

drop policy if exists education_modules_read_published on public.education_modules;
create policy education_modules_read_published on public.education_modules
  for select using (is_published or is_admin());

drop policy if exists education_modules_admin_write on public.education_modules;
create policy education_modules_admin_write on public.education_modules
  for all using (is_admin()) with check (is_admin());

drop policy if exists education_progress_owner on public.education_progress;
create policy education_progress_owner on public.education_progress
  for all using (is_self(user_id) or is_admin()) with check (is_self(user_id) or is_admin());

-- --------------------------------------------------------------- coaching
alter table public.coach_messages enable row level security;

drop policy if exists coach_messages_owner on public.coach_messages;
create policy coach_messages_owner on public.coach_messages
  for all using (is_self(user_id) or is_admin()) with check (is_self(user_id) or is_admin());

-- ---------------------------------------------------------- notifications
alter table public.notifications enable row level security;

drop policy if exists notifications_owner_or_broadcast on public.notifications;
create policy notifications_owner_or_broadcast on public.notifications
  for select using (is_self(user_id) or user_id is null or is_admin());

drop policy if exists notifications_owner_update on public.notifications;
create policy notifications_owner_update on public.notifications
  for update using (is_self(user_id) or is_admin());

drop policy if exists notifications_admin_write on public.notifications;
create policy notifications_admin_write on public.notifications
  for insert with check (is_admin());

drop policy if exists notifications_admin_delete on public.notifications;
create policy notifications_admin_delete on public.notifications
  for delete using (is_admin());

-- -------------------------------------------------- admin-only config/audit
alter table public.integration_configs enable row level security;
alter table public.system_settings enable row level security;
alter table public.audit_logs enable row level security;

drop policy if exists integration_configs_admin_only on public.integration_configs;
create policy integration_configs_admin_only on public.integration_configs
  for all using (is_admin()) with check (is_admin());

drop policy if exists system_settings_admin_only on public.system_settings;
create policy system_settings_admin_only on public.system_settings
  for all using (is_admin()) with check (is_admin());

drop policy if exists audit_logs_admin_read on public.audit_logs;
create policy audit_logs_admin_read on public.audit_logs
  for select using (is_admin());

-- audit_logs inserts happen only via the service-role client server-side.
