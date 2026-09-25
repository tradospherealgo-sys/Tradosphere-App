import { beforeEach, describe, expect, it, vi } from "vitest";

// The decorator write-through targets Supabase purely as an observability
// record. Stubbing it keeps these tests hermetic and proves the read path
// never depends on the table.
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({ upsert: async () => ({ error: null }) }),
  }),
}));

import { CachedMarketDataProvider, __clearMarketDataCaches } from "./cache";
import type {
  Candle,
  CandleInterval,
  MarketDataProvider,
  ProviderTestResult,
  Quote,
} from "./types";

function quote(symbol: string, price: number, asOf = new Date().toISOString()): Quote {
  return {
    symbol,
    name: symbol,
    lastPrice: price,
    prevClose: null,
    open: null,
    high: null,
    low: null,
    volume: null,
    asOf,
    source: "fake",
  };
}

/** A provider whose every response and failure mode is scripted by the test. */
class FakeProvider implements MarketDataProvider {
  readonly name = "fake";
  readonly label = "Fake";
  quoteCalls = 0;
  batchCalls: string[][] = [];
  candleCalls = 0;
  configured = true;
  throwTimes = 0;
  nextQuote: Quote | null = quote("RELIANCE", 100);
  nextCandles: Candle[] = [
    { ts: "2026-09-08T00:00:00.000Z", open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 },
  ];
  delayMs = 0;

  isConfigured() {
    return this.configured;
  }

  private async maybeFail() {
    if (this.delayMs > 0) await new Promise((r) => setTimeout(r, this.delayMs));
    if (this.throwTimes > 0) {
      this.throwTimes -= 1;
      throw new Error("upstream blew up");
    }
  }

  async getQuote(): Promise<Quote | null> {
    this.quoteCalls += 1;
    await this.maybeFail();
    return this.nextQuote;
  }

  async getQuotes(symbols: string[]): Promise<Quote[]> {
    this.batchCalls.push(symbols);
    await this.maybeFail();
    return symbols.map((s) => quote(s, 100));
  }

  async getHistoricalCandles(): Promise<Candle[]> {
    this.candleCalls += 1;
    await this.maybeFail();
    return this.nextCandles;
  }

  async testConnection(): Promise<ProviderTestResult> {
    return { ok: true, message: "ok", testedAt: new Date().toISOString() };
  }
}

let inner: FakeProvider;
let provider: CachedMarketDataProvider;

beforeEach(() => {
  __clearMarketDataCaches();
  inner = new FakeProvider();
  provider = new CachedMarketDataProvider(inner);
});

