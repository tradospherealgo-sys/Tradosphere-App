-- ============================================================================
-- FIX — ambiguous overload of ingest_classified_signal
--
-- 0031 added a second `ingest_classified_signal` overload (30 params) beside
-- 0019's original (25 params), reasoning that keeping both would let an
-- "external caller bound to the old signature" keep working. In practice
-- every one of the old signature's 25 parameter names is also a parameter
-- name on the new one, so any call using PostgREST/Supabase RPC's named-
-- parameter form (`{"p_source_id": ..., "p_symbol": ...}`) that happens not
-- to mention at least one of the 5 new-only params (`p_agent_outputs`,
-- `p_market_context`, `p_validation_status`, `p_validation_flags`,
-- `p_risk_note`) matches both functions equally and Postgres raises
-- "function ingest_classified_signal(...) is not unique" rather than picking
-- one. Confirmed via `supabase/tests/13_signal_os_review.sql`, which calls
-- the function with exactly such a subset and fails on this ambiguity.
--
-- The n8n Signal OS pipeline (the only real caller — grep confirms nothing
-- in src/ calls this RPC directly) already sends all 30 named parameters on
-- every "Publish Signal" call, so it only ever matched the new function and
-- was never affected — but every other caller (tests, future admin tooling)
-- would be. The old 25-param overload is unreachable in practice (any call
-- that could resolve to it also resolves to the new one, ambiguously) and
-- has no remaining caller depending on its narrower signature, so it is
-- dropped rather than kept: an unreachable overload isn't compatibility,
-- it's a landmine.
-- ============================================================================

drop function if exists public.ingest_classified_signal(
  uuid, bigint, public.signal_category, text, text, text, public.instrument_kind,
  public.order_side, numeric, numeric, numeric, numeric, numeric, numeric, numeric,
  timestamptz, text, numeric, text, text, text, text, timestamptz, text, text
);
