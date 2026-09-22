import { afterEach, describe, expect, it, vi } from "vitest";
import { UpstoxProvider } from "./upstox";
import { __testing } from "./upstox";

const { mapOhlcEntry, mapCandleRow, toNumber, toIsoFromEpochMs } = __testing;

// A symbol containing "|" is treated by resolveInstrumentKey() as an
// already-resolved instrument_key, so these HTTP-level tests never touch
// Supabase — they exercise exactly the fetch/parse/error-handling path.
const KEY = "NSE_INDEX|Nifty 50";

function withToken<T>(run: () => Promise<T>): Promise<T> {
  process.env.UPSTOX_ACCESS_TOKEN_TEST = "token-123";
  return run().finally(() => {
    delete process.env.UPSTOX_ACCESS_TOKEN_TEST;
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("UpstoxProvider.isConfigured", () => {
  it("is unconfigured with no access-token env var set", () => {
    const provider = new UpstoxProvider({}, "UPSTOX_ACCESS_TOKEN_TEST_UNSET");
    expect(provider.isConfigured()).toBe(false);
  });

  it("is configured once the named env var holds a token", () => {
    process.env.UPSTOX_ACCESS_TOKEN_TEST = "token-123";
    const provider = new UpstoxProvider({}, "UPSTOX_ACCESS_TOKEN_TEST");
    expect(provider.isConfigured()).toBe(true);
    delete process.env.UPSTOX_ACCESS_TOKEN_TEST;
  });

  it("defaults the env var name to UPSTOX_ACCESS_TOKEN when none is given", () => {
    process.env.UPSTOX_ACCESS_TOKEN = "token-abc";
    const provider = new UpstoxProvider({}, null);
    expect(provider.isConfigured()).toBe(true);
    delete process.env.UPSTOX_ACCESS_TOKEN;
  });
});

describe("mapOhlcEntry", () => {
  it("maps a real-shaped v3 OHLC response entry to a Quote", () => {
    const entry = {
      last_price: 2500.5,
      instrument_token: "NSE_EQ|INE002A01018",
      live_ohlc: { open: 2480, high: 2510, low: 2475, close: 2500.5, volume: 123456, ts: 1735689600000 },
      prev_ohlc: { open: 2460, high: 2470, low: 2455, close: 2465, volume: 98765, ts: 1735603200000 },
    };

    const quote = mapOhlcEntry(entry, "RELIANCE", "upstox");

    expect(quote).toEqual({
      symbol: "RELIANCE",
      name: null,
      lastPrice: 2500.5,
      prevClose: 2465,
      open: 2480,
      high: 2510,
      low: 2475,
      volume: 123456,
      asOf: new Date(1735689600000).toISOString(),
      source: "upstox",
    });
  });

  it("refuses to fabricate a quote when last_price is missing", () => {
    expect(mapOhlcEntry({ live_ohlc: {}, prev_ohlc: {} }, "RELIANCE", "upstox")).toBeNull();
  });

  it("refuses to fabricate a quote when last_price is zero or negative", () => {
    expect(mapOhlcEntry({ last_price: 0 }, "RELIANCE", "upstox")).toBeNull();
    expect(mapOhlcEntry({ last_price: -5 }, "RELIANCE", "upstox")).toBeNull();
  });

  it("returns null for a non-object entry", () => {
    expect(mapOhlcEntry(null, "RELIANCE", "upstox")).toBeNull();
    expect(mapOhlcEntry("not an object", "RELIANCE", "upstox")).toBeNull();
  });

  it("tolerates a missing live_ohlc/prev_ohlc (still returns the price)", () => {
    const quote = mapOhlcEntry({ last_price: 100 }, "TCS", "upstox");
    expect(quote?.lastPrice).toBe(100);
    expect(quote?.open).toBeNull();
    expect(quote?.prevClose).toBeNull();
  });
});

describe("mapCandleRow", () => {
  it("maps a real-shaped v3 historical-candle row", () => {
    const row = ["2025-01-01T00:00:00+05:30", 53.1, 53.95, 51.6, 52.05, 235519861, 0];
    expect(mapCandleRow(row)).toEqual({
      ts: new Date("2025-01-01T00:00:00+05:30").toISOString(),
      open: 53.1,
      high: 53.95,
      low: 51.6,
      close: 52.05,
      volume: 235519861,
    });
  });

  it("rejects a short or malformed row rather than guessing", () => {
    expect(mapCandleRow(["2025-01-01", 1, 2, 3])).toBeNull();
    expect(mapCandleRow(null)).toBeNull();
    expect(mapCandleRow({})).toBeNull();
  });

  it("rejects a row whose OHLC values are not numeric", () => {
    expect(mapCandleRow(["2025-01-01T00:00:00Z", "x", 2, 3, 4, 5])).toBeNull();
  });
});

describe("toNumber", () => {
  it("passes through finite numbers", () => {
    expect(toNumber(42)).toBe(42);
    expect(toNumber(0)).toBe(0);
  });

  it("parses numeric strings", () => {
    expect(toNumber("42.5")).toBe(42.5);
  });

  it("rejects non-numeric and non-finite values", () => {
    expect(toNumber("not a number")).toBeNull();
    expect(toNumber(NaN)).toBeNull();
    expect(toNumber(null)).toBeNull();
    expect(toNumber(undefined)).toBeNull();
  });
});

describe("toIsoFromEpochMs", () => {
  it("converts an epoch-ms number to an ISO string", () => {
    expect(toIsoFromEpochMs(1735689600000)).toBe(new Date(1735689600000).toISOString());
  });

  it("returns null for a non-numeric or invalid value", () => {
    expect(toIsoFromEpochMs("nonsense")).toBeNull();
    expect(toIsoFromEpochMs(undefined)).toBeNull();
  });
});

describe("UpstoxProvider.getQuotes", () => {
  it("returns [] when unconfigured (no token) without calling fetch", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const provider = new UpstoxProvider({}, "UPSTOX_ACCESS_TOKEN_TEST_UNSET");
    expect(await provider.getQuotes(["NIFTY 50"])).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("maps a real NIFTY 50 quote on success", () =>
    withToken(async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            status: "success",
            data: { [KEY]: { last_price: 24500.5, instrument_token: KEY, live_ohlc: {}, prev_ohlc: {} } },
          }),
        })
      );
      const provider = new UpstoxProvider({}, "UPSTOX_ACCESS_TOKEN_TEST");
      const quotes = await provider.getQuotes([KEY]);
      expect(quotes).toHaveLength(1);
      expect(quotes[0].lastPrice).toBe(24500.5);
    }));

  it("returns [] on an empty data response rather than a fabricated quote", () =>
    withToken(async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: "success", data: {} }) })
      );
      const provider = new UpstoxProvider({}, "UPSTOX_ACCESS_TOKEN_TEST");
      expect(await provider.getQuotes([KEY])).toEqual([]);
    }));

  it("returns [] when Upstox rejects the (invalid/expired) token with 401", () =>
    withToken(async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401 }));
      const provider = new UpstoxProvider({}, "UPSTOX_ACCESS_TOKEN_TEST");
      expect(await provider.getQuotes([KEY])).toEqual([]);
    }));

  it("returns [] rather than throwing when the Upstox API errors/is unreachable", () =>
    withToken(async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
      const provider = new UpstoxProvider({}, "UPSTOX_ACCESS_TOKEN_TEST");
      await expect(provider.getQuotes([KEY])).resolves.toEqual([]);
    }));
});

