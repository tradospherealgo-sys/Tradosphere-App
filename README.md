# Tradosphere

A paper-trading and signal-intelligence platform for Indian equity and index
derivatives. Next.js 16 App Router, Supabase (Postgres + Auth + RLS).

**Paper trading only.** Nothing in this codebase places a real-money order, and
nothing should be added that does. The engine fills against live quotes and
writes to `paper_accounts`, `orders`, `positions` and `trades`.

**No synthetic data.** If a market-data or option-chain provider is not
configured, or a request to it fails, the affected surface renders an empty or
error state. There is no fallback that invents a price, an open-interest
figure, a fill, or a signal.

## Requirements

- Node 20+
- A Supabase project (Postgres 15+, Auth enabled)

## Setup

```bash
npm install
cp .env.example .env.local   # then fill in the values, see below
```

`.env.example` is the authoritative list of every credential the platform
consumes, with a note on what each one unlocks. Only the Supabase block is
required to boot; everything else degrades to an empty state rather than a
fake one.

| Variable | Required | Unlocks |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | yes | everything |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | everything |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | admin surfaces, cron, Telegram ingestion, admin bootstrap |
| `SMC_API_KEY`, `SMC_CLIENT_CODE`, `SMC_API_SECRET`, `SMC_TOTP_SECRET` | no | live SMC quotes, candles, option chain |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` | no | signal ingestion from Telegram |
| `CRON_SECRET` | no | the subscription expiry/warning sweep |
| Razorpay or Stripe keys | no | checkout; without them no payment can be marked succeeded |

The service-role key is read only from server modules guarded by
`import "server-only"`. No secret is ever exposed under a `NEXT_PUBLIC_`
name — `src/lib/security/policies.test.ts` fails the build if one is.

### Database

Apply the migrations in numeric order. They are ordinary SQL and are safe to
run through `supabase db push`, the SQL editor, or `psql`:

```
0001_schema.sql             tables, enums, indexes
0002_rls.sql                row level security across every user-scoped table
0003_trading_functions.sql  SECURITY DEFINER order/fill primitives
0004_financial_lockdown.sql revokes direct client writes to money tables
0005_trading_engine.sql     fills, positions, realized P&L
0006_admin_bootstrap.sql    bootstrap_first_admin()
0007_signals.sql            signals, verdicts, publication state
0008_subscriptions.sql      plans, subscriptions, payments, entitlements
0009_education.sql          courses, modules, lessons, progress
0010_instruments.sql        instrument master + watchlists
0011_signal_ingestion.sql   Telegram source registry and raw-message log
0012_checkout.sql           checkout intents, record_payment_success()
0013_entitlement_gating.sql moves the paywall onto the rows
0014_expiry_warnings.sql    idempotent pre-expiry warning sweep
```

`0004` is the one to understand before changing anything financial: clients
hold the public anon key, so `orders`, `positions`, `trades`, `payments` and
`subscriptions` revoke INSERT/UPDATE/DELETE from `anon` and `authenticated`
outright. `paper_accounts` is the deliberate exception — the owner may edit
`risk_per_trade_pct` — and its money columns are protected by the
`guard_paper_account_financials` BEFORE UPDATE trigger, because RLS
`WITH CHECK` cannot see `OLD`.

### First admin

There is no self-serve path to the admin role. Sign up through the UI, then:

```bash
npm run bootstrap:admin -- you@example.com
```

The script only carries the service-role key; the privilege check lives in
`bootstrap_first_admin()`, which refuses once any admin exists, so it cannot
be replayed later to escalate an account.

### Providers

Market data and option chain are configured at runtime under
**Admin → Integrations**, not in code. Pick a provider per surface and supply
its credentials there (they are stored server-side and never sent to the
browser). With both left at `none`, quotes, charts and the option chain render
an explicit "not configured" state.

`src/lib/market-data/providers/` holds the implementations: `smc` (SMC /
Angel One SmartAPI, TOTP session), `nse-unofficial`, `generic-rest` (map any
REST endpoint onto the provider interface), and `none`.

### Telegram signal ingestion

Register trusted source chats under **Admin → Signals**, then point the bot at
the webhook:

```bash
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -d "url=https://your-host/api/telegram/webhook" \
  -d "secret_token=$TELEGRAM_WEBHOOK_SECRET"
```

Messages from unregistered chats are logged and dropped. Parsed messages
become draft signals; an admin releases them. A message that does not parse
into a complete signal is never partially published.

### Scheduled jobs

One endpoint drives subscription lifecycle. Call it daily:

```bash
curl -X POST https://your-host/api/cron/expire-subscriptions \
  -H "Authorization: Bearer $CRON_SECRET"
```

It warns subscribers three days out (once, tracked by
`expiry_warned_at`) and then expires anything past its period end.

## Running

```bash
npm run dev        # http://localhost:3000
npm run build
npm start
```

## Checks

```bash
npm run typecheck  # tsc --noEmit
npm run lint       # eslint
npm test           # vitest — unit + database-policy guards
npm run test:e2e   # playwright — chromium + Pixel-class mobile
```

The authenticated Playwright tier self-skips unless `E2E_TEST_EMAIL` and
`E2E_TEST_PASSWORD` are set to a real account on the target Supabase project.
The public tier runs anywhere, including against an instance with no Supabase
configuration at all.

## Layout

```
src/app/(app)       client surfaces: dashboard, charts, option chain, signals,
                    portfolio, paper trading, activity, education, subscription
src/app/admin       admin control centre: clients, integrations, signals,
                    subscriptions, education, notifications, health, audit logs
src/app/api         Telegram webhook, cron
src/lib/market-data provider abstraction + implementations
src/lib/trading     paper engine: orders, fills, positions, P&L, risk maths
src/lib/signals     ingestion, parsing, admin publication, reads
src/lib/security    policy regression tests over the migrations
supabase/migrations schema, RLS, SECURITY DEFINER functions
e2e                 public (no auth) and authenticated Playwright suites
```
