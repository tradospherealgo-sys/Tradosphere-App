# WAVE 1 — MASTER AUDIT REPORT
### Tradosphere Wealth Management — `TRADOSPHERE-FINAL`
Audit date: 2026-09-11. Method: full static read of source, migrations, n8n workflow, tests, CI, and env config, plus live execution of `typecheck`, `lint`, `test` (vitest), and `build`. No production data touched, no credentials fabricated, no destructive commands run.

---

## 1. Executive Summary

Tradosphere is **substantially further along than a typical "audit target."** The codebase is disciplined about one thing above all else: it refuses to fabricate financial data. That rule (no synthetic prices, no invented fills, no guessed Greeks, explicit "not configured" / "no live quote" states everywhere) is enforced consistently across market data, option chain, paper trading, dashboard, and signals — verified directly in code, not taken on faith from comments.

What exists and is genuinely real, end-to-end:
- Google + email/password auth, three-layer route protection (proxy → layout → RLS)
- A real, SECURITY DEFINER, RLS-locked paper-trading engine (place/modify/cancel/fill, Indian brokerage/STT/GST charges, realized+unrealized P&L, position lifecycle) that the client cannot forge
- A genuine provider-agnostic Market Data / Option Chain interface with working NSE-unofficial and SMC (unverified against a live account) providers, real Black-Scholes options math, and a well-engineered caching/staleness layer
- A complete, professional client dashboard, education CMS, admin panel (10 real sections), and Android WebView shell with a built debug APK
- A fully-designed Signal OS schema (12 categories, dedup fingerprinting, quarantine, distribution logs) and a well-built n8n AI-classification workflow — **but the AI/n8n half is entirely unactivated**; only a Telegram regex parser and manual admin composer are live today

What is missing or blocked, in order of Beta impact:
0. **`npm run build` (production build) fails reproducibly** — confirmed on both Node 20.20.2 and Node 22.23.2 — with `unhandledRejection SyntaxError: Unexpected identifier 'Object'` thrown from inside Next's bundled edge-runtime loader (`node_modules/next/dist/compiled/@edge-runtime/primitives/load.js`), before any route is emitted. **CI never runs `npm run build` at all** — `.github/workflows/ci.yml` only runs typecheck/lint/unit tests and an E2E suite against `next dev` (via `scripts/e2e-local.sh`), so this breakage has never been caught automatically and the true production-build health of this repo was unknown until this audit ran it directly. This is the most urgent finding in the entire audit — everything else assumes the app can be built for production, and right now it cannot.
1. **No Upstox provider exists anywhere in the codebase** — despite Upstox being the user's stated primary Beta market-data provider, there is a single passing mention of it in a `.env.example` comment and nothing else. This is the single largest piece of net-new engineering identified in this audit.
2. **The Signal OS AI pipeline (extraction, classification, dedup, multi-channel distribution) is real code sitting in an unactivated n8n JSON file** with 5 unbound placeholder credentials, one disabled node (SMC Auto Trender, vendor-blocked), and an unsolved WhatsApp-relay problem. The live app only has a narrow Telegram-regex + manual-admin path.
3. **One real, exploitable security bug**: an open redirect in `/auth/callback` (`next` param concatenated into a redirect URL without validation).
4. **`npm run test:db`** (the strongest test suite in the repo — pgTAP-level trading-engine and RLS correctness tests) **is not wired into CI.**
5. Payment gateway is intentionally unwired (checkout opens a pending row only; admin-grant is the only activation path today) — consistent with docs, not a bug, but blocks self-serve paid signup.
6. Android is a real, tested debug APK but has no release signing / Play Store readiness.

**Bottom line:** this is a closed/admin-managed Beta today (manual signal composition + manual subscription grants + Upstox-less market data via NSE-unofficial/SMC), not yet the fully-automated, Upstox-powered, AI-classified Beta described in the product brief.

---

## 2. Current Architecture

