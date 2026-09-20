-- ============================================================================
-- MISSION 8 — SIGNAL OS: MANDATORY HUMAN APPROVAL
--
-- 0007/0011/0019 already built the right shape: every ingested signal lands
-- `verification_state = 'unverified'` / `status = 'pending'`, RLS hides
-- anything not `verified` + not `pending` from clients, and an admin releases
-- or rejects through `admin_verify_signal`. The one gap is
-- `signal_sources.auto_verify`: when a source is marked `is_trusted AND
-- auto_verify`, both ingestion paths (`ingest_classified_signal` here, and
-- the legacy `ingestTelegramMessage` in src/lib/signals/ingest.ts) call
-- `system_release_signal`, which releases the signal with zero human
-- involvement.
--
-- Mission 8 requires that NO signal — from any source, however trusted —
-- reach a client dashboard without an explicit admin approve/reject action.
-- Rather than touching the ingestion functions (more surface area, more risk
-- of breaking the provenance/dedup guarantees they already enforce), this
-- closes the gap at its single root cause: `auto_verify` can never again be
-- true. With that constraint in place:
--   * `ingest_classified_signal`'s `if v_source.is_trusted and
--     v_source.auto_verify then perform system_release_signal(...)` branch
--     can never execute (both call sites keep working, they just always
--     take the "leave it pending" path).
--   * `ingestTelegramMessage`'s equivalent branch never fires either.
--   * `system_release_signal` itself always raises "not configured for
--     automatic release" if ever invoked directly, since no source can
--     satisfy its check.
-- The column and its history are kept (Mission 8: do not remove existing
-- functionality) — it is just permanently pinned to `false` so it cannot be
-- flipped back on by an admin, an RPC bug, or a future migration mistake.
-- ============================================================================

update public.signal_sources set auto_verify = false where auto_verify = true;

alter table public.signal_sources drop constraint if exists signal_sources_auto_verify_disabled;
alter table public.signal_sources add constraint signal_sources_auto_verify_disabled
  check (auto_verify = false);

comment on column public.signal_sources.auto_verify is
  'Permanently disabled (Mission 8, migration 0028): every signal requires '
  'explicit admin approval via admin_verify_signal, regardless of source '
  'trust. Column kept for historical/audit purposes; a check constraint '
  'prevents it from ever being set back to true.';

comment on function public.system_release_signal(uuid) is
  'Dead-letter path kept for compatibility with existing call sites '
  '(ingest_classified_signal, ingestTelegramMessage). Always raises, because '
  'signal_sources_auto_verify_disabled guarantees no source can satisfy its '
  'is_trusted-and-auto_verify check (Mission 8: mandatory human review).';
