import { describe, expect, it } from "vitest";
import { GenericRestProvider } from "./generic-rest";
import { __testing } from "./generic-rest";

const { mapQuote, mapCandle } = __testing;

describe("GenericRestProvider.isConfigured", () => {
  it("is unconfigured with no baseUrl and no secret env var", () => {
    const provider = new GenericRestProvider({}, null);
    expect(provider.isConfigured()).toBe(false);
  });

  it("is unconfigured with a baseUrl but no matching env var set", () => {
    const provider = new GenericRestProvider(
      { baseUrl: "https://vendor.example.com" },
      "GENERIC_REST_TEST_UNSET"
    );
    expect(provider.isConfigured()).toBe(false);
  });

  it("is configured once baseUrl and the named env var are both present", () => {
    process.env.GENERIC_REST_TEST = "key-123";
    const provider = new GenericRestProvider(
      { baseUrl: "https://vendor.example.com" },
      "GENERIC_REST_TEST"
    );
    expect(provider.isConfigured()).toBe(true);
    delete process.env.GENERIC_REST_TEST;
  });
});

describe("mapQuote", () => {
  it("maps a well-shaped quote response", () => {
    const json = {
      symbol: "RELIANCE",
      name: "Reliance Industries",
      lastPrice: 2500.5,
      prevClose: 2465,
      open: 2480,
      high: 2510,
      low: 2475,
      volume: 123456,
      asOf: "2025-01-01T00:00:00.000Z",
    };
    expect(mapQuote(json, "generic_rest")).toEqual({
      symbol: "RELIANCE",
      name: "Reliance Industries",
      lastPrice: 2500.5,
      prevClose: 2465,
      open: 2480,
      high: 2510,
      low: 2475,
      volume: 123456,
      asOf: "2025-01-01T00:00:00.000Z",
      source: "generic_rest",
    });
  });

  it("refuses to fabricate a quote when symbol or lastPrice is missing", () => {
    expect(mapQuote({ lastPrice: 100 }, "generic_rest")).toBeNull();
    expect(mapQuote({ symbol: "TCS" }, "generic_rest")).toBeNull();
  });

  it("returns null for a non-object response", () => {
    expect(mapQuote(null, "generic_rest")).toBeNull();
    expect(mapQuote("not an object", "generic_rest")).toBeNull();
  });

  it("tolerates missing optional fields without inventing values", () => {
    const quote = mapQuote({ symbol: "TCS", lastPrice: 100 }, "generic_rest");
    expect(quote?.prevClose).toBeNull();
    expect(quote?.name).toBeNull();
    expect(quote?.volume).toBeNull();
  });
});

describe("mapCandle", () => {
  it("maps a well-shaped candle row", () => {
    const row = {
      ts: "2025-01-01T00:00:00.000Z",
      open: 53.1,
      high: 53.95,
      low: 51.6,
      close: 52.05,
      volume: 235519861,
    };
    expect(mapCandle(row)).toEqual(row);
  });

  it("rejects a row missing required OHLC fields", () => {
    expect(mapCandle({ ts: "2025-01-01T00:00:00.000Z", open: 1 })).toBeNull();
    expect(mapCandle(null)).toBeNull();
    expect(mapCandle("not an object")).toBeNull();
  });

  it("rejects a row whose numeric fields are not numbers", () => {
    expect(
      mapCandle({ ts: "2025-01-01T00:00:00.000Z", open: "x", high: 2, low: 3, close: 4 })
    ).toBeNull();
  });

  it("tolerates a missing volume", () => {
    const candle = mapCandle({
      ts: "2025-01-01T00:00:00.000Z",
      open: 1,
      high: 2,
      low: 0.5,
      close: 1.5,
    });
    expect(candle?.volume).toBeNull();
  });
});
