# Mission 7A — Upstox Diagnostic

**Scope:** Read-only diagnosis of why production (`https://tradosphere-app.vercel.app`) shows no quotes/charts, despite a real `UPSTOX_ACCESS_TOKEN` being configured locally. No code was modified. No credential was rotated, printed, logged, or included below — every check that touched the token used it only in-memory, server-side, exactly as the existing code already does, and nothing token-shaped appears anywhere in this report.

## Checklist findings

| # | Check | Finding |
|---|---|---|
| 1 | `src/lib/market-data/providers/upstox.ts` | Implements `UpstoxProvider`: reads token from `process.env[secret_env_var \|\| "UPSTOX_ACCESS_TOKEN"]`, resolves NIFTY-style symbols to Upstox `instrument_key`s via the `instruments` table, calls the v3 quote/candle endpoints, never fabricates a price. Structurally correct. |
| 2 | `src/lib/options/providers/upstox.ts` | Implements `UpstoxOptionChainProvider`: same token/env-var handling, calls v2 option contract/chain endpoints, maps real Greeks from Upstox's own response. Structurally correct. Intentionally duplicated rather than shared with (1) — a design choice, not a bug. |
| 3 | `/api/market/*` routes | `quote/route.ts` and `candles/route.ts` both: require an authenticated user (`requireUser()`), rate-limit per user, then call `getActiveMarketDataProvider()` → `provider.getQuotes()`/`getHistoricalCandles()`. `option-chain/route.ts` follows the same pattern (confirmed 401 unauthenticated in Mission 6). `status/route.ts` is public and provider-agnostic (session-phase only, no quote data). All routes wired correctly to the provider abstraction. |
| 4 | `integration_configs` usage | `src/lib/market-data/index.ts::resolveProvider()` reads the `market_data_provider` row; if missing/disabled it silently falls back to `NoneProvider` (by design — never throws, never fabricates). **Live read of the actual row** (see below) confirms it is present, `provider: "upstox"`, `is_enabled: true`. `src/lib/options/index.ts` mirrors this for `option_chain_provider`, also confirmed `upstox` / `is_enabled: true`. |
| 5 | Current provider enable/disable state | **Enabled.** Both `market_data_provider` and `option_chain_provider` rows have `is_enabled: true`, `provider: "upstox"`, `secret_env_var: "UPSTOX_ACCESS_TOKEN"`. This is not the default — the seed file (`supabase/seed.sql`) ships both as `provider: 'none', is_enabled: false`, so an admin has already explicitly switched this on in this database. |
| 6 | Exact env var name expected | `UPSTOX_ACCESS_TOKEN` — this is both the code's hardcoded fallback and the exact `secret_env_var` value stored in both `integration_configs` rows, so there is no name mismatch between DB config and code. |
| 7 | Is `UPSTOX_ACCESS_TOKEN` read server-side only | Yes. Both provider files start with `import "server-only"`, and the token is read via `process.env[...]` inside a class that is only ever instantiated from `src/lib/market-data/index.ts` / `src/lib/options/index.ts`, both also `server-only`. It is never sent to the client — API routes return only the normalized `Quote`/`OptionChainSnapshot` shape, never the provider's raw response or the token. Confirmed present in `.env.local` (checked for the *presence of the variable name only* — its value was never read into this report). |
| 8 | Can production routes reach Upstox | Code-level: yes, nothing blocks outbound `fetch()` to `api.upstox.com` from a Vercel serverless function. Whether the *deployed* function actually has a working token is exactly the open question in item 19 below — this could not be directly confirmed for the Vercel **production** environment specifically (no Vercel CLI/dashboard access from this environment). |
| 9 | Instrument-key construction for NIFTY | `resolveInstrumentKey("NIFTY 50")` looks up `instruments.provider_token` for that symbol. **Live read of the `instruments` table** confirms the "NIFTY 50" row has `provider_token: "NSE_INDEX|Nifty 50"` (also confirmed for NIFTY BANK, NIFTY FIN SERVICE, NIFTY MIDCAP 100 — all correctly mapped, all `is_active: true`). This is the exact key format Upstox's own instrument master publishes. No `config.instrumentKeys` override is set on either integration row (`config: {}`), and none is needed since the registry mapping is already correct. |
| 10 | Quote endpoint | `GET https://api.upstox.com/v3/market-quote/ohlc?instrument_key=<key>&interval=1d`, header `Authorization: Bearer <token>`. |
| 11 | Candles/chart endpoint | `GET https://api.upstox.com/v3/historical-candle/<key>/<unit>/<interval>/<to>/<from>`, same auth header. |
| 12 | Option-chain endpoint | `GET https://api.upstox.com/v2/option/chain?instrument_key=<key>&expiry_date=<date>` (expiries first read from `GET /v2/option/contract?instrument_key=<key>`). |
| 13 | Authentication headers | `Authorization: Bearer <token>`, `Content-Type: application/json`, `Accept: application/json` — identical across both provider files. |
| 14 | Response parsing | `mapOhlcEntry`/`mapCandleRow`/`mapLeg` all defensively type-check every field and return `null`/omit the row rather than guess at a malformed shape; a quote with `last_price <= 0` is explicitly rejected as "not a quote." No parsing bug found. |
| 15 | Error handling | Every provider method wraps its `fetch` in try/catch and returns `null`/`[]` on any thrown error or non-`ok` HTTP status — a failure degrades to "no data," never to a crash or a fabricated value. `testConnection()` additionally distinguishes 401/403 (bad/expired token) from other HTTP failures. |
| 16 | Rate limiting | `CachedMarketDataProvider` (the decorator wrapping every provider) de-dupes concurrent identical requests, applies a TTL cache (seconds while market is open, longer while closed), and does exactly one bounded retry on a thrown error — this protects Upstox's own rate limits. Additionally, `/api/market/quote` itself rate-limits per authenticated user (30 req) via `checkRateLimit`. No rate-limiting defect found. |
| 17 | Is the current token expired | **Not directly tested against the live Upstox API by this agent**, to avoid any risk of the flagged-compromised token surfacing in a request/response log. Indirect evidence: the `last_test_result` stored on the `market_data_provider` row (see below) shows a **successful** live authentication with a real NIFTY 50 LTP value, timestamped a few hours before this audit. Upstox tokens expire at 3:30 AM IST the *following* day with no refresh — so if that stored result reflects the same token still in place, it has not reached its expiry window yet. This cannot fully rule out that the token has since been rotated/revoked as a direct consequence of the exposure event described in this mission's brief. |
| 18 | Static-IP restrictions | The code already deliberately avoids `/v2/user/profile` (documented in both files as being static-IP-restricted on some Upstox accounts even with a valid token) and instead tests connectivity via `/market-quote/ltp`, which the same in-repo comment records as working with no IP restriction on the account previously tested. No evidence this is the current blocker for the quote/candle/option-chain endpoints actually used in production, which are the same unrestricted family. |
| 19 | Does Vercel production have the required variable | **Could not be verified from this environment** — no Vercel CLI is installed and no Vercel API/dashboard credential was available to this agent (`which vercel` → not found). This is the single largest gap in this diagnosis and the most likely explanation for the mismatch described below. |
| 20 | Does a DB integration row override the environment config | The DB row does not *override* the env var — it only stores which env var name to read (`secret_env_var: "UPSTOX_ACCESS_TOKEN"`) and whether the provider is enabled. It does not store the token itself (by design — see the schema comment in `0001_schema.sql`: "Secret values ... are NEVER stored here in plaintext"). So there is no DB-level override fighting the environment; the DB and the environment variable are two halves of one configuration, and only the DB half could be confirmed here. |

