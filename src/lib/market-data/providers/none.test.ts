import { describe, expect, it } from "vitest";
import { NoneProvider } from "./none";

describe("NoneProvider", () => {
  const provider = new NoneProvider();

  it("reports itself as not configured", () => {
    expect(provider.isConfigured()).toBe(false);
  });

  it("never fabricates a quote", async () => {
    expect(await provider.getQuote("RELIANCE")).toBeNull();
    expect(await provider.getQuotes(["RELIANCE", "TCS"])).toEqual([]);
  });

  it("never fabricates historical candles", async () => {
    const candles = await provider.getHistoricalCandles(
      "RELIANCE",
      "1d",
      new Date("2024-01-01"),
      new Date("2024-01-31")
    );
    expect(candles).toEqual([]);
  });

  it("reports a failing test-connection result explaining why", async () => {
    const result = await provider.testConnection();
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/no market-data provider is configured/i);
  });
});
