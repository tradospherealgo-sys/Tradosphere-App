-- ============================================================================
-- UPSTOX INSTRUMENT KEYS FOR THE SEEDED INDEX ROWS
--
-- provider_token was left null for all four index rows in 0010_instruments.sql
-- pending a real provider integration. These four values are copied verbatim
-- from Upstox's own published NSE instrument master
-- (https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz,
-- downloaded and inspected 2026-09-11) — not invented or guessed from naming
-- convention. Each was also confirmed live against a real Upstox account via
-- GET /v3/market-quote/ohlc and, for NIFTY 50, GET /v2/option/contract +
-- /v2/option/chain, which returned real quotes/contracts for exactly this
-- instrument_key.
--
-- This only populates the Upstox mapping. A different provider (SMC, NSE
-- unofficial) would need its own token in this same column — providers
-- resolve provider_token generically, they don't know which vendor minted it.
-- ============================================================================

update public.instruments set provider_token = 'NSE_INDEX|Nifty 50'
  where exchange = 'NSE' and symbol = 'NIFTY 50';

update public.instruments set provider_token = 'NSE_INDEX|Nifty Bank'
  where exchange = 'NSE' and symbol = 'NIFTY BANK';

update public.instruments set provider_token = 'NSE_INDEX|Nifty Fin Service'
  where exchange = 'NSE' and symbol = 'NIFTY FIN SERVICE';

update public.instruments set provider_token = 'NSE_INDEX|NIFTY MIDCAP 100'
  where exchange = 'NSE' and symbol = 'NIFTY MIDCAP 100';
