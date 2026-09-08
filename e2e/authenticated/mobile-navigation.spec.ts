import { test, expect, devices } from "@playwright/test";

/**
 * Regression cover for audit defect B-2: on a phone the app shell rendered
 * its only navigation as `hidden … md:flex`, so a signed-in user had no
 * links and no way to sign out.
 *
 * This pins the replacement — a bottom bar plus a drawer — at Android
 * phone width. Like the rest of e2e/authenticated it self-skips without
 * E2E_TEST_EMAIL / E2E_TEST_PASSWORD rather than failing, so the suite
 * still runs green with no live Supabase project.
 */

const EMAIL = process.env.E2E_TEST_EMAIL;
const PASSWORD = process.env.E2E_TEST_PASSWORD;

test.use({ ...devices["Pixel 7"] });

test.describe("mobile navigation", () => {
  test.skip(!EMAIL || !PASSWORD, "Set E2E_TEST_EMAIL/E2E_TEST_PASSWORD to run this suite.");

  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.locator('input[type="email"], input[name="email"]').fill(EMAIL!);
    await page.locator('input[type="password"]').fill(PASSWORD!);
    await page.getByRole("button", { name: /sign in|log in/i }).click();
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test("bottom bar is visible and its targets are reachable", async ({ page }) => {
    const bar = page.getByRole("navigation", { name: "Primary" });
    await expect(bar).toBeVisible();

    await page.getByRole("link", { name: "Portfolio" }).click();
    await expect(page).toHaveURL(/\/portfolio/);
  });

  test("drawer opens, navigates, and closes itself", async ({ page }) => {
    await page.getByRole("button", { name: "Open navigation" }).first().click();
    const link = page.getByRole("link", { name: "Paper Trading" });
    await expect(link).toBeVisible();

    await link.click();
    await expect(page).toHaveURL(/\/paper-trading/);
    // The drawer must not survive the navigation it triggered.
    await expect(link).toBeHidden();
  });

  test("sign out is reachable from the drawer", async ({ page }) => {
    await page.getByRole("button", { name: "Open navigation" }).first().click();
    await page.getByRole("button", { name: /sign out/i }).click();
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
  });

  test("every nav target renders without horizontal overflow", async ({ page }) => {
    const routes = [
      "/dashboard",
      "/signals",
      "/markets",
      "/charts",
      "/option-chain",
      "/paper-trading",
      "/portfolio",
      "/education",
      "/activity",
      "/notifications",
      "/subscription",
      "/settings",
    ];

    for (const route of routes) {
      await page.goto(route);
      // scrollWidth beating clientWidth is the page being draggable
      // sideways — the exact symptom the audit flagged. A wide table is
      // fine as long as *it* scrolls rather than the document.
      const overflows = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
      );
      expect(overflows, `${route} overflows horizontally`).toBe(false);
    }
  });

  test("interactive controls meet the 44px touch-target minimum", async ({ page }) => {
    await page.goto("/settings");
    const buttons = page.locator("button:visible, a[href]:visible");
    const count = await buttons.count();
    const undersized: string[] = [];

    for (let i = 0; i < count; i++) {
      const box = await buttons.nth(i).boundingBox();
      if (!box) continue;
      // Inline text links inside a paragraph are legitimately short; only
      // standalone controls are held to the target size.
      if (box.height < 44 && box.width > 60) {
        undersized.push(
          `${(await buttons.nth(i).innerText()).slice(0, 30)} (${Math.round(box.height)}px)`
        );
      }
    }

    expect(undersized, `Undersized touch targets: ${undersized.join(", ")}`).toHaveLength(0);
  });
});
