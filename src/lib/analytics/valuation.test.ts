import { describe, expect, it } from "vitest";
import { calcAllocation, valuePositions } from "./valuation";
import type { Position } from "@/types/database";
import type { Quote } from "@/lib/market-data/types";

function position(over: Partial<Position> = {}): Position {
  return {
    id: "p1",
    account_id: "a",
    user_id: "u",
    symbol: "RELIANCE",
    instrument_kind: "EQUITY",
    side: "BUY",
    quantity: 10,
    avg_price: 100,
    product: "MIS",
    entry_charges: 0,
    stop_loss: null,
    target_price: null,
    opened_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...over,
  };
}

function quote(over: Partial<Quote> = {}): Quote {
  return {
    symbol: "RELIANCE",
    name: null,
    lastPrice: 110,
    prevClose: 105,
    open: null,
    high: null,
    low: null,
    volume: null,
    asOf: "2026-01-02T09:30:00Z",
    source: "test",
    ...over,
  };
}

describe("valuePositions", () => {
  it("marks a long position to market", () => {
    const v = valuePositions([position()], [quote()]);
    expect(v.marketValue).toBe(1100);
    expect(v.unrealizedPnl).toBe(100);
    expect(v.dayPnl).toBe(50);
    expect(v.investedAtCost).toBe(1000);
    expect(v.unquoted).toBe(0);
  });

  it("inverts the sign for a short", () => {
    const v = valuePositions([position({ side: "SELL" })], [quote()]);
    expect(v.unrealizedPnl).toBe(-100);
    expect(v.dayPnl).toBe(-50);
  });

  it("reports an unquoted position as unknown, not flat", () => {
    const v = valuePositions([position({ symbol: "TCS" })], [quote()]);
    expect(v.rows[0].unrealizedPnl).toBeNull();
    expect(v.unquoted).toBe(1);
    expect(v.marketValue).toBeNull();
    expect(v.unrealizedPnl).toBeNull();
  });

  it("suppresses portfolio totals when any leg lacks a quote", () => {
    const v = valuePositions(
      [position(), position({ id: "p2", symbol: "INFY" })],
      [quote()]
    );
    expect(v.rows[0].unrealizedPnl).toBe(100);
    expect(v.unrealizedPnl).toBeNull();
    expect(v.investedAtCost).toBe(2000);
  });

  it("leaves day P&L null when the provider gave no previous close", () => {
    const v = valuePositions([position()], [quote({ prevClose: null })]);
    expect(v.unrealizedPnl).toBe(100);
    expect(v.dayPnl).toBeNull();
  });

  it("matches symbols case-insensitively", () => {
    const v = valuePositions([position({ symbol: "reliance" })], [quote()]);
    expect(v.unquoted).toBe(0);
  });
});

describe("calcAllocation", () => {
  it("splits by symbol at market value", () => {
    const v = valuePositions(
      [position(), position({ id: "p2", symbol: "INFY", quantity: 10, avg_price: 50 })],
      [quote(), quote({ symbol: "INFY", lastPrice: 110 })]
    );
    const alloc = calcAllocation(v);
    expect(alloc).toHaveLength(2);
    expect(alloc[0].pct).toBe(50);
  });

  it("returns nothing when the portfolio cannot be valued", () => {
    const v = valuePositions([position({ symbol: "TCS" })], []);
    expect(calcAllocation(v)).toEqual([]);
  });
});