### Live configuration read (read-only, no secrets exposed)

Using the existing service-role client pattern this codebase already uses server-side (no new access was granted, no token printed), the following **non-secret** rows were read directly:

- `integration_configs.market_data_provider` → `provider: "upstox"`, `is_enabled: true`, `secret_env_var: "UPSTOX_ACCESS_TOKEN"`, `config: {}`, and a stored `last_test_result` of **`ok: true`**, with a message recording a live NIFTY 50 LTP value, timestamped a few hours before this audit.
- `integration_configs.option_chain_provider` → same `provider`/`is_enabled`/`secret_env_var`, `last_test_result` **`ok: true`**, recording live option legs mapped for the current NIFTY 50 expiry.
- `instruments` (index rows) → NIFTY 50 / NIFTY BANK / NIFTY FIN SERVICE / NIFTY MIDCAP 100 all have correct, Upstox-format `provider_token` values and `is_active: true`.

**This means the database side of the configuration is fully correct and was, a few hours ago, proven to work end-to-end against the real Upstox API with a real result.** That test could only have run from *some* running instance of this app (local dev or the deployed app) holding a valid `UPSTOX_ACCESS_TOKEN` at that moment — it does not by itself prove that the **currently deployed Vercel production** instance holds that same valid value right now.

## Answers

