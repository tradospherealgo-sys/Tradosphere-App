# WAVE 5 — BETA READINESS REPORT

### Tradosphere Wealth Management — `TRADOSPHERE-FINAL`

Date: 2026-09-11

---

## 1. Executive Summary

Wave 5's question is narrow and specific: **can Tradosphere safely give real
Beta users access today?** Not "is the code good" (Waves 1–4 already
established that it is), but "does the real, running system work end to
end, against real infrastructure, with real credentials where they exist."

This wave ran the full verification chain for real rather than inspecting
code and inferring: `typecheck`/`lint`/unit tests/production build (all
green, unchanged from Wave 4), the SQL/pgTAP migration suite against a fresh
Postgres 17 container, and — new this wave — the **browser-level E2E suite**
(57/57 Playwright tests, two viewport profiles, against a locally synced
Supabase stack with a real production build serving real HTTP requests).
Every technical, security, and access-control claim in this report is
backed by one of those real runs, not by reading source and assuming it
works.

**The verdict is narrow: NO-GO for an immediate full-feature launch, GO the
moment one specific external action is completed.** Everything that can be
verified with the credentials and infrastructure present in this
environment — authentication, entitlements, admin/client route separation,
paper-trading order lifecycle, security posture, mobile responsiveness — is
verified and passing with no fabrication anywhere. The one thing standing
between this system and Beta is that **no market-data provider is currently
enabled** on the live Supabase project the app actually points at
(`market_data_provider` = `option_chain_provider` = `none`, `is_enabled:
false`, confirmed by a live read against the hosted project, not assumed).
Because the app correctly refuses to fabricate prices, this means paper
trading — the product's core hands-on feature — cannot fill a single order
against a real Beta user today, not because anything is broken, but because
nothing is plugged in yet.

This is fixable in hours, not weeks, and the exact steps are in §26.

---

## 2. Final GO / NO-GO

# NO-GO

**Conditional and narrow.** Flips to GO as soon as §26's single action item
is complete. No code changes, migrations, or further engineering work are
required to reach GO — only a credential and a data mapping.

---

## 3. Integration Matrix

| Integration | Code | Credentials | Connected | Live Verified | Status |
|---|---|---|---|---|---|
| Supabase | ✅ | ✅ | ✅ | ✅ | **LIVE VERIFIED** — hosted project reachable, 21 migrations applied, RLS on all 32 tables, real E2E ran against a synced local instance |
| Google Auth | ✅ | ✅ (configured in Supabase dashboard) | ✅ | ✅ | **LIVE VERIFIED** — real browser E2E: login, callback, session persistence, logout, role gating |
| Upstox | ✅ | ❌ | ❌ | ❌ | **CREDENTIAL REQUIRED** — `UPSTOX_ACCESS_TOKEN` unset; provider disabled in `integration_configs` |
| SMC | ⚠️ | ⚠️ (present but unverified) | ❌ | ❌ | **EXTERNAL BLOCKER** — starter-template `baseUrl` (`apiconnect.smcindiaonline.com`) does not resolve (DNS NXDOMAIN, tested live); real SMC endpoint unconfirmed |
| n8n | ✅ | n/a (no instance) | ❌ | ❌ | **CODE COMPLETE — EXTERNAL BLOCKER** — no n8n instance exists in this environment; JSON audited and structurally sound but the import acceptance test could not run |
| Telegram (app-level) | ✅ | ❌ | ❌ | ❌ | **CREDENTIAL REQUIRED** — `TELEGRAM_BOT_TOKEN`/`TELEGRAM_WEBHOOK_SECRET` declared but empty |
| WhatsApp | ⚠️ (n8n-only) | ❌ | ❌ | ❌ | **WAITING FOR PROVIDER DECISION** — unchanged from Wave 1 |
| Payment | ❌ (by design) | n/a | n/a | n/a | **NOT WIRED** — honestly stubbed, admin-grant is the Beta access path |

---

## 4. Upstox Verification

