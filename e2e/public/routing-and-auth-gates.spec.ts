import { test, expect } from "@playwright/test";

/**
 * No-auth-required smoke tests: public pages render, and every protected
 * route redirects an unauthenticated visitor to /login. These must pass in
 * any environment (including one with zero Supabase config — see
 * (app)/layout.tsx and admin/layout.tsx, which both redirect via
 * getCurrentUser() regardless of whether Supabase env vars are set).
 */

test.describe("public pages", () => {
  // `/` is a router, not a page: it forwards to /dashboard when signed in
  // and /login when not. There is no marketing surface to render.
  test("root forwards an unauthenticated visitor to /login", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login/);
  });

  test("login page renders with email + password fields", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator('input[type="email"], input[name="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
  });

  test("signup page renders with email + password + confirm fields", async ({ page }) => {
    await page.goto("/signup");
    await expect(page.locator('input[type="email"], input[name="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toHaveCount(2);
  });
});

test.describe("unauthenticated redirects", () => {
  const protectedAppRoutes = [
    "/dashboard",
    "/portfolio",
    "/option-chain",
    "/charts",
    "/signals",
    "/activity",
    "/subscription",
    "/markets",
    "/paper-trading",
    "/notifications",
    "/settings",
    "/education",
  ];

  for (const route of protectedAppRoutes) {
    test(`${route} redirects an unauthenticated visitor to /login`, async ({ page }) => {
      await page.goto(route);
      await expect(page).toHaveURL(/\/login/);
    });
  }

  test("/admin redirects an unauthenticated visitor to /login", async ({ page }) => {
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/login/);
  });

  test("/admin/clients redirects an unauthenticated visitor to /login", async ({ page }) => {
    await page.goto("/admin/clients");
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe("mobile viewport", () => {
  test("login page is usable on a phone-width viewport", async ({ page }) => {
    await page.goto("/login");
    const form = page.locator("form").first();
    await expect(form).toBeVisible();
    const box = await form.boundingBox();
    expect(box).not.toBeNull();
    // Form shouldn't overflow the mobile viewport horizontally.
    expect(box!.width).toBeLessThanOrEqual(430);
  });
});
