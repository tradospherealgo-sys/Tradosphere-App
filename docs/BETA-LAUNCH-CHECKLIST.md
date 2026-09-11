# BETA LAUNCH CHECKLIST

Status as verified in Wave 5 (2026-09-11). See `docs/BETA-READINESS-REPORT.md`
for full evidence and the GO/NO-GO rationale behind each line.

## Technical

- [x] Production build (`next build`, 41 routes, 0 errors)
- [x] Database — 21 migrations, RLS enabled on all 32 public tables, pgTAP
      suite green against a real Postgres 17 instance
- [x] Authentication — Google OAuth verified end-to-end (real browser E2E:
      login redirect, session persistence, logout, admin/client route gating)
- [ ] Market data — **NOT live**. Both `market_data_provider` and
      `option_chain_provider` are `none`/disabled on the hosted project.
      Upstox is code-complete but has no access token; SMC's credentials
      exist but its configured endpoint doesn't resolve. See report §5.
- [ ] Charts — code-complete, but render empty (no fabricated data) while
      market data is unconfigured
- [ ] Option chain — code-complete incl. entitlement gating, same blocker
- [ ] Signals — Telegram ingestion code-complete; `TELEGRAM_BOT_TOKEN` /
      `TELEGRAM_WEBHOOK_SECRET` are currently unset, so no channel is live
- [x] Paper trading — order lifecycle (fill/rest/modify/cancel/afford-check)
      verified via real Postgres pgTAP tests AND real browser E2E against a
      test-fixture price; blocked from firing on real prices only by the
      market-data gap above (by design — never fabricates a fill price)
- [x] Education — audited in Wave 4, no gaps
- [x] Admin — full E2E-verified: clients, signals, subscriptions, trading
      visibility, distribution log, integrations, health, non-admin lockout
- [x] Mobile — 320/360/390/430px verified via Playwright `mobile` project
      (touch targets, drawer nav, no horizontal overflow)
- [x] Security — see report §12; no critical findings
- [x] Backups/recovery — Supabase-managed Postgres; standard project backup
      policy applies (not modified this wave)

## Integrations

- [ ] **Upstox** — CODE COMPLETE, CREDENTIAL REQUIRED. Needs
      `UPSTOX_ACCESS_TOKEN` minted via the OAuth login flow (expires daily,
      manual renewal — Upstox platform constraint) **and** `instruments.provider_token`
      populated for at least the 4 seeded index instruments.
- [ ] **n8n** — workflow JSON audited and structurally sound (37 nodes, no
      orphans, no embedded secrets, correctly credential-referenced); the
      hard "actually import it" acceptance test could not run — no n8n
      instance exists in this environment.
- [ ] **Telegram** — app-level ingestion code-complete; bot token/webhook
      secret not currently set.
- [ ] **WhatsApp** — WAITING FOR PROVIDER DECISION (unchanged from Wave 1).
      Confined to the un-configured n8n workflow; no fake "connected" state
      anywhere in the app.
- [ ] **SMC** — WAITING FOR OFFICIAL API ACCESS; starter-template endpoint
      does not resolve.
- [x] **Google Auth** — CONNECTED, LIVE VERIFIED (real E2E login/logout/session)
- [ ] **Payment** — not wired (by design); admin-grant is the Beta access path.

## Business

- [ ] Beta access policy — entitlement/suspend/unsuspend model is
      code-complete and tested; the actual policy text (who gets Beta, for
      how long) is a business decision, not a code gap.
- [ ] Pricing decision — blocked on payment gateway choice, not urgent for
      an admin-granted Beta.
- [ ] Terms / privacy / disclaimer / risk disclosure — not audited as legal
      documents this wave (out of scope — this is an engineering audit, not
      a legal review).
- [ ] Market-data redistribution/licensing review — moot while no provider
      is enabled; revisit once Upstox or SMC goes live.
- [ ] Source-content redistribution permissions (Telegram/SMC signal
      content) — revisit once a real source is connected.

**Legend**: `[x]` verified working this wave. `[ ]` either an open external
action or explicitly optional for initial Beta — see the report for which.