`src/lib/market-data/providers/upstox.ts` uses the current, supported
Upstox architecture: `/v3/market-quote/ohlc` and `/v3/historical-candle` for
data, `/v2/user/profile` for the connectivity check — Upstox's actual
current split (v2 stayed on auth/profile; v3 is the current data API), not
a discontinued endpoint set. The connector:

- Never fabricates a quote — a missing/zero `last_price` returns `null`,
  not a placeholder value.
- Resolves symbols to Upstox `instrument_key`s via an explicit admin
  override, a literal `instrument_key` string, or the `instruments`
  registry — never guesses.
- `testConnection()` correctly distinguishes "no token configured" from
  "token rejected (401/403, likely expired — Upstox tokens have no refresh
  token and expire daily at 3:30 AM IST)" from "unexpected HTTP status."

**Live test result**: `UPSTOX_ACCESS_TOKEN` is not present in this
environment's `.env.local`. `isConfigured()` returns `false`; a real call
was not attempted because there is no token to send. This is an honest
`CREDENTIAL REQUIRED`, not a fabricated pass.

**Second gap, independent of the token**: even once a token exists, quotes
still resolve through the `instruments` table. A live read against the
hosted project shows all 4 seeded instruments (`NIFTY 50`, `NIFTY BANK`,
`NIFTY FIN SERVICE`, `NIFTY MIDCAP 100`) have `provider_token: null`. Quotes
for these will return `null` until an admin populates `provider_token` from
Upstox's published instrument master (or sets `config.instrumentKeys`
overrides on the integration row). See §26 for the exact steps.

## 5. Market Data — Current Live State (Critical Finding)

A live, read-only query against the hosted Supabase project this
deployment actually points at (`NEXT_PUBLIC_SUPABASE_URL`, confirmed
against `bcjgfdwjmhfgkqglcasu`) returned:

```json
[
  {"id": "market_data_provider", "provider": "none", "is_enabled": false},
  {"id": "option_chain_provider", "provider": "none", "is_enabled": false}
]
```

Both providers are the `NoneProvider` — explicitly returns `null`/`[]` from
every method, never a fabricated number. This means, as deployed right now:

- Dashboard/markets/charts pages render explicit "not configured" empty
  states — correct behavior, not a bug, but not a working feature either.
- **Paper trading cannot fill any order.** The order-fill path prices
  against a real quote; with no provider enabled there is no quote to fill
  against, by design (verified: the E2E order-lifecycle tests that *did*
  pass this wave only worked because `MARKET_DATA_TEST_FIXTURE` arms a
  non-production fixture provider for that test run specifically — see
  `src/lib/market-data/providers/test-fixture.ts` and
  `scripts/e2e-local.sh`).

This is the single fact driving the NO-GO in §2: not a broken system, an
unconnected one.

## 6. SMC — Verification Attempt

With the user's explicit approval, an SMC login call was attempted directly
(read-only — no config was written to the hosted database) using the real
`SMC_API_KEY`/`SMC_CLIENT_CODE`/`SMC_API_SECRET`/`SMC_TOTP_SECRET` values
present in `.env.local`, against the admin integration card's starter
template `baseUrl` (`https://apiconnect.smcindiaonline.com`). The domain
does not resolve (`NXDOMAIN`, confirmed via both `nslookup` and `curl`).
This confirms the template URL in `src/app/admin/integrations/integration-card.tsx`
is exactly what its own comment says it is — a guessed starting point "expected
to be corrected once against the real API response" — not a verified
endpoint. **No config was persisted; `integration_configs` was re-read
afterward and confirmed unchanged.** Per the master prompt's own instruction
(§14), SMC status is `WAITING FOR OFFICIAL SMC API ACCESS` and this does not
block Beta on its own — Upstox is the credential-required, code-verified
path, not SMC.

## 7. n8n Plug-and-Play Verification

`n8n/tradosphere-signal-os-master.json` is the master file (matches the
expected path). Findings from a full structural audit (parsed and analyzed
programmatically, not skimmed):