- **Stack**: Next.js 16.3.4 (App Router, Server Actions, Server Components), React 19.2.8, TypeScript, Tailwind v4, Supabase (Postgres + Auth + RLS), `lightweight-charts` + `recharts`, Capacitor 8 (Android shell), Playwright (E2E), Vitest (unit).
- **Auth**: Supabase Auth (Google OAuth + email/password), session managed via `src/proxy.ts` (Next 16's renamed `middleware.ts`) + `src/lib/supabase/{client,server,admin,middleware}.ts`. Three independent enforcement layers: proxy → route-group layout → Postgres RLS.
- **Data layer**: 19 sequential SQL migrations (`supabase/migrations/0001`–`0019`) implementing schema, RLS, a SECURITY DEFINER trading engine, admin bootstrap, signals, subscriptions, education, instruments, and the Signal OS extension. A `require_trusted_write` trigger (0004) blocks all direct client writes to financial tables — only SECURITY DEFINER RPCs can move money or fill orders.
- **Market data**: `src/lib/market-data/` — a real `MarketDataProvider` interface (`types.ts`), provider resolution against a `integration_configs` DB table (`index.ts`), a caching/dedup/retry decorator (`cache.ts`), and 5 provider implementations (`none`, `nse_unofficial`, `generic_rest`, `smc`, `test_fixture`). Mirrored for options in `src/lib/options/`.
- **Signal OS**: schema for multi-channel ingestion, AI classification, fingerprint dedup, quarantine, and distribution logging (`0007`, `0011`, `0019`) — matched by a real n8n workflow (`n8n/tradosphere-signal-os-master.json`, 37 nodes, includes a genuine LangChain Claude agent) that is not deployed/activated. The only live ingestion path is a narrow Telegram-bot regex parser (`src/lib/signals/ingest.ts`, `parser.ts`) plus a manual admin composer.
- **Admin panel**: 10 real sections (overview, clients, integrations, signal desk, subscriptions, education CMS, notifications, settings, audit logs, health) under `src/app/admin/`, all gated by `requireAdmin()` at both layout and Server Action level.
- **Mobile**: Capacitor WebView shell pointed at the deployed server (no bundled Next.js, no embedded secrets) — a debug APK is built and present in the repo.

---

## 3. Client Experience Audit

Walking through as a real Beta client:

- **Can a new client sign up and reach the dashboard?** Yes — Google OAuth or email/password, both real, both routed through proxy+layout+RLS protection. (One caveat: see the open-redirect finding in §12/§6 — it doesn't block login, but it's a phishing vector on the callback URL.)
- **Are market prices real or fake?** Real when a provider is configured (NSE-unofficial or SMC); explicit "not configured" empty states otherwise. **No `Math.random()`, no hardcoded price arrays, anywhere in the codebase** — confirmed by grep across all of `src/`.
- **Are charts real?** Yes — 100% driven by `/api/market/candles`, which returns exactly what the provider returns, never synthesizes bars.
- **Is option-chain data real?** Yes — real provider data plus genuine Black-Scholes Greeks computed from real inputs, with `null` returned (not a guess) whenever a required input is missing.
- **Does paper trading work end-to-end?** Yes, verified as a real, atomic, RLS-locked SECURITY DEFINER engine — not UI-only. Charges, P&L, cash reservation, and position lifecycle are all computed server-side and cannot be forged by the client.
- **Are signals available, and do they reach the dashboard?** Yes for the narrow live path (Telegram-registered channels + manual admin composition); the broader "AI classifies any of 12 categories from Telegram/WhatsApp/SMC" experience described in the product brief is not live — it exists only inside the unactivated n8n workflow.
- **Are signal statuses/categories meaningful?** Partially — a real bug was found: **every signal ingested through either of the two currently-live paths (Telegram regex, admin manual composer) silently defaults to `category = 'OTHER'`**, because neither writer populates the `category` column. Client-facing category filter tabs (F&O/Equity/etc.) will appear empty even when tradeable signals exist.
- **Is educational content usable?** Yes — real DB-backed CMS, real progress tracking. The "Coach" is honestly a private journal, not an AI chat — and says so in its own UI copy.
- **Is the UI professional?** Yes across all 13 client nav items and 10 admin sections — no dead links, no lorem ipsum, no stub pages found in either audit pass.
- **Does it communicate PAPER TRADING / EDUCATIONAL positioning clearly?** Yes, repeatedly and explicitly ("educational, simulation-only account. No real money or live broker execution") on dashboard, settings, login, and signup.
- **Misleading financial claims?** None found. No landing/marketing page exists at all (`/` is a pure redirect to `/dashboard` or `/login`), which further limits exposure. The two "risk-free"/"guarantee" grep hits are legitimate options-pricing terminology (Black-Scholes risk-free rate), not marketing claims.
- **Dead buttons / empty sections pretending to be functional?** None found in either the paper-trading flow or the general nav/admin sweep.
- **Mobile/Android?** A real, security-conscious WebView shell with a built debug APK and a genuine bottom-nav + drawer implementation with E2E regression coverage (12 routes, touch targets, overflow) — but debug-signed only, not Play Store ready.
- **What would make a real client lose trust fastest?** (a) Signals silently mis-categorized as "Other" so a client filtering for F&O sees nothing even though calls exist; (b) market data showing "not configured" if no admin has turned on a provider post-deploy — by design, but looks broken on a fresh install; (c) the "AI Intelligence" page rendering nothing, since no in-repo process writes to `ai_agent_verdicts` yet.

---

## 4. 20-Phase Status Matrix

| # | Phase | Status | Wave | Beta-critical | Key files/modules | Dependency / blocker |
|---|---|---|---|---|---|---|
| 1 | Full Existing-Project Audit | **COMPLETE** | — | — | this report | — |
| 2 | Signal OS Architecture | **PARTIAL** | 3 | Yes | `supabase/migrations/0007,0011,0019`, `src/lib/signals/*` | Schema complete; only 2 of 10 pipeline stages (ingest, storage) live in app |
| 3 | AI Signal Agent | **PARTIAL** (real code, not deployed) | 3 | Yes | `n8n/tradosphere-signal-os-master.json` (`AI Agent Extract And Classify`, `Claude Model`) | n8n instance + Anthropic credential; zero LLM calls exist in the Next.js app itself |
| 4 | Validation + Deduplication | **PARTIAL** | 3 | Yes | `0019_signal_os.sql` (`fingerprint`), n8n `Parse AI Output`/`Check Duplicate Fingerprint` | Real in n8n only; Telegram regex path never computes/checks `fingerprint` |
| 5 | Supabase Core | **COMPLETE** | — | Yes | `supabase/migrations/0001-0019` | Schema/RLS/functions solid; `test:db` not in CI (see Wave 5) |
| 6 | Master n8n Workflow | **PARTIAL** | 3 | Yes | `n8n/tradosphere-signal-os-master.json` | Well-built, `active:false`, 5 placeholder credentials, 1 disabled node |
| 7 | Credentials + External Integrations | **EXTERNAL BLOCKER** | 3/2 | Yes | Upstox, SMC, n8n creds, WhatsApp Business Cloud, Telegram bot | See §16 User Actions |
| 8 | Signal Test Mode | **PARTIAL** | 3 | No | n8n `Test Mode Trigger`, `MARKET_DATA_TEST_FIXTURE` | n8n test path never executed against staging Supabase |
| 9 | Professional Client Dashboard | **COMPLETE** | — | Yes | `src/app/(app)/dashboard/page.tsx` | — |
| 10 | Signal Center | **PARTIAL** | 2/3 | Yes | `src/app/(app)/signals/*`, `src/app/admin/signals/*` | Display real; category defaults to `OTHER` on both live write paths (bug) |
| 11 | Paper Trading | **COMPLETE** | — | Yes | `src/lib/trading/*`, `0003/0005/0015/0016/0017/0018` | — |
| 12 | Live Market Data + Charts | **PARTIAL** | 2 | Yes | `src/lib/market-data/*` | Architecture complete; Upstox provider absent; SMC unverified against live account |
| 13 | Option Chain | **PARTIAL** | 2 | Yes | `src/lib/options/*` | Same provider gap as #12; math/analysis itself is complete and real |
| 14 | Education | **COMPLETE** | — | No | `src/app/(app)/education/*`, `0009_education.sql` | — |
| 15 | Admin Panel | **COMPLETE** | — | Yes | `src/app/admin/*` | — |
| 16 | Security | **PARTIAL** | 4 | Yes | `src/app/auth/callback/route.ts` | One real bug: open redirect via unvalidated `next` param |
| 17 | Mobile / Android UX | **PARTIAL** | 4 | No (Beta can ship browser-only) | `android/`, `capacitor.config.ts`, `scripts/android-build.sh` | Debug-signed only; no release keystore |
| 18 | Full E2E Verification | **PARTIAL** | 5 | Yes | `e2e/*`, `supabase/tests/*`, `.github/workflows/ci.yml` | Unit+E2E strong and green; `npm run test:db` not run in CI |
| 19 | Production Readiness | **BROKEN** | 5 | Yes | build/CI/env config | `npm run build` fails reproducibly (Node 20 & 22); never caught because CI has no build step; blocks every other Wave-5 item until fixed |
| 20 | Beta Launch | **MISSING** (not attempted) | 5 | Yes | — | Depends on all of the above |

**Tally: COMPLETE 6 · PARTIAL 11 · EXTERNAL BLOCKER 1 · MISSING 1 · BROKEN 1**

---

## 5. Supabase Audit

**Migration inventory** (19 files, applied in order, single-transaction-per-file design):

| Migration | Adds |
|---|---|
| 0001_schema | Core tables: profiles, paper_accounts, positions, orders, trades, watchlists, watchlist_items, `integration_configs` |
| 0002_rls | RLS enablement + `is_admin()` policy helper across core tables |
| 0003_trading_functions | Early trading RPC scaffolding |
| 0004_financial_lockdown | `require_trusted_write` trigger + `begin_trusted_write()` — blocks all direct client writes to financial tables; only SECURITY DEFINER RPCs can write |
| 0005_trading_engine | Full paper-trading engine constraints (no margin/leverage/shorting-credit by design) |
| 0006_admin_bootstrap | First-admin bootstrap path, consumed by `scripts/bootstrap-admin.mjs` |
| 0007_signals | `signal_source_kind`, `signal_status`, `verification_state` enums; `signal_sources`, `telegram_inbox`, `signals`, `signal_events` tables; RLS restricting clients to verified/non-pending signals |
| 0008_subscriptions | Plans/subscriptions/payments/entitlements schema |
| 0009_education | courses/course_modules/lessons/lesson_progress/course_enrollments/coach_messages |
| 0010_instruments | Instrument/symbol mapping tables |
| 0011_signal_ingestion | `system_release_signal()` — service-role-only, trusted-source auto-release |
| 0012_checkout | Checkout intents + `record_payment_success()` (service-role only, gateway-webhook target) |
| 0013_entitlement_gating | Moves paywall enforcement onto RLS via `has_entitlement` |
| 0014_expiry_warnings | Idempotent pre-expiry subscription warning sweep |
| 0015_order_status_pending | Adds pending order status |
| 0016_order_lifecycle | Full order lifecycle: `place_paper_order`, `fill_order_internal`, `cancelOrder`/`modifyOrder` RPCs, charges calc, reservation accounting |
| 0017_allow_account_erasure | Account erasure support |
| 0018_backfill_paper_accounts | Data backfill for existing accounts |
| 0019_signal_os | 12-category `signal_category` enum, `whatsapp_group`/`api_connector` source kinds, `raw_signal_messages`, `distribution_logs`, `workflow_errors`, `ingest_classified_signal()`, `quarantine_raw_message()`, `log_distribution()`, `log_workflow_error()` |

**RLS**: enabled and correctly scoped on every table reviewed; financial tables additionally protected by the `require_trusted_write` trigger so RLS grants alone are not the only line of defense. No missing-RLS table was found in this pass. Signal OS tables (`raw_signal_messages`, `distribution_logs`, `workflow_errors`) are admin-only by RLS, writable only via the service-role RPCs listed above.

**App-code ↔ schema alignment**: verified consistent. `src/types/database.ts` mirrors the migrations. No orphaned table/column references found in `src/lib/`.

**Discrepancies / gaps found**:
- `calcRMultiple` in `src/lib/trading/risk.ts` is dead code (defined, tested, never imported) — SQL computes an equivalent `v_r_multiple` independently and correctly, so no correctness loss, just cleanup.
- Neither live signal-write path (Telegram regex, admin composer) populates `signals.category` — defaults silently to `OTHER` (see §9).
- `scripts/verify-db.sh` (`npm run test:db`) — the pgTAP-equivalent SQL test suite covering 13 trading-engine scenarios plus RLS isolation and account erasure — is **not invoked by CI** (confirmed: no `test:db`/`verify-db`/`supabase test` reference in `.github/workflows/ci.yml`).
- `supabase/.temp/linked-project.json` and related `.temp/` files exist locally (evidence of a linked Supabase project used for local dev) — contents not printed per audit safety rules; presence noted only.

---

## 6. Authentication Audit

- **OAuth flow**: `google-button.tsx` → Supabase `signInWithOAuth` → `/auth/callback` → `exchangeCodeForSession` → redirect to `next` (default `/dashboard`). Email/password path is separate and complete (`src/lib/auth/actions.ts`).
- **Route protection**: three independent layers — `src/proxy.ts` (session + redirect-to-login for all non-public paths, plus admin role+active check for `/admin/**`), route-group `layout.tsx` files (independent re-check), and Postgres RLS (final backstop, cannot be bypassed even if the first two layers were misconfigured).
- **🔴 Real finding — open redirect**: `src/app/auth/callback/route.ts` builds the post-login redirect via string concatenation of `origin` + a client-supplied `next` query param, with no validation that `next` is a same-origin relative path. Confirmed exploitable patterns: `next=@evil.com/` and `next=.evil.com` both produce a redirect to an attacker-controlled host. **This is the one concrete security defect found in this audit** — classified as CODE FIX, scheduled Wave 4 (§16).
- **Minor dead code**: `middleware.ts`'s `?next=` param set on the login redirect is never read by `signInWithPassword`, which always redirects to `/dashboard` — a UX gap, not a security issue.
- **Admin authorization**: enforced at three levels too — proxy, `admin/layout.tsx`, and (critically) every exported Server Action in `src/lib/admin/actions.ts` independently calls `ensureAdmin()` first, with an inline comment explicitly noting that Server Actions are independently network-invokable and the layout redirect alone would not be sufficient. No admin action was found missing this check.
- **API route security**: every route under `src/app/api/` was read individually — cron and Telegram webhook use constant-time shared-secret comparison (`crypto.timingSafeEqual`) with correct 503 (unconfigured) vs 401 (bad secret) semantics; market-data routes require `requireUser()`; `/api/market/status` is intentionally public (pure calendar math, no sensitive data). No route was found reachable without its intended gate.
- **Secrets**: service-role client is `import "server-only"` guarded; provider secrets (SMC keys etc.) are referenced by env-var *name* only in the `integration_configs` table, never stored as values in the DB. No `NEXT_PUBLIC_` var was found exposing anything beyond the intentionally-public Supabase anon key/URL pair. No sensitive values found in logs (`console.*`) anywhere in `src/`.
- **Live-order safety**: confirmed by exhaustive grep — no broker SDK (SmartAPI, Kite, Upstox order API) and no order-placement HTTP call exists anywhere; `placeOrder()` calls exclusively the Postgres `place_paper_order` RPC.

---

## 7. Paper Trading Audit

**Verdict: genuinely functional, not decorative.** Full trace, client → server action → RPC → DB:

```
order-form.tsx → placeOrder() [trading/actions.ts]
  → fetch real quote, reject MARKET orders without one
  → supabase.rpc("place_paper_order", …)
    → place_paper_order() SECURITY DEFINER RPC [0016_order_lifecycle.sql]
        → re-derives account from auth.uid() (never trusts client-supplied id)
        → reserves buying power / rejects if insufficient
        → if condition already met at current price → fill_order_internal()
            → computes DB-authoritative charges (not client-supplied)
            → re-checks affordability including charges
            → writes/updates positions (weighted avg price)
            → inserts trades row (realized_pnl, net_realized_pnl, r_multiple)
            → updates cash_balance, order status, order_events, notifications
              — all inside one transaction
→ portfolio/page.tsx: unrealized P&L computed against a fresh live quote;
  shows "no live quote" rather than a stale/fake number if none available
```

All direct writes to `orders`/`trades`/`positions`/`paper_accounts` are revoked for `anon`/`authenticated` roles and blocked by a `require_trusted_write` trigger (`0004_financial_lockdown.sql`) — **the client cannot forge a fill, a position, or a cash balance under any circumstance**, only through the RPCs above.

- **Risk controls**: cash/buying-power gating enforced at both placement and fill time (including charges); double-reservation prevention verified by pgTAP test; stop/target sanity checks enforced server-side in `actions.ts` before the RPC call; no margin/leverage exists, by design, and this is stated in the UI, not hidden.
- **Charges**: real Indian cash-segment charge model (brokerage, STT, exchange, SEBI/IPFT, stamp duty, GST) computed authoritatively inside the DB function (not passed in by the client, specifically because the RPC is callable directly with the anon key); a client-side preview mirrors it rate-for-rate for UX.
- **P&L**: pure arithmetic, never fabricates a price; realized P&L computed once server-side at fill time; unrealized P&L (and portfolio totals) explicitly render "unknown" rather than "flat"/zero when a position can't be quoted.
- **Live-execution safety**: confirmed absent (no broker SDK/API call exists anywhere in the trading or market-data code).
- **E2E proof**: `e2e/authenticated/order-lifecycle.spec.ts` and `paper-trading-flow.spec.ts` drive the real UI end-to-end (place → fill → debit-by-notional-plus-charges within 2 cents → close → net-P&L check), using the deterministic test-fixture price source but exercising the *real* order engine, not a mock. `supabase/tests/10_order_lifecycle.sql` (13 scenarios) and `11_account_erasure.sql` give strong DB-level proof independent of the UI — but **are not run in CI** (see §5/§18).
- **Dead code found**: `calcRMultiple` (`risk.ts`) — unused, safe to remove or wire in for consistency.

---

## 8. Market Data Audit

**Architecture verdict: real and provider-agnostic, matching the user's stated `Market Data Interface → Provider` direction — not aspirational.**

- `src/lib/market-data/types.ts` defines a genuine `MarketDataProvider` interface with an explicit written contract: never invent/interpolate/randomly generate a price; return `null`/`[]` when real data isn't available.
- `src/lib/market-data/index.ts` resolves the active provider from the `integration_configs` DB table (admin-changeable, no redeploy needed) and always falls back to an explicit `NoneProvider` — never throws, never fabricates.
- A caching/dedup/one-retry decorator (`cache.ts`) wraps every provider uniformly; TTL is session-aware (5s open market / 5min closed) via `market-hours.ts`.
- Mirrored exactly for option chain in `src/lib/options/`.

**Provider inventory:**

| Provider | Real or fake | External API | Notes |
|---|---|---|---|
| `none` | Stub by design | — | Default / explicit "no data" state |
| `nse_unofficial` | **Real** | `nseindia.com` public/unofficial JSON | Cookie-session handshake; explicitly labeled dev-grade, not production SLA |
| `generic_rest` | **Real, vendor-generic** | Whatever `baseUrl` an admin configures | No vendor-specific tested implementation; a template |
| `smc` | **Real, but unverified against a live account** | SMC partner API (login + JWT + RFC 6238 TOTP, verified against RFC test vectors) | Field mappings are admin-configurable JSON-paths; comments explicitly note defaults are best-guesses pending a real SMC account |
| `test_fixture` | **Explicitly fake, triple-gated** | none | DB row + env var required; absent from the admin dropdown; self-labeled "NOT A MARKET DATA SOURCE" |
| **`upstox`** | **Does not exist** | — | Zero references anywhere except one `.env.example` comment naming it as a hypothetical `generic_rest` target |

**🔴 Critical finding — Upstox gap**: confirmed by exhaustive grep (`upstox`, case-insensitive, across `src/`, `supabase/`, `n8n/`) that the only hit anywhere in the repository is a parenthetical example in a `.env.example` comment. No `UpstoxProvider` class, no `UPSTOX_*` env var, no admin-dropdown entry, no `case "upstox"` branch exists. Given the user's explicit direction ("Upstox = primary, SMC should not block Beta"), this is the single largest piece of net-new engineering identified across the whole audit.

**What building it requires** (scoped precisely from the existing pattern):
1. `src/lib/market-data/providers/upstox.ts` implementing `MarketDataProvider` — Upstox uses OAuth2 authorization-code flow, not username+TOTP like SMC, so a **new** `upstox-session.ts` is needed (SMC's session module is not reusable as-is).
2. Optionally `src/lib/options/providers/upstox.ts` implementing `OptionChainProvider`, sharing the new session module.
3. A `case "upstox":` branch in `resolveProvider()` in both `market-data/index.ts` and `options/index.ts`.
4. A dropdown entry + `CONFIG_TEMPLATES.upstox` + `REQUIRED_ENV.upstox` in `src/app/admin/integrations/{page.tsx,integration-card.tsx}`.
5. `UPSTOX_API_KEY`/`UPSTOX_ACCESS_TOKEN` (or equivalent) documented in `.env.example`.
6. **No changes needed** to `cache.ts`, `market-hours.ts`, `use-live-quotes.ts`, the `/api/market/*` routes, or any chart/option-chain UI component — they are already fully provider-agnostic.

**Charts**: 100% real-data-driven — `chart-panel.tsx` fetches `/api/market/candles`, which returns exactly what the provider returns; `price-chart.tsx` (lightweight-charts) never interpolates gaps. No hardcoded data found.

**Option chain**: real end-to-end, including genuine Black-Scholes Greeks (`src/lib/options/calc.ts`, real Abramowitz-Stegun normal-CDF approximation) computed from real inputs, returning `null` rather than a guess when inputs are missing. Max Pain / PCR are real formulas. UI explicitly distinguishes computed ("est.") Greeks from provider-reported ones.

**Fake-data scan**: zero `Math.random()` matches anywhere in `src/`; no hardcoded price arrays, `mockPrice`/`fakePrice`/`dummyPrice` identifiers found. The only intentionally-fake price source is the triple-gated `test_fixture`.

**`/api/market/stream` note**: implemented as SSE polling against the cached provider (min ~5s latency during market hours), not a true WebSocket push — the client contract is designed so swapping to a real push socket later is "a change inside this file" per its own comment, not a wider refactor.

**Hidden blocker**: the `.env.example` mention of Upstox as a hypothetical `generic_rest` target could mislead a future engineer — Upstox's real API (OAuth2, instrument-token-based) does not match `generic_rest`'s assumed contract (`GET {baseUrl}/quote` + static bearer key) and needs its own dedicated provider, not a generic-REST config.

---

## 9. Signal OS Audit

**Schema** (0007/0011/0019) is complete and well-designed, supporting the full vision: multi-source ingestion (Telegram/WhatsApp/API/manual), all 12 categories (F&O, EQUITY, COMMODITY, IPO, SIP, MUTUAL_FUND, INVESTMENT, INSURANCE, LOAN, MARKET_UPDATE, EDUCATION, OTHER — confirmed present verbatim in the `signal_category` enum), fingerprint-based dedup with a unique partial index, quarantine handling, and per-destination distribution logging.

**Pipeline reality check** — of the 10 conceptual stages (Sources → ingestion → normalization → AI extraction → classification → validation → dedup → storage → distribution → dashboard), only **ingestion, storage, and dashboard-read are live in the deployed Next.js app.** Everything else exists as real, well-built code — but only inside the unactivated n8n workflow:

| Stage | Live in app? | Where the real code actually lives |
|---|---|---|
| Telegram ingestion | ✅ Yes | `src/app/api/telegram/webhook/route.ts`, `src/lib/signals/ingest.ts` |
| WhatsApp/SMC ingestion | ❌ No | n8n nodes only, disabled/placeholder |
| AI extraction/classification | ❌ No LLM call exists in `src/` at all | n8n `AI Agent Extract And Classify` + Claude Sonnet model node |
| Deterministic validation | ❌ No | n8n `Parse AI Output` code node |
| Fingerprint dedup | ❌ Not invoked by the Telegram path | n8n `Check Duplicate Fingerprint` node + DB unique index |
| Multi-destination distribution | ❌ No | n8n `Send To Telegram/WhatsApp` + `log_distribution()` |
| Dashboard read | ✅ Yes | `src/app/(app)/signals/*` |

**AI Agent presence — explicit answer**: zero LLM/AI API calls exist anywhere in the Next.js application code (confirmed by exhaustive grep for openai/anthropic/gpt/claude/llm/langchain across all of `src/`). The AI agent is real but lives entirely inside `n8n/tradosphere-signal-os-master.json`.

**n8n workflow** (37 nodes, `active: false`, never deployed): node-by-node review found **no orphaned or fake nodes** — every node has real logic and correct connections, including the LangChain sub-node wiring (Claude model → structured-output parser → agent). Three real blockers prevent it running against live traffic today: (1) 5 unbound placeholder credentials (Postgres, Telegram Bot, WhatsApp Cloud ×2, Anthropic key), (2) the `SMC Auto Trender API` node is disabled with a placeholder URL, pending vendor access, (3) WhatsApp source ingestion has an acknowledged platform constraint — the official WhatsApp Cloud API only receives messages sent to Tradosphere's own business number, so the 3 target source groups need a relay mechanism that doesn't exist yet. The `Test Mode Trigger` path bypasses all three and could be exercised against a real Supabase instance once credentials alone are bound.

**Manual admin distribution path**: real and fully functional (`src/app/admin/signals/signal-composer.tsx` → `createSignal()`), bypassing ingestion entirely — an admin can hand-type a signal that lands `pending`/`unverified` and must still pass `verifySignal()` before clients see it.

**🔴 Bug found**: neither `createSignal()` (manual composer) nor the Telegram regex `ingest.ts` path ever sets `signals.category` — every live-today signal silently defaults to the DB default `'OTHER'`, which breaks the client-facing category filter tabs even for correctly-typed F&O/Equity calls.

**WhatsApp**: confirmed absent from the running app entirely — present only as schema columns and n8n nodes.

---

## 10. n8n Audit

Covered in detail in §9. Summary verdict: **the workflow file is real, importable, and well-engineered — not a mockup** — but requires credential binding, a WhatsApp relay solution, and SMC vendor access before it can run against live traffic. No fake/placeholder node logic was found; the placeholders that exist are exactly where credentials belong (by n8n's own convention), not disguised as functioning nodes.

---

## 11. Dashboard/UI Audit

- **Navigation**: all 13 client nav items and 10 admin nav items resolve to real, DB-backed pages — no dead links, no stub pages, confirmed by direct read of every target file.
- **Dashboard**: fully real, computed from live Supabase queries (`Promise.all` across account/positions/orders/trades/watchlists/quotes/signals), explicit "—" instead of fabricated values for anything unknown.
- **AI Intelligence page**: renders real rows from an `ai_agent_verdicts` table, but **no in-repo process writes to that table** — the page is explicit about this in its own UI copy ("this page only renders what already exists, it never generates a verdict client-side"). If Beta expects live AI verdicts here, that generation pipeline does not exist yet anywhere in this repo.
- **Education "Coach"**: honestly a private reflection journal, not an AI chat — states so directly in its own component copy; no fabricated AI response is ever generated.
- **Admin panel**: all 10 sections real and functional, including a genuine audit-log trail (service-role-only writes, no client insert policy) and a narrow-but-real system-health page (3 env-var presence checks + 2 integration test results — no DB connectivity/uptime signal beyond that).
- **No TODO/FIXME/"Coming soon"/lorem-ipsum found anywhere in `src/`.**
- **No misleading financial claims found** — every money-touching surface explicitly states "educational, simulation-only... no real money or live broker execution."
- **README.md is unusually accurate** — its claims about no-synthetic-data, unwired payment gateway, and the Android APK's credential-free design all check out against the actual code.

---

## 12. Security Audit

See §6 for full detail. Summary:

| Area | Verdict |
|---|---|
| OAuth flow | Working; **one real bug** — open redirect in `/auth/callback?next=` |
| Route protection | Three independent layers (proxy/layout/RLS), all verified correct |
| Admin authorization | Enforced at page, layout, AND Server Action level — no bypass found |
| API route security | Every route's auth gate verified to run before any side effect |
| Secret handling | Service-role client `server-only`-guarded; provider secrets never stored as values in DB; no secret exposed via `NEXT_PUBLIC_` |
| Sensitive logging | Zero credential values found logged anywhere |
| CSRF/replay | Shared-secret constant-time comparisons with correct 503/401 semantics; replay impact is low given idempotent downstream operations |
| Live-order safety | Confirmed: no broker SDK/order-placement code exists anywhere |

---

## 13. Mobile Audit

- Real Capacitor WebView shell, deliberately thin by design (server-rendered app can't be statically bundled) — ships no Supabase keys, no provider credentials, no market data in the APK itself.
- A debug APK is actually built and present on disk (`android/app/build/outputs/apk/debug/app-debug.apk`), with a populated Gradle project, not empty scaffolding.
- `scripts/android-build.sh` refuses to build against a non-HTTPS `TRADOSPHERE_APP_URL`, with commentary specifically warning against shipping a placeholder-configured build.
- Real, tested mobile navigation: `mobile-nav.tsx` (bottom bar + drawer, 44px touch targets, safe-area padding, focus trap), with genuine E2E coverage (`mobile-navigation.spec.ts`) asserting no horizontal overflow across 12 routes on a Pixel 7 viewport.
- **Gap**: no release signing/keystore exists yet — debug-signed only, not Play Store ready.

---

## 14. Testing Audit

Executed live this session:

| Check | Command | Result |
|---|---|---|
| TypeScript | `npm run typecheck` | **Pass, 0 errors** |
| ESLint | `npm run lint` | **Pass, 0 errors/warnings** |
| Unit tests (Vitest) | `npm run test` | **Pass — 17 test files, 205 tests, 41.65s** |
| Production build | `npm run build` | **🔴 FAIL — exit code 1.** `unhandledRejection SyntaxError: Unexpected identifier 'Object'` inside `node_modules/next/dist/compiled/@edge-runtime/primitives/load.js`, thrown before any page/route is emitted. Reproduced identically on **Node 20.20.2 and Node 22.23.2** (re-ran under both via `nvm`) and after a full `rm -rf .next` (rules out stale build cache). Not a local Node-version quirk — the failure is Node-version-independent given both 20 and 22 reproduce it identically. |

**🔴 Critical gap confirmed**: `.github/workflows/ci.yml` has exactly two jobs, `static-checks` (typecheck, lint, unit test) and `e2e` (Playwright against `next dev` via `scripts/e2e-local.sh`) — **`next build` / `npm run build` is never invoked anywhere in CI.** This means the production-build path has had no automated verification at all, on any commit, and this failure could have been present for some time without anyone knowing. Root cause was not chased further in this audit (out of scope for a read-only pass — likely candidates worth checking first in Wave 2: `src/proxy.ts` edge-runtime bundling, the `next build --webpack` flag forcing webpack over Turbopack on Next 16.3.4, or a corrupted/mismatched `node_modules` install), but it must be fixed before anything else in Wave 5, and ideally immediately, since it currently blocks any real deployment.

E2E (`e2e/authenticated/*.spec.ts`, Playwright): read and assessed as genuinely assertion-heavy (not smoke-only) — order lifecycle, mobile navigation, and paper-trading-flow specs all self-skip locally without seeded test credentials but are required (fail, not skip) in CI per `.github/workflows/ci.yml`.

**Gap**: `npm run test:db` (`scripts/verify-db.sh`), which runs the pgTAP-equivalent SQL suite (`supabase/tests/10_order_lifecycle.sql`, `11_account_erasure.sql` — 13 scenarios covering fill correctness, reservation math, cross-user RLS isolation, and direct-write lockdown) is **not invoked anywhere in CI**. This is the single strongest correctness test in the repo and currently only runs if a developer remembers to run it manually.

---

## 15. Hidden Blockers (full list)

0. **`npm run build` fails, and CI never runs it** — the single most urgent finding in this audit (see §14). Reproduced on two Node major versions; not a build-cache artifact; root cause not yet identified.
1. **Open redirect** in `src/app/auth/callback/route.ts` — `next` param unvalidated before use in a redirect (real, exploitable).
2. **`npm run test:db` not wired into CI** — the strongest trading-engine/RLS test suite in the repo can be bypassed by a regression that lands on `main`.
3. **Signal category defaults to `OTHER` on both live write paths** (Telegram regex ingest, manual admin composer) — breaks client-facing category filters for real, correctly-typed signals.
4. **Dedup/fingerprinting only exists in the unactivated n8n path** — the live Telegram regex path has no dedup at all today.
5. **`quarantine_raw_message()` has zero application-code callers** — the "quarantine" concept currently has no real-world runtime usage outside the inactive n8n workflow.
6. **Upstox is entirely unbuilt** — the stated primary Beta provider does not exist in code (see §8).
7. **SMC provider field-mappings are unverified against a real account** — comments in the code itself acknowledge this; cannot be certified production-ready by static review alone.
8. **NSE-unofficial provider is explicitly dev-grade** — subject to rate-limiting/IP blocking, not a production SLA feed.
9. **`/api/market/stream` is SSE polling, not a true push socket** — ~5s minimum latency during market hours, not instantaneous.
10. **`AI Intelligence` page has no writer** — `ai_agent_verdicts` table is read-only from the app's perspective; nothing in this repo populates it.
11. **`calcRMultiple` (risk.ts) is dead code** — harmless but unused.
12. **`.env.example`'s Upstox mention could mislead** — implies Upstox could be wired through `generic_rest`, but its real OAuth2/instrument-token API doesn't match that contract.
13. **No payment-gateway webhook exists** — `record_payment_success()` has no caller; only manual admin grant activates subscriptions today (documented, not hidden, but worth restating here as a functional gap).
14. **Android is debug-signed only** — no release keystore present.
15. **System Health admin page is narrow** — 3 env-var checks + 2 integration test results only; no DB connectivity/uptime signal.

---

## 16. External / User Blockers

Everything below requires an external account, credential, cloud dashboard, or business decision — none of it can be resolved by Claude writing code:

- **Upstox developer account + API credentials** (client ID/secret, redirect URI registration) — required before an Upstox provider can be tested against real data, even after the code is written.
- **SMC partner API onboarding** — no public self-service signup; needed to verify/correct the existing SMC provider's field mappings against a real account.
- **Google Cloud Console**: OAuth consent screen + authorized redirect URI pointing at Supabase's `/auth/v1/callback`.
- **Supabase Dashboard**: enable Google Auth provider; set Site URL / additional redirect URLs (also a secondary mitigation layer for the open-redirect bug — should be locked down regardless of the code fix).
- **n8n instance**: stand up and import `n8n/tradosphere-signal-os-master.json`; bind 5 credentials (Supabase Postgres, Telegram Bot API, WhatsApp Business Cloud Trigger + Send, Anthropic API key).
- **WhatsApp Business Cloud number + relay decision**: register a Tradosphere-owned business number, and decide/solve how 3 external source groups relay into it (platform-level constraint, not a code problem).
- **CRON_SECRET** set in the production hosting environment, matching whatever scheduler (Vercel Cron / GitHub Actions / pg_cron) calls `/api/cron/expire-subscriptions`.
- **TELEGRAM_WEBHOOK_SECRET** matching what was registered via Telegram's `setWebhook` `secret_token` param.
- **Payment gateway selection + credentials** (Razorpay/Stripe/PayU) if self-serve paid signup is wanted before Beta.
- **Android release keystore** generation and secure storage (explicitly kept out of the repo).
- **Market-data redistribution/licensing confirmation** for whichever provider(s) actually serve live prices to paying clients (Upstox and/or SMC) — a legal/business check, not a code check.
- **Production deployment/DNS ownership** (Vercel or equivalent), including `SUPABASE_SERVICE_ROLE_KEY` scoped to server-only env vars there.

---

## 17. Claude vs User Responsibilities

**CLAUDE CAN DO** (code-level, no external account needed):
- Fix the open-redirect bug in `/auth/callback`.
- Build the `UpstoxProvider` / `upstox-session.ts` module and wire it into `resolveProvider()` + admin UI (code can be written and unit-tested now; live-account verification still needs real Upstox credentials from the user).
- Fix `createSignal()`/`signal-composer.tsx` to persist `category`.
- Wire fingerprint dedup into the Telegram regex ingestion path.
- Add `npm run test:db` as a CI step.
- Remove or wire in the orphaned `calcRMultiple`.
- Correct the `.env.example` Upstox comment to avoid implying `generic_rest` compatibility.
- Any migration, RLS policy, Server Action, admin UI, adapter, or n8n JSON edits.
- Android release-build *pipeline* code (Gradle signing config referencing an externally-supplied keystore) — the keystore itself must come from the user.

**USER MUST DO MANUALLY** (see §16 in full) — Upstox/SMC account credentials, Google Cloud OAuth config, Supabase dashboard settings, n8n hosting + credential binding, WhatsApp Business number + relay decision, payment gateway selection, Android keystore, production secrets/DNS, market-data licensing confirmation, Beta pricing/legal decisions.

---

## 18. Dependency Graph

```
Supabase Core (COMPLETE)
  → Paper Trading (COMPLETE, depends only on Supabase Core + a market-data provider for fills)
       → Market Data Interface (COMPLETE)
            → NSE-unofficial / SMC providers (PARTIAL — real but unverified/dev-grade)
            → Upstox provider (MISSING — net-new, Wave 2)
                 → Charts (COMPLETE, already provider-agnostic, no changes needed)
                 → Option Chain (COMPLETE math, PARTIAL provider coverage — same Upstox gap)
  → Dashboard (COMPLETE, consumes Paper Trading + Market Data + Signals)

Signal Sources (Telegram real / WhatsApp+SMC missing)
  → Ingestion (PARTIAL — Telegram regex only)
       → AI Extraction (MISSING in app / real in n8n only)
            → Classification into 12 categories (same gap)
                 → Validation (same gap)
                      → Dedup/Fingerprinting (same gap)
                           → Supabase storage (COMPLETE schema, PARTIAL population — category bug)
                                → Distribution (MISSING in app / real in n8n only)
                                     → Dashboard/Signal Center (COMPLETE display, PARTIAL data quality)

Security fixes (open redirect) — independent, no dependency, should land early (Wave 2/4 either works)
CI hardening (test:db gate) — independent, should land before any further Wave 2/3 merges
Education / Admin Panel / Mobile shell — already COMPLETE or PARTIAL-but-non-blocking, Wave 4 polish only
```

**Real execution order** (not phase-number order): Supabase Core is already done, so the critical path is **Upstox provider → verified market data/option chain/charts (Wave 2)**, running in parallel with **Signal OS ingestion fixes + n8n credential binding + WhatsApp/SMC resolution (Wave 3)**, converging on **security fix + CI hardening + Android/education polish (Wave 4)**, then **full E2E + production verification (Wave 5)**.

---

## 19. Wave 2 Task Plan — Core Trading Platform Completion

| Task ID | Objective | Files/modules | Depends on | Work | Verification | Beta-critical |
|---|---|---|---|---|---|---|
| W2-01 | Build Upstox market-data provider | `src/lib/market-data/providers/upstox.ts` (new), `src/lib/market-data/providers/upstox-session.ts` (new, OAuth2) | User-supplied Upstox API credentials | Implement `MarketDataProvider` interface; OAuth2 auth-code exchange + refresh; map Upstox quote/candle JSON to internal types | Unit tests mirroring `smc-session.test.ts` pattern; manual `testConnection()` against real sandbox once credentials exist | **Yes** |
| W2-02 | Wire Upstox into provider resolution + admin UI | `src/lib/market-data/index.ts`, `src/app/admin/integrations/{page.tsx,integration-card.tsx}`, `.env.example` | W2-01 | Add `case "upstox"`, dropdown entry, config template, required-env list, env var docs | Admin can select/save/"Test connection" for Upstox in the integrations UI | Yes |
| W2-03 | Optional: Upstox option-chain provider | `src/lib/options/providers/upstox.ts` (new) | W2-01 | Implement `OptionChainProvider`, reuse `upstox-session.ts` | Same pattern as W2-02 for `option_chain_provider` row | No (nice-to-have if Upstox exposes chain data; SMC/NSE-unofficial can carry option chain if not) |
| W2-04 | Fix `.env.example` Upstox comment | `.env.example` | — | Clarify Upstox needs its own dedicated provider, not `generic_rest` | Docs review | No |
| W2-05 | Verify SMC provider against a real account (once credentials available) | `src/lib/market-data/providers/smc.ts`, `smc-session.ts` | User-supplied SMC credentials | Adjust field-mapping defaults based on real API responses | `testConnection()` succeeds; live quote round-trip verified | No (SMC explicitly must not block Beta) |
| W2-06 | Remove or wire in `calcRMultiple` | `src/lib/trading/risk.ts` | — | Delete dead code, or invoke from `actions.ts` if a UI use is found | `npm run test` still green | No |

## Wave 3 Task Plan — Signal Automation

| Task ID | Objective | Files/modules | Depends on | Work | Verification | Beta-critical |
|---|---|---|---|---|---|---|
| W3-01 | Fix signal category persistence | `src/lib/signals/admin-actions.ts` (`createSignal`), `src/app/admin/signals/signal-composer.tsx` | — | Add category field to form + insert | Manually composed signal shows correct filter tab | **Yes** |
| W3-02 | Add fingerprint dedup to Telegram ingestion path | `src/lib/signals/ingest.ts`, `parser.ts` | — | Compute the same fingerprint formula n8n uses; check `signals.fingerprint` unique index before insert | Duplicate Telegram message does not create a second signal | Yes |
| W3-03 | Stand up n8n instance + import workflow | (external) n8n hosting | User: n8n hosting decision | Import `n8n/tradosphere-signal-os-master.json` | Workflow appears in n8n UI, `Test Mode Trigger` runs | Yes |
| W3-04 | Bind n8n credentials | n8n instance config | User: Supabase Postgres conn string, Telegram bot token, Anthropic API key, WhatsApp Cloud creds | Configure 5 credentials in n8n | Each node validates its credential | Yes |
| W3-05 | Run `Test Mode Trigger` against staging Supabase | n8n instance + staging Supabase project | W3-03, W3-04 | Execute test fixture message through full pipeline | `raw_signal_messages` → `signals` → `distribution_logs` rows appear correctly in staging | Yes |
| W3-06 | Resolve WhatsApp source relay | (external/business decision) | User | Register business number + solve group-relay, or drop WhatsApp *source* ingestion from Beta scope (keep distribution only) | Decision documented; if pursued, WhatsApp trigger receives real messages | Yes (decision required either way) |
| W3-07 | Secure SMC Auto Trender API access | (external) | User: SMC vendor relationship | Enable disabled n8n nodes once access granted | Node executes without error | No (can defer past Beta) |
| W3-08 | Wire n8n webhook/trigger endpoints into real infra | n8n instance, `.env.example` (if any app-side reference needed) | W3-03–W3-05 | Point Telegram/WhatsApp triggers at production webhook URLs; set `active: true` only after staging verification | Production signal flows end-to-end once | Yes |
| W3-09 | Add admin visibility for `workflow_errors` | `src/app/admin/signals/` (new panel or extend existing) | 0019 schema (already exists) | Simple admin-reads page/query surfacing unresolved `workflow_errors` rows | Admin can see failed pipeline runs | No (operational nicety, recommended before relying on n8n in production) |

## Wave 4 Task Plan — Product Completion

| Task ID | Objective | Files/modules | Depends on | Work | Verification | Beta-critical |
|---|---|---|---|---|---|---|
| W4-01 | Fix open-redirect in OAuth callback | `src/app/auth/callback/route.ts` | — | Validate `next` is a same-origin relative path (reject `//`, `@`, `://`) before redirecting | Manual test with malicious `next` values confirms rejection; existing login flow still works | **Yes** |
| W4-02 | Wire `?next=` through email/password login | `src/lib/auth/actions.ts`, `src/app/login/page.tsx` | — | Read and use the `next` param already set by the proxy | User returns to intended page after password login | No |
| W4-03 | Android release signing pipeline | `android/`, `scripts/android-build.sh` | User: keystore file | Add Gradle signing config referencing an externally-supplied keystore path/env vars | `assembleRelease` produces a signed AAB/APK once keystore is supplied | No (Beta can ship as sideloaded debug APK or browser-only) |
| W4-04 | Payment gateway integration (if self-serve paid signup wanted for Beta) | new `src/app/api/payments/webhook/route.ts`, gateway SDK | User: gateway account + credentials | Signature-verified webhook calling `record_payment_success()` | Test payment activates subscription end-to-end in gateway sandbox | Only if self-serve payment is in Beta scope; otherwise admin-grant is sufficient |
| W4-05 | Expand System Health admin page | `src/app/admin/health/page.tsx` | — | Add DB connectivity ping, basic latency/uptime signal | Health page reflects a simulated outage correctly | No |
| W4-06 | Decide/implement `AI Intelligence` verdict-generation pipeline | new module (scope TBD) | User: business decision on what generates verdicts | Either wire a real generation process or relabel the page as admin-curated | Page shows real verdicts or accurate "curated by our desk" framing | No (currently honest about its limits, not broken) |

## Wave 5 Task Plan — Beta Readiness

| Task ID | Objective | Files/modules | Depends on | Work | Verification | Beta-critical |
|---|---|---|---|---|---|---|
| W5-00 | **Fix `npm run build`** | likely `src/proxy.ts`, `next.config.ts`, or `node_modules` reinstall | — | Diagnose the edge-runtime bundling `SyntaxError` (reproduced on Node 20 & 22, not a cache issue); candidates: proxy.ts edge-runtime compatibility, the forced `--webpack` flag on Next 16.3.4, or a corrupted install (`rm -rf node_modules && npm ci` as a first diagnostic step) | `npm run build` exits 0 and emits a working production server | **Yes — blocks everything else in Wave 5, do first** |
| W5-00b | Add `npm run build` to CI | `.github/workflows/ci.yml` | W5-00 | Add a build step to `static-checks` (or a new job) so this class of regression is never invisible again | CI fails on a deliberately-reintroduced build break in a test branch | Yes |
| W5-01 | Wire `npm run test:db` into CI | `.github/workflows/ci.yml` | — | Add a step provisioning throwaway Postgres (or using the existing Supabase CLI `supabase start` already in the E2E job) and running `scripts/verify-db.sh` | CI fails on a deliberately-broken migration/RPC in a test branch | **Yes** |
| W5-02 | Full regression pass | all | Waves 2-4 complete | Re-run `typecheck`/`lint`/`test`/`test:db`/`test:e2e`/`build` | All green | Yes |
| W5-03 | Production environment verification | hosting config | User: production secrets set | Confirm `CRON_SECRET`, `TELEGRAM_WEBHOOK_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, Upstox/SMC keys all present server-side only in production | Manual checklist against `.env.example` | Yes |
| W5-04 | Route verification | all `src/app` routes | — | Re-confirm no dead links post-Wave-2-4 changes | Nav sweep repeated | Yes |
| W5-05 | Market-data verification | Upstox + SMC providers | W2-01–W2-05 | Confirm live quotes flow through cache correctly in production-like environment | Manual spot-check against a real market session | Yes |
| W5-06 | Paper-trading safety re-verification | trading engine | — | Re-run `supabase/tests/10_order_lifecycle.sql`/`11_account_erasure.sql` post any Wave 2-4 schema touches | All pgTAP assertions pass | Yes |
| W5-07 | Signal pipeline verification | Signal OS + n8n | W3 complete | End-to-end test: real Telegram message → n8n → Supabase → dashboard, in staging then production | Signal appears correctly categorized, deduped, on dashboard | Yes |
| W5-08 | Final client-perspective audit | — | all above | Repeat §3 of this report against the Wave-2-4 state | Documented pass/fail per item | Yes |
| W5-09 | Beta checklist sign-off | `docs/WAVE-1-AUDIT.md` (this doc, updated) | all above | Compile final go/no-go list | User sign-off | Yes |

---

## 20. Beta-Critical Path

**Fix `npm run build` (W5-00) — first, before anything else, independent of wave numbering** → Upstox provider (W2-01/02) → verified market data + option chain + charts → signal category fix (W3-01) + n8n activation with either WhatsApp resolved or descoped (W3-03–06/08) → open-redirect fix (W4-01) → CI DB gate + CI build gate (W5-00b/W5-01) → full regression (W5-02) → production env verification (W5-03) → final client-perspective re-audit (W5-08) → Beta launch.

Everything else (education polish, Android release signing, payment gateway, expanded health page, AI-verdict pipeline) is real but **not** on the critical path — it can ship after Beta or run in parallel without blocking it.

---

## 21. Risks

- **Upstox API behavior is unknown until credentials exist** — the provider can be built to spec now, but its real-world response shapes/rate limits/error semantics can only be confirmed once the user has an Upstox developer account. Budget a verification pass after credentials arrive, not just a code-complete milestone.
- **WhatsApp source-group relay has no known solution yet** — this could slip Wave 3 significantly if not descoped; recommend explicitly deciding whether WhatsApp *ingestion* (not just distribution) is truly Beta-critical, since Telegram + manual admin composition already cover the live signal path.
- **SMC field-mappings are best-guesses** — if SMC becomes more important than currently planned (e.g., as an Upstox fallback), the unverified mapping risk transfers with it.
- **No payment gateway** means Beta cannot scale past however many users an admin is willing to manually grant access to — fine for a small closed Beta, a real constraint for a larger one.
- **CI currently cannot catch a trading-engine regression** until W5-01 lands — recommend prioritizing this earlier than Wave 5 if Wave 2/3 work touches any trading-adjacent migration or RPC.

---

## 22. Recommended Execution Order

0. **W5-00** (fix `npm run build`) — do this literally first, before any other task in this document. Nothing about "Beta readiness" is meaningful while the app cannot be built for production, and it may reveal or interact with other issues (e.g. `src/proxy.ts`) touched by later waves.
1. **W4-01** (open-redirect fix), **W5-00b** (CI build gate), and **W5-01** (CI DB gate) — all small, independent, high-leverage; do these immediately after W5-00, before any further merges land.
2. **W2-01/W2-02** (Upstox provider + admin wiring) — the single largest blocker to the stated Beta direction; start as soon as Upstox credentials are available, code structure can begin immediately using the SMC provider as a template.
3. **W3-01** (signal category fix) — trivial, high client-visible impact, do early.
4. **W3-03–W3-05** (n8n stand-up + credential binding + staged test run) — can proceed in parallel with Upstox work once n8n hosting is decided.
5. **W3-06** (WhatsApp decision) — resolve early since it gates whether W3-08 (go-live) is achievable on the original timeline.
6. **W2-05** (SMC live-account verification) — opportunistic, whenever SMC credentials become available; explicitly non-blocking per the user's stated direction.
7. **Wave 4 remainder** (Android signing, payment gateway, health page, AI-verdict decision) — schedule based on actual Beta scope decisions, none block a closed/admin-managed Beta launch.
8. **Wave 5** — full regression + production verification + final client-perspective re-audit, immediately before launch.

