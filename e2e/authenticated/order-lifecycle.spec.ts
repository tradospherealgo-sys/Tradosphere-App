import { test, expect, type Page } from "@playwright/test";
import { E2E_SYMBOL, E2E_FIXTURE_PRICE } from "../global-setup";

/**
 * The order lifecycle, end to end, through the real UI against a real
 * backend: place → fill → position → portfolio/P&L → close → trade recorded,
 * plus the resting-order path (rest → modify → cancel) which never touches a
 * fill at all.
 *
 * This is the test the production audit asked for. A login-and-navigate smoke
 * test proves the pages render; it cannot tell you that money moved
 * correctly, and money moving correctly is the only thing this feature is
 * for. So every assertion below is about a number the engine produced —
 * balances, charges, P&L — not about a heading being visible.
 *
 * Requires the seeded environment (E2E_SEED=1, see e2e/global-setup.ts) and a
 * server started with MARKET_DATA_TEST_FIXTURE so orders have a deterministic
 * price. Self-skips otherwise, so `npm run test:e2e` stays green without it.
 *
 * Unconditionally skipped for now: Paper Trading's order-entry UI (the order
 * ticket, order book, #order-* fields this file drives) is not rendered on
 * /paper-trading while the feature is deferred (see that page's own
 * comment) — the engine and RPCs underneath are untouched, but there is no
 * UI left for this file to drive. Re-enable once a paper-trading UI ships.
 */

const EMAIL = process.env.E2E_TEST_EMAIL;
const PASSWORD = process.env.E2E_TEST_PASSWORD;
const SEEDED = process.env.E2E_SEED === "1";

const QTY = 5;
const MODIFIED_QTY = 2;

