import { describe, expect, it } from "vitest";
import {
  calcCashDelta,
  calcRealizedPnl,
  calcUnrealizedPnl,
  calcWeightedAveragePrice,
  hasSufficientCash,
} from "./pnl";

describe("calcRealizedPnl", () => {
  it("computes profit on a long trade", () => {
    expect(
      calcRealizedPnl({ side: "BUY", quantity: 10, entryPrice: 100, exitPrice: 110 })
    ).toBe(100);
  });

  it("computes loss on a long trade", () => {
    expect(
      calcRealizedPnl({ side: "BUY", quantity: 10, entryPrice: 100, exitPrice: 90 })
    ).toBe(-100);
  });

  it("computes profit on a short trade", () => {
    expect(
      calcRealizedPnl({ side: "SELL", quantity: 5, entryPrice: 100, exitPrice: 80 })
    ).toBe(100);
  });

  it("computes loss on a short trade", () => {
    expect(
      calcRealizedPnl({ side: "SELL", quantity: 5, entryPrice: 100, exitPrice: 120 })
    ).toBe(-100);
  });
});

describe("calcUnrealizedPnl", () => {
  it("marks a long position to market", () => {
    expect(
      calcUnrealizedPnl({ side: "BUY", quantity: 2, avgPrice: 50, lastPrice: 55 })
    ).toBe(10);
  });

  it("marks a short position to market", () => {
    expect(
      calcUnrealizedPnl({ side: "SELL", quantity: 2, avgPrice: 50, lastPrice: 45 })
    ).toBe(10);
  });
});

describe("calcWeightedAveragePrice", () => {
  it("averages two equal-size fills", () => {
    expect(
      calcWeightedAveragePrice({
        existingQty: 10,
        existingAvgPrice: 100,
        addQty: 10,
        addPrice: 120,
      })
    ).toBe(110);
  });

  it("weights larger fills more heavily", () => {
    expect(
      calcWeightedAveragePrice({
        existingQty: 5,
        existingAvgPrice: 100,
        addQty: 15,
        addPrice: 200,
      })
    ).toBe(175);
  });

  it("returns 0 for a fully closed position", () => {
    expect(
      calcWeightedAveragePrice({
        existingQty: 10,
        existingAvgPrice: 100,
        addQty: -10,
        addPrice: 100,
      })
    ).toBe(0);
  });
});

describe("calcCashDelta", () => {
  it("debits cash for a BUY", () => {
    expect(calcCashDelta({ side: "BUY", quantity: 10, price: 25 })).toBe(-250);
  });

  it("credits cash for a SELL", () => {
    expect(calcCashDelta({ side: "SELL", quantity: 10, price: 25 })).toBe(250);
  });
});

describe("hasSufficientCash", () => {
  it("blocks a BUY that exceeds cash balance", () => {
    expect(
      hasSufficientCash({ side: "BUY", quantity: 10, price: 100, cashBalance: 500 })
    ).toBe(false);
  });

  it("allows a BUY within cash balance", () => {
    expect(
      hasSufficientCash({ side: "BUY", quantity: 5, price: 100, cashBalance: 500 })
    ).toBe(true);
  });

  it("never blocks a SELL on cash grounds", () => {
    expect(
      hasSufficientCash({ side: "SELL", quantity: 1000, price: 100, cashBalance: 0 })
    ).toBe(true);
  });
});
