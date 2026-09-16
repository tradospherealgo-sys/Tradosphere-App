-- ============================================================================
-- Seed data. Safe to re-run (every statement is an idempotent upsert).
--
-- What is deliberately NOT seeded: any price, quote, option-chain row, fill,
-- position or signal. A fresh deployment has an empty book and an empty
-- signal desk, and every surface that needs market data renders an explicit
-- "no provider configured" state until an admin wires one up. Seeding a
-- plausible-looking number here would be indistinguishable, to a user, from
-- the product actually working.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Integrations — all present, all disabled. The admin picks the provider; the
-- secret is supplied server-side via the named env var, never stored here.
-- ----------------------------------------------------------------------------
insert into public.integration_configs (id, provider, config, secret_env_var, is_enabled)
values
  ('market_data_provider',  'none', '{}'::jsonb, null, false),
  ('option_chain_provider', 'none', '{}'::jsonb, null, false),
  ('telegram_ingest',       'none', '{}'::jsonb, null, false)
on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- System settings
-- ----------------------------------------------------------------------------
insert into public.system_settings (key, value, description)
values
  ('app_name', '"Tradosphere Wealth Management"'::jsonb, 'Display name shown across the app'),
  ('default_starting_capital', '1000000'::jsonb, 'Default paper account starting capital (INR)'),
  ('education_only_mode', 'true'::jsonb, 'When true, shows the educational-simulation banner app-wide'),
  ('max_risk_per_trade_pct', '5'::jsonb, 'Hard ceiling admins allow for the risk-per-trade setting'),
  ('signal_auto_release', 'false'::jsonb, 'When false, every ingested signal waits for admin verification')
on conflict (key) do nothing;

-- ----------------------------------------------------------------------------
-- Subscription plans
--
-- Prices are in paise (integer minor units). These describe the plan
-- *structure*; set the real commercial figures before launch. No payment
-- gateway is wired to them yet — see record_payment_success() in
-- 0008_subscriptions.sql for the single hook a gateway webhook must call.
-- ----------------------------------------------------------------------------
insert into public.plans (slug, name, description, billing_interval, price_minor, entitlements, sort_order)
values
  ('monthly', 'Monthly', 'Full access, billed every month.', 'monthly', 49900,
   '["signals","option_chain","charts","courses_premium","analytics"]'::jsonb, 1),
  ('quarterly', 'Quarterly', 'Full access, billed every three months.', 'quarterly', 139900,
   '["signals","option_chain","charts","courses_premium","analytics"]'::jsonb, 2),
  ('half-yearly', 'Half-Yearly', 'Full access, billed every six months.', 'half_yearly', 259900,
   '["signals","option_chain","charts","courses_premium","analytics"]'::jsonb, 3),
  ('yearly', 'Yearly', 'Full access, billed annually.', 'yearly', 559900,
   '["signals","option_chain","charts","courses_premium","analytics"]'::jsonb, 4)
on conflict (slug) do nothing;

-- ----------------------------------------------------------------------------
-- Signal sources
--
-- Registered but INACTIVE and UNTRUSTED. Activating a source and binding it to
-- a real Telegram chat id is an explicit admin action, because doing so is
-- exactly what makes that channel's calls appear on client dashboards.
-- ----------------------------------------------------------------------------
insert into public.signal_sources (slug, name, kind, description, is_trusted, is_active, auto_verify)
values
  ('smc-specialists', 'SMC Specialist Desk', 'smc_specialist',
   'Named research analysts at SMC Global. Bind the desk''s Telegram chat id in Admin -> Signal Sources.',
   false, false, false),
  ('smc-auto-trender', 'SMC Auto Trender', 'smc_auto_trender',
   'SMC''s algorithmic trend product. Bind its broadcast chat id in Admin -> Signal Sources.',
   false, false, false),
  ('tradosphere-ai', 'Tradosphere Analysis', 'tradosphere_ai',
   'Tradosphere''s own combination layer. Produces a verdict only when it has real inputs to combine.',
   false, false, false)
on conflict (slug) do nothing;

-- ----------------------------------------------------------------------------
-- Education catalogue
--
-- The free foundation course is created by migration 0009, which carries the
-- V1 explainers across as lessons. These two premium shells give the
-- entitlement gate something real to protect; they ship published with no
-- lessons, and the UI renders "no lessons published yet" rather than filler.
-- ----------------------------------------------------------------------------
insert into public.courses (slug, title, summary, level, is_free, required_entitlement, is_published, sort_order)
values
  ('options-desk', 'The Options Desk',
   'Chain structure, writer positioning, spreads and expiry behaviour, worked through on live chains.',
   'intermediate', false, 'courses_premium', true, 2),
  ('risk-and-review', 'Risk, Sizing and Review',
   'Turning a trade log into a decision process: sizing rules, expectancy, and how to run a weekly review.',
   'intermediate', false, 'courses_premium', true, 3)
on conflict (slug) do nothing;