test.describe("paper-trading order lifecycle", () => {
  test.skip(
    true,
    "Paper Trading UI is not exposed yet (deferred feature) — no order-entry UI for this suite to drive."
  );
  test.skip(
    !SEEDED || !EMAIL || !PASSWORD,
    "Requires a seeded backend: E2E_SEED=1 plus E2E_TEST_EMAIL/E2E_TEST_PASSWORD."
  );

  // Serial: these tests share one paper account, and each asserts on
  // balances the previous one moved.
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("a market order fills, opens a position, and books a closed trade", async ({
    page,
  }) => {
    await page.goto("/paper-trading");
    const cashBefore = await readAvailableCash(page);

    // --- place ---------------------------------------------------------
    await page.locator("#order-symbol").fill(E2E_SYMBOL);
    await page.locator("#order-side").selectOption("BUY");
    await page.locator("#order-product").selectOption("MIS");
    await page.locator("#order-qty").fill(String(QTY));
    await page.getByRole("button", { name: "Place order" }).click();

    // --- fill ----------------------------------------------------------
    // The confirmation quotes the price the server actually filled at. That
    // it equals the fixture is the whole point: the fill came from the
    // market-data layer, not from anything the browser typed.
    const confirmation = page.getByText(/^Filled:/);
    await expect(confirmation).toBeVisible({ timeout: 15_000 });
    await expect(confirmation).toContainText(`@ ${E2E_FIXTURE_PRICE}`);

    const charges = await readChargesFromConfirmation(confirmation);
    expect(charges).toBeGreaterThan(0);

    // --- cash debited by notional + charges -----------------------------
    await page.reload();
    const cashAfter = await readAvailableCash(page);
    const expectedDebit = E2E_FIXTURE_PRICE * QTY + charges;
    expect(Math.abs(cashBefore - cashAfter - expectedDebit)).toBeLessThan(0.02);

    // --- order history records the fill ---------------------------------
    const historyRow = page.locator("table tbody tr", { hasText: E2E_SYMBOL }).first();
    await expect(historyRow).toContainText("FILLED");
    await expect(historyRow).toContainText("MARKET");

    // --- position exists on the portfolio -------------------------------
    await page.goto("/portfolio");
    const positionRow = page.locator("table tbody tr", { hasText: E2E_SYMBOL }).first();
    await expect(positionRow).toBeVisible();
    await expect(positionRow).toContainText(String(QTY));

    // --- close ----------------------------------------------------------
    await positionRow.getByRole("button", { name: /close/i }).click();

    // --- the position is gone and a trade was recorded ------------------
    await expect(async () => {
      await page.reload();
      const closedTrade = page.locator("table tbody tr", { hasText: E2E_SYMBOL });
      await expect(closedTrade.first()).toBeVisible();
      // No open position may remain with a Close button on it.
      await expect(
        page.locator("table tbody tr", { hasText: E2E_SYMBOL }).getByRole("button", {
          name: /close/i,
        })
      ).toHaveCount(0);
    }).toPass({ timeout: 20_000 });

    // Bought and sold at the same fixture price, so the trade is a loss of
    // exactly the round-trip charges — never a break-even. A P&L that
    // ignored costs would show zero here, which is the specific bug this
    // assertion exists to catch.
    await page.goto("/activity");
    const tradeRow = page.locator("table tbody tr", { hasText: E2E_SYMBOL }).first();
    await expect(tradeRow).toBeVisible();
    // Rendered with a currency symbol between the sign and the digits, e.g.
    // "-₹5.34".
    const net = await readSignedNumber(tradeRow, /-\s*[^\d\s]?\s*[\d,]+\.\d{2}/);
    expect(net).toBeLessThan(0);
  });

  test("a resting limit order reserves cash, can be modified, and releases it on cancel", async ({
    page,
  }) => {
    await page.goto("/paper-trading");
    const cashBefore = await readAvailableCash(page);

    // Far below the fixture price, so it cannot fill and must rest.
    const limit = E2E_FIXTURE_PRICE / 2;
    await page.getByRole("button", { name: "Limit", exact: true }).click();
    await page.locator("#order-symbol").fill(E2E_SYMBOL);
    await page.locator("#order-side").selectOption("BUY");
    await page.locator("#order-qty").fill(String(QTY));
    await page.locator("#order-limit").fill(String(limit));
    await page.getByRole("button", { name: "Place resting order" }).click();

    await expect(page.getByText(/Order resting:/)).toBeVisible({ timeout: 15_000 });

    // Buying power drops by the reserved notional even though no cash has
    // been spent — otherwise the same rupees could back several orders.
    await page.reload();
    const cashResting = await readAvailableCash(page);
    expect(cashBefore - cashResting).toBeGreaterThan(limit * QTY - 1);

    // --- the matcher must NOT fill it -----------------------------------
    await page.getByRole("button", { name: /check for fills/i }).click();
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("button", { name: /cancel/i }).first()).toBeVisible();

    // --- modify shrinks the order and its reservation with it -----------
    // Halving the quantity must hand back half the reserved cash. A modify
    // that changed the order but not the reservation would leave the account
    // quietly unable to spend money it actually has.
    await page.getByRole("button", { name: "Modify" }).first().click();
    // The order-book edit field, not the placement form's — both are labelled
    // "Quantity"; only the placement one is a number input (spinbutton).
    await page.getByRole("textbox", { name: "Quantity" }).fill(String(MODIFIED_QTY));
    await page.getByRole("button", { name: "Save", exact: true }).click();

    await expect(async () => {
      await page.reload();
      const cashModified = await readAvailableCash(page);
      expect(cashBefore - cashModified).toBeCloseTo(limit * MODIFIED_QTY, 0);
    }).toPass({ timeout: 20_000 });

    // --- cancel releases the reservation exactly ------------------------
    await page.getByRole("button", { name: /cancel/i }).first().click();
    await expect(async () => {
      await page.reload();
      expect(await readAvailableCash(page)).toBeCloseTo(cashBefore, 1);
    }).toPass({ timeout: 20_000 });
  });

  test("an order for more than the account can afford is refused", async ({ page }) => {
    await page.goto("/paper-trading");
    await page.locator("#order-symbol").fill(E2E_SYMBOL);
    await page.locator("#order-side").selectOption("BUY");
    await page.locator("#order-qty").fill("100000");
    await page.getByRole("button", { name: "Place order" }).click();

    const row = page.locator("table tbody tr", { hasText: E2E_SYMBOL }).first();
    await expect(async () => {
      await page.reload();
      await expect(row).toContainText("REJECTED");
    }).toPass({ timeout: 20_000 });
  });
});

async function login(page: Page) {
  await page.goto("/login");
  await page.locator('input[type="email"], input[name="email"]').fill(EMAIL!);
  await page.locator('input[type="password"]').fill(PASSWORD!);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
}

/** Reads the "Cash available: INR 1,00,000" figure from the page header. */
async function readAvailableCash(page: Page): Promise<number> {
  const text = await page.getByText(/Cash available:/).innerText();
  return parseIndianNumber(text);
}

async function readChargesFromConfirmation(
  locator: ReturnType<Page["getByText"]>
): Promise<number> {
  const text = await locator.innerText();
  const match = text.match(/charges\s+([\d.]+)/i);
  if (!match) throw new Error(`No charges in confirmation: ${text}`);
  return Number(match[1]);
}

async function readSignedNumber(
  locator: ReturnType<Page["locator"]>,
  pattern: RegExp
): Promise<number> {
  const text = await locator.innerText();
  const match = text.match(pattern);
  if (!match) throw new Error(`No number matching ${pattern} in: ${text}`);
  // Drops the thousands separators and the currency symbol, keeping the sign.
  return Number(match[0].replace(/[^\d.-]/g, ""));
}

/** "Cash available: INR 1,00,000.5" -> 100000.5 */
function parseIndianNumber(text: string): number {
  const match = text.match(/([\d,]+(?:\.\d+)?)/);
  if (!match) throw new Error(`No number in: ${text}`);
  return Number(match[1].replace(/,/g, ""));
}
