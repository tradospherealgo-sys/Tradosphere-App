import { describe, expect, it } from "vitest";
import { buildEquityCurve, calcDrawdown, calcTradeStats } from "./stats";
import type { Trade } from "@/types/database";

let n = 0;
function trade(realized: number, extra: Partial<Trade> = {}): Trade {
  n += 1;
  return {
    id: `t${n}`,
    account_id: "a",
    user_id: "u",
    symbol: "TEST",
    side: "BUY",
    quantity: 1,
    entry_price: 100,
    exit_price: 100 + realized,
    realized_pnl: realized,
    stop_loss: null,
    target_price: null,
    r_multiple: null,
    opened_at: `2026-01-${String(n).padStart(2, "0")}T09:15:00Z`,
    closed_at: `2026-01-${String(n).padStart(2, "0")}T15:00:00Z`,
    origin: null,
    notes: null,
    signal_id: null,
    ...extra,
  };
}

describe("calcTradeStats", () => {
  it("returns nulls, not zeros, with no trades", () => {
    const s = calcTradeStats([]);
    expect(s.totalTrades).toBe(0);
    expect(s.winRate).toBeNull();
    expect(s.expectancy).toBeNull();
    expect(s.profitFactor).toBeNull();
  });

  it("computes win rate, averages and expectancy", () => {
    const s = calcTradeStats([trade(100), trade(200), trade(-50), trade(-50)]);
    expect(s.totalTrades).toBe(4);
    expect(s.wins).toBe(2);
    expect(s.losses).toBe(2);
    expect(s.winRate).toBe(50);
    expect(s.grossProfit).toBe(300);
    expect(s.grossLoss).toBe(100);
    expect(s.netPnl).toBe(200);
    expect(s.avgWin).toBe(150);
    expect(s.avgLoss).toBe(50);
    expect(s.expectancy).toBe(50);
    expect(s.profitFactor).toBe(3);
  });

  it("excludes flat trades from the win-rate denominator", () => {
    const s = calcTradeStats([trade(100), trade(-100), trade(0)]);
    expect(s.breakEven).toBe(1);
    expect(s.winRate).toBe(50);
    expect(s.totalTrades).toBe(3);
  });

  it("leaves profit factor null when nothing has lost", () => {
    const s = calcTradeStats([trade(10), trade(20)]);
    expect(s.profitFactor).toBeNull();
    expect(s.avgLoss).toBeNull();
  });

  it("averages only the R multiples that exist", () => {
    const s = calcTradeStats([
      trade(100, { r_multiple: 2 }),
      trade(-50, { r_multiple: -1 }),
      trade(10),
    ]);
    expect(s.avgRMultiple).toBe(0.5);
  });

  it("tracks best and worst", () => {
    const s = calcTradeStats([trade(5), trade(-80), trade(120)]);
    expect(s.bestTrade).toBe(120);
    expect(s.worstTrade).toBe(-80);
  });
});

describe("buildEquityCurve / calcDrawdown", () => {
  it("starts at starting capital and moves only on closed trades", () => {
    const curve = buildEquityCurve([trade(100), trade(-40)], 1000);
    expect(curve[0].equity).toBe(1000);
    expect(curve.at(-1)!.equity).toBe(1060);
    expect(curve).toHaveLength(3);
  });

  it("measures peak-to-trough drawdown", () => {
    const curve = buildEquityCurve([trade(200), trade(-300), trade(50)], 1000);
    const dd = calcDrawdown(curve);
    expect(dd.peakEquity).toBe(1200);
    expect(dd.maxDrawdown).toBe(300);
    expect(dd.maxDrawdownPct).toBe(25);
  });

  it("reports no drawdown on a monotonic curve", () => {
    const dd = calcDrawdown(buildEquityCurve([trade(10), trade(20)], 500));
    expect(dd.maxDrawdown).toBe(0);
    expect(dd.maxDrawdownPct).toBe(0);
  });
});