describe("UpstoxProvider.getHistoricalCandles", () => {
  const from = new Date("2025-01-01T00:00:00Z");
  const to = new Date("2025-01-31T00:00:00Z");

  it("maps candles on success", () =>
    withToken(async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            data: { candles: [["2025-01-01T00:00:00+05:30", 100, 110, 95, 105, 5000, 0]] },
          }),
        })
      );
      const provider = new UpstoxProvider({}, "UPSTOX_ACCESS_TOKEN_TEST");
      const candles = await provider.getHistoricalCandles(KEY, "1d", from, to);
      expect(candles).toHaveLength(1);
      expect(candles[0].close).toBe(105);
    }));

  it("returns [] on an empty candles array", () =>
    withToken(async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { candles: [] } }) })
      );
      const provider = new UpstoxProvider({}, "UPSTOX_ACCESS_TOKEN_TEST");
      expect(await provider.getHistoricalCandles(KEY, "1d", from, to)).toEqual([]);
    }));

  it("returns [] rather than throwing on an Upstox API error", () =>
    withToken(async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
      const provider = new UpstoxProvider({}, "UPSTOX_ACCESS_TOKEN_TEST");
      expect(await provider.getHistoricalCandles(KEY, "1d", from, to)).toEqual([]);
    }));
});

describe("UpstoxProvider.testConnection", () => {
  it("reports not-configured without calling fetch", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const provider = new UpstoxProvider({}, "UPSTOX_ACCESS_TOKEN_TEST_UNSET");
    const result = await provider.testConnection();
    expect(result.ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("distinguishes an expired/invalid token (401) from other failures", () =>
    withToken(async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: false,
          status: 401,
          json: async () => ({ status: "error", errors: [{ message: "Invalid token" }] }),
        })
      );
      const provider = new UpstoxProvider({}, "UPSTOX_ACCESS_TOKEN_TEST");
      const result = await provider.testConnection();
      expect(result.ok).toBe(false);
      expect(result.message).toMatch(/401|token/i);
    }));

  it("reports ok:true with a real LTP on success", () =>
    withToken(async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({ data: { [KEY]: { last_price: 24500.5 } } }),
        })
      );
      const provider = new UpstoxProvider({}, "UPSTOX_ACCESS_TOKEN_TEST");
      const result = await provider.testConnection();
      expect(result.ok).toBe(true);
      expect(result.message).toContain("24500.5");
    }));
});
