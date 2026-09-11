-- ============================================================================
-- SIGNAL OS — multi-source ingestion, classification, dedup, distribution
--
-- Extends the provenance-first model from 0007/0011 rather than replacing it.
-- The existing Telegram webhook (src/lib/signals/ingest.ts, telegram_inbox)
-- keeps working exactly as-is: rule-based parsing of one bot's chats into
-- tradeable F&O/EQUITY signals, admin-reviewed.
--
-- This migration adds a second, source-agnostic ingestion path for the n8n
-- Signal OS pipeline (n8n/tradosphere-signal-os-master.json), which:
--   * pulls from multiple Telegram channels, WhatsApp groups, and future API
--     connectors (signal_sources.kind already had `smc_auto_trender` — see
--     0011 — anticipating exactly this),
--   * runs an AI agent over the raw text to classify it into one of twelve
--     categories (trade calls and non-trade content alike — an IPO notice or
--     an education note is a real thing a desk sends and a client should see,
--     it just never has a direction or a stop-loss),
--   * writes through `raw_signal_messages` (this migration's analogue of
--     `telegram_inbox`, but channel-agnostic) before anything is classified,
--   * and only ever inserts a signal through `ingest_classified_signal`,
--     which is service-role-only — the browser anon/authenticated roles
--     cannot call it, matching the existing `system_release_signal` model.
--
-- `signals` gains a `category` column and `direction`/trade-level columns
-- become meaningful-when-present rather than mandatory: a MUTUAL_FUND or
-- EDUCATION item has no direction, and forcing one would mean inventing it,
-- which is the one thing this whole system is built to never do.
-- ============================================================================

do $$ begin
  create type public.signal_category as enum (
    'F&O', 'EQUITY', 'COMMODITY', 'IPO', 'SIP', 'MUTUAL_FUND',
    'INVESTMENT', 'INSURANCE', 'LOAN', 'MARKET_UPDATE', 'EDUCATION', 'OTHER'
  );
exception when duplicate_object then null; end $$;

-- WhatsApp groups and generic future API connectors, alongside the
-- `smc_auto_trender` kind 0011 already reserved for this purpose.
alter type public.signal_source_kind add value if not exists 'whatsapp_group';
alter type public.signal_source_kind add value if not exists 'api_connector';

-- Commodity signals (MCX) are a real category the desk sends but neither
-- EQUITY nor INDEX_OPTION/STOCK_OPTION describes them — 0001 only anticipated
-- equity cash and derivatives. Adding a fourth value rather than force-fitting
-- a commodity signal into STOCK_OPTION, which would misrepresent it.
alter type public.instrument_kind add value if not exists 'COMMODITY';

-- WhatsApp binding, mirroring signal_sources.telegram_chat_id (0011). The n8n
-- ingestion path looks a source up by whichever of the two is populated.
alter table public.signal_sources add column if not exists whatsapp_group_id text unique;

-- ----------------------------------------------------------------------------
-- signals: widen from "tradeable call" to "classified desk message"
-- ----------------------------------------------------------------------------
alter table public.signals add column if not exists category public.signal_category;

update public.signals
  set category = case instrument_kind
    when 'EQUITY' then 'EQUITY'::public.signal_category
    else 'F&O'::public.signal_category
  end
  where category is null;

alter table public.signals alter column category set default 'OTHER';
alter table public.signals alter column category set not null;

-- A trade category still requires a direction; a non-trade category (IPO,
-- SIP, MUTUAL_FUND, INVESTMENT, INSURANCE, LOAN, MARKET_UPDATE, EDUCATION,
-- OTHER) has none. Existing rows are all trade calls and already have one.
alter table public.signals alter column direction drop not null;

alter table public.signals add column if not exists instrument_name text;
alter table public.signals add column if not exists exchange text;
alter table public.signals add column if not exists timeframe text;
alter table public.signals add column if not exists normalized_message text;
alter table public.signals add column if not exists source_message_id text;
alter table public.signals add column if not exists source_timestamp timestamptz;
alter table public.signals add column if not exists ai_model text;
alter table public.signals add column if not exists fingerprint text;

