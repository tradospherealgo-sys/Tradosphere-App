# TRADOSPHERE PRODUCTION E2E AUDIT

Audit date: 2026-09-17
Repo: https://github.com/tradospherealgo-sys/Tradosphere-App
Production: https://tradosphere-app.vercel.app
Local project: ~/Desktop/TRADOSPHERE-FINAL
Scope: READ-ONLY. No code, database, migrations, environment variables, or credentials were modified. No deploys were made.

## Executive Summary

**Overall state: NOT READY (for public paid launch) / READY (as an internal or invite-only paper-trading beta with admin-granted access).**

This is an unusually mature codebase for its stage. Typecheck, lint, unit tests (274/274), production build, and the public (unauthenticated) Playwright suite (18/18) all pass cleanly with zero errors. RLS is universal, financial tables are locked down with defense-in-depth (RLS + revoked grants + triggers + `SECURITY DEFINER` re-checks), admin authorization is verified server-side at multiple layers, and the paper-trading engine has no real-money execution path and no fabricated market data. The gaps that block a real public launch are concentrated in exactly three places: **no payment gateway is integrated** (self-serve subscriptions cannot complete), **no scheduled task runner is configured** (the expire-subscriptions cron logic exists but nothing calls it), and **Upstox token refresh is entirely manual** (a human must re-authenticate daily). None of these are code defects — they are unfinished integrations plus one recurring operational chore.

---

## 1. PASS

