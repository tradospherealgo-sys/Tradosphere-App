-- ============================================================================
-- Add a half-yearly billing interval.
--
-- Postgres will not let a new enum label be used in the same transaction
-- that adds it, so this migration only adds the label. The functions that
-- switch on billing_interval are updated in the next migration.
-- ============================================================================

alter type public.billing_interval add value if not exists 'half_yearly' after 'quarterly';
