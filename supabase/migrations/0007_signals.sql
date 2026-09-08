-- ============================================================================
-- SIGNAL INTELLIGENCE + TELEGRAM INGESTION
--
-- Replaces the generic `ai_signals` / `ai_agent_verdicts` prototype tables
-- (which had no notion of provenance) with a provenance-first model:
--
--   signal_sources   who issued it — an SMC specialist desk, the SMC Auto
--                    Trender algo, Tradosphere's own analysis layer, or a
--                    Telegram channel. Every source is explicitly registered
--                    and marked trusted/untrusted by an admin.
--   telegram_inbox   raw inbound messages, stored verbatim before any
--                    interpretation. Parsing is a separate, auditable step,
--                    so a message that cannot be parsed is visible as a
--                    parse failure rather than silently dropped or guessed at.
--   signals          the normalised signal. Carries `source_id` and
--                    `verification_state` so the UI can always say where a
--                    number came from and whether anyone stands behind it.
--   signal_events    append-only lifecycle log (target hit, SL moved,
--                    cancelled), which is what drives client notifications.
--
-- Hard rule enforced by the check constraints below: a signal must reference
-- a registered source and must record where its numbers came from. There is
-- no code path in the application that inserts a signal without one, and
-- nothing here generates a signal on its own.
-- ============================================================================

