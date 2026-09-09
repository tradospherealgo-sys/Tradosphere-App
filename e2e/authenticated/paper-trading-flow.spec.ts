import { test, expect } from "@playwright/test";

/**
 * Full-flow E2E tests against a REAL Supabase project + a disposable test
 * user. These self-skip (not fail) unless E2E_TEST_EMAIL/E2E_TEST_PASSWORD
 * are set, so `npm run test:e2e` stays green with zero live credentials —
 * but running it with real ones exercises the actual login → paper-order →
 * portfolio lifecycle end to end, per the "actually verify the flows"
 * requirement from the production audit.
 *
 * Setup required to run this file for real:
 *   1. In Supabase Auth, create a disposable user (never a real/admin
 *      account) — e.g. e2e-test@yourdomain.test.
 *   2. Set E2E_TEST_EMAIL / E2E_TEST_PASSWORD in your shell before running:
 *        E2E_TEST_EMAIL=... E2E_TEST_PASSWORD=... npm run test:e2e
 *   3. That user gets a paper_accounts row automatically via the
 *      handle_new_user() trigger — no manual seeding needed.
 */

const EMAIL = process.env.E2E_TEST_EMAIL;
const PASSWORD = process.env.E2E_TEST_PASSWORD;

test.describe("authenticated paper-trading flow", () => {
  test.skip(!EMAIL || !PASSWORD, "Set E2E_TEST_EMAIL/E2E_TEST_PASSWORD to run this suite.");

  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.locator('input[type="email"], input[name="email"]').fill(EMAIL!);
    await page.locator('input[type="password"]').fill(PASSWORD!);
    await page.getByRole("button", { name: /sign in|log in/i }).click();
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test("session persists across a reload", async ({ page }) => {
    await page.reload();
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test("portfolio page loads the signed-in user's own paper account", async ({ page }) => {
    await page.goto("/portfolio");
    // The page heading, not merely some text matching /portfolio/: the first
    // such match is the desktop sidebar link, hidden at phone widths.
    await expect(page.getByRole("heading", { name: "Portfolio" })).toBeVisible();
  });

  test("non-admin cannot reach /admin and is redirected to /dashboard", async ({ page }) => {
    await page.goto("/admin");
    // The seeded E2E user is a plain client, so the only acceptable outcome
    // is being bounced to /dashboard. The previous form of this assertion
    // accepted /admin as well, which meant it passed whether or not the
    // authorization check ran at all.
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test("sign out returns to a signed-out state", async ({ page }) => {
    // On phone widths the sidebar is replaced by a drawer, so sign-out has
    // to be revealed first. Desktop shows it inline.
    const drawerToggle = page.getByRole("button", { name: "Open navigation" }).first();
    if (await drawerToggle.isVisible()) await drawerToggle.click();

    await page.getByRole("button", { name: /sign out/i }).click();
    // Sign-out is a server action that redirects. Navigating before it lands
    // races it, and the still-valid cookie then looks like a sign-out bug.
    await expect(page).toHaveURL(/\/login/);

    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
  });
});