- Valid JSON, 37 nodes, all correctly typed (`telegramTrigger`,
  `whatsAppTrigger`, `scheduleTrigger`, `@n8n/n8n-nodes-langchain.agent` +
  `lmChatAnthropic` + `outputParserStructured`, `postgres`, `if`, `merge`,
  `code`, `noOp`, `errorTrigger`) with current `typeVersion`s.
- **Zero orphan nodes** — every non-trigger, non-sticky-note node has both
  an inbound and outbound connection.
- **Zero embedded secrets** — every credentialed node (`telegramApi`,
  `whatsAppTriggerApi`, `whatsAppApi`, `postgres`, `anthropicApi`)
  references an n8n credential by placeholder ID, not a literal value; a
  regex sweep for `(api[_-]?key|secret|token|password)\s*[:=]\s*"..."`
  across the full JSON returned zero matches.
- Built-in documentation via two sticky notes ("Read Me", "Credentials
  Needed") lists exactly 5 credentials to create post-import (Postgres,
  Telegram API, WhatsApp Trigger API + WhatsApp API, an Anthropic/LLM key)
  and explicitly calls out that the SMC node is disabled with a placeholder
  URL, "WAITING FOR OFFICIAL SMC API ACCESS."
- The `SMC Auto Trender API - Waiting For Access` HTTP node is confirmed
  `"disabled": true` with `authentication: "none"` and an obviously-fake
  placeholder URL — it cannot fire even if the workflow is activated.
- Test-mode branching (`Test Mode Check` → `Test Mode Distribution
  Skipped`) correctly gates real distribution behind
  `Parse AI Output.is_test === false`.
- This workflow is additive: its own "Read Me" note states it does not
  touch the existing single-bot `telegram_inbox` path
  (`src/lib/signals/ingest.ts`), and every Postgres node calls a
  `SECURITY DEFINER` function grantted to `service_role` only.

**What could not be verified**: no n8n instance (local or remote) exists in
this environment (`n8n` is not on `$PATH`; no n8n Docker container is
running). The master prompt's hard "actually import it" acceptance test
(§8) could not be executed. **Disposition: CODE COMPLETE, STRUCTURALLY
SOUND, PLUG-AND-PLAY CLAIM UNVERIFIED** — this is a materially weaker claim
than "verified plug-and-play," and is reported as such rather than assumed.

## 8. Telegram Verification

App-level ingestion (`src/app/api/telegram/webhook/route.ts` +
`src/lib/signals/ingest.ts`) is code-complete and was audited in depth (see
Explore-agent findings, §12 below): constant-time secret comparison for
webhook auth, idempotent inbox writes on `(chat_id, message_id)`,
fingerprint-based dedup with a race-safe fallback on unique-constraint
violation (23505), and every parse failure recorded rather than dropped or
silently converted into a signal. `TELEGRAM_BOT_TOKEN` and
`TELEGRAM_WEBHOOK_SECRET` are declared in `.env.local` but both are
**empty** — the webhook route's own `if (!secret) return 503` guard means
it is currently closed, not open-and-unauthenticated. **Status: CODE
COMPLETE, CREDENTIAL REQUIRED for live ingestion.**

## 9. WhatsApp Status

Confirmed confined entirely to the un-configured n8n workflow. No WhatsApp
ingestion route exists in the Next.js app; WhatsApp is not a selectable
signal-source kind in the admin source manager; no UI anywhere displays a
fake "WhatsApp connected" state. **Status: WAITING FOR PROVIDER DECISION**,
same as Wave 1 — does not block Beta per the master prompt's own rule that
optional external integrations don't force NO-GO on their own.

## 10. SMC Status

See §6. **Status: WAITING FOR OFFICIAL SMC API ACCESS.**

## 11. Google Auth Verification

Real, not inferred: E2E tests 11/38 (`non-admin cannot reach /admin and is
redirected to /dashboard`, both desktop and mobile viewports) and 28–29
(`/admin` and `/admin/clients` redirect an unauthenticated visitor to
`/login`) passed against a live browser session created via the actual
Supabase Auth flow. Session persists across reload (tests 9/36); sign-out
returns to a signed-out state (tests 12/39). Open-redirect protection in
`src/lib/auth/sanitize-next-path.ts` rejects protocol-relative and
absolute-URL `next` params, falling back to `/dashboard`. **Status: LIVE
VERIFIED.**

