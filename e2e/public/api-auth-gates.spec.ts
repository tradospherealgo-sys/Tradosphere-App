import { test, expect } from "@playwright/test";

/**
 * API routes that don't need a signed-in browser session to test: they gate
 * on either a Supabase session (requireUser) or a shared secret
 * (Authorization: Bearer <SECRET>). These assert the reject path only — no
 * credentials are exercised, so this suite stays runnable with zero secrets
 * configured, same constraint as e2e/public/routing-and-auth-gates.spec.ts.
 */

test.describe("market data API", () => {
  test("/api/market/quote rejects an unauthenticated request", async ({ request }) => {
    const res = await request.get("/api/market/quote?symbols=NIFTY");
    expect(res.status()).toBe(401);
  });

  test("/api/market/candles rejects an unauthenticated request", async ({ request }) => {
    const res = await request.get("/api/market/candles?symbol=NIFTY");
    expect(res.status()).toBe(401);
  });

  test("/api/market/option-chain rejects an unauthenticated request", async ({ request }) => {
    const res = await request.get("/api/market/option-chain?underlying=NIFTY");
    expect(res.status()).toBe(401);
  });

  test("/api/market/status is publicly readable", async ({ request }) => {
    const res = await request.get("/api/market/status");
    expect(res.status()).toBe(200);
  });
});

test.describe("shared-secret API routes", () => {
  test("/api/cron/expire-subscriptions rejects a request with no secret", async ({ request }) => {
    const res = await request.get("/api/cron/expire-subscriptions");
    // 503 if CRON_SECRET isn't set in this environment, 401 if it is but no
    // header was presented — either way, the sweep must not run un-authed.
    expect([401, 503]).toContain(res.status());
  });

  test("/api/cron/expire-subscriptions rejects an obviously wrong secret", async ({
    request,
  }) => {
    const res = await request.get("/api/cron/expire-subscriptions", {
      headers: { Authorization: "Bearer not-the-real-secret" },
    });
    expect([401, 503]).toContain(res.status());
  });

  test("/api/telegram/webhook rejects a request with no secret token", async ({ request }) => {
    const res = await request.post("/api/telegram/webhook", {
      data: { update_id: 1 },
    });
    expect([401, 503]).toContain(res.status());
  });
});
