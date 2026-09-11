# POST-BETA BACKLOG

Non-launch-critical work identified during Wave 5. Nothing here blocks Beta.

## Integrations
- **WhatsApp relay**: requires a Meta WhatsApp Business Cloud provider decision
  and credentials. Telegram-only ingestion is acceptable for Beta.
- **SMC Auto Trender feed**: no official API access exists; the admin
  integration card ships a *starter template* `baseUrl`
  (`apiconnect.smcindiaonline.com`) that does not currently resolve (DNS
  NXDOMAIN, verified 2026-09-11). Do not enable this provider in production
  until SMC's real API host and partner access are confirmed.
- **Second/backup market-data provider** for redundancy once Upstox is live.
- **n8n production hosting**: no n8n instance exists in this environment.
  Once one is stood up, the master workflow (`n8n/tradosphere-signal-os-master.json`)
  needs an actual import-and-run pass (§7–§11 of the Wave 5 prompt) — this
  was audited at the JSON/code level only this wave, not import-tested.
- **Payment gateway** (Razorpay/Stripe/etc.): fully unwired. Admin-grant is
  the only access path for Beta; wire a real gateway before charging money.

## Product
- Instrument registry (`instruments.provider_token`) is currently empty for
  all 4 seeded index instruments — needs populating from Upstox's instrument
  master before quotes resolve, independent of the token itself.
- SMC Greeks/OI/bid-ask field mapping (`quoteFields`, `chainPath` etc. in the
  admin integration card's starter template) is unverified against a real
  response and will need correction once real API access exists.

## Engineering
- Node 20 is the default local interpreter, but `@supabase/realtime-js`
  requires Node 22+ for native WebSocket support (surfaced running E2E this
  wave — worked once switched to the already-installed nvm v22.23.2). Worth
  pinning the project's engines/CI to Node 22 so this doesn't surprise future
  contributors.
- `vitest.config.ts` triggers a Vite `configLoader: 'native'` deprecation
  warning (ESM-in-CommonJS). Cosmetic; does not fail tests.

## Advanced features (explicitly out of scope for Beta)
- Advanced analytics / reporting beyond the existing admin dashboards.
- Additional brokers beyond Upstox/SMC.
- Native mobile app (the responsive web app covers 320–430px per Wave 5's
  mobile check).
- Advanced AI features beyond the existing signal-extraction agent.
- Additional signal sources beyond Telegram/SMC/manual.
