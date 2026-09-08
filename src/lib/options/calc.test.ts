import { describe, expect, it } from "vitest";
import { calcGreeks, calcMaxPain, calcPcr, classifyMoneyness, daysToExpiry, findAtmStrike } from "./calc";
import type { OptionLeg } from "./types";

function leg(strike: number, optionType: "CE" | "PE", oi: number | null): OptionLeg {
  return {
    strike,
    optionType,
    ltp: null,
    bid: null,
    ask: null,
    volume: null,
    oi,
    changeOi: null,
    iv: null,
    delta: null,
    gamma: null,
    theta: null,
    vega: null,
  };
}

describe("findAtmStrike", () => {
  it("picks the strike closest to spot", () => {
    const legs = [leg(24000, "CE", 1), leg(24100, "CE", 1), leg(24200, "CE", 1)];
    expect(findAtmStrike(legs, 24120)).toBe(24100);
  });

  it("returns null for an empty chain", () => {
    expect(findAtmStrike([], 24000)).toBeNull();
  });
});

describe("classifyMoneyness", () => {
  it("classifies calls below ATM as ITM, above as OTM", () => {
    expect(classifyMoneyness("CE", 23900, 24000)).toBe("ITM");
    expect(classifyMoneyness("CE", 24100, 24000)).toBe("OTM");
    expect(classifyMoneyness("CE", 24000, 24000)).toBe("ATM");
  });

  it("classifies puts above ATM as ITM, below as OTM", () => {
    expect(classifyMoneyness("PE", 24100, 24000)).toBe("ITM");
    expect(classifyMoneyness("PE", 23900, 24000)).toBe("OTM");
  });

  it("treats an unknown ATM strike as ATM (no fabricated classification)", () => {
    expect(classifyMoneyness("CE", 24000, null)).toBe("ATM");
  });
});

describe("calcPcr", () => {
  it("computes put/call ratio from OI", () => {
    const legs = [leg(24000, "CE", 1000), leg(24000, "PE", 1500)];
    expect(calcPcr(legs)).toBe(1.5);
  });

  it("returns null when OI data is missing entirely", () => {
    const legs = [leg(24000, "CE", null), leg(24000, "PE", null)];
    expect(calcPcr(legs)).toBeNull();
  });

  it("returns null when call OI is zero (avoid divide-by-zero)", () => {
    const legs = [leg(24000, "CE", 0), leg(24000, "PE", 500)];
    expect(calcPcr(legs)).toBeNull();
  });
});

describe("calcMaxPain", () => {
  it("finds the strike minimizing total option-writer payout", () => {
    // At strike 100: CE(90) ITM payout 10*100=1000, PE(110) ITM payout 10*100=1000 -> 2000
    // At strike 100 itself, both are ATM (no payout).
    const legs = [
      leg(90, "CE", 100),
      leg(100, "CE", 100),
      leg(110, "CE", 100),
      leg(90, "PE", 100),
      leg(100, "PE", 100),
      leg(110, "PE", 100),
    ];
    expect(calcMaxPain(legs)).toBe(100);
  });

  it("returns null for an empty chain", () => {
    expect(calcMaxPain([])).toBeNull();
  });
});

describe("calcGreeks", () => {
  it("computes a plausible ATM call delta near 0.5-0.6", () => {
    // Spot=strike (ATM), 30 days to expiry, 15% IV — textbook near-ATM call delta.
    const g = calcGreeks(24000, 24000, 30 / 365, 15, "CE");
    expect(g).not.toBeNull();
    expect(g!.delta).toBeGreaterThan(0.45);
    expect(g!.delta).toBeLessThan(0.65);
    expect(g!.gamma).toBeGreaterThan(0);
    expect(g!.vega).toBeGreaterThan(0);
  });

  it("computes a deep ITM call delta close to 1", () => {
    const g = calcGreeks(25000, 20000, 30 / 365, 15, "CE");
    expect(g!.delta).toBeGreaterThan(0.9);
  });

  it("computes a deep OTM put delta close to 0", () => {
    const g = calcGreeks(25000, 20000, 30 / 365, 15, "PE");
    expect(Math.abs(g!.delta)).toBeLessThan(0.1);
  });

  it("put delta is negative, call delta is positive, same strike/spot", () => {
    const call = calcGreeks(24000, 24000, 30 / 365, 15, "CE")!;
    const put = calcGreeks(24000, 24000, 30 / 365, 15, "PE")!;
    expect(call.delta).toBeGreaterThan(0);
    expect(put.delta).toBeLessThan(0);
    // Put-call parity on delta: call delta - put delta ≈ 1
    expect(call.delta - put.delta).toBeCloseTo(1, 1);
  });

  it("gamma and vega are identical for calls and puts at the same strike (Black-Scholes identity)", () => {
    const call = calcGreeks(24000, 24100, 30 / 365, 18, "CE")!;
    const put = calcGreeks(24000, 24100, 30 / 365, 18, "PE")!;
    expect(call.gamma).toBeCloseTo(put.gamma, 4);
    expect(call.vega).toBeCloseTo(put.vega, 4);
  });

  it("returns null when any required real input is missing or non-positive", () => {
    expect(calcGreeks(0, 24000, 30 / 365, 15, "CE")).toBeNull();
    expect(calcGreeks(24000, 0, 30 / 365, 15, "CE")).toBeNull();
    expect(calcGreeks(24000, 24000, 0, 15, "CE")).toBeNull(); // expired
    expect(calcGreeks(24000, 24000, 30 / 365, 0, "CE")).toBeNull(); // no IV published
  });
});

describe("daysToExpiry", () => {
  it("returns a positive fractional day count for a future expiry", () => {
    const now = new Date("2026-01-01T10:00:00+05:30");
    const days = daysToExpiry("2026-01-08", now);
    expect(days).toBeGreaterThan(6.5);
    expect(days).toBeLessThan(7.5);
  });

  it("floors to 0 for a past expiry rather than going negative", () => {
    const now = new Date("2026-01-10T10:00:00+05:30");
    expect(daysToExpiry("2026-01-01", now)).toBe(0);
  });
});
