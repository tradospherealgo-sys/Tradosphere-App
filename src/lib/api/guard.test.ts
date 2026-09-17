import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { checkRateLimit, parseSymbols } from "./guard";

describe("parseSymbols", () => {
  it("splits, trims, and upper-cases", () => {
    expect(parseSymbols(" nifty , reliance ")).toEqual(["NIFTY", "RELIANCE"]);
  });

  it("de-duplicates", () => {
    expect(parseSymbols("TCS,tcs,TCS")).toEqual(["TCS"]);
  });

  it("returns empty array for null/empty input", () => {
    expect(parseSymbols(null)).toEqual([]);
    expect(parseSymbols("")).toEqual([]);
  });

  it("caps at the max count", () => {
    const many = Array.from({ length: 30 }, (_, i) => `SYM${i}`).join(",");
    expect(parseSymbols(many, 25)).toHaveLength(25);
  });
});

describe("checkRateLimit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows calls up to the limit", () => {
    const key = `test:${crypto.randomUUID()}`;
    expect(checkRateLimit(key, 3)).toBe(true);
    expect(checkRateLimit(key, 3)).toBe(true);
    expect(checkRateLimit(key, 3)).toBe(true);
  });

  it("rejects the call that exceeds the limit", () => {
    const key = `test:${crypto.randomUUID()}`;
    checkRateLimit(key, 2);
    checkRateLimit(key, 2);
    expect(checkRateLimit(key, 2)).toBe(false);
  });

  it("does not let one key's usage affect another key", () => {
    const keyA = `test:${crypto.randomUUID()}`;
    const keyB = `test:${crypto.randomUUID()}`;
    checkRateLimit(keyA, 1);
    expect(checkRateLimit(keyA, 1)).toBe(false);
    expect(checkRateLimit(keyB, 1)).toBe(true);
  });

  it("allows calls again once the window has elapsed", () => {
    const key = `test:${crypto.randomUUID()}`;
    checkRateLimit(key, 1);
    expect(checkRateLimit(key, 1)).toBe(false);

    vi.advanceTimersByTime(10_001);

    expect(checkRateLimit(key, 1)).toBe(true);
  });
});
