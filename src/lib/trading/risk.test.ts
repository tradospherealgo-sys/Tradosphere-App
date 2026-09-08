import { describe, expect, it } from "vitest";
import { calcPositionSize, calcRMultiple, calcRiskReward } from "./risk";

describe("calcPositionSize", () => {
  it("sizes a cash-equity trade from the risk budget", () => {
    const result = calcPositionSize({
      equity: 1_000_000,
      riskPct: 1,
      entryPrice: 500,
      stopLoss: 490,
    });

    expect(result).not.toBeNull();
    expect(result!.riskAmount).toBe(10_000);
    expect(result!.riskPerUnit).toBe(10);
    expect(result!.quantity).toBe(1000);
    expect(result!.notional).toBe(500_000);
    expect(result!.actualRisk).toBe(10_000);
  });

  it("floors to whole lots and reports the reduced actual risk", () => {
    const result = calcPositionSize({
      equity: 1_000_000,
      riskPct: 1,
      entryPrice: 22_000,
      stopLoss: 21_900,
      lotSize: 75,
    });

    // 10,000 budget / (100 per unit * 75 per lot) = 1.33 -> 1 lot
    expect(result!.lots).toBe(1);
    expect(result!.quantity).toBe(75);
    expect(result!.actualRisk).toBe(7500);
  });

  it("returns zero quantity when the budget cannot cover one lot", () => {
    const result = calcPositionSize({
      equity: 50_000,
      riskPct: 1,
      entryPrice: 22_000,
      stopLoss: 21_500,
      lotSize: 75,
    });

    // Never rounds up to one lot — that would silently exceed the risk rule.
    expect(result!.lots).toBe(0);
    expect(result!.quantity).toBe(0);
    expect(result!.actualRisk).toBe(0);
  });

  it("handles a short, where the stop sits above entry", () => {
    const result = calcPositionSize({
      equity: 200_000,
      riskPct: 2,
      entryPrice: 100,
      stopLoss: 104,
    });

    expect(result!.riskPerUnit).toBe(4);
    expect(result!.quantity).toBe(1000);
  });

  it("refuses to size without a real stop distance", () => {
    expect(
      calcPositionSize({ equity: 100_000, riskPct: 1, entryPrice: 500, stopLoss: 500 })
    ).toBeNull();
  });

  it("rejects degenerate equity and risk inputs", () => {
    expect(calcPositionSize({ equity: 0, riskPct: 1, entryPrice: 10, stopLoss: 9 })).toBeNull();
    expect(calcPositionSize({ equity: 100, riskPct: 0, entryPrice: 10, stopLoss: 9 })).toBeNull();
    expect(calcPositionSize({ equity: 100, riskPct: 150, entryPrice: 10, stopLoss: 9 })).toBeNull();
    expect(calcPositionSize({ equity: 100, riskPct: 1, entryPrice: -10, stopLoss: 9 })).toBeNull();
  });
});

describe("calcRiskReward", () => {
  it("computes R:R for a long", () => {
    expect(
      calcRiskReward({ side: "BUY", entryPrice: 100, stopLoss: 95, targetPrice: 115 })
    ).toBe(3);
  });

  it("computes R:R for a short", () => {
    expect(
      calcRiskReward({ side: "SELL", entryPrice: 100, stopLoss: 105, targetPrice: 90 })
    ).toBe(2);
  });

  it("returns null when the stop is on the wrong side of entry", () => {
    expect(
      calcRiskReward({ side: "BUY", entryPrice: 100, stopLoss: 105, targetPrice: 115 })
    ).toBeNull();
  });

  it("returns null when the target is on the wrong side of entry", () => {
    expect(
      calcRiskReward({ side: "BUY", entryPrice: 100, stopLoss: 95, targetPrice: 98 })
    ).toBeNull();
  });
});

describe("calcRMultiple", () => {
  it("reports a winner in units of initial risk", () => {
    expect(
      calcRMultiple({ side: "BUY", entryPrice: 100, exitPrice: 110, stopLoss: 95 })
    ).toBe(2);
  });

  it("reports a loser as negative R", () => {
    expect(
      calcRMultiple({ side: "BUY", entryPrice: 100, exitPrice: 95, stopLoss: 95 })
    ).toBe(-1);
  });

  it("handles shorts", () => {
    expect(
      calcRMultiple({ side: "SELL", entryPrice: 100, exitPrice: 90, stopLoss: 105 })
    ).toBe(2);
  });

  it("returns null without a usable stop", () => {
    expect(
      calcRMultiple({ side: "BUY", entryPrice: 100, exitPrice: 110, stopLoss: 100 })
    ).toBeNull();
  });
});
