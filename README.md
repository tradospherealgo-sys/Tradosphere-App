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
0015_order_status_pending.sql  adds the PENDING order status
0016_order_lifecycle.sql    LIMIT/SL/SL-M engine, charges, cash reservation
0017_allow_account_erasure.sql  lets deleting a user cascade through the ledger
```

`0015` is one statement on purpose. Postgres refuses to *use* a new enum value
in the transaction that added it (SQLSTATE 55P04), and Supabase applies each
migration file as a single transaction — so the `ALTER TYPE` has to commit
before `0016` indexes on `status = 'PENDING'`. Do not merge them back
together: the combined file applies cleanly under a per-statement runner and
then fails on a real deployment.

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

Two harnesses exercise the money path against a real backend rather than a
mock. Both need Docker and `npx supabase start`:

```bash
./scripts/verify-db.sh    # applies every migration, then supabase/tests/*.sql
./scripts/e2e-local.sh    # production build + seeded Playwright, incl. the
                          # full order lifecycle
```

`verify-db.sh` applies each migration with `--single-transaction` because that
is how Supabase applies them; running them statement-by-statement hides a real
class of deployment failure. `e2e-local.sh` seeds a disposable user, arms the
deterministic test-fixture price source (see below), builds, and runs the
suite against `next start` on port 3100 — not 3000, so a dev server left
running cannot answer the readiness probe and silently replace the build under
test.

The lifecycle spec asserts on numbers the engine produced, not on headings
being visible: cash debited by notional plus charges, a resting order's
reservation released to the rupee on cancel, and a round trip at one price
booking a loss equal to the statutory charges rather than a break-even.

Nothing in the suite fabricates a market price. The fixture provider that
makes deterministic fills possible is double-gated — an admin must select
`test_fixture` in `integration_configs` *and* the server must be started with
`MARKET_DATA_TEST_FIXTURE` — and it is absent from the admin UI, returns
`null` for any symbol it was not given, and serves no candles at all. With
either gate missing the app falls back to "no provider configured".

## Android

```bash
brew install openjdk@21
brew install --cask android-commandlinetools
TRADOSPHERE_APP_URL=https://your-host ./scripts/android-build.sh
# -> android/app/build/outputs/apk/debug/app-debug.apk
```

The Android app is a Capacitor shell around the deployed site, not a second
implementation. This app is server-rendered — server actions, middleware
auth, per-request RLS — and none of that survives a static export, so
bundling the UI into the APK would mean rebuilding the backend contract on
the client and shipping keys to do it. Pointing a native WebView at the
deployed host keeps exactly one codebase and one security boundary.

The consequence worth stating plainly: the APK contains no Supabase keys, no
provider credentials and no market data. `unzip -p app-debug.apk | strings`
finds nothing to steal. The only screen it owns is an offline notice, which
deliberately shows no cached prices — a stale quote during an outage is worse
than no quote.

`TRADOSPHERE_APP_URL` is required, must be HTTPS, and is not defaulted: an
APK built against a placeholder installs and launches happily and only fails
once it is on someone else's phone.

`assembleDebug` signs with the shared Android debug key, which is fine for
testing and unacceptable for distribution. A release build additionally needs
an upload keystore — generated once, kept out of this repository, and
referenced from `android/app/build.gradle` via a signing config whose
password comes from the environment or `~/.gradle/gradle.properties`.

## Layout

```
src/app/(app)       client surfaces: dashboard, charts, option chain, signals,
                    portfolio, paper trading, activity, education, subscription
src/app/admin       admin control centre: clients, integrations, signals,
                    subscriptions, education, notifications, health, audit logs
src/app/api         market quote/candles/option-chain/stream, Telegram, cron
src/lib/market-data provider abstraction + implementations
src/lib/trading     paper engine: orders, fills, positions, P&L, risk maths
src/lib/signals     ingestion, parsing, admin publication, reads
src/lib/security    policy regression tests over the migrations
supabase/migrations schema, RLS, SECURITY DEFINER functions
supabase/tests      SQL assertions over the engine and the ledger guards
e2e                 public (no auth) and authenticated Playwright suites
scripts             admin bootstrap, database/e2e verification, android build
android             Capacitor shell — a WebView onto the deployed host
android-shell       the shell's only owned screen: an offline notice
```
