-- ============================================================================
-- SIGNAL OS — RPC wrappers for the n8n pipeline's remaining ad-hoc SQL
--
-- 0019_signal_os.sql already exposed ingest_classified_signal,
-- quarantine_raw_message, log_distribution, and log_workflow_error as the
-- only way the n8n pipeline touches these tables. Three steps in the
-- pipeline (raw message insert + source lookup, fingerprint dedup check,
-- duplicate marking) were still using ad-hoc SQL text sent over a direct
-- Postgres connection instead of one of these functions, because that
-- direct connection allowed running a raw query without one.
--
-- Now that the n8n workflow calls Supabase over its REST API (PostgREST)
-- instead of a raw Postgres connection, every DB-touching step must be a
-- function call — PostgREST only executes tables/views and RPC functions,
-- never arbitrary SQL text. These three wrappers are that: a straight
-- lift of the exact queries that used to live in the n8n node's "query"
-- field, parameterized and locked down service-role-only like every other
-- function in this pipeline.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- insert_raw_signal_message — verbatim port of the CTE the n8n "Insert Raw
-- Message" node used to send directly: look up a signal_sources row by
-- whichever of telegram_chat_id/whatsapp_group_id matches, insert the raw
-- message bound to it (or to no source, if unregistered), and no-op on a
-- re-delivered (source_id, external_message_id) pair. Returns zero rows on
-- that conflict — same "nothing to do" semantics the raw query had — and
-- exactly one row otherwise.
-- ----------------------------------------------------------------------------
create or replace function public.insert_raw_signal_message(
  p_channel text,
  p_external_chat_id text,
  p_external_message_id text,
  p_sender text,
  p_raw_text text,
  p_raw_payload jsonb,
  p_received_at timestamptz
)
returns table (
  id bigint,
  source_id uuid,
  channel text,
  external_message_id text,
  raw_text text,
  received_at timestamptz,
  source_found boolean
)
language sql
security definer set search_path = public
as $$
  with src as (
    select sc.id from public.signal_sources sc
    where sc.telegram_chat_id = p_external_chat_id or sc.whatsapp_group_id = p_external_chat_id
    limit 1
  )
  insert into public.raw_signal_messages (
    source_id, channel, external_chat_id, external_message_id, sender, raw_text, raw_payload, received_at
  )
  select (select id from src), p_channel, p_external_chat_id, nullif(p_external_message_id, ''),
         nullif(p_sender, ''), p_raw_text, p_raw_payload, p_received_at
  on conflict (source_id, external_message_id) where external_message_id is not null
  do nothing
  returning
    raw_signal_messages.id,
    raw_signal_messages.source_id,
    raw_signal_messages.channel,
    raw_signal_messages.external_message_id,
    raw_signal_messages.raw_text,
    raw_signal_messages.received_at,
    (raw_signal_messages.source_id is not null) as source_found;
$$;

revoke all on function public.insert_raw_signal_message(text, text, text, text, text, jsonb, timestamptz)
  from public, anon, authenticated;
grant execute on function public.insert_raw_signal_message(text, text, text, text, text, jsonb, timestamptz)
  to service_role;

-- ----------------------------------------------------------------------------
-- check_signal_fingerprint_duplicate — verbatim port of the "Check Duplicate
-- Fingerprint" node's exists() query. Always returns exactly one row.
-- ----------------------------------------------------------------------------
create or replace function public.check_signal_fingerprint_duplicate(p_fingerprint text)
returns table (is_duplicate boolean)
language sql
security definer set search_path = public
as $$
  select exists(select 1 from public.signals where fingerprint = p_fingerprint) as is_duplicate;
$$;

revoke all on function public.check_signal_fingerprint_duplicate(text) from public, anon, authenticated;
grant execute on function public.check_signal_fingerprint_duplicate(text) to service_role;

-- ----------------------------------------------------------------------------
-- mark_raw_message_duplicate — verbatim port of the "Mark Duplicate" node's
-- update statement.
-- ----------------------------------------------------------------------------
create or replace function public.mark_raw_message_duplicate(p_raw_message_id bigint)
returns table (id bigint)
language sql
security definer set search_path = public
as $$
  update public.raw_signal_messages
    set parse_status = 'duplicate', processed_at = now()
    where raw_signal_messages.id = p_raw_message_id
    returning raw_signal_messages.id;
$$;

revoke all on function public.mark_raw_message_duplicate(bigint) from public, anon, authenticated;
grant execute on function public.mark_raw_message_duplicate(bigint) to service_role;