**A. Is the current code correctly wired?**
Yes. Every layer — provider classes, the `integration_configs`-driven provider factory, the API routes, response parsing, error handling, and the caching/rate-limit decorator — is implemented correctly and consistently with the DB-recorded live test result. No code defect was found.

**B. Is the Upstox provider enabled?**
Yes, for both market-data and option-chain, confirmed by a direct read of `integration_configs` (`provider: "upstox"`, `is_enabled: true` on both rows).

**C. What exact API endpoint is being called for quote?**
`GET https://api.upstox.com/v3/market-quote/ohlc?instrument_key=<key>&interval=1d`

**D. What exact API endpoint is being called for chart/candles?**
`GET https://api.upstox.com/v3/historical-candle/<instrument_key>/<unit>/<interval>/<to-date>/<from-date>`

**E. What exact instrument key is being sent for NIFTY?**
`NSE_INDEX|Nifty 50` — confirmed as the live value stored in `instruments.provider_token` for the "NIFTY 50" row, and the same constant the code's own connectivity check uses.

**F. Is the failure caused by credentials, expiry, static IP, integration config, instrument key, API response parsing, or something else?**
Not integration config, not instrument key, not response parsing, not rate limiting, and not the static-IP restriction (the code already routes around that). The DB proves the *configuration* is correct and was recently proven live-working. The one thing this agent cannot verify from here is **whether the Vercel production deployment's environment actually has `UPSTOX_ACCESS_TOKEN` set to a currently-valid value** — this is the most likely remaining cause, especially since the token is now known to have been exposed and must be treated as compromised (it may since have been rotated, revoked by the user, or revoked by Upstox, independent of whatever value production currently holds). This is "something else": an **environment-variable / deployment-configuration gap between what was tested and what production is actually running**, not a code or database defect.

**G. What is the ONE next manual action the user must take?**
Open the Vercel dashboard → the Tradosphere project → **Settings → Environment Variables**, and confirm `UPSTOX_ACCESS_TOKEN` is present, correctly scoped to the **Production** environment (not only Preview/Development), and holds a **freshly minted, non-compromised** Upstox access token (mint a new one via the Upstox OAuth login flow, since the existing one must be treated as leaked regardless of what the DB's last test recorded) — then redeploy so production picks up the new value. This single check is the one Mission 6/7 cannot perform from inside this repository.

## Constraints honored

- No code was modified.
- No credential was rotated or generated.
- The existing (now-compromised) token was never printed, logged, or included in this report or in any tool output visible in this session.
- No Telegram/WhatsApp/n8n work was performed.
- Only read-only checks were used: source review, and read-only queries against non-secret configuration tables (`integration_configs`, `instruments`) using the app's own existing server-side access pattern — no new credential was created or exposed to do this.

## Mission 7A status

**DIAGNOSIS COMPLETE.** Not proceeding beyond diagnosis, per instructions.
