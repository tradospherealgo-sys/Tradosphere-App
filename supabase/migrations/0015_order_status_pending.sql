-- ============================================================================
-- ORDER STATUS: 'PENDING'
--
-- A resting order needs a state between "placed" and "filled". This is one
-- line, in its own migration, for a reason Postgres enforces: a value added
-- to an existing enum cannot be *used* in the same transaction that added it
-- (SQLSTATE 55P04). The very next migration indexes on `status = 'PENDING'`,
-- so the ALTER has to have committed before that file runs.
--
-- Supabase applies each migration file as one transaction, which is what
-- makes the file boundary the transaction boundary here. Do not merge this
-- back into 0016 — it applies cleanly under a per-statement runner and then
-- fails on a real deployment, which is the worst way to discover it.
-- ============================================================================

alter type public.order_status add value if not exists 'PENDING';