- TypeScript typecheck (`tsc --noEmit`): 0 errors.
- ESLint (`eslint .`): 0 errors, 0 warnings.
- Unit tests (`vitest run`): 274/274 passed across 25 files.
- Production build (`next build --webpack`): compiles successfully, all 39 routes generated correctly (static routes `/login`, `/signup`, `/_not-found` prerendered; rest server-rendered on demand as expected).
- Public Playwright E2E suite (`e2e/public/routing-and-auth-gates.spec.ts`): 18/18 passed — login/signup render correctly, all 11 protected app routes correctly redirect unauthenticated visitors to `/login`, `/admin` and `/admin/clients` correctly redirect unauthenticated visitors, mobile viewport renders login usably.
- Production URL is live and correctly wired: `/login` → 200, `/` → 307 (redirect to login, expected), `/manifest.webmanifest` → 200.
- Route protection: double-enforced everywhere (Next 16 `proxy.ts` + layout-level checks), not merely client-side.
- Admin authorization: DB-column based (`profiles.role`/`is_active`), re-verified server-side in the layout, in every server action (`requireAdmin()`), and again inside `SECURITY DEFINER` SQL functions — three independent layers.
- RLS: enabled on every user-data table (30+), no `USING (true)` policies found anywhere.
- Financial tables (`orders`, `positions`, `trades`, `paper_accounts` cash columns): client INSERT/UPDATE/DELETE explicitly revoked; writes only possible through vetted RPCs wrapped in a "trusted write" trigger.
- Privilege escalation: a client cannot self-grant a subscription, change their own role, or write to admin tables — all blocked by revoked grants + a `prevent_role_self_escalation` trigger + `SECURITY DEFINER` functions that re-check `is_admin()` internally.
- Service-role key usage: isolated to exactly one factory (`src/lib/supabase/admin.ts`, marked `server-only`), used only in genuinely server-side contexts (cron route, health-page presence check). No client-bundle exposure found.
- Paper trading safety: no real-money order execution path exists anywhere in the codebase (verified by exhaustive grep for broker execution APIs/SDKs); no fabricated/`Math.random()` price data is presented as real market data.
- Google OAuth: fully implemented end-to-end (button, callback, orphaned-account cleanup on invalid invite code) — only needs the Google provider enabled in the Supabase dashboard.
- Education content gating: enforced at the RLS/DB layer (locked lessons literally don't come back from the API), not just hidden in the UI.
- Signal ingestion (Telegram): real, working end-to-end — secret-verified webhook, rule-based parser, fingerprint-based dedup, admin review workflow, full audit trail.
- PWA installability: manifest complete with all icon sizes including maskable, correct viewport/theme-color meta tags, valid (no-op) service worker satisfying installability heuristics.
- Indexes/constraints: schema shows a mature second security/design pass (migration comments explicitly reference and remediate a prior audit dated 2026-09-08).

## 2. BROKEN

No confirmed runtime defects were found in application code. One test-harness (not production) defect was found:

- **Location**: `supabase/tests/00_shim.sql` (local DB test harness) vs. `supabase/migrations/0026_invite_codes.sql:87`.
- **Problem**: `npm run test:db` fails with `ERROR: record "new" has no field "raw_app_meta_data"`. The shim's mock `auth.users` table (used to run migrations against plain Postgres in CI/local Docker) only defines `raw_user_meta_data`, but the `handle_new_user()` trigger — patched in migration 0026 to detect the Google OAuth provider — also reads `new.raw_app_meta_data`, a column that exists on real Supabase's `auth.users` but was never added to the shim.
- **Impact**: The local/CI SQL test suite (`scripts/verify-db.sh`) cannot currently complete a full run; it cannot exercise anything past `supabase/tests/10_order_lifecycle.sql`'s user-creation step. This does **not** affect the real, hosted Supabase database (which has the real column) — production signup/OAuth is unaffected. It does mean this regression-test safety net is currently non-functional.
- **Root cause**: Migration 0026 (Google OAuth support) was added without updating the test shim to match. Code-only fix (add `raw_app_meta_data jsonb not null default '{}'::jsonb` to the shim's `auth.users` definition).

## 3. INCOMPLETE

- **Payment gateway integration**: `startCheckout()` (`src/lib/subscriptions/actions.ts`) only opens a `pending` payment row; no Razorpay/Stripe/PhonePe/Paytm SDK or webhook route exists to ever mark it successful. Comped/admin-granted subscriptions work fully; self-serve paid signup does not complete.
- **Vercel Cron scheduling**: `src/app/api/cron/expire-subscriptions/route.ts` is fully implemented and correctly secret-gated, but no `vercel.json` exists in the repo and no `crons` block is configured anywhere — nothing currently invokes this route on a schedule. Access control still works correctly in the meantime (live entitlement checks compare `current_period_end` directly), but subscription status/expiry notifications go stale until something calls it.
- **Upstox token refresh**: access token is a static env var with no refresh-token flow; Upstox tokens expire daily at 3:30 AM IST. Nothing in the app automates re-authentication — this is a recurring manual chore, not a one-time setup step.
- **WhatsApp signal distribution**: exists only as a type-level enum value (`RawMessageChannel`, `DistributionDestination`) in the live app. Real WhatsApp ingestion/distribution exists only inside the not-yet-deployed n8n workflow (`n8n/tradosphere-signal-os-master.json`), which itself needs a self-hosted n8n instance and WhatsApp Business Cloud credentials.
- **Admin health page**: displays environment-variable presence and cached `last_test_result` values, not a live connectivity probe run on page load.
- **Password reset**: no forgot-password / reset-password flow exists anywhere in the app.
- **Market-hours gating of paper orders**: orders can be placed and filled 24/7 as long as a live/last quote exists; `market-hours.ts` is used for cache-TTL and display only, never to block order placement outside NSE session hours.
- **Rate limiting**: `/api/market/*` routes require an authenticated, active user but have no additional rate limiter — an authenticated user could exhaust Upstox API quota by hammering these endpoints.
- **Sign-out control location**: confirmed present in the admin sidebar (`src/app/admin/layout.tsx`); not independently confirmed inside the main `(app)` shell component in this pass (likely present in `AppShell`, worth a direct check in Mission 2).

## 4. EXTERNAL CONFIGURATION REQUIRED

**Google**
- Enable the Google provider in the Supabase Auth dashboard and supply its OAuth client ID/secret there (not in app env vars). Code is complete and ready.

**Supabase**
- All three core env vars (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) are already set in `.env.local`. No further action identified beyond enabling the Google provider above.

**Vercel**
- No `vercel.json` / cron configuration exists — must be added to schedule `expire-subscriptions` (this is a code change, listed in §6, not a dashboard-only action, since it requires committing a `vercel.json`).
- Confirm production environment variables are mirrored into the Vercel project dashboard (a `scripts/sync-vercel-env.sh` exists locally, untracked by git — currently shows as an untracked file in `git status`).

**Upstox**
- `UPSTOX_ACCESS_TOKEN` is currently set, but requires **manual daily renewal** via Upstox's OAuth login (token expires ~3:30 AM IST, no refresh token). A recurring operational task until/unless an automated refresh mechanism is built (see §6).
- Instrument-to-`instrument_key` mapping (`instruments.provider_token`) should be kept in sync as Upstox updates its instrument master.

**Telegram**
- `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET` are already set. Confirm the webhook URL is registered with Telegram's Bot API pointing at the production `/api/telegram/webhook` endpoint (not verified in this read-only pass — recommend confirming via Telegram's `getWebhookInfo`).

**WhatsApp**
- No integration exists in the live app. To activate, would need Meta WhatsApp Business Cloud API credentials plus the n8n workflow deployment described below.

**n8n**
- A complete 37-node workflow (`n8n/tradosphere-signal-os-master.json`) is pre-built but requires: self-hosting an n8n instance with a public HTTPS endpoint; binding a separate Telegram bot token, WhatsApp Business Cloud credentials, a Groq API key, and a Supabase service-role key as n8n credentials; and registering signal-source chat IDs in the `signal_sources` table. This is entirely additive to the already-working single-bot Telegram path.

**Payments**
- No provider (Razorpay/Stripe/etc.) is integrated at all. Requires both an external merchant account/API keys AND new code (webhook route, checkout redirect) — see §6.

**Cron**
- Needs a `vercel.json` `crons` entry (or equivalent scheduler) pointing at `/api/cron/expire-subscriptions` with the `CRON_SECRET` header. `CRON_SECRET` is already set as an env var; only the schedule wiring is missing.

## 5. MANUAL USER ACTIONS

1. Enable Google as an auth provider in the Supabase dashboard (Auth → Providers) and paste in a Google Cloud OAuth client ID/secret.
2. Re-authenticate with Upstox and update `UPSTOX_ACCESS_TOKEN` — currently a **daily** task (before 3:30 AM IST) until an automated refresh is built.
3. Verify the Telegram webhook is registered against the production URL (`https://tradosphere-app.vercel.app/api/telegram/webhook`) with the configured secret token.
4. Choose and sign up for a payment gateway (Razorpay is the natural fit for INR) and obtain API keys/webhook signing secret — needed before any payment code can be written or tested.
5. Decide whether to pursue the n8n/WhatsApp signal pipeline; if yes, provision a self-hosted n8n instance and WhatsApp Business Cloud API access.
6. Confirm all production env vars are set in the Vercel project dashboard (the repo has an untracked `scripts/sync-vercel-env.sh` — review and run it, or set manually).
7. Decide on and communicate a policy for market-hours order restrictions (currently unrestricted 24/7) if that is a compliance/product requirement.

## 6. CODE CHANGES REQUIRED

*(Not made in this mission — read-only audit only. Ordered by priority in §11.)*

- `supabase/tests/00_shim.sql` — add `raw_app_meta_data jsonb not null default '{}'::jsonb` to the mock `auth.users` table so `npm run test:db` runs to completion again.
- New `vercel.json` (or platform-equivalent) with a `crons` entry calling `/api/cron/expire-subscriptions` on a daily/hourly schedule with the `CRON_SECRET` header.
- New payment integration: a checkout-initiation route/redirect to the chosen gateway, and a webhook route that verifies the gateway's signature and calls the existing `record_payment_success` RPC (already implemented DB-side, currently unreachable from any real payment event).
- Upstox token refresh automation: either an OAuth callback route that performs the daily re-auth server-side (if Upstox's flow allows a semi-automated refresh) or, at minimum, an admin-facing alert when the token is near/past expiry (currently silent — expired tokens just make `/markets`, `/charts`, `/option-chain` show "no data").
- Optional/nice-to-have: password-reset flow (`resetPasswordForEmail` + a reset page); market-hours gate in `src/lib/trading/actions.ts` if 24/7 paper trading is undesired; basic rate limiting on `/api/market/*`; confirm/add a visible sign-out control in the main app shell if missing.

## 7. SECURITY FINDINGS

- **CRITICAL**: None found.
- **HIGH**: None found.
- **MEDIUM**:
  - No rate limiting on `/api/market/*` routes beyond requiring an authenticated, active user — a malicious authenticated user could exhaust the Upstox API quota for all users. (`src/lib/api/guard.ts`)
  - Local SQL regression-test suite (`test:db`) is currently broken (see §2), meaning any future migration change is not being validated by this safety net until fixed.
- **LOW**:
  - Admin audit logging (`writeAuditLog`) silently no-ops on failure (wrapped in try/catch) rather than failing the parent action or alerting — a broken service-role key would silently stop audit trail generation with no error surfaced. (`src/lib/admin/audit.ts`)
  - `sw-register.tsx` silently swallows service-worker registration failures — acceptable given the SW is a no-op, but worth a log line for future debugging if real caching is ever added.
- **INFORMATIONAL**:
  - Paper trading has no market-hours restriction on order placement/fills — informational only since this is a paper (non-real-money) system, but worth confirming is intentional product behavior.
  - `.env.local` and `.env.example` variable sets are already in sync; only two optional generic-market-data vars are intentionally empty (app degrades gracefully per its own comments).
  - Node.js 20 deprecation warnings from `@supabase/supabase-js` appeared repeatedly during the build — not a security issue today, but the runtime should be upgraded to Node 22 before Supabase drops Node 20 support.

## 8. TEST RESULTS

| Command | Result |
|---|---|
| `npx tsc --noEmit` | **PASS** — 0 errors |
| `npx eslint .` | **PASS** — 0 errors/warnings |
| `npx vitest run` | **PASS** — 274/274 tests, 25/25 files |
| `npm run build` (`next build --webpack`) | **PASS** — compiled successfully, 39 routes generated, no errors (only Node 20 deprecation warnings, non-fatal) |
| `npx playwright test e2e/public --project=chromium` | **PASS** — 18/18 tests |
| `npx playwright test e2e/authenticated/*` | **NOT RUN** — requires `E2E_TEST_EMAIL`/`E2E_TEST_PASSWORD` for a real seeded Supabase test user; these specs are designed to self-skip (not fail) without them, per `playwright.config.ts` comments. This is an external-credential gap, not a code defect. |
| `npm run test:db` (`scripts/verify-db.sh`, Docker + Postgres 17) | **FAIL** — all 27 migrations apply cleanly; the first SQL test (`supabase/tests/10_order_lifecycle.sql`) fails with `record "new" has no field "raw_app_meta_data"` due to the test shim being out of sync with migration 0026 (see §2). Production database is unaffected — this is a test-harness bug. |
| Production smoke check (`curl` against https://tradosphere-app.vercel.app) | **PASS** — `/login` → 200, `/` → 307 (redirect, expected), `/manifest.webmanifest` → 200 |

## 9. ROUTE MATRIX

| Route | Auth | Role | Status | Dependencies | Issues |
|---|---|---|---|---|---|
| `/` | N/A | none | Redirects to `/login` or `/dashboard` | — | None |
| `/login` | Public | none | Complete | Supabase auth | None |
| `/signup` | Public | none | Complete, invite-gated | Supabase auth, invite_codes | None |
| `/auth/callback` | Public | none | Complete | Supabase OAuth exchange, invite RPC | None |
| `/dashboard` | Y | user | Complete | paper_accounts, positions, market data | None |
| `/activity` | Y | user | Complete | trades, analytics | None |
| `/ai-intelligence` | Y | user | Complete (read-only) | ai_agent_verdicts | None |
| `/charts` | Y | user | Complete | `/api/market/candles`, Upstox | Depends on Upstox token validity |
| `/education`, `/education/[slug]`, `/education/[slug]/[lesson]` | Y | user | Complete | courses/lessons, RLS entitlement gate | None |
| `/markets` | Y | user | Complete | watchlists, Upstox quotes | Depends on Upstox token validity |
| `/notifications` | Y | user | Complete | notifications table | None |
| `/option-chain` | Y | user + entitlement | Complete | `/api/market/option-chain`, Upstox | Depends on Upstox token + subscription entitlement |
| `/paper-trading` | Y | user | Complete | orders/positions, instruments | No market-hours gate (by design/TBD) |
| `/portfolio` | Y | user | Complete | positions/trades, pnl.ts | None |
| `/settings` | Y | user | Complete | profiles, paper account | None |
| `/signals`, `/signals/[id]` | Y | user + entitlement | Complete | signals, signal_events | None |
| `/subscription` | Y | user | Complete | subscriptions, plans | Checkout cannot complete (no payment gateway) |
| `/admin` (+ 10 subroutes) | Y | admin | Complete | role-specific tables | Health page shows cached/static status, not live probe |
| `/api/market/quote,candles,option-chain,stream` | Y (`requireUser`) | user | Complete | Upstox | No rate limiting |
| `/api/market/status` | Public (by design) | none | Complete | calendar math only | None |
| `/api/telegram/webhook` | Shared secret | none (bot) | Complete | Telegram, signals pipeline | None |
| `/api/cron/expire-subscriptions` | Shared secret | none (service) | Complete logic | subscriptions | **Not scheduled anywhere** (no vercel.json) |

## 10. FEATURE MATRIX

| Feature | Status | Code complete? | External dependency? | Manual action? | Blocking? |
|---|---|---|---|---|---|
| Email/password auth | Working | Yes | No | No | No |
| Google OAuth | Code complete, unconfigured | Yes | Yes (Supabase dashboard provider) | Yes | No (optional login method) |
| Password reset | Absent | No | No | No | No (nice-to-have) |
| Admin panel + RBAC | Working | Yes | No | No | No |
| Paper trading engine (orders/fills/P&L) | Working | Yes | Depends on live quotes | No | No |
| Watchlist | Minimal but working | Yes (basic) | No | No | No |
| Upstox market data/quotes/candles | Working, needs daily token refresh | Yes | Yes (Upstox account + daily token) | Yes (daily) | Degrades gracefully if stale |
| Upstox option chain + Greeks | Working, same token dependency | Yes | Yes | Yes (daily) | Degrades gracefully |
| Signal ingestion (Telegram, single bot) | Working | Yes | Telegram bot token (set) | Verify webhook registration | No |
| Signal ingestion (n8n multi-source + WhatsApp) | Not deployed | Partially (workflow pre-built, not wired to app DB path beyond shared tables) | Yes (n8n host, WhatsApp API, Groq key) | Yes | No (additive) |
| Education content + paywall | Working, RLS-enforced | Yes | No | No | No |
| Subscriptions (admin-granted) | Working | Yes | No | No | No |
| Subscriptions (self-serve paid) | Cannot complete | No (checkout stub only) | Yes (payment gateway) | Yes | **Yes, for monetization** |
| Subscription expiry automation | Logic complete, unscheduled | Yes (logic) / No (scheduling) | Yes (Vercel Cron or equivalent) | Yes | Cosmetic only (live checks still correct) |
| PWA installability | Working | Yes | No | No | No |
| PWA offline support | Absent by design | N/A (deliberate no-op SW) | No | No | No |
| Native Android wrapper | Working (WebView shell) | Yes | No | No | No |
| Test suite (unit/lint/type/build) | All passing | Yes | No | No | No |
| DB regression test harness | Broken (shim out of sync) | No (needs 1-line fix) | No | No | No (dev-only tooling) |
| Authenticated E2E suite | Cannot run in this audit | Yes (specs complete) | Yes (seeded test user credentials) | Yes | No |

## 11. MISSION 2 PLAN

Ordered list of tasks Claude can safely perform in a follow-up mission (code changes only — no credential creation, no deploys, no DB/migration edits beyond what's listed):

1. **Fix the DB test shim** — add the missing `raw_app_meta_data` column to `supabase/tests/00_shim.sql` so `npm run test:db` runs to completion again. Lowest risk, restores a safety net.
2. **Add rate limiting** to `/api/market/*` routes (e.g. a simple per-user sliding window) to close the Upstox-quota-exhaustion risk noted in §7.
3. **Surface audit-log write failures** — change `writeAuditLog`'s silent catch to at least log a distinguishable error server-side (still shouldn't block the parent action, but shouldn't be invisible either).
4. **Add `vercel.json` with a `crons` entry** for `/api/cron/expire-subscriptions` (code-only; user must confirm the schedule cadence and that `CRON_SECRET` is set in Vercel).
5. **Build the payment gateway integration** (checkout redirect + webhook route + signature verification, wired to the existing `record_payment_success` RPC) — highest-value unblock for monetization, but requires the user to first obtain gateway credentials (external, manual — see §5).
6. **Automate or alert on Upstox token expiry** — at minimum, add a health-check/notification when the token is stale/expired instead of silently degrading to "no data".
7. **Add a password-reset flow** (`resetPasswordForEmail` + reset page) for account-recovery completeness.
8. **Decide and implement market-hours gating** for paper order placement, if desired as a product/compliance requirement.
9. **Wire the n8n/WhatsApp signal pipeline**, once the user has provisioned an n8n host and WhatsApp Business credentials (external prerequisite — Claude can help integrate but cannot provision hosting/credentials).
10. **UI/UX polish pass** — confirm/add a visible sign-out affordance in the main `(app)` shell if not already present; general responsive/empty-state review per §14 walkthrough notes below.
11. **Upgrade Node.js runtime** to 22+ ahead of Supabase's Node 20 deprecation.

### Client-experience walkthrough notes (Phase 14)

Walking the golden path login → signup → dashboard → markets → watchlist → paper trading → orders → positions → P&L → signals → education → subscription → profile → logout → login again, based on the code inspected across all agents: the flow is coherent and nothing was found to be blank, mislabeled, or structurally broken. The one place a new client would hit a dead end today is **`/subscription` → attempting to pay for a plan** — checkout starts but can never complete, since no payment webhook exists to confirm it. Everywhere else (markets/charts/option-chain) correctly shows a "not configured"/"no data" state rather than crashing or showing fake numbers when Upstox is misconfigured or the token has expired, which is the correct failure mode for a financial app.

---

# MISSION 1 COMPLETE

PASS: 8 major systems and all automated test suites but one (auth, RLS/security, paper trading, admin, PWA config, build, unit tests, public E2E)
BROKEN: 1 (local DB test harness shim out of sync with migration 0026 — dev tooling only, not production)
INCOMPLETE: 8 (payment gateway, cron scheduling, Upstox token automation, WhatsApp/n8n pipeline, admin health live-check, password reset, market-hours order gating, API rate limiting)
BLOCKED: External configuration needed for Google OAuth (Supabase dashboard), Upstox (daily token), Telegram webhook registration verification, n8n/WhatsApp hosting, payment gateway account
MANUAL: 7 actions listed in Section 5 (Google provider setup, daily Upstox re-auth, Telegram webhook verification, payment gateway signup, n8n/WhatsApp provisioning decision, Vercel env sync, market-hours policy decision)
CODE CHANGES: 6 items listed in Section 6, prioritized as an 11-step plan in Section 11 (none performed in this mission)