alter table public.signals drop constraint if exists signals_category_requires_direction;
alter table public.signals add constraint signals_category_requires_direction
  check (
    category not in ('F&O', 'EQUITY', 'COMMODITY') or direction is not null
  );

create index if not exists signals_category_idx on public.signals(category, issued_at desc);
create unique index if not exists signals_fingerprint_idx
  on public.signals(fingerprint) where fingerprint is not null;

-- ----------------------------------------------------------------------------
-- raw_signal_messages — verbatim inbound content from any source, before any
-- interpretation. Channel-agnostic sibling of `telegram_inbox` (0011), which
-- remains dedicated to the existing single-bot rule-based path.
-- ----------------------------------------------------------------------------
create table if not exists public.raw_signal_messages (
  id bigint generated always as identity primary key,
  source_id uuid references public.signal_sources(id) on delete set null,
  channel text not null check (channel in ('telegram', 'whatsapp', 'api', 'manual')),
  external_chat_id text,
  external_message_id text,
  sender text,
  raw_text text not null,
  raw_payload jsonb not null default '{}'::jsonb,

  -- AI agent output. `ai_extraction` is the full structured JSON the agent
  -- returned (see n8n workflow); the columns below duplicate the fields the
  -- app actually queries on so they don't need a jsonb scan.
  normalized_text text,
  ai_category public.signal_category,
  ai_confidence numeric(5,2) check (ai_confidence is null or ai_confidence between 0 and 100),
  ai_extraction jsonb,
  ai_model text,

  fingerprint text,

  parse_status text not null default 'pending'
    check (parse_status in (
      'pending', 'classified', 'validated', 'quarantined',
      'duplicate', 'published', 'rejected'
    )),
  quarantine_reason text,

  signal_id uuid references public.signals(id) on delete set null,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

-- Re-delivery of the same message from the same source is a no-op, not a new
-- row — mirrors the (chat_id, message_id) constraint on telegram_inbox.
create unique index if not exists raw_signal_messages_source_msg_idx
  on public.raw_signal_messages(source_id, external_message_id)
  where external_message_id is not null;

create unique index if not exists raw_signal_messages_fingerprint_idx
  on public.raw_signal_messages(fingerprint)
  where fingerprint is not null and parse_status not in ('rejected', 'quarantined');

create index if not exists raw_signal_messages_status_idx
  on public.raw_signal_messages(parse_status, received_at desc);

-- ----------------------------------------------------------------------------
-- distribution_logs — per-destination delivery attempts for a published
-- signal. A failed WhatsApp send must not block Telegram/dashboard, and must
-- be independently retryable — this table is what makes that auditable.
-- ----------------------------------------------------------------------------
create table if not exists public.distribution_logs (
  id bigint generated always as identity primary key,
  signal_id uuid not null references public.signals(id) on delete cascade,
  destination text not null check (destination in ('telegram', 'whatsapp', 'dashboard')),
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'failed', 'retrying')),
  attempt_count int not null default 0,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists distribution_logs_signal_idx
  on public.distribution_logs(signal_id, destination);
create index if not exists distribution_logs_pending_idx
  on public.distribution_logs(status) where status in ('pending', 'retrying');

-- ----------------------------------------------------------------------------
-- workflow_errors — sink for anything the n8n pipeline's error branches
-- catch (AI call failure, malformed JSON, insert rejected, destination
-- unreachable) so a stage failure is visible without reading n8n's own logs.
-- ----------------------------------------------------------------------------
create table if not exists public.workflow_errors (
  id bigint generated always as identity primary key,
  workflow_name text not null,
  node_name text not null,
  stage text not null,
  error_message text not null,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  resolved boolean not null default false,
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id)
);

create index if not exists workflow_errors_open_idx
  on public.workflow_errors(resolved, occurred_at desc);