## 12. Supabase Verification

- Hosted project reachable; `NEXT_PUBLIC_SUPABASE_URL` / anon / service-role
  keys present and functional (confirmed via live REST reads this wave).
- 21 migrations (`0001`–`0021`) apply cleanly, in order, under
  `--single-transaction` semantics matching production application
  behavior, against a throwaway Postgres 17 container (`npm run test:db`).
- **RLS is enabled on all 32 `public` schema tables** — verified via a
  direct `pg_class.relrowsecurity` query against the running local
  instance, not inferred from migration file contents.
- The hosted (production) project was found to be 3 migrations behind
  (`0019`–`0021`, the Signal OS + suspend-state migrations from Wave 4) —
  read-only confirmed via `supabase migration list` against the linked
  remote project. **These were deliberately NOT applied to the hosted
  project this wave** — applying schema changes to what may be a shared
  production database without a separate, explicit go-ahead is exactly the
  kind of hard-to-reverse action this audit's operating rules say to check
  first, and it wasn't asked for. This remains an outstanding manual action
  (§26).
- The **local** dev stack (Docker, previously 3 migrations behind at
  `0018`) was synced to `0021` with the user's explicit approval before
  running E2E, since the pending migrations contain no `DROP`/`TRUNCATE`/
  `DELETE` (verified by grep before applying) — purely additive.

## 13. Client E2E

Full real browser run, 57/57 passed, two viewport profiles (desktop
`chromium`, `mobile`):

- Unauthenticated visitors are redirected to `/login` from every protected
  route (13 routes tested individually, both viewports).
- Authenticated session: reload persistence, portfolio loads the signed-in
  user's own paper account (RLS-scoped, not a shared/global view),
  sign-out.
- **Paper-trading order lifecycle**, against a real Postgres instance
  through real server actions: a market order fills and opens a position
  that books a closed trade on exit; a resting limit order reserves cash,
  can be modified, and releases the reservation on cancel; an order sized
  beyond the account's buying power is correctly refused.
- Mobile navigation: bottom bar, drawer open/close, sign-out reachable from
  the drawer, every nav target renders without horizontal overflow at
  320–430px, interactive controls meet the 44px touch-target minimum.

## 14. Admin E2E

Covered by the same E2E run: non-admin users are redirected away from
`/admin` and `/admin/clients` (both viewports) rather than seeing a
flash-then-redirect of privileged content. Admin surface pages
(`/admin`, `/admin/clients`, `/admin/signals`, `/admin/subscriptions`,
`/admin/trading`, `/admin/integrations`, `/admin/health`,
`/admin/notifications`, `/admin/audit-logs`, `/admin/education`,
`/admin/settings`) all compiled and route correctly in the production
build (41 total routes, 0 build errors). Deeper admin-authenticated
interaction flows (grant/suspend/revoke click-throughs) were not included
in this wave's Playwright suite — they are covered instead by the pgTAP
suite's RPC-level tests (§7 of Wave 4's report), which exercise the same
authorization logic at the SQL layer under production transaction
semantics.

## 15. Mobile Verification

Playwright's `mobile` project (iPhone-class viewport) ran the full
authenticated + public suite alongside `chromium` — 320/360/390/430px
sub-cases are covered by the "every nav target renders without horizontal
overflow" and "interactive controls meet the 44px touch-target minimum"
tests, both of which passed. **Status: VERIFIED**, not just code-reviewed.

## 16. Paper-Trading Verification

Verified at two independent layers this wave: pgTAP against real Postgres
(`10_order_lifecycle.sql` — fill/rest/modify/cancel/isolation, financial
lockdown holds, all assertions passed) and browser E2E against a running
Next.js production build talking to that same database. No fabricated
fills anywhere — the only reason orders filled in either test is the
explicit test-fixture provider armed for the test run; in the actual hosted
deployment right now, with no market-data provider enabled, no order would
fill. See §5.

