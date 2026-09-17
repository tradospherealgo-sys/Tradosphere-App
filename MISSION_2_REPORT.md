# Mission 2 Report — Code-Side Fixes from Mission 1 Audit

Scope: implement only genuine application-code fixes identified in `AUDIT_REPORT.md`. No external service configuration was touched (Google Cloud, Supabase dashboard, Vercel project settings, Upstox, Telegram, WhatsApp, n8n) — those remain manual/external tasks, listed at the end of this report.

## Changes Made

12 files modified, 6 files added. Full diff stat:

```
src/app/api/cron/expire-subscriptions/route.ts | 11 ++++++-
src/app/api/market/candles/route.ts            |  6 +++-
src/app/api/market/option-chain/route.ts       |  6 +++-
src/app/api/market/quote/route.ts              |  6 +++-
src/app/auth/callback/route.ts                 | 24 ++++++++++-----
src/components/pwa/sw-register.tsx             |  6 ++--
src/lib/admin/audit.ts                         | 14 ++++++---
src/lib/api/guard.ts                           | 41 ++++++++++++++++++++++++++
supabase/tests/00_shim.sql                     |  1 +
supabase/tests/10_order_lifecycle.sql          |  9 ++++--
supabase/tests/11_account_erasure.sql          |  4 ++-
supabase/tests/12_subscriptions_billing.sql    |  8 +++--
12 files changed, 113 insertions(+), 23 deletions(-)

new: e2e/public/api-auth-gates.spec.ts
new: src/lib/api/guard.test.ts
new: src/lib/auth/is-brand-new-account.ts
new: src/lib/auth/is-brand-new-account.test.ts
new: vercel.json
```

No unrelated files touched, no secrets added or committed, `.env.local` untouched. `git diff --check` is clean (no whitespace errors).

## Security Fixes (Priority 1)