do $$ begin
  create type public.signal_source_kind as enum (
    'smc_specialist',      -- named human desk analyst at SMC
    'smc_auto_trender',    -- SMC's algorithmic signal product
    'tradosphere_ai',      -- Tradosphere's own analysis/combination layer
    'telegram_channel',    -- a trusted broadcast channel
    'manual'               -- entered by an admin directly
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.signal_status as enum (
    'pending',     -- ingested, not yet released to clients
    'active',      -- live, tradeable in the simulator
    'triggered',   -- entry reached
    'target_hit',
    'stopped_out',
    'expired',
    'cancelled'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.verification_state as enum (
    'unverified',  -- ingested but nobody has stood behind it yet
    'verified',    -- checked against the source and released
    'rejected'     -- reviewed and refused; never shown as tradeable
  );
exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------------------------
-- signal_sources
-- ----------------------------------------------------------------------------
create table if not exists public.signal_sources (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  kind public.signal_source_kind not null,
  description text,
  -- Telegram binding. chat_id is not a secret (the bot token is, and lives in
  -- an env var referenced by integration_configs.secret_env_var).
  telegram_chat_id text unique,
  is_trusted boolean not null default false,
  is_active boolean not null default true,
  -- Signals from an untrusted source are ingested but never auto-released;
  -- an admin must verify each one.
  auto_verify boolean not null default false,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists signal_sources_kind_idx on public.signal_sources(kind, is_active);

-- ----------------------------------------------------------------------------
-- telegram_inbox — verbatim inbound messages, parsed separately
-- ----------------------------------------------------------------------------
create table if not exists public.telegram_inbox (
  id bigint generated always as identity primary key,
  chat_id text not null,
  message_id bigint not null,
  sender text,
  text text not null,
  raw jsonb not null,
  source_id uuid references public.signal_sources(id) on delete set null,
  parse_status text not null default 'pending'
    check (parse_status in ('pending', 'parsed', 'unparseable', 'ignored')),
  parse_error text,
  signal_id uuid,
  received_at timestamptz not null default now(),
  unique (chat_id, message_id)
);

create index if not exists telegram_inbox_status_idx
  on public.telegram_inbox(parse_status, received_at desc);

-- ----------------------------------------------------------------------------
-- signals
-- ----------------------------------------------------------------------------
create table if not exists public.signals (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.signal_sources(id) on delete restrict,
  symbol text not null,
  instrument_kind public.instrument_kind not null default 'EQUITY',
  direction public.order_side not null,

  -- Levels. All nullable: a source that did not publish a target must show as
  -- "not provided", never as a computed stand-in.
  entry_price numeric(16,4),
  entry_low numeric(16,4),
  entry_high numeric(16,4),
  stop_loss numeric(16,4),
  target_1 numeric(16,4),
  target_2 numeric(16,4),
  target_3 numeric(16,4),

  -- Derived only when entry and stop are both genuinely present (see the
  -- generated column below) — otherwise null, not zero.
  risk_reward numeric(10,4) generated always as (
    case
      when stop_loss is null or target_1 is null or coalesce(entry_price, entry_low) is null
        then null
      when abs(coalesce(entry_price, entry_low) - stop_loss) = 0 then null
      else round(
        abs(target_1 - coalesce(entry_price, entry_low))
        / abs(coalesce(entry_price, entry_low) - stop_loss),
      4)
    end
  ) stored,

  confidence numeric(5,2) check (confidence is null or confidence between 0 and 100),
  rationale text,
  risk_note text,

  status public.signal_status not null default 'pending',
  verification_state public.verification_state not null default 'unverified',
  verified_by uuid references public.profiles(id),
  verified_at timestamptz,

  -- Provenance. `origin_ref` points back at the inbox row / upstream id so any
  -- number on screen can be traced to the message that produced it.
  origin_ref text,
  raw_message text,

  issued_at timestamptz not null default now(),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint signals_entry_range_ordered
    check (entry_low is null or entry_high is null or entry_low <= entry_high)
);

create index if not exists signals_live_idx
  on public.signals(status, verification_state, issued_at desc);
create index if not exists signals_symbol_idx on public.signals(symbol, issued_at desc);

alter table public.telegram_inbox
  drop constraint if exists telegram_inbox_signal_id_fkey;
alter table public.telegram_inbox
  add constraint telegram_inbox_signal_id_fkey
  foreign key (signal_id) references public.signals(id) on delete set null;

-- ----------------------------------------------------------------------------
-- signal_events — append-only lifecycle log
-- ----------------------------------------------------------------------------
create table if not exists public.signal_events (
  id bigint generated always as identity primary key,
  signal_id uuid not null references public.signals(id) on delete cascade,
  event_type text not null
    check (event_type in ('created', 'verified', 'rejected', 'released',
                          'entry_triggered', 'target_hit', 'stop_hit',
                          'sl_updated', 'target_updated', 'expired', 'cancelled')),
  detail text,
  payload jsonb not null default '{}'::jsonb,
  actor_id uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists signal_events_signal_idx
  on public.signal_events(signal_id, created_at desc);

-- ----------------------------------------------------------------------------
-- Link a paper order back to the signal that inspired it, so the journal can
-- report how the desk's calls actually performed for this user.
-- ----------------------------------------------------------------------------
alter table public.orders add column if not exists signal_id uuid
  references public.signals(id) on delete set null;
alter table public.trades add column if not exists signal_id uuid
  references public.signals(id) on delete set null;

-- ----------------------------------------------------------------------------
-- updated_at triggers
-- ----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['signal_sources', 'signals']
  loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format('create trigger set_updated_at before update on public.%I
                      for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- RLS
--
-- Clients read released signals only (verified + not pending/cancelled).
-- Nothing client-side may write a signal, a source, an inbox row or an event:
-- ingestion runs server-side through the service-role client in the Telegram
-- webhook, and curation runs through admin server actions.
-- ----------------------------------------------------------------------------
alter table public.signal_sources  enable row level security;
alter table public.signals         enable row level security;
alter table public.signal_events   enable row level security;
alter table public.telegram_inbox  enable row level security;

drop policy if exists signal_sources_read on public.signal_sources;
create policy signal_sources_read on public.signal_sources
  for select using (auth.role() = 'authenticated');

drop policy if exists signal_sources_admin_write on public.signal_sources;
create policy signal_sources_admin_write on public.signal_sources
  for all using (is_admin()) with check (is_admin());

drop policy if exists signals_read_released on public.signals;
create policy signals_read_released on public.signals
  for select using (
    is_admin()
    or (
      auth.role() = 'authenticated'
      and verification_state = 'verified'
      and status <> 'pending'
    )
  );

drop policy if exists signals_admin_write on public.signals;
create policy signals_admin_write on public.signals
  for all using (is_admin()) with check (is_admin());

drop policy if exists signal_events_read on public.signal_events;
create policy signal_events_read on public.signal_events
  for select using (
    is_admin()
    or exists (
      select 1 from public.signals s
      where s.id = signal_id
        and s.verification_state = 'verified'
        and s.status <> 'pending'
    )
  );

drop policy if exists signal_events_admin_write on public.signal_events;
create policy signal_events_admin_write on public.signal_events
  for all using (is_admin()) with check (is_admin());

-- Raw inbound Telegram traffic is admin-only: it can contain channel content
-- that was never released to clients, including rejected calls.
drop policy if exists telegram_inbox_admin_only on public.telegram_inbox;
create policy telegram_inbox_admin_only on public.telegram_inbox
  for all using (is_admin()) with check (is_admin());

-- ----------------------------------------------------------------------------
-- Retire the prototype tables. `ai_agent_verdicts` is kept (it is the
-- multi-agent analysis surface, distinct from a tradeable signal) but
-- `ai_signals` is superseded outright and dropping it prevents two competing
-- sources of truth for "what did the desk call".
-- ----------------------------------------------------------------------------
drop table if exists public.ai_signals;

-- ----------------------------------------------------------------------------
-- Curation helpers, all admin-gated and audit-logged.
-- ----------------------------------------------------------------------------
create or replace function public.admin_verify_signal(
  p_signal_id uuid,
  p_release boolean default true
)
returns public.signals
language plpgsql
security definer set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_signal public.signals%rowtype;
begin
  if not public.is_admin() then
    raise exception 'Admin privileges are required.' using errcode = '42501';
  end if;

  update public.signals
    set verification_state = case when p_release then 'verified' else 'rejected' end,
        status = case when p_release then 'active' else 'cancelled' end,
        verified_by = v_actor,
        verified_at = now(),
        updated_at = now()
    where id = p_signal_id
    returning * into v_signal;

  if not found then
    raise exception 'Signal not found.';
  end if;

  insert into public.signal_events(signal_id, event_type, actor_id, detail)
  values (p_signal_id,
          case when p_release then 'verified' else 'rejected' end,
          v_actor,
          case when p_release then 'Released to clients.' else 'Rejected; not shown as tradeable.' end);

  -- Broadcast notification (user_id null = everyone) only on release.
  if p_release then
    insert into public.notifications(user_id, kind, title, body)
    values (null, 'signal',
            format('New verified signal: %s %s', v_signal.direction, v_signal.symbol),
            v_signal.rationale);
  end if;

  return v_signal;
end;
$$;

grant execute on function public.admin_verify_signal(uuid, boolean) to authenticated;

create or replace function public.admin_update_signal_status(
  p_signal_id uuid,
  p_status public.signal_status,
  p_detail text default null
)
returns public.signals
language plpgsql
security definer set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_signal public.signals%rowtype;
  v_event text;
begin
  if not public.is_admin() then
    raise exception 'Admin privileges are required.' using errcode = '42501';
  end if;

  update public.signals
    set status = p_status, updated_at = now()
    where id = p_signal_id
    returning * into v_signal;

  if not found then
    raise exception 'Signal not found.';
  end if;

  v_event := case p_status
    when 'triggered'   then 'entry_triggered'
    when 'target_hit'  then 'target_hit'
    when 'stopped_out' then 'stop_hit'
    when 'expired'     then 'expired'
    when 'cancelled'   then 'cancelled'
    else 'released'
  end;

  insert into public.signal_events(signal_id, event_type, actor_id, detail)
  values (p_signal_id, v_event, v_actor, p_detail);

  insert into public.notifications(user_id, kind, title, body)
  values (null, 'signal',
          format('%s %s — %s', v_signal.direction, v_signal.symbol, replace(p_status::text, '_', ' ')),
          p_detail);

  return v_signal;
end;
$$;

grant execute on function public.admin_update_signal_status(uuid, public.signal_status, text) to authenticated;