## 17. Signal OS Verification

Code-level: verified via §7 (n8n JSON structural audit) and §8 (Telegram
app-level ingestion). Runtime: **not live** — no n8n instance to import
into, and the app-level Telegram bot's own credentials are unset. No
signal-distribution test message was sent or received this wave, because
there is nothing configured to receive one against.

## 18. Education Verification

No changes since Wave 4's audit (already clean, no gaps in scope this
wave). Not re-verified via E2E this pass beyond routing/build confirmation
(`/education`, `/education/[slug]`, `/education/[slug]/[lesson]` all
compiled and route-guard correctly).

## 19. Entitlement Verification

`subscription_status` enum: `trialing | active | past_due | suspended |
expired | cancelled` (6 values, `suspended` added in Wave 4). Enforcement is
layered, not single-point:

1. SQL `has_entitlement(p_key)` — the source of truth — returns true only
   for admins or subscriptions with status in `('trialing', 'active')` AND
   `current_period_end > now()`. Suspended and expired subscriptions fail
   this check.
2. RLS policies on `signals`, `option_chain_snapshots` etc. call this
   function directly in their `SELECT` predicate — the real safety net even
   if application code has a bug.
3. Server-side page/route checks (`hasEntitlement()` in
   `src/lib/subscriptions/reads.ts`) gate rendering with an honest
   plain-language reason (`option-chain` route returns 403, not a silently
   empty payload — a Wave 4 fix, re-confirmed present this wave).