-- ----------------------------------------------------------------------------
-- updated_at trigger for distribution_logs
-- ----------------------------------------------------------------------------
drop trigger if exists set_updated_at on public.distribution_logs;
create trigger set_updated_at before update on public.distribution_logs
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- RLS — same shape as telegram_inbox: admin-only. Raw/classified pipeline
-- state can contain rejected or quarantined content that was never released.
-- ----------------------------------------------------------------------------
alter table public.raw_signal_messages enable row level security;
alter table public.distribution_logs   enable row level security;
alter table public.workflow_errors     enable row level security;

drop policy if exists raw_signal_messages_admin_only on public.raw_signal_messages;
create policy raw_signal_messages_admin_only on public.raw_signal_messages
  for all using (is_admin()) with check (is_admin());

drop policy if exists distribution_logs_admin_only on public.distribution_logs;
create policy distribution_logs_admin_only on public.distribution_logs
  for all using (is_admin()) with check (is_admin());

drop policy if exists workflow_errors_admin_only on public.workflow_errors;
create policy workflow_errors_admin_only on public.workflow_errors
  for all using (is_admin()) with check (is_admin());

-- ----------------------------------------------------------------------------
-- ingest_classified_signal — the only way the n8n pipeline is allowed to
-- create a signal. Service-role-only (browser roles are explicitly revoked
-- below), so the AI agent's output can never reach the table directly from a
-- client context. Mirrors system_release_signal's shape: re-derives the
-- auto-release decision from the source's own trusted/auto_verify flags
-- rather than trusting a flag the caller passes in.
-- ----------------------------------------------------------------------------
create or replace function public.ingest_classified_signal(
  p_source_id uuid,
  p_raw_message_id bigint,
  p_category public.signal_category,
  p_symbol text,
  p_instrument_name text default null,
  p_exchange text default null,
  p_instrument_kind public.instrument_kind default 'EQUITY',
  p_direction public.order_side default null,
  p_entry_price numeric default null,
  p_entry_low numeric default null,
  p_entry_high numeric default null,
  p_stop_loss numeric default null,
  p_target_1 numeric default null,
  p_target_2 numeric default null,
  p_target_3 numeric default null,
  p_expiry timestamptz default null,
  p_timeframe text default null,
  p_confidence numeric default null,
  p_rationale text default null,
  p_raw_message text default null,
  p_normalized_message text default null,
  p_source_message_id text default null,
  p_source_timestamp timestamptz default null,
  p_fingerprint text default null,
  p_ai_model text default null
)
returns public.signals
language plpgsql
security definer set search_path = public
as $$
declare
  v_signal public.signals%rowtype;
  v_source public.signal_sources%rowtype;
begin
  select * into v_source from public.signal_sources where id = p_source_id;
  if not found then
    raise exception 'Unknown signal source.';
  end if;
  if not v_source.is_active then
    raise exception 'Signal source is disabled.';
  end if;

  insert into public.signals(
    source_id, symbol, instrument_name, exchange, instrument_kind, category,
    direction, entry_price, entry_low, entry_high, stop_loss,
    target_1, target_2, target_3, expires_at, timeframe, confidence,
    rationale, raw_message, normalized_message, source_message_id,
    source_timestamp, fingerprint, ai_model,
    origin_ref
  ) values (
    p_source_id, p_symbol, p_instrument_name, p_exchange, p_instrument_kind, p_category,
    p_direction, p_entry_price, p_entry_low, p_entry_high, p_stop_loss,
    p_target_1, p_target_2, p_target_3, p_expiry, p_timeframe, p_confidence,
    p_rationale, p_raw_message, p_normalized_message, p_source_message_id,
    p_source_timestamp, p_fingerprint, p_ai_model,
    format('%s:%s', v_source.slug, coalesce(p_source_message_id, 'n8n'))
  )
  returning * into v_signal;

  insert into public.signal_events(signal_id, event_type, detail)
  values (v_signal.id, 'created', format('Ingested via Signal OS from %s.', v_source.name));

  if p_raw_message_id is not null then
    update public.raw_signal_messages
      set signal_id = v_signal.id, parse_status = 'validated', processed_at = now()
      where id = p_raw_message_id;
  end if;

  if v_source.is_trusted and v_source.auto_verify then
    perform public.system_release_signal(v_signal.id);
    select * into v_signal from public.signals where id = v_signal.id;
  end if;

  return v_signal;
