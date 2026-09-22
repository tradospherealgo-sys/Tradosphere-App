-- ============================================================================
-- SIGNAL OS — multi-agent analysis storage
--
-- The n8n pipeline's single "AI Agent Extract And Classify" node is being
-- replaced with five distinct agents (MARK/market context, MUSE/strategy,
-- ECHO/validation, SCOUT/intelligence, ATLAS/final synthesis). 0019 only
-- ever anticipated one agent's output, captured in `signals.rationale`
-- (free text) and `raw_signal_messages.ai_extraction` (jsonb, currently
-- write-only from the app's perspective — nothing ever populated it).
--
-- This migration is additive, mirrors 0019's own pattern, and does not
-- remove or repurpose any existing column: `rationale` keeps carrying
-- ATLAS's human-readable verdict text exactly as the single-agent version
-- put its rationale there, so nothing downstream (dashboard, notifications)
-- needs to change to keep working. What's new is queryable, structured
-- storage for the other four agents' reasoning and for the validation
-- outcome ECHO can flag.
-- ============================================================================

alter table public.signals add column if not exists agent_outputs jsonb;
alter table public.signals add column if not exists market_context text;
alter table public.signals add column if not exists validation_status text
  check (validation_status is null or validation_status in ('passed', 'flagged', 'rejected'));
alter table public.signals add column if not exists validation_flags jsonb not null default '[]'::jsonb;

comment on column public.signals.agent_outputs is
  'Full structured output of all five Signal OS agents (MARK, MUSE, ECHO, SCOUT, ATLAS) for this signal, keyed by agent name. Audit/debug surface; the dashboard-facing summary fields (market_context, validation_status, rationale, risk_note) are denormalized from this for querying without a jsonb scan.';
comment on column public.signals.market_context is
  'MARK (Market Analyst) agent''s market-structure assessment, denormalized from agent_outputs for querying.';
comment on column public.signals.validation_status is
  'ECHO (Signal Validator) agent''s verdict on this signal: passed, flagged (has validation_flags but still published), or rejected (never reaches this table — quarantined upstream instead). Null for signals ingested before this migration or via the legacy rule-based path.';
comment on column public.signals.validation_flags is
  'ECHO agent''s list of specific validation concerns (missing fields, contradictions, suspicious input), even when validation_status is ''passed''. Empty array, never null.';

alter table public.raw_signal_messages add column if not exists agent_outputs jsonb;

comment on column public.raw_signal_messages.agent_outputs is
  'Same structured multi-agent payload as signals.agent_outputs, written at classification time (before publish/dedup), so a quarantined or duplicate message still has its full agent reasoning available for audit.';

-- ----------------------------------------------------------------------------
-- update_raw_message_ai_analysis — persist the multi-agent classification
-- result onto raw_signal_messages once ATLAS has synthesized it, before the
-- validation/dedup/publish branches run. Mirrors insert_raw_signal_message's
-- security posture (service_role only, called from the n8n pipeline).
-- ----------------------------------------------------------------------------
create or replace function public.update_raw_message_ai_analysis(
  p_raw_message_id bigint,
  p_normalized_text text,
  p_category public.signal_category,
  p_confidence numeric,
  p_agent_outputs jsonb
)
returns public.raw_signal_messages
language plpgsql
security definer set search_path = public
as $$
declare
  v_row public.raw_signal_messages%rowtype;
begin
  update public.raw_signal_messages
    set normalized_text = p_normalized_text,
        ai_category = p_category,
        ai_confidence = p_confidence,
        ai_extraction = p_agent_outputs,
        agent_outputs = p_agent_outputs,
        ai_model = coalesce(ai_model, 'groq/openai-gpt-oss-120b'),
        parse_status = 'classified'
    where id = p_raw_message_id
    returning * into v_row;

  if not found then
    raise exception 'Raw message not found.';
  end if;

  return v_row;
end;
$$;

revoke all on function public.update_raw_message_ai_analysis(bigint, text, public.signal_category, numeric, jsonb)
  from public, anon, authenticated;
grant execute on function public.update_raw_message_ai_analysis(bigint, text, public.signal_category, numeric, jsonb)
  to service_role;

-- ----------------------------------------------------------------------------
-- ingest_classified_signal — extend with the three new denormalized fields
-- and the jsonb agent payload. Overload rather than replace-in-place so any
-- external caller bound to the old 24-arg signature keeps working; the n8n
-- workflow is updated to call this new signature.
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
  p_ai_model text default null,
  p_agent_outputs jsonb default null,
  p_market_context text default null,
  p_validation_status text default null,
  p_validation_flags jsonb default '[]'::jsonb,
  p_risk_note text default null
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
    rationale, risk_note, raw_message, normalized_message, source_message_id,
    source_timestamp, fingerprint, ai_model,
    agent_outputs, market_context, validation_status, validation_flags,
    origin_ref
  ) values (
    p_source_id, p_symbol, p_instrument_name, p_exchange, p_instrument_kind, p_category,
    p_direction, p_entry_price, p_entry_low, p_entry_high, p_stop_loss,
    p_target_1, p_target_2, p_target_3, p_expiry, p_timeframe, p_confidence,
    p_rationale, p_risk_note, p_raw_message, p_normalized_message, p_source_message_id,
    p_source_timestamp, p_fingerprint, p_ai_model,
    p_agent_outputs, p_market_context, p_validation_status, coalesce(p_validation_flags, '[]'::jsonb),
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
  timestamptz, text, numeric, text, text, text, text, timestamptz, text, text,
  jsonb, text, text, jsonb, text
) from public, anon, authenticated;
grant execute on function public.ingest_classified_signal(
  uuid, bigint, public.signal_category, text, text, text, public.instrument_kind,
  public.order_side, numeric, numeric, numeric, numeric, numeric, numeric, numeric,
  timestamptz, text, numeric, text, text, text, text, timestamptz, text, text,
  jsonb, text, text, jsonb, text
) to service_role;