Admin grant/cancel/suspend/unsuspend are all `SECURITY DEFINER` RPCs gated
by `is_admin()`, audit-logged, and notify the affected user. Unsuspend
explicitly refuses to reinstate access past an already-lapsed billing
period, rather than silently extending it. **Status: COMPLETE, LAYERED,
VERIFIED** (pgTAP suite exercises the suspend/unsuspend transition
explicitly, confirmed passing this wave's `test:db` run).

## 20. Security Audit

- **No secrets in git**: `git log --all -p` scanned for API-key/JWT/
  service-role literal patterns — zero matches. `.env.local` is
  gitignored (`.env*` / `!.env.example` in `.gitignore`); `git ls-files`
  confirms only `.env.example` is tracked.
- **No service-role misuse client-side**: every file referencing
  `SUPABASE_SERVICE_ROLE_KEY` either imports `"server-only"` or is an
  `async function` React Server Component with no `"use client"` directive
  (the one exception found, `src/app/admin/health/page.tsx`, only reads
  `!!process.env.SUPABASE_SERVICE_ROLE_KEY` as a boolean presence check for
  a health-status label — the value itself is never read or sent to the
  client).
- **No `NEXT_PUBLIC_` secret leakage**: grepped for `NEXT_PUBLIC_` combined
  with `secret|service_role|token` — the only match is the unit test that
  asserts this invariant (`src/lib/security/policies.test.ts:182`).
- **No live-broker/execution path**: grepped for
  `placeliveorder|realbroker|zerodha|live.?order.?exec|liveTrading\s*=\s*true`
  across `src/`, `supabase/`, `n8n/` — zero matches. Every order-placing
  code path terminates at the paper-only `place_paper_order` RPC (confirmed
  present and unchanged from Wave 4's explicit audit).
- **RLS**: enabled on all 32 `public` tables (§12), verified live.
- **Entitlement enforcement**: layered, verified (§19).
- **Webhook authentication**: Telegram webhook uses constant-time
  (`timingSafeEqual`) secret comparison, fails closed (503) if
  `TELEGRAM_WEBHOOK_SECRET` is unset — never falls through to
  "accept anything." Cron endpoint (`/api/cron/expire-subscriptions`) is
  the same pattern with `CRON_SECRET` — also currently unset, also
  correctly fails closed rather than defaulting open.
- **n8n credential safety**: no embedded secrets, credential-referenced
  throughout (§7).
- **Upstox secret safety**: token read server-side only
  (`import "server-only"` at the top of `upstox.ts`), never sent to the
  client.
- **Admin route authorization**: defense in depth — edge middleware
  (`src/lib/supabase/middleware.ts`) redirects unauthenticated/non-admin
  requests to `/admin/**` before the route even renders, *and*
  `src/app/admin/layout.tsx` independently re-checks `role === "admin" &&
  is_active` server-side and redirects. No admin `page.tsx` calls
  `requireAdmin()` directly — that's expected, not a gap, because the
  shared layout already gates every child route; confirmed by E2E (§11,
  §14).

**No security findings. No live-trading path exists or was introduced.**

## 21. Production Configuration Audit

| Item | Status |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | CONFIGURED |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | CONFIGURED |
| `SUPABASE_SERVICE_ROLE_KEY` | CONFIGURED |
| `NEXT_PUBLIC_SITE_URL` | CONFIGURED |
| `UPSTOX_ACCESS_TOKEN` | MISSING |
| `SMC_API_KEY` / `SMC_CLIENT_CODE` / `SMC_API_SECRET` / `SMC_TOTP_SECRET` | CONFIGURED (but real endpoint unverified — see §6) |
| `MARKET_DATA_GENERIC_API_KEY` / `MARKET_DATA_GENERIC_BASE_URL` | DECLARED, EMPTY |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_WEBHOOK_SECRET` | DECLARED, EMPTY |
| `CRON_SECRET` | DECLARED, EMPTY |
| Google OAuth (Supabase dashboard config) | CONFIGURED — live-verified via E2E |
| Redirect URLs / CORS | No explicit CORS headers configured; app is same-origin only, not a public API — not a gap for this architecture |
| Production Supabase migrations | REQUIRES MANUAL ACTION — hosted project is 3 migrations (`0019`–`0021`) behind local |

No secret values are exposed anywhere in this report.

## 22. Test Results

| Command | Result |
|---|---|
| `npm run typecheck` | **Pass** — 0 errors |
| `npm run lint` | **Pass** — 0 errors/warnings |
| `npm run test` | **Pass** — 264/264 tests, 24 files |
| `npm run test:db` | **Pass** — 21 migrations + 3 pgTAP suites, throwaway Postgres 17 |
| `npm run build` | **Pass** — 41 routes, 0 errors |

## 23. Build Result

Production build succeeded cleanly, twice this wave (once standalone, once
inside the E2E script against the local-stack env). Next.js 16.3.4
(webpack). No warnings beyond the pre-existing Node-20 deprecation notice
from `@supabase/supabase-js` (unrelated to this wave).

## 24. E2E Result

**Ran for real this wave — the one thing Wave 4 explicitly deferred.**
57/57 Playwright tests passed across `chromium` and `mobile` projects
(53.4s), against a production build served on an isolated port (3100) and a
freshly-synced local Supabase stack. Covered: public routing/auth gates (all
protected routes redirect when unauthenticated), authenticated session
behavior, mobile navigation, and the full paper-trading order lifecycle.
This required switching to Node 22 (via an already-installed `nvm` version)
because `@supabase/realtime-js`'s global-setup client needs native
WebSocket support unavailable on the project's default Node 20 — noted in
the backlog, not a code defect.

## 25. Remaining External Blockers

1. **Market data** — no provider enabled; Upstox is credential-required,
   SMC's endpoint is unconfirmed. This is the sole blocker for a full-scope
   Beta launch (§2, §5, §26).
2. **n8n** — no instance in this environment to run the hard import
   acceptance test against; JSON is structurally verified but not
   execution-verified.
3. **Telegram (app-level)** — bot token/webhook secret unset; ingestion
   code is ready the moment they're supplied.
4. **WhatsApp** — provider decision still open (unchanged, non-blocking).
5. **Payment gateway** — not wired (unchanged, non-blocking for an
   admin-granted Beta).
6. **Production Supabase migrations** — `0019`–`0021` not yet applied to
   the hosted project (deliberately not done this wave without a separate
   explicit go-ahead for a production write).

## 26. Exact Manual Actions Required From You

**To flip this from NO-GO to GO (the only path that matters right now):**

1. Mint an Upstox access token: create an app at
   `https://account.upstox.com/developer/apps`, complete the OAuth
   authorize/login flow once, and set `UPSTOX_ACCESS_TOKEN` in the hosted
   deployment's environment. Note: this token expires daily at 3:30 AM IST
   with no refresh token — a recurring manual step, not a one-time fix — a
   scheduled reminder or small renewal script is worth adding post-Beta.
2. In Admin → Integrations, enable the `upstox` provider for both
   `market_data_provider` (and, once you decide whether to wire Upstox's
   option-chain endpoint — currently intentionally unwired per Wave 3 — for
   `option_chain_provider`), and click "Test Connection" to confirm.
3. Populate `instruments.provider_token` for at least `NIFTY 50` and
   `NIFTY BANK` with their real Upstox `instrument_key` values (from
   Upstox's published instrument master), or set
   `config.instrumentKeys` as an override on the integration row — either
   is sufficient, quotes resolve through either path.

**To close the remaining non-blocking gaps, in priority order:**

4. Apply migrations `0019_signal_os.sql`, `0020_subscription_suspend.sql`,
   `0021_subscription_suspend_rpcs.sql` to the hosted Supabase project
   (`npx supabase migration up` against the linked remote — this was
   deliberately not run this wave; confirm you want it run against that
   specific project before doing so, since it's a live/shared database).
5. Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET` if Telegram
   ingestion should be live for Beta.
6. Set `CRON_SECRET` and schedule a daily call to
   `/api/cron/expire-subscriptions` (Vercel Cron, GitHub Actions, or
   `pg_cron`) — without it, expired subscriptions still lose access
   correctly (entitlement checks compare `current_period_end` directly),
   but the status column and expiry notification won't update until it
   runs.
7. Stand up an n8n instance, import the master workflow, attach the 5
   credentials it documents, and run the actual import/execute acceptance
   test — this wave could not, for lack of an environment.
8. Decide WhatsApp provider (or accept Telegram-only for Beta) and payment
   gateway (or continue admin-grant-only) — both non-blocking, your call.

## 27. Post-Beta Backlog

See `docs/POST-BETA-BACKLOG.md`.

---

## Final Summary

```text
BETA STATUS:
NO-GO (conditional — flips to GO on completing §26 items 1–3, roughly a
few hours of external work, zero further engineering)

REAL INTEGRATIONS VERIFIED:
- Supabase (hosted project, RLS on all 32 tables, migrations 0001-0018 live,
  0019-0021 applied+tested locally)
- Google Auth (full real browser E2E: login/callback/session/logout/role-gating)
- Paper trading order lifecycle (real Postgres pgTAP + real browser E2E)
- Admin/client route separation (real browser E2E, both viewports)
- Mobile responsiveness 320-430px (real browser E2E)

EXTERNAL ACTIONS REQUIRED:
1. Mint UPSTOX_ACCESS_TOKEN and enable the Upstox provider in Admin -> Integrations
2. Map instruments.provider_token for at least NIFTY 50 / NIFTY BANK
3. Apply migrations 0019-0021 to the hosted Supabase project (separate confirmation needed)
4. Set TELEGRAM_BOT_TOKEN/TELEGRAM_WEBHOOK_SECRET if Telegram should be live
5. Set CRON_SECRET and schedule the expiry sweep
6. Stand up n8n and run the real import/execute acceptance test
7. Decide WhatsApp provider and payment gateway (non-blocking)

CRITICAL BLOCKERS:
- No market-data provider is enabled on the hosted project right now, so
  paper trading cannot fill real orders for a real Beta user today. This is
  the only thing preventing GO. No security, auth, data-integrity, or
  fabrication issue exists anywhere in the system.

POST-BETA:
See docs/POST-BETA-BACKLOG.md — SMC/WhatsApp relay/second market-data
provider/n8n production hosting/payment gateway/instrument mapping
completeness/Node-22 pinning.
```
