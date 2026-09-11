import { describe, expect, it } from "vitest";
import { computeSignalFingerprint } from "./fingerprint";

describe("computeSignalFingerprint", () => {
  it("is stable for the same inputs", () => {
    const input = {
      category: "EQUITY" as const,
      symbol: "RELIANCE",
      action: "BUY",
      entry: 2450,
      stopLoss: 2400,
      targets: [2500, 2550, null],
    };
    expect(computeSignalFingerprint(input)).toBe(computeSignalFingerprint(input));
  });

  it("is prefixed with today's date so the same call on a different day is not a duplicate", () => {
    const fp = computeSignalFingerprint({
      category: "EQUITY",
      symbol: "RELIANCE",
      action: "BUY",
      entry: 2450,
      stopLoss: 2400,
      targets: [2500],
    });
    expect(fp.startsWith(new Date().toISOString().slice(0, 10))).toBe(true);
  });

  it("differs when any field differs", () => {
    const base = {
      category: "EQUITY" as const,
      symbol: "RELIANCE",
      action: "BUY",
      entry: 2450,
      stopLoss: 2400,
      targets: [2500],
    };
    const other = { ...base, symbol: "TCS" };
    expect(computeSignalFingerprint(base)).not.toBe(computeSignalFingerprint(other));
  });

  it("treats null fields as empty rather than the string 'null'", () => {
    const fp = computeSignalFingerprint({
      category: "F&O",
      symbol: "NIFTY",
      action: null,
      entry: null,
      stopLoss: null,
      targets: [],
    });
    expect(fp).not.toContain("NULL");
  });

  it("ignores missing targets when computing the joined list", () => {
    const withGap = computeSignalFingerprint({
      category: "EQUITY",
      symbol: "TCS",
      action: "SELL",
      entry: 100,
      stopLoss: 110,
      targets: [90, null, 80],
    });
    const withoutGap = computeSignalFingerprint({
      category: "EQUITY",
      symbol: "TCS",
      action: "SELL",
      entry: 100,
      stopLoss: 110,
      targets: [90, 80],
    });
    expect(withGap).toBe(withoutGap);
  });
});