describe("CachedMarketDataProvider.getQuote", () => {
  it("serves a repeat request from cache instead of hitting upstream twice", async () => {
    expect((await provider.getQuote("RELIANCE"))?.lastPrice).toBe(100);
    expect((await provider.getQuote("RELIANCE"))?.lastPrice).toBe(100);
    expect(inner.quoteCalls).toBe(1);
  });

  it("treats the symbol case-insensitively when keying the cache", async () => {
    await provider.getQuote("reliance");
    await provider.getQuote("RELIANCE");
    expect(inner.quoteCalls).toBe(1);
  });

  it("collapses concurrent identical requests onto one upstream call", async () => {
    inner.delayMs = 20;
    const results = await Promise.all([
      provider.getQuote("RELIANCE"),
      provider.getQuote("RELIANCE"),
      provider.getQuote("RELIANCE"),
    ]);
    expect(results.every((r) => r?.lastPrice === 100)).toBe(true);
    expect(inner.quoteCalls).toBe(1);
  });

  it("returns null without calling upstream when the provider is unconfigured", async () => {
    inner.configured = false;
    expect(await provider.getQuote("RELIANCE")).toBeNull();
    expect(inner.quoteCalls).toBe(0);
  });

  it("retries once past a transient upstream failure", async () => {
    inner.throwTimes = 1;
    expect((await provider.getQuote("RELIANCE"))?.lastPrice).toBe(100);
    expect(inner.quoteCalls).toBe(2);
  });

  it("gives up after the single retry rather than serving anything", async () => {
    inner.throwTimes = 5;
    expect(await provider.getQuote("RELIANCE")).toBeNull();
    expect(inner.quoteCalls).toBe(2);
  });

  it("does not retry a null result, which is a real answer and not an error", async () => {
    inner.nextQuote = null;
    expect(await provider.getQuote("UNKNOWN")).toBeNull();
    expect(inner.quoteCalls).toBe(1);
  });

  it("never serves the last-seen price once upstream starts failing", async () => {
    // The dangerous failure mode: a cached-but-stale price presented as
    // current is indistinguishable from a fabricated one at the fill.
    expect((await provider.getQuote("RELIANCE"))?.lastPrice).toBe(100);
    __clearMarketDataCaches();
    inner.throwTimes = 5;
    expect(await provider.getQuote("RELIANCE")).toBeNull();
  });

  describe("maxStaleMs", () => {
    it("rejects a successful fetch whose asOf is older than the caller's bound", async () => {
      inner.nextQuote = quote("RELIANCE", 100, new Date(Date.now() - 120_000).toISOString());
      expect(await provider.getQuote("RELIANCE", { maxStaleMs: 60_000 })).toBeNull();
    });

    it("accepts a fetch inside the bound", async () => {
      inner.nextQuote = quote("RELIANCE", 100, new Date(Date.now() - 5_000).toISOString());
      const result = await provider.getQuote("RELIANCE", { maxStaleMs: 60_000 });
      expect(result?.lastPrice).toBe(100);
    });

    it("refetches when the cached entry no longer satisfies a tighter bound", async () => {
      inner.nextQuote = quote("RELIANCE", 100, new Date(Date.now() - 30_000).toISOString());
      await provider.getQuote("RELIANCE"); // unbounded caller populates the cache
      expect(inner.quoteCalls).toBe(1);

      // A fill-path caller will not accept that 30s-old price and must not be
      // handed it just because someone else cached it.
      expect(await provider.getQuote("RELIANCE", { maxStaleMs: 1_000 })).toBeNull();
      expect(inner.quoteCalls).toBe(2);
    });

    it("treats an unparseable asOf as infinitely stale", async () => {
      inner.nextQuote = quote("RELIANCE", 100, "not-a-timestamp");
      expect(await provider.getQuote("RELIANCE", { maxStaleMs: 60_000 })).toBeNull();
    });
  });
});

describe("CachedMarketDataProvider circuit breaker", () => {
  it("keeps hitting upstream through failures below the breaker threshold", async () => {
    inner.throwTimes = 100;
    await provider.getQuote("A");
    await provider.getQuote("B");
    // Two attempts (initial + retry) per call, none of them short-circuited.
    expect(inner.quoteCalls).toBe(4);
  });

  it("opens after enough consecutive fully-failed calls and stops calling upstream", async () => {
    inner.throwTimes = 100;
    await provider.getQuote("A"); // failure 1 (2 attempts)
    await provider.getQuote("B"); // failure 2 (2 attempts)
    await provider.getQuote("C"); // failure 3 (2 attempts) -> breaker opens
    expect(inner.quoteCalls).toBe(6);

    expect(await provider.getQuote("D")).toBeNull();
    expect(inner.quoteCalls).toBe(6); // short-circuited, no upstream call at all
  });

  it("closes again on the next success once the cooldown elapses", async () => {
    // Only Date is faked: the breaker's cooldown check reads Date.now(), but
    // withRetry's real 250ms backoff timer must still fire on its own so the
    // getQuote calls above actually resolve.
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      inner.throwTimes = 100;
      await provider.getQuote("A");
      await provider.getQuote("B");
      await provider.getQuote("C"); // opens the breaker
      expect(inner.quoteCalls).toBe(6);

      expect(await provider.getQuote("D")).toBeNull();
      expect(inner.quoteCalls).toBe(6); // still open, still short-circuited

      vi.advanceTimersByTime(30_000);
      inner.throwTimes = 0;
      expect((await provider.getQuote("E"))?.lastPrice).toBe(100);
      expect(inner.quoteCalls).toBe(7); // cooldown elapsed, upstream reached again
    } finally {
      vi.useRealTimers();
    }
  });

  it("is scoped per provider, not shared across every symbol globally", async () => {
    // A different CachedMarketDataProvider instance (a different upstream
    // provider) must not be tripped by another provider's failures.
    const otherInner = new FakeProvider();
    (otherInner as { name: string }).name = "other";
    const otherProvider = new CachedMarketDataProvider(otherInner);

    inner.throwTimes = 100;
    await provider.getQuote("A");
    await provider.getQuote("B");
    await provider.getQuote("C"); // trips the "fake" breaker only

    expect((await otherProvider.getQuote("A"))?.lastPrice).toBe(100);
    expect(otherInner.quoteCalls).toBe(1);
  });
});