end;
$$;

revoke all on function public.ingest_classified_signal(
  uuid, bigint, public.signal_category, text, text, text, public.instrument_kind,
  public.order_side, numeric, numeric, numeric, numeric, numeric, numeric, numeric,
  timestamptz, text, numeric, text, text, text, text, timestamptz, text, text
) from public, anon, authenticated;
grant execute on function public.ingest_classified_signal(
  uuid, bigint, public.signal_category, text, text, text, public.instrument_kind,
  public.order_side, numeric, numeric, numeric, numeric, numeric, numeric, numeric,
  timestamptz, text, numeric, text, text, text, text, timestamptz, text, text
) to service_role;

-- ----------------------------------------------------------------------------
-- quarantine_raw_message — deterministic reject path (Phase 4). Records why
-- without ever creating a signal row.
-- ----------------------------------------------------------------------------
create or replace function public.quarantine_raw_message(
  p_raw_message_id bigint,
  p_reason text
)
returns public.raw_signal_messages
language plpgsql
security definer set search_path = public
as $$
declare
  v_row public.raw_signal_messages%rowtype;
begin
  update public.raw_signal_messages
    set parse_status = 'quarantined', quarantine_reason = p_reason, processed_at = now()
    where id = p_raw_message_id
    returning * into v_row;

  if not found then
    raise exception 'Raw message not found.';
  end if;

  return v_row;
end;
$$;

revoke all on function public.quarantine_raw_message(bigint, text) from public, anon, authenticated;
grant execute on function public.quarantine_raw_message(bigint, text) to service_role;

-- ----------------------------------------------------------------------------
-- log_distribution — upsert one destination's delivery attempt for a signal.
-- Called independently per destination so a WhatsApp failure never touches
-- the Telegram or dashboard rows for the same signal.
-- ----------------------------------------------------------------------------
create or replace function public.log_distribution(
  p_signal_id uuid,
  p_destination text,
  p_status text,
  p_error text default null
)
returns public.distribution_logs
language plpgsql
security definer set search_path = public
as $$
declare
  v_row public.distribution_logs%rowtype;
begin
  insert into public.distribution_logs(signal_id, destination, status, attempt_count, last_error, sent_at)
  values (
    p_signal_id, p_destination, p_status, 1, p_error,
    case when p_status = 'sent' then now() else null end
  )
  on conflict on constraint distribution_logs_signal_destination_key
  do update set
    status = excluded.status,
    attempt_count = public.distribution_logs.attempt_count + 1,
    last_error = excluded.last_error,
    sent_at = case when excluded.status = 'sent' then now() else public.distribution_logs.sent_at end,
    updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

alter table public.distribution_logs drop constraint if exists distribution_logs_signal_destination_key;
alter table public.distribution_logs add constraint distribution_logs_signal_destination_key
  unique (signal_id, destination);

revoke all on function public.log_distribution(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.log_distribution(uuid, text, text, text) to service_role;

-- ----------------------------------------------------------------------------
-- log_workflow_error — single insert point for every n8n error branch.
-- ----------------------------------------------------------------------------
create or replace function public.log_workflow_error(
  p_workflow_name text,
  p_node_name text,
  p_stage text,
  p_error_message text,
  p_payload jsonb default '{}'::jsonb
)
returns public.workflow_errors
language plpgsql
security definer set search_path = public
as $$
declare
  v_row public.workflow_errors%rowtype;
begin
  insert into public.workflow_errors(workflow_name, node_name, stage, error_message, payload)
  values (p_workflow_name, p_node_name, p_stage, p_error_message, p_payload)
  returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.log_workflow_error(text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.log_workflow_error(text, text, text, text, jsonb) to service_role;
