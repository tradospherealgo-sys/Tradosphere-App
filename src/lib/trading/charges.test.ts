import { describe, expect, it } from "vitest";
import { calcCharges, shouldFill } from "./charges";

describe("calcCharges", () => {
  it("charges no brokerage on delivery and caps intraday brokerage at Rs 20", () => {
    expect(calcCharges("BUY", "CNC", 500_000).brokerage).toBe(0);
    // 0.03% of 50,000 is 15 — under the cap.
    expect(calcCharges("BUY", "MIS", 50_000).brokerage).toBe(15);
    // 0.03% of 500,000 is 150 — capped.
    expect(calcCharges("BUY", "MIS", 500_000).brokerage).toBe(20);
  });

  it("applies STT on both sides for delivery but only the sell side intraday", () => {
    expect(calcCharges("BUY", "CNC", 100_000).stt).toBe(100);
    expect(calcCharges("SELL", "CNC", 100_000).stt).toBe(100);
    expect(calcCharges("BUY", "MIS", 100_000).stt).toBe(0);
    expect(calcCharges("SELL", "MIS", 100_000).stt).toBe(25);
  });

  it("charges stamp duty on purchases only", () => {
    expect(calcCharges("BUY", "CNC", 100_000).stampDuty).toBe(15);
    expect(calcCharges("BUY", "MIS", 100_000).stampDuty).toBe(3);
    expect(calcCharges("SELL", "CNC", 100_000).stampDuty).toBe(0);
    expect(calcCharges("SELL", "MIS", 100_000).stampDuty).toBe(0);
  });

  it("excludes STT and stamp duty from the GST base", () => {
    const c = calcCharges("BUY", "MIS", 100_000);
    // GST is 18% of brokerage + exchange + SEBI + IPFT only.
    const taxable = c.brokerage + c.exchangeCharges + c.sebiCharges;
    expect(c.gst).toBeCloseTo(Math.round(taxable * 0.18 * 100) / 100, 2);
  });

  it("sums every line into the total", () => {
    const c = calcCharges("SELL", "MIS", 250_000);
    expect(c.total).toBeCloseTo(
      c.brokerage + c.stt + c.exchangeCharges + c.sebiCharges + c.stampDuty + c.gst,
      2
    );
  });

  it("returns zero for a zero or nonsensical turnover rather than a negative charge", () => {
    expect(calcCharges("BUY", "MIS", 0).total).toBe(0);
    expect(calcCharges("BUY", "MIS", -5_000).total).toBe(0);
    expect(calcCharges("BUY", "MIS", Number.NaN).total).toBe(0);
  });
});

describe("shouldFill", () => {
  it("never fills against a missing or non-positive price", () => {
    expect(shouldFill("MARKET", "BUY", null, null, null)).toBe(false);
    expect(shouldFill("MARKET", "BUY", 0, null, null)).toBe(false);
    expect(shouldFill("MARKET", "BUY", -10, null, null)).toBe(false);
  });

  it("fills a market order against any real price", () => {
    expect(shouldFill("MARKET", "BUY", 101.5, null, null)).toBe(true);
    expect(shouldFill("MARKET", "SELL", 101.5, null, null)).toBe(true);
  });

  it("fills a limit buy at or below the limit, a limit sell at or above", () => {
    expect(shouldFill("LIMIT", "BUY", 99, 100, null)).toBe(true);
    expect(shouldFill("LIMIT", "BUY", 100, 100, null)).toBe(true);
    expect(shouldFill("LIMIT", "BUY", 101, 100, null)).toBe(false);
    expect(shouldFill("LIMIT", "SELL", 101, 100, null)).toBe(true);
    expect(shouldFill("LIMIT", "SELL", 99, 100, null)).toBe(false);
  });

  it("triggers SL-M on the trigger alone", () => {
    expect(shouldFill("SL_M", "BUY", 105, null, 104)).toBe(true);
    expect(shouldFill("SL_M", "BUY", 103, null, 104)).toBe(false);
    expect(shouldFill("SL_M", "SELL", 95, null, 96)).toBe(true);
    expect(shouldFill("SL_M", "SELL", 97, null, 96)).toBe(false);
  });

  it("requires an SL order to be past the trigger and still inside the limit", () => {
    // Buy stop at 104, unwilling to chase past 106.
    expect(shouldFill("SL", "BUY", 105, 106, 104)).toBe(true);
    expect(shouldFill("SL", "BUY", 103, 106, 104)).toBe(false);
    expect(shouldFill("SL", "BUY", 107, 106, 104)).toBe(false);
    // Sell stop at 96, unwilling to sell below 94.
    expect(shouldFill("SL", "SELL", 95, 94, 96)).toBe(true);
    expect(shouldFill("SL", "SELL", 93, 94, 96)).toBe(false);
  });

  it("refuses to fill when the price defining the order is missing", () => {
    expect(shouldFill("LIMIT", "BUY", 100, null, null)).toBe(false);
    expect(shouldFill("SL_M", "BUY", 100, null, null)).toBe(false);
    expect(shouldFill("SL", "BUY", 100, 106, null)).toBe(false);
  });
});