- **Rate limiting on Upstox-backed routes** (`src/lib/api/guard.ts`, applied in `/api/market/quote`, `/api/market/candles`, `/api/market/option-chain`): added a dependency-free, in-memory, per-key sliding-window limiter (30 req/10s) as a courtesy backstop against a single authenticated user exhausting the shared Upstox quota. This is strictly additive — it never widens what an authenticated user could already do, and doesn't touch auth/RLS/entitlement logic. Documented as per-instance, not a distributed limit (no Redis/Upstash dependency introduced).
- **Silent audit-log failures** (`src/lib/admin/audit.ts`): `writeAuditLog()` previously swallowed every failure via an empty `catch {}`. Now logs both RPC-level errors and thrown exceptions via `console.error`, while still never throwing back into the caller (an audit-log failure must not block the admin action it's logging).
- **Silent service-worker registration failures** (`src/components/pwa/sw-register.tsx`): empty `.catch(() => {})` now logs via `console.warn`.
- **Confirmed, not changed**: RLS policies, service-role usage, admin authorization (`requireAdmin()`), entitlement enforcement, and paper-trading financial lockdown (revoked grants + `SECURITY DEFINER` RPCs + trusted-write triggers) were reviewed and found already correctly implemented. No RLS or authorization was weakened anywhere in this mission.

## Authentication Fixes (Priority 2 — Google OAuth)

- Extracted the inline `isBrandNewAccount()` heuristic (compares `created_at` vs `last_sign_in_at` within a 10s window) out of `src/app/auth/callback/route.ts` into `src/lib/auth/is-brand-new-account.ts`, and added 6 unit tests covering: no `last_sign_in_at`, missing property, within-10s, long-after (returning user), exact 10s boundary, and clock-skew (sign-in timestamp before created_at).
- **Fixed a real UX/logic bug**: OAuth failure/cancellation always redirected to `/login`, even when the attempt was launched from `/signup` (Google's `GoogleButton` sets an `invite` query param only on the signup flow). Failure redirect now targets `/signup` when `invite` is present, `/login` otherwise.
- Added recognition of Google's `access_denied` response (user cancelled consent) with a distinct, clearer message ("Google sign-in was cancelled.") instead of the generic failure message. Verified `src/app/login/page.tsx` already surfaces `?error=` from the query string, so no further UI change was needed.
- The invite-code redemption / brand-new-account-deletion logic for Google signups was reviewed and left unchanged — it was already correct (redeems the invite server-side, deletes the just-created Supabase user via the admin client if redemption fails, so no codeless account persists).
- **Not done, per explicit instruction**: no Google Cloud credentials created or modified, no claim made that Google production OAuth configuration is complete.

## Paper Trading Fixes (Priority 3)

No application-code defects found. Confirmed via a full spot-check pass: `placeOrder`/`closePosition` validate symbol/side/quantity client-side and the `place_paper_order` RPC re-validates everything server-side under a row lock, with buying power reserved atomically. All financial tables have INSERT/UPDATE/DELETE revoked from `authenticated`/`anon`; the only write path is `SECURITY DEFINER` RPCs that derive the account from `auth.uid()`, never a client-supplied ID. No code changes were necessary or made in this area — no real order execution exists anywhere in the codebase, and none was added.

## Upstox Fixes (Priority 4)

No application-code defects found in `src/lib/market-data/providers/upstox.ts`. Token failure, stale data, and missing data are already handled by returning `null` on any failure path rather than fabricating values, and `testConnection()` already distinguishes 401/403 with a clear message. No changes made. No Upstox credentials were created, modified, or inspected in any way that would expose them.

## Signal OS Fixes (Priority 5)

No application-code defects found. Confirmed: the Telegram webhook refuses to run without `TELEGRAM_WEBHOOK_SECRET` configured (503) and validates the presented token with a constant-time comparison (`secretsMatch`, `timingSafeEqual`-based). Duplicate protection exists at two layers (DB unique constraint on `(chat_id, message_id)`, plus a content-based fingerprint for same-day duplicate calls with a race-safe `23505` fallback). Unparseable messages are recorded, not silently dropped. All admin signal-review mutations independently call `requireAdmin()`. No changes made; the existing n8n workflow compatibility is untouched, and no external credentials were invented.

## Subscription Fixes (Priority 6)

No application-code defects found. `has_entitlement`/`current_entitlements` are `SECURITY DEFINER` functions checking `status in ('trialing','active') and current_period_end > now()`, with admins short-circuited — no client-side entitlement recomputation exists to bypass. All admin subscription mutations (`grantSubscription`, `cancelSubscription`, `suspendSubscription`, `unsuspendSubscription`, `upsertPlan`) call `requireAdmin()` and route through RPCs that re-check `is_admin()` server-side. State transitions are correctly guarded (e.g. `admin_unsuspend_subscription` refuses to reinstate a subscription whose period has already lapsed). No changes made. The payment gateway remains unintegrated by design — this mission does not pretend checkout is complete.

## Cron / Subscription Expiry Fixes (Priority 7)

- **Fixed a genuine blocking defect**: `src/app/api/cron/expire-subscriptions/route.ts` previously exported only `POST`. Vercel Cron exclusively issues **GET** requests and can never send POST — meaning the expiry sweep could never actually be triggered by a configured Vercel Cron job, regardless of any dashboard configuration. Refactored the handler body into a shared `handleExpireSweep()` function, now exported as both `GET` and `POST` (POST retained for manual/other-scheduler invocation with the same shared-secret header). All existing auth logic (`CRON_SECRET` presence → 503 if unset, bearer-token match via `secretsMatch` → 401 if wrong) and RPC logic (`warn_expiring_subscriptions` then `expire_lapsed_subscriptions`) preserved unchanged.
- **Added `vercel.json`** wiring `/api/cron/expire-subscriptions` to a daily `0 3 * * *` schedule. This requires no new secret: Vercel auto-injects `Authorization: Bearer <CRON_SECRET>` into cron-triggered requests whenever `CRON_SECRET` is already set as a project environment variable — the same variable the route already expected. If `CRON_SECRET` is not yet set on the Vercel project, this schedule will run and receive a 503 (safe default) rather than executing un-authed.
- **CODE status**: fixed and verified locally (GET now returns 401 with a wrong/missing secret, exactly like POST did before). **PRODUCTION SCHEDULER status**: the Vercel Cron schedule is now declared in `vercel.json`, but whether it actually fires depends on the Vercel project being on a plan that supports Cron Jobs and `CRON_SECRET` being set as a project environment variable — that verification is external/manual and was not performed here (no Vercel dashboard access was made).

## PWA Fixes (Priority 8)

Reviewed `public/sw.js` and confirmed it is already a safe no-op passthrough with no caching of financial/market data — left unchanged, since introducing caching here was explicitly disallowed and none was needed. Only change in this area was the service-worker registration failure logging described under Security Fixes above.

## Test Harness Fix (Priority 9)

Root cause was **test-harness-only (Category A)**, not a production/application defect:

1. `supabase/tests/00_shim.sql` mocks `auth.users` for the local Docker Postgres harness, but was missing the `raw_app_meta_data` column that real Supabase's `auth.users` table already has and that migration `0026_invite_codes.sql`'s trigger reads. Fixed by adding the column to the shim.
2. After that fix, the harness surfaced a second, expected failure: migration 0026 legitimately requires a valid invite code for password (`'email'`-provider) signups. The SQL test fixtures in `10_order_lifecycle.sql`, `11_account_erasure.sql`, and `12_subscriptions_billing.sql` created synthetic users via bare `insert into auth.users(email) values (...)`, which defaults to the `'email'` provider and is correctly rejected without an invite code by production logic. Fixed by tagging fixture inserts with `raw_app_meta_data: '{"provider":"test"}'` — the same non-`'email'`-provider mechanism real Google OAuth signups already use to legitimately skip the invite gate.

No production database behavior was changed to make this pass — both fixes are confined to `supabase/tests/*.sql`, which only exist in the local test harness.

**Verified**: `npm run test:db` → `OK: all migrations applied and all sql tests passed`.

## Test Results

| Command | Result |
|---|---|
| `npm run typecheck` | ✅ Pass (no errors) |
| `npm run lint` | ✅ Pass (no errors) |
| `npm run test` (vitest) | ✅ 288/288 tests passed, 27/27 test files |
| `npm run test:db` | ✅ All migrations applied, all SQL assertions passed |
| `npm run build` | ✅ Succeeded, all routes compiled (35 routes) |
| Playwright `e2e/public` | ✅ 50/50 passed (18 original tests × 2 projects [chromium+mobile] + 7 new tests × 2 projects) |

New unit tests added this mission: `src/lib/api/guard.test.ts` (8 tests: `parseSymbols` trim/uppercase/dedup/cap/null-handling, `checkRateLimit` allow/reject/key-isolation/window-reset) and `src/lib/auth/is-brand-new-account.test.ts` (6 tests, see Authentication Fixes above) — both included in the 288 passing.

New E2E coverage added: `e2e/public/api-auth-gates.spec.ts` — asserts `/api/market/quote|candles|option-chain` reject unauthenticated requests (401), `/api/market/status` stays publicly readable (200), and `/api/cron/expire-subscriptions` / `/api/telegram/webhook` reject missing or wrong shared-secret credentials (401 or 503 depending on whether `CRON_SECRET`/`TELEGRAM_WEBHOOK_SECRET` are configured in the running environment). No credentials were invented; this only exercises reject paths.

An authenticated Supabase test user (`E2E_TEST_EMAIL`/`E2E_TEST_PASSWORD`) is still required for `e2e/authenticated/**` — those tests already self-skip (not fail) when the env vars are absent, per the existing convention. This remains an external/manual requirement, not something addressed by inventing credentials.

## Remaining External/Manual Tasks

These are explicitly out of scope for Mission 2 and were not touched:

- **Google Cloud OAuth configuration** — creating the OAuth client, authorized redirect URIs, consent screen. See the Mission 3 Readiness checklist below.
- **Supabase Google provider configuration** — enabling the Google provider in the Supabase Auth dashboard and entering the Google client ID/secret.
- **Vercel production environment variables** — confirming `CRON_SECRET`, `TELEGRAM_WEBHOOK_SECRET`, Upstox credentials, and all Supabase keys are set on the actual Vercel project (this mission only wrote `vercel.json`; it did not access any Vercel dashboard or CLI project state).
- **Upstox credentials/access token** — daily-expiring token acquisition/rotation is entirely manual/external; no credentials were created or modified.
- **Telegram bot credentials/channel configuration** — bot token, channel/group wiring, and `TELEGRAM_WEBHOOK_SECRET` provisioning.
- **WhatsApp/Meta configuration** — not present in this mission's scope at all; no code exists for it to touch.
- **n8n credential configuration/activation** — the n8n workflow file remains a separate, undeployed pipeline; not activated or modified.
- **Payment provider configuration** — no payment gateway is integrated; `startCheckout` reads plan price server-side but there is no live payment processor wired in. This is a known, intentional gap, not a bug.
- **Production Cron scheduler verification** — `vercel.json` now declares the schedule; confirming it actually executes requires checking the Vercel project's plan/dashboard, which was not accessed.

## Mission 3 Readiness — Google OAuth Manual Configuration Checklist

To make Google sign-in functional in production, the following must be done outside this codebase (none of it was done here):

1. **Google Cloud Console**
   - Create (or reuse) a Google Cloud project.
   - Configure the OAuth consent screen (app name, support email, scopes — typically just `email`/`profile`/`openid`).
   - Create an OAuth 2.0 Client ID of type "Web application".
   - Add the authorized redirect URI Supabase requires: `https://<your-supabase-project-ref>.supabase.co/auth/v1/callback`.
   - Add your production app origin(s) to "Authorized JavaScript origins" if prompted.
   - Note the generated **Client ID** and **Client Secret**.

2. **Supabase Dashboard**
   - Authentication → Providers → Google → enable it.
   - Paste in the Client ID and Client Secret from step 1.
   - Confirm the Supabase project's site URL and any additional redirect URLs (e.g. your Vercel production domain and any preview domains you want OAuth to work on) are listed under Authentication → URL Configuration → Redirect URLs, matching what `src/app/auth/callback/route.ts` expects (`{origin}/auth/callback`).

3. **Vercel**
   - Ensure `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` on the Vercel project point at the same Supabase project configured in step 2.
   - No new env vars are needed specifically for Google OAuth beyond what Supabase already requires — the OAuth client secret lives in Supabase, not in this app.

4. **End-to-end manual verification** (cannot be automated without real Google test credentials)
   - Visit `/signup`, click "Continue with Google", confirm redirect to Google's consent screen.
   - Complete consent with a **brand-new** Google account not previously used with this app; confirm it prompts for/consumes the invite code correctly (or is rejected with "That invite code is invalid, expired, or already used." if no valid code) per `isBrandNewAccount()` + `redeem_invite_code`.
   - Sign out, sign back in with the same Google account; confirm it is treated as a returning user (no invite-code re-check) and lands on the intended `next` destination.
   - Cancel the Google consent screen deliberately; confirm redirect back to `/signup` (if launched from signup) or `/login` (if launched from login) with the "Google sign-in was cancelled." message.

No claim is made here that Google OAuth is production-ready — only that the application-side callback logic has been reviewed, hardened, and unit-tested to correctly handle every branch (success, brand-new + valid invite, brand-new + invalid invite, returning user, provider error, cancellation) once the above external configuration is completed.

---

MISSION 2 COMPLETE
