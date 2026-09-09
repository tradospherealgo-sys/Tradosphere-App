import { defineConfig, devices } from "@playwright/test";

/**
 * E2E smoke/flow suite. Split into two tiers:
 *  - e2e/public/**  — no auth required, safe to run against any environment
 *    (including CI with zero Supabase config; pages must degrade to their
 *    "not signed in" / "not configured" states rather than crash).
 *  - e2e/authenticated/** — requires real Supabase test-user credentials
 *    via E2E_TEST_EMAIL / E2E_TEST_PASSWORD env vars. Tests in this tier
 *    skip themselves (not fail) when those vars are absent, so the suite
 *    stays runnable without live credentials while still exercising the
 *    full login → paper-order → portfolio flow whenever they're supplied.
 *
 * Never point E2E_TEST_EMAIL/PASSWORD at a production admin account —
 * use a disposable Supabase auth user seeded for this purpose only.
 */
export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: true,
  // Every authenticated spec signs in as the same seeded user, and Supabase's
  // signOut() revokes that user's sessions globally — so a sign-out test
  // running beside the lifecycle test logs it out mid-order. Seeded runs
  // therefore take one worker; unseeded runs are stateless and fan out.
  workers: process.env.E2E_SEED === "1" ? 1 : undefined,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"] },
      // The lifecycle spec asserts on exact balances in a single shared
      // paper account. Running it concurrently in a second project would
      // have the two runs spending each other's cash.
      testIgnore: /order-lifecycle\.spec\.ts/,
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npm run dev",
        url: "http://localhost:3000",
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
