import { describe, expect, it } from "vitest";
import { bollinger, ema, rsi, sma, vwap } from "./indicators";
import type { Candle } from "@/lib/market-data/types";

function candle(ts: string, close: number, volume: number | null = 100): Candle {
  return { ts, open: close, high: close, low: close, close, volume };
}

describe("sma", () => {
  it("leaves the warm-up window null instead of back-filling", () => {
    const result = sma([1, 2, 3, 4, 5], 3);
    expect(result.slice(0, 2)).toEqual([null, null]);
    expect(result[2]).toBe(2);
    expect(result[4]).toBe(4);
  });

  it("returns all null when there is less history than the period", () => {
    expect(sma([1, 2], 5)).toEqual([null, null]);
  });
});

describe("ema", () => {
  it("seeds from the SMA of the first period", () => {
    const result = ema([1, 2, 3, 4, 5], 3);
    expect(result.slice(0, 2)).toEqual([null, null]);
    expect(result[2]).toBe(2); // SMA(1,2,3)
    // k = 2/4 = 0.5 -> 4*0.5 + 2*0.5 = 3
    expect(result[3]).toBe(3);
    expect(result[4]).toBe(4);
  });

  it("returns all null when history is shorter than the period", () => {
    expect(ema([1, 2], 5)).toEqual([null, null]);
  });
});

describe("rsi", () => {
  it("reports 100 for an unbroken run of up-closes", () => {
    const values = Array.from({ length: 20 }, (_, i) => 100 + i);
    const result = rsi(values, 14);
    expect(result[14]).toBe(100);
  });

  it("reports 0 for an unbroken run of down-closes", () => {
    const values = Array.from({ length: 20 }, (_, i) => 100 - i);
    const result = rsi(values, 14);
    expect(result[14]).toBe(0);
  });

  it("sits mid-range for alternating equal moves", () => {
    const values: number[] = [100];
    for (let i = 1; i < 40; i++) values.push(values[i - 1] + (i % 2 === 0 ? 1 : -1));
    const last = rsi(values, 14).at(-1);
    expect(last).toBeGreaterThan(30);
    expect(last).toBeLessThan(70);
  });

  it("is null until there is enough history", () => {
    expect(rsi([1, 2, 3], 14).every((v) => v === null)).toBe(true);
  });
});

describe("bollinger", () => {
  it("collapses the bands onto the mean when price is flat", () => {
    const values = new Array(25).fill(50);
    const bb = bollinger(values, 20, 2);
    expect(bb.middle[24]).toBe(50);
    expect(bb.upper[24]).toBe(50);
    expect(bb.lower[24]).toBe(50);
  });

  it("brackets the mean when price varies", () => {
    const values = Array.from({ length: 25 }, (_, i) => 50 + (i % 5));
    const bb = bollinger(values, 20, 2);
    expect(bb.upper[24]!).toBeGreaterThan(bb.middle[24]!);
    expect(bb.lower[24]!).toBeLessThan(bb.middle[24]!);
  });
});

describe("vwap", () => {
  it("resets at each new session", () => {
    const candles = [
      candle("2026-01-01T09:15:00Z", 100),
      candle("2026-01-01T09:20:00Z", 200),
      candle("2026-01-02T09:15:00Z", 500),
    ];
    const result = vwap(candles);
    expect(result[1]).toBe(150);
    // New day: not dragged forward from the previous session.
    expect(result[2]).toBe(500);
  });

  it("returns all null when no candle carries volume", () => {
    const candles = [candle("2026-01-01T09:15:00Z", 100, null)];
    expect(vwap(candles)).toEqual([null]);
  });
});
