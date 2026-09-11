import { describe, expect, it } from "vitest";
import { __testing } from "./smc";

const { readPath, toNumber, toIsoOrNow, mapCandle, formatBrokerDate } = __testing;

describe("readPath", () => {
  it("reads a dotted path out of a nested object", () => {
    expect(readPath({ data: { ltp: 2500.5 } }, "data.ltp")).toBe(2500.5);
  });

  it("reads a numeric-string path as an array index", () => {
    expect(readPath([100, 200, 300], "1")).toBe(200);
  });

  it("returns undefined for a missing path", () => {
    expect(readPath({ data: {} }, "data.missing")).toBeUndefined();
    expect(readPath(null, "data.ltp")).toBeUndefined();
  });
});

describe("toNumber", () => {
  it("passes through finite numbers and parses numeric strings", () => {
    expect(toNumber(42)).toBe(42);
    expect(toNumber("42.5")).toBe(42.5);
  });

  it("rejects non-numeric and non-finite values", () => {
    expect(toNumber("nonsense")).toBeNull();
    expect(toNumber(NaN)).toBeNull();
    expect(toNumber(undefined)).toBeNull();
    expect(toNumber(null)).toBeNull();
  });
});

describe("toIsoOrNow", () => {
  it("converts a parseable date value to ISO", () => {
    expect(toIsoOrNow("2025-01-01T00:00:00.000Z")).toBe(
      new Date("2025-01-01T00:00:00.000Z").toISOString()
    );
  });

  it("falls back to now for an unparseable or missing value", () => {
    const before = Date.now();
    const iso = toIsoOrNow(undefined);
    const after = Date.now();
    const parsed = new Date(iso).getTime();
    expect(parsed).toBeGreaterThanOrEqual(before);
    expect(parsed).toBeLessThanOrEqual(after);
  });
});

describe("formatBrokerDate", () => {
  it("formats a Date into the broker's expected date string", () => {
    const formatted = formatBrokerDate(new Date("2025-01-05T00:00:00.000Z"));
    expect(typeof formatted).toBe("string");
    expect(formatted.length).toBeGreaterThan(0);
  });
});

describe("mapCandle", () => {
  const fields = {
    ts: "0",
    open: "1",
    high: "2",
    low: "3",
    close: "4",
    volume: "5",
  };

  it("maps a well-shaped array-style candle row", () => {
    const row = ["2025-01-01T00:00:00.000Z", 53.1, 53.95, 51.6, 52.05, 235519861];
    expect(mapCandle(row, fields)).toEqual({
      ts: new Date("2025-01-01T00:00:00.000Z").toISOString(),
      open: 53.1,
      high: 53.95,
      low: 51.6,
      close: 52.05,
      volume: 235519861,
    });
  });

  it("rejects a row missing required OHLC values", () => {
    expect(mapCandle(["2025-01-01T00:00:00.000Z", 1, 2, 3], fields)).toBeNull();
    expect(mapCandle(null, fields)).toBeNull();
  });

  it("tolerates a missing volume", () => {
    const row = ["2025-01-01T00:00:00.000Z", 1, 2, 0.5, 1.5];
    expect(mapCandle(row, fields)?.volume).toBeNull();
  });
});
