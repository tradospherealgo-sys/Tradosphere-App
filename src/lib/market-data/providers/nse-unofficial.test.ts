import { describe, expect, it } from "vitest";
import { NseUnofficialProvider } from "./nse-unofficial";
import { __testing } from "./nse-unofficial";

const { parseNseTimestamp } = __testing;

describe("NseUnofficialProvider.isConfigured", () => {
  it("is always configured (no secret required)", () => {
    const provider = new NseUnofficialProvider();
    expect(provider.isConfigured()).toBe(true);
  });
});

describe("parseNseTimestamp", () => {
  it("parses NSE's DD-Mon-YYYY HH:mm:ss format as IST", () => {
    const iso = parseNseTimestamp("01-Jan-2025 09:15:00");
    expect(iso).toBe(new Date("2025-01-01T09:15:00+05:30").toISOString());
  });

  it("handles every month abbreviation", () => {
    expect(parseNseTimestamp("15-Dec-2025 15:30:00")).toBe(
      new Date("2025-12-15T15:30:00+05:30").toISOString()
    );
  });

  it("falls back to now for a missing or unparseable timestamp", () => {
    const before = Date.now();
    const iso = parseNseTimestamp(undefined);
    const after = Date.now();
    const parsed = new Date(iso).getTime();
    expect(parsed).toBeGreaterThanOrEqual(before);
    expect(parsed).toBeLessThanOrEqual(after);
  });

  it("falls back to now for a malformed timestamp string", () => {
    const before = Date.now();
    const iso = parseNseTimestamp("not a timestamp");
    const after = Date.now();
    const parsed = new Date(iso).getTime();
    expect(parsed).toBeGreaterThanOrEqual(before);
    expect(parsed).toBeLessThanOrEqual(after);
  });
});