describe("CachedMarketDataProvider.getQuotes", () => {
  it("asks upstream only for the symbols it does not already hold", async () => {
    await provider.getQuote("RELIANCE");
    const results = await provider.getQuotes(["RELIANCE", "TCS", "INFY"]);
    expect(results.map((r) => r.symbol).sort()).toEqual(["INFY", "RELIANCE", "TCS"]);
    expect(inner.batchCalls).toEqual([["TCS", "INFY"]]);
  });

  it("deduplicates the requested symbol list", async () => {
    await provider.getQuotes(["TCS", "tcs", "TCS"]);
    expect(inner.batchCalls).toEqual([["TCS"]]);
  });

  it("returns an empty array without calling upstream for an empty request", async () => {
    expect(await provider.getQuotes([])).toEqual([]);
    expect(inner.batchCalls).toEqual([]);
  });

  it("drops individual quotes that breach the caller's freshness bound", async () => {
    const stale = quote("TCS", 100, new Date(Date.now() - 120_000).toISOString());
    inner.getQuotes = async () => [stale, quote("INFY", 200)];
    const results = await provider.getQuotes(["TCS", "INFY"], { maxStaleMs: 60_000 });
    expect(results.map((r) => r.symbol)).toEqual(["INFY"]);
  });
});

describe("CachedMarketDataProvider.getHistoricalCandles", () => {
  const from = new Date("2026-09-01T00:00:00.000Z");
  const to = new Date("2026-09-09T00:00:00.000Z");

  it("caches a window so a re-rendering chart does not refetch", async () => {
    await provider.getHistoricalCandles("RELIANCE", "1d", from, to);
    await provider.getHistoricalCandles("RELIANCE", "1d", from, to);
    expect(inner.candleCalls).toBe(1);
  });

  it("keys the cache by interval", async () => {
    await provider.getHistoricalCandles("RELIANCE", "1d", from, to);
    await provider.getHistoricalCandles("RELIANCE", "5m", from, to);
    expect(inner.candleCalls).toBe(2);
  });

  it("does not cache an empty result, so a recovered upstream is picked up", async () => {
    inner.nextCandles = [];
    expect(await provider.getHistoricalCandles("RELIANCE", "1d", from, to)).toEqual([]);
    inner.nextCandles = [
      { ts: "2026-09-08T00:00:00.000Z", open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 },
    ];
    expect(await provider.getHistoricalCandles("RELIANCE", "1d", from, to)).toHaveLength(1);
    expect(inner.candleCalls).toBe(2);
  });

  it("returns an empty array for an unconfigured provider", async () => {
    inner.configured = false;
    expect(await provider.getHistoricalCandles("RELIANCE", "1d", from, to)).toEqual([]);
    expect(inner.candleCalls).toBe(0);
  });
});

describe("CachedMarketDataProvider.testConnection", () => {
  it("passes straight through, so an admin sees this attempt's real result", async () => {
    const spy = vi.spyOn(inner, "testConnection");
    await provider.testConnection();
    await provider.testConnection();
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe("interface conformance", () => {
  it("reports the wrapped provider's identity, not its own", () => {
    expect(provider.name).toBe("fake");
    expect(provider.label).toBe("Fake");
  });

  it("accepts any CandleInterval", () => {
    const intervals: CandleInterval[] = ["1m", "5m", "15m", "1h", "1d"];
    expect(intervals).toHaveLength(5);
  });
});
