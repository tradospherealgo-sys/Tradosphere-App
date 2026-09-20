-- ============================================================================
-- Mission 7: register the 5 premium SMC Telegram channels as signal_sources.
--
-- These are the exact chat IDs the user provided for the channels their
-- Telegram account already subscribes to (Option B: authorized MTProto
-- client ingestion via workers/telegram-mtproto/ — see that worker's README
-- and the "Telegram MTProto In" node in n8n/tradosphere-signal-os-master.json).
--
-- auto_verify is omitted (defaults to false) and cannot be set to true even
-- by a future edit — signal_sources_auto_verify_disabled (migration 0028)
-- enforces that at the database level. Every message from these channels
-- still lands `pending`/`unverified` and requires explicit admin approval
-- in Signal Desk before any client can see it.
-- ============================================================================

insert into public.signal_sources (slug, name, kind, telegram_chat_id, is_trusted, is_active)
values
  ('smc-sensex360-nitin-murarka', 'PREMIUM SENSEX360 BY Nitin Murarka (SMC)', 'telegram_channel', '-1002902210804', false, true),
  ('smc-technofunda-calls', 'PREMIUM TechnoFunda Calls by SMC', 'telegram_channel', '-1002766156703', false, true),
  ('smc-equity-ka-funda', 'PREMIUM Equity Ka Funda by SMC', 'telegram_channel', '-1002739828902', false, true),
  ('smc-index-trading-nitin-murarka', 'PREMIUM Index trading with CA Nitin Murarka (SMC Global)', 'telegram_channel', '-1002899616041', false, true),
  ('smc-commodity-mantra', 'PREMIUM Commodity Mantra by SMC', 'telegram_channel', '-1002670661233', false, true)
on conflict (telegram_chat_id) do nothing;
